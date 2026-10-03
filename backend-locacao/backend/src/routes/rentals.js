import { Router } from 'express';
import { pool } from '../db.js';
import { logAudit } from '../audit.js';
import { uid, isDate, diffDays, toNumber, HttpError, withTransaction } from '../utils.js';
import { getAvailability, findShortages, lockAvailability } from '../services/availability.js';
import { generateAppointments } from '../services/schedule.js';

const router = Router();
const ACTIVE = ['confirmado', 'em_andamento'];

const SELECT = `
  SELECT r.*, c.name AS client_name, s.name AS site_name, s.address AS site_address,
    COALESCE((
      SELECT json_agg(json_build_object(
               'productTypeId', ri.product_type_id, 'name', pt.name, 'category', pt.category,
               'quantity', ri.quantity, 'unitPrice', ri.unit_price)
             ORDER BY pt.category, pt.name)
        FROM rental_items ri JOIN product_types pt ON pt.id = ri.product_type_id
       WHERE ri.rental_id = r.id), '[]') AS items
  FROM rentals r
  LEFT JOIN clients c ON c.id = r.client_id
  LEFT JOIN sites s ON s.id = r.site_id`;

function toRental(r){
  return {
    id: r.id, clientId: r.client_id, clientName: r.client_name,
    siteId: r.site_id, siteName: r.site_name, siteAddress: r.site_address,
    startDate: r.start_date, endDate: r.end_date, status: r.status, teamId: r.team_id,
    totalValue: r.total_value, notes: r.notes, items: r.items || [], createdAt: r.created_at,
  };
}

async function fetchRental(db, id){
  const { rows } = await db.query(`${SELECT} WHERE r.id=$1`, [id]);
  if(!rows[0]) throw new HttpError(404, 'Locação não encontrada.');
  return toRental(rows[0]);
}

function validate(body){
  const { clientId, startDate, endDate, items } = body;
  if(!clientId) throw new HttpError(400, 'Selecione o cliente.');
  if(!isDate(startDate) || !isDate(endDate)) throw new HttpError(400, 'Datas inválidas (use AAAA-MM-DD).');
  if(endDate < startDate) throw new HttpError(400, 'A data de retirada não pode ser antes da entrega.');
  if(!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Adicione pelo menos um item.');
  for(const it of items){
    const q = Number(it.quantity);
    if(!it.productTypeId || !Number.isInteger(q) || q <= 0) {
      throw new HttpError(400, 'Há um item com produto ou quantidade inválida.');
    }
  }
}

// Grava os itens e devolve o valor calculado.
// unitPrice = diária por unidade; se não vier, usa a diária do cadastro do produto.
// Dias cobrados = da entrega até a retirada, contando os dois.
async function saveItems(db, rentalId, items, startDate, endDate){
  await db.query('DELETE FROM rental_items WHERE rental_id=$1', [rentalId]);
  const { rows } = await db.query(
    'SELECT id, daily_price FROM product_types WHERE id = ANY($1)',
    [items.map(i => i.productTypeId)]
  );
  const priceById = Object.fromEntries(rows.map(r => [r.id, r.daily_price]));
  const days = diffDays(startDate, endDate) + 1;
  let total = 0;
  for(const it of items){
    if(!(it.productTypeId in priceById)) throw new HttpError(400, 'Produto não encontrado no catálogo.');
    const unitPrice = toNumber(it.unitPrice) ?? priceById[it.productTypeId];
    await db.query(
      'INSERT INTO rental_items (id, rental_id, product_type_id, quantity, unit_price) VALUES ($1,$2,$3,$4,$5)',
      [uid(), rentalId, it.productTypeId, Number(it.quantity), unitPrice ?? null]
    );
    if(unitPrice) total += unitPrice * Number(it.quantity) * days;
  }
  return Math.round(total * 100) / 100;
}

// --- Listagem: ?status=confirmado,em_andamento&from=2026-10-01&to=2026-10-31&clientId=...
router.get('/', async (req, res) => {
  const conds = [], params = [];
  if(req.query.status){ params.push(req.query.status.split(',')); conds.push(`r.status = ANY($${params.length})`); }
  if(req.query.from){ params.push(req.query.from); conds.push(`r.end_date >= $${params.length}`); }
  if(req.query.to){ params.push(req.query.to); conds.push(`r.start_date <= $${params.length}`); }
  if(req.query.clientId){ params.push(req.query.clientId); conds.push(`r.client_id = $${params.length}`); }
  const { rows } = await pool.query(
    `${SELECT} ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY r.start_date DESC`,
    params
  );
  res.json(rows.map(toRental));
});

// --- Disponibilidade: ?start=2026-10-10&end=2026-10-12&excludeRentalId=...
router.get('/availability', async (req, res) => {
  const { start, end, excludeRentalId } = req.query;
  if(!isDate(start) || !isDate(end) || end < start) throw new HttpError(400, 'Informe início e fim válidos.');
  res.json(await getAvailability(pool, start, end, excludeRentalId || null));
});

// --- Detalhe com unidades alocadas e O.S.
router.get('/:id', async (req, res) => {
  const rental = await fetchRental(pool, req.params.id);
  const assets = await pool.query(
    `SELECT a.id, a.code, pt.name AS product_name, ra.delivered_at, ra.returned_at, ra.return_condition
       FROM rental_assets ra JOIN assets a ON a.id = ra.asset_id
       JOIN product_types pt ON pt.id = a.product_type_id
      WHERE ra.rental_id = $1 ORDER BY a.code`,
    [req.params.id]
  );
  const appts = await pool.query(
    `SELECT id, date, kind, status, team_id, notes, time_window FROM appointments
      WHERE rental_id = $1 ORDER BY date, created_at`,
    [req.params.id]
  );
  res.json({
    ...rental,
    assets: assets.rows.map(a => ({
      id: a.id, code: a.code, productName: a.product_name,
      deliveredAt: a.delivered_at, returnedAt: a.returned_at, returnCondition: a.return_condition,
    })),
    appointments: appts.rows.map(a => ({
      id: a.id, date: a.date, kind: a.kind, status: a.status, teamId: a.team_id,
      notes: a.notes, timeWindow: a.time_window,
    })),
  });
});

// --- Criar (sempre nasce como orçamento; não reserva estoque ainda)
router.post('/', async (req, res) => {
  validate(req.body);
  const { clientId, siteId, startDate, endDate, items, notes, teamId, totalValue } = req.body;
  const id = req.body.id || uid();
  const rental = await withTransaction(async db => {
    await db.query(
      `INSERT INTO rentals (id, client_id, site_id, start_date, end_date, status, team_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,'orcamento',$6,$7,$8)`,
      [id, clientId, siteId || null, startDate, endDate, teamId || null, notes || null, req.user.id]
    );
    const computed = await saveItems(db, id, items, startDate, endDate);
    await db.query('UPDATE rentals SET total_value=$1 WHERE id=$2', [toNumber(totalValue) ?? computed, id]);
    return fetchRental(db, id);
  });
  // Aviso antecipado: o orçamento é salvo mesmo se faltar estoque
  const shortages = await findShortages(pool, startDate, endDate, items, id);
  await logAudit(req.user, 'create', 'rental', `${rental.clientName} — ${startDate} a ${endDate}`);
  res.status(201).json({ ...rental, shortages });
});

// --- Editar. Se já confirmada, revalida estoque e regenera as O.S. pendentes.
router.put('/:id', async (req, res) => {
  validate(req.body);
  const { clientId, siteId, startDate, endDate, items, notes, teamId, totalValue } = req.body;
  const { id } = req.params;
  const out = await withTransaction(async db => {
    await lockAvailability(db);
    const { rows: [cur] } = await db.query('SELECT * FROM rentals WHERE id=$1 FOR UPDATE', [id]);
    if(!cur) throw new HttpError(404, 'Locação não encontrada.');
    if(['encerrado', 'cancelado'].includes(cur.status)) {
      throw new HttpError(409, 'Locações encerradas ou canceladas não podem ser editadas.');
    }
    const active = ACTIVE.includes(cur.status);
    if(active){
      const shortages = await findShortages(db, startDate, endDate, items, id);
      if(shortages.length) throw new HttpError(409, 'Não há estoque suficiente para essa alteração.', { shortages });
    }
    await db.query(
      `UPDATE rentals SET client_id=$1, site_id=$2, start_date=$3, end_date=$4, team_id=$5, notes=$6 WHERE id=$7`,
      [clientId, siteId || null, startDate, endDate, teamId || cur.team_id, notes || null, id]
    );
    const computed = await saveItems(db, id, items, startDate, endDate);
    await db.query('UPDATE rentals SET total_value=$1 WHERE id=$2', [toNumber(totalValue) ?? computed, id]);
    const generated = active ? await generateAppointments(db, id) : 0;
    return { rental: await fetchRental(db, id), generated };
  });
  await logAudit(req.user, 'update', 'rental', `${out.rental.clientName} — ${startDate} a ${endDate}`);
  res.json({ ...out.rental, generatedAppointments: out.generated });
});

// --- Confirmar: reserva o estoque e gera entrega, limpezas e retirada
router.post('/:id/confirm', async (req, res) => {
  const { id } = req.params;
  const out = await withTransaction(async db => {
    await lockAvailability(db);
    const { rows: [cur] } = await db.query('SELECT * FROM rentals WHERE id=$1 FOR UPDATE', [id]);
    if(!cur) throw new HttpError(404, 'Locação não encontrada.');
    if(cur.status !== 'orcamento') throw new HttpError(409, 'Somente orçamentos podem ser confirmados.');
    const teamId = req.body.teamId || cur.team_id;
    if(!teamId) throw new HttpError(400, 'Escolha a equipe responsável.');

    const { rows: items } = await db.query(
      'SELECT product_type_id AS "productTypeId", quantity FROM rental_items WHERE rental_id=$1', [id]
    );
    const shortages = await findShortages(db, cur.start_date, cur.end_date, items, id);
    if(shortages.length) throw new HttpError(409, 'Não há estoque suficiente para confirmar.', { shortages });

    await db.query(`UPDATE rentals SET status='confirmado', team_id=$2 WHERE id=$1`, [id, teamId]);
    const generated = await generateAppointments(db, id);
    return { rental: await fetchRental(db, id), generated };
  });
  await logAudit(req.user, 'update', 'rental', `Confirmada — ${out.rental.clientName}`, { generated: out.generated });
  res.json({ ...out.rental, generatedAppointments: out.generated });
});

// --- Cancelar (só antes de os equipamentos saírem)
router.post('/:id/cancel', async (req, res) => {
  const { id } = req.params;
  const rental = await withTransaction(async db => {
    const { rows: [cur] } = await db.query('SELECT * FROM rentals WHERE id=$1 FOR UPDATE', [id]);
    if(!cur) throw new HttpError(404, 'Locação não encontrada.');
    if(!['orcamento', 'confirmado'].includes(cur.status)) {
      throw new HttpError(409, 'Essa locação já está em andamento. Faça a retirada e encerre em vez de cancelar.');
    }
    await db.query(`DELETE FROM appointments WHERE rental_id=$1 AND status='pendente'`, [id]);
    await db.query(`UPDATE rentals SET status='cancelado', notes=concat_ws(E'\n', notes, $2::text) WHERE id=$1`,
      [id, req.body.reason ? `Cancelada: ${req.body.reason}` : null]);
    return fetchRental(db, id);
  });
  await logAudit(req.user, 'update', 'rental', `Cancelada — ${rental.clientName}`, { reason: req.body.reason });
  res.json(rental);
});

// --- Encerrar manualmente.
// Se ainda houver unidades no local, é preciso dizer o que aconteceu com elas:
// { missingAssetsStatus: "extraviado" | "higienizacao" }
router.post('/:id/close', async (req, res) => {
  const { id } = req.params;
  const { missingAssetsStatus } = req.body;
  const rental = await withTransaction(async db => {
    const { rows: [cur] } = await db.query('SELECT * FROM rentals WHERE id=$1 FOR UPDATE', [id]);
    if(!cur) throw new HttpError(404, 'Locação não encontrada.');
    if(!ACTIVE.includes(cur.status)) throw new HttpError(409, 'Só locações confirmadas ou em andamento podem ser encerradas.');

    const { rows: missing } = await db.query(
      `SELECT a.id, a.code FROM rental_assets ra JOIN assets a ON a.id = ra.asset_id
        WHERE ra.rental_id=$1 AND ra.returned_at IS NULL`, [id]
    );
    if(missing.length){
      if(!['extraviado', 'higienizacao'].includes(missingAssetsStatus)){
        throw new HttpError(409, `${missing.length} unidade(s) ainda constam no local.`, {
          missingAssets: missing.map(m => m.code),
        });
      }
      for(const m of missing){
        await db.query(
          `UPDATE rental_assets SET returned_at=now(), return_condition=$3 WHERE rental_id=$1 AND asset_id=$2`,
          [id, m.id, missingAssetsStatus === 'extraviado' ? 'extraviado' : 'ok']
        );
        await db.query('UPDATE assets SET status=$1 WHERE id=$2', [missingAssetsStatus, m.id]);
        await db.query(
          `INSERT INTO asset_movements (id, asset_id, rental_id, movement, condition, notes)
           VALUES ($1,$2,$3,'retorno',$4,'Baixa manual no encerramento')`,
          [uid(), m.id, id, missingAssetsStatus === 'extraviado' ? 'extraviado' : 'ok']
        );
      }
    }
    await db.query(`DELETE FROM appointments WHERE rental_id=$1 AND status='pendente'`, [id]);
    await db.query(`UPDATE rentals SET status='encerrado' WHERE id=$1`, [id]);
    return fetchRental(db, id);
  });
  await logAudit(req.user, 'update', 'rental', `Encerrada — ${rental.clientName}`);
  res.json(rental);
});

router.delete('/:id', async (req, res) => {
  const { rows: [cur] } = await pool.query(
    `SELECT r.status, c.name FROM rentals r LEFT JOIN clients c ON c.id=r.client_id WHERE r.id=$1`, [req.params.id]
  );
  if(!cur) throw new HttpError(404, 'Locação não encontrada.');
  if(!['orcamento', 'cancelado'].includes(cur.status)) {
    throw new HttpError(409, 'Só é possível excluir orçamentos ou locações canceladas.');
  }
  await pool.query('DELETE FROM rentals WHERE id=$1', [req.params.id]);
  await logAudit(req.user, 'delete', 'rental', cur.name);
  res.status(204).end();
});

export default router;
