import { Router } from 'express';
import { pool } from '../db.js';
import { logAudit } from '../audit.js';
import { uid, HttpError, withTransaction } from '../utils.js';

const router = Router();
const STATUSES = ['disponivel', 'locado', 'higienizacao', 'manutencao', 'extraviado', 'baixado'];

function toAsset(r){
  return {
    id: r.id, productTypeId: r.product_type_id, productName: r.product_name, category: r.category,
    code: r.code, status: r.status, notes: r.notes, acquiredAt: r.acquired_at,
    currentRental: r.rental_id ? { id: r.rental_id, clientName: r.client_name, endDate: r.rental_end } : null,
  };
}

const SELECT = `
  SELECT a.*, pt.name AS product_name, pt.category,
         cur.rental_id, cur.client_name, cur.rental_end
    FROM assets a
    JOIN product_types pt ON pt.id = a.product_type_id
    LEFT JOIN LATERAL (
      SELECT ra.rental_id, c.name AS client_name, r.end_date AS rental_end
        FROM rental_assets ra
        JOIN rentals r ON r.id = ra.rental_id
        LEFT JOIN clients c ON c.id = r.client_id
       WHERE ra.asset_id = a.id AND ra.returned_at IS NULL
       ORDER BY ra.delivered_at DESC LIMIT 1
    ) cur ON true`;

// ?productTypeId=...&status=disponivel,higienizacao&code=BQ-01
router.get('/', async (req, res) => {
  const conds = [], params = [];
  if(req.query.productTypeId){ params.push(req.query.productTypeId); conds.push(`a.product_type_id = $${params.length}`); }
  if(req.query.status){ params.push(req.query.status.split(',')); conds.push(`a.status = ANY($${params.length})`); }
  if(req.query.code){ params.push(`%${req.query.code}%`); conds.push(`a.code ILIKE $${params.length}`); }
  const { rows } = await pool.query(
    `${SELECT} ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY pt.category, pt.name, a.code`,
    params
  );
  res.json(rows.map(toAsset));
});

// Resumo para o painel: quantas unidades de cada produto em cada status
router.get('/summary', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT pt.id, pt.name, pt.category, a.status, count(a.id)::int AS n
       FROM product_types pt LEFT JOIN assets a ON a.product_type_id = pt.id
      WHERE pt.active
      GROUP BY pt.id, pt.name, pt.category, a.status
      ORDER BY pt.category, pt.name`
  );
  const out = {};
  for(const r of rows){
    out[r.id] ||= { productTypeId: r.id, name: r.name, category: r.category, total: 0, byStatus: {} };
    if(r.status){ out[r.id].byStatus[r.status] = r.n; out[r.id].total += r.n; }
  }
  res.json(Object.values(out));
});

router.post('/', async (req, res) => {
  const { productTypeId, code, status, notes, acquiredAt } = req.body;
  if(!productTypeId || !code) throw new HttpError(400, 'Informe o produto e o código (patrimônio).');
  if(status && !STATUSES.includes(status)) throw new HttpError(400, 'Status inválido.');
  const id = req.body.id || uid();
  await pool.query(
    `INSERT INTO assets (id, product_type_id, code, status, notes, acquired_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, productTypeId, code.trim().toUpperCase(), status || 'disponivel', notes || null, acquiredAt || null]
  );
  await logAudit(req.user, 'create', 'asset', code);
  const { rows } = await pool.query(`${SELECT} WHERE a.id=$1`, [id]);
  res.status(201).json(toAsset(rows[0]));
});

// Cadastro em lote: { productTypeId, prefix: "BQ", count: 30, startNumber: 1, digits: 3 } -> BQ-001 ... BQ-030
router.post('/bulk', async (req, res) => {
  const { productTypeId, prefix, count, startNumber = 1, digits = 3 } = req.body;
  const n = parseInt(count);
  if(!productTypeId || !prefix || !(n > 0 && n <= 1000)) {
    throw new HttpError(400, 'Informe produto, prefixo e quantidade (1 a 1000).');
  }
  const result = await withTransaction(async db => {
    let created = 0;
    const skipped = [];
    for(let i = 0; i < n; i++){
      const code = `${prefix.trim().toUpperCase()}-${String(Number(startNumber) + i).padStart(digits, '0')}`;
      const r = await db.query(
        `INSERT INTO assets (id, product_type_id, code) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING`,
        [uid(), productTypeId, code]
      );
      if(r.rowCount) created++; else skipped.push(code);
    }
    return { created, skipped };
  });
  await logAudit(req.user, 'create', 'asset', `Cadastro em lote (${result.created} unidades, prefixo ${prefix})`);
  res.status(201).json(result);
});

router.put('/:id', async (req, res) => {
  const { productTypeId, code, notes, acquiredAt } = req.body;
  if(!productTypeId || !code) throw new HttpError(400, 'Informe o produto e o código.');
  const r = await pool.query(
    `UPDATE assets SET product_type_id=$1, code=$2, notes=$3, acquired_at=$4 WHERE id=$5`,
    [productTypeId, code.trim().toUpperCase(), notes || null, acquiredAt || null, req.params.id]
  );
  if(!r.rowCount) throw new HttpError(404, 'Unidade não encontrada.');
  await logAudit(req.user, 'update', 'asset', code);
  const { rows } = await pool.query(`${SELECT} WHERE a.id=$1`, [req.params.id]);
  res.json(toAsset(rows[0]));
});

// Mudança manual de status no pátio (ex.: terminou a higienização -> disponivel)
router.put('/:id/status', async (req, res) => {
  const { status, notes } = req.body;
  if(!STATUSES.includes(status)) throw new HttpError(400, 'Status inválido.');
  if(status === 'locado') throw new HttpError(400, 'O status "locado" é definido pela entrega no app da equipe.');
  const { rows } = await pool.query('SELECT code, status FROM assets WHERE id=$1', [req.params.id]);
  if(!rows[0]) throw new HttpError(404, 'Unidade não encontrada.');
  await withTransaction(async db => {
    await db.query('UPDATE assets SET status=$1 WHERE id=$2', [status, req.params.id]);
    await db.query(
      `INSERT INTO asset_movements (id, asset_id, movement, notes) VALUES ($1,$2,'ajuste',$3)`,
      [uid(), req.params.id, `${rows[0].status} → ${status}${notes ? ' — ' + notes : ''}`]
    );
  });
  await logAudit(req.user, 'update', 'asset', rows[0].code, { from: rows[0].status, to: status });
  res.json({ id: req.params.id, status });
});

router.get('/:id/history', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT m.*, c.name AS client_name, s.name AS site_name
       FROM asset_movements m
       LEFT JOIN rentals r ON r.id = m.rental_id
       LEFT JOIN clients c ON c.id = r.client_id
       LEFT JOIN sites s ON s.id = r.site_id
      WHERE m.asset_id = $1
      ORDER BY m.created_at DESC`,
    [req.params.id]
  );
  res.json(rows.map(m => ({
    id: m.id, movement: m.movement, condition: m.condition, notes: m.notes, teamId: m.team_id,
    rentalId: m.rental_id, appointmentId: m.appointment_id,
    clientName: m.client_name, siteName: m.site_name, createdAt: m.created_at,
  })));
});

router.delete('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT code FROM assets WHERE id=$1', [req.params.id]);
  try{
    await pool.query('DELETE FROM assets WHERE id=$1', [req.params.id]);
  }catch(err){
    if(err.code === '23503') throw new HttpError(409, 'Essa unidade já participou de locações. Use o status "baixado" em vez de excluir.');
    throw err;
  }
  await logAudit(req.user, 'delete', 'asset', rows[0]?.code);
  res.status(204).end();
});

export default router;
