import { Router } from 'express';
import { pool } from '../db.js';
import { logAudit } from '../audit.js';
import { uid, toCoord, HttpError } from '../utils.js';

const router = Router();

function toSite(r){
  return {
    id: r.id, clientId: r.client_id, name: r.name, address: r.address, lat: r.lat, lon: r.lon,
    contactName: r.contact_name, contactPhone: r.contact_phone, accessNotes: r.access_notes,
  };
}

function params(b){
  return [b.clientId || null, b.name.trim(), b.address.trim(), toCoord(b.lat), toCoord(b.lon),
          b.contactName || null, b.contactPhone || null, b.accessNotes || null];
}

// ?clientId=... filtra os locais de um cliente
router.get('/', async (req, res) => {
  const { rows } = req.query.clientId
    ? await pool.query('SELECT * FROM sites WHERE client_id=$1 ORDER BY created_at DESC', [req.query.clientId])
    : await pool.query('SELECT * FROM sites ORDER BY created_at DESC');
  res.json(rows.map(toSite));
});

router.post('/', async (req, res) => {
  if(!req.body.name || !req.body.address) throw new HttpError(400, 'Informe nome e endereço do local.');
  const id = req.body.id || uid();
  const { rows } = await pool.query(
    `INSERT INTO sites (id, client_id, name, address, lat, lon, contact_name, contact_phone, access_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, ...params(req.body)]
  );
  await logAudit(req.user, 'create', 'site', req.body.name);
  res.status(201).json(toSite(rows[0]));
});

router.put('/:id', async (req, res) => {
  if(!req.body.name || !req.body.address) throw new HttpError(400, 'Informe nome e endereço do local.');
  const { rows } = await pool.query(
    `UPDATE sites SET client_id=$1, name=$2, address=$3, lat=$4, lon=$5, contact_name=$6, contact_phone=$7, access_notes=$8
     WHERE id=$9 RETURNING *`,
    [...params(req.body), req.params.id]
  );
  if(!rows[0]) throw new HttpError(404, 'Local não encontrado.');
  await logAudit(req.user, 'update', 'site', req.body.name);
  res.json(toSite(rows[0]));
});

router.delete('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT name FROM sites WHERE id=$1', [req.params.id]);
  await pool.query('DELETE FROM sites WHERE id=$1', [req.params.id]);
  await logAudit(req.user, 'delete', 'site', rows[0]?.name);
  res.status(204).end();
});

export default router;
