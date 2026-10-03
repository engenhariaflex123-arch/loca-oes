import { Router } from 'express';
import { pool } from '../db.js';
import { logAudit } from '../audit.js';

const router = Router();

function toCoord(v){
  if(v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function toClient(row){
  return {
    id: row.id, name: row.name, address: row.address, phone: row.phone,
    lat: row.lat, lon: row.lon, notes: row.notes,
  };
}

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM clients ORDER BY created_at ASC');
  res.json(rows.map(toClient));
});

router.post('/', async (req, res) => {
  const { id, name, address, phone, lat, lon, notes } = req.body;
  await pool.query(
    `INSERT INTO clients (id, name, address, phone, lat, lon, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, name, address || '', phone || null, toCoord(lat), toCoord(lon), notes || null]
  );
  await logAudit(req.user, 'create', 'client', name);
  res.status(201).json(req.body);
});

router.post('/bulk', async (req, res) => {
  const { clients } = req.body;
  if(!Array.isArray(clients) || clients.length === 0){
    return res.status(400).json({ error: 'Nenhum cliente enviado.' });
  }
  const dbClient = await pool.connect();
  let created = 0;
  try{
    await dbClient.query('BEGIN');
    for(const c of clients){
      await dbClient.query(
        `INSERT INTO clients (id, name, address, phone, lat, lon, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [c.id, c.name, c.address || '', c.phone || null, toCoord(c.lat), toCoord(c.lon), c.notes || null]
      );
      created++;
    }
    await dbClient.query('COMMIT');
  }catch(err){
    await dbClient.query('ROLLBACK');
    console.error('Falha na importação em massa:', err);
    dbClient.release();
    return res.status(500).json({ error: `Falha ao importar: ${err.message}` });
  }
  dbClient.release();
  await logAudit(req.user, 'create', 'client', `Importação em massa (${created} clientes)`);
  res.status(201).json({ created });
});

router.put('/:id', async (req, res) => {
  const { name, address, phone, lat, lon, notes } = req.body;
  await pool.query(
    `UPDATE clients SET name=$1, address=$2, phone=$3, lat=$4, lon=$5, notes=$6 WHERE id=$7`,
    [name, address, phone || null, toCoord(lat), toCoord(lon), notes || null, req.params.id]
  );
  await logAudit(req.user, 'update', 'client', name);
  res.json(req.body);
});

router.delete('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT name FROM clients WHERE id=$1', [req.params.id]);
  await pool.query('DELETE FROM clients WHERE id=$1', [req.params.id]);
  await logAudit(req.user, 'delete', 'client', rows[0]?.name);
  res.status(204).end();
});

export default router;
