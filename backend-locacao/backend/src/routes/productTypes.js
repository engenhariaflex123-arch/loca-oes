import { Router } from 'express';
import { pool } from '../db.js';
import { logAudit } from '../audit.js';
import { uid, toNumber, HttpError } from '../utils.js';

const router = Router();
const CATEGORIES = ['tenda', 'banheiro', 'acessorio'];

function toProductType(r){
  return {
    id: r.id, category: r.category, name: r.name,
    dailyPrice: r.daily_price, monthlyPrice: r.monthly_price,
    setupMinutes: r.setup_minutes, teardownMinutes: r.teardown_minutes,
    cleaningIntervalDays: r.cleaning_interval_days,
    serviceEveryUses: r.service_every_uses, serviceEveryDays: r.service_every_days,
    turnaroundDays: r.turnaround_days,
    active: r.active,
  };
}

function validate(body){
  if(!body.name) throw new HttpError(400, 'Informe o nome do produto.');
  if(!CATEGORIES.includes(body.category)) throw new HttpError(400, 'Categoria deve ser tenda, banheiro ou acessorio.');
}

function params(b){
  return [
    b.category, b.name.trim(), toNumber(b.dailyPrice),
    toNumber(b.setupMinutes) ?? 30, toNumber(b.teardownMinutes) ?? 30,
    toNumber(b.cleaningIntervalDays), toNumber(b.turnaroundDays) ?? 1,
    b.active !== false,
    toNumber(b.serviceEveryUses), toNumber(b.serviceEveryDays),
    toNumber(b.monthlyPrice),
  ];
}

// ?all=1 inclui os desativados
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM product_types ${req.query.all ? '' : 'WHERE active'} ORDER BY category, name`
  );
  res.json(rows.map(toProductType));
});

router.post('/', async (req, res) => {
  validate(req.body);
  const id = req.body.id || uid();
  const { rows } = await pool.query(
    `INSERT INTO product_types
       (id, category, name, daily_price, setup_minutes, teardown_minutes, cleaning_interval_days, turnaround_days, active,
        service_every_uses, service_every_days, monthly_price)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [id, ...params(req.body)]
  );
  await logAudit(req.user, 'create', 'product_type', req.body.name);
  res.status(201).json(toProductType(rows[0]));
});

router.put('/:id', async (req, res) => {
  validate(req.body);
  const { rows } = await pool.query(
    `UPDATE product_types SET category=$1, name=$2, daily_price=$3, setup_minutes=$4, teardown_minutes=$5,
       cleaning_interval_days=$6, turnaround_days=$7, active=$8, service_every_uses=$9, service_every_days=$10,
       monthly_price=$11
     WHERE id=$12 RETURNING *`,
    [...params(req.body), req.params.id]
  );
  if(!rows[0]) throw new HttpError(404, 'Produto não encontrado.');
  await logAudit(req.user, 'update', 'product_type', req.body.name);
  res.json(toProductType(rows[0]));
});

router.delete('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT name FROM product_types WHERE id=$1', [req.params.id]);
  try{
    await pool.query('DELETE FROM product_types WHERE id=$1', [req.params.id]);
  }catch(err){
    if(err.code === '23503') throw new HttpError(409, 'Esse produto já tem unidades ou locações. Desative-o em vez de excluir.');
    throw err;
  }
  await logAudit(req.user, 'delete', 'product_type', rows[0]?.name);
  res.status(204).end();
});

export default router;
