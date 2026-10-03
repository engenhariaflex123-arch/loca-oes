import { Router } from 'express';
import { pool } from '../db.js';
import { logAudit } from '../audit.js';

const router = Router();

router.get('/:key', async (req, res) => {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key=$1', [req.params.key]);
  res.json({ key: req.params.key, value: rows[0] ? rows[0].value : null });
});

router.put('/:key', async (req, res) => {
  const { value } = req.body;
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [req.params.key, JSON.stringify(value)]
  );
  await logAudit(req.user, 'update', 'settings', req.params.key, value);
  res.json({ key: req.params.key, value });
});

export default router;
