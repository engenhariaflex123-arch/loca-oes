import { Router } from 'express';
import { pool } from '../db.js';
import { logAudit } from '../audit.js';

const router = Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM task_types ORDER BY created_at ASC');
  res.json(rows.map(r => ({ id: r.id, name: r.name, description: r.description, estimatedMinutes: r.estimated_minutes || 60 })));
});

router.post('/', async (req, res) => {
  const { id, name, description, estimatedMinutes } = req.body;
  await pool.query(
    'INSERT INTO task_types (id, name, description, estimated_minutes) VALUES ($1,$2,$3,$4)',
    [id, name, description || null, estimatedMinutes || 60]
  );
  await logAudit(req.user, 'create', 'task_type', name);
  res.status(201).json(req.body);
});

router.put('/:id', async (req, res) => {
  const { name, description, estimatedMinutes } = req.body;
  await pool.query(
    'UPDATE task_types SET name=$1, description=$2, estimated_minutes=$3 WHERE id=$4',
    [name, description || null, estimatedMinutes || 60, req.params.id]
  );
  await logAudit(req.user, 'update', 'task_type', name);
  res.json(req.body);
});

router.delete('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT name FROM task_types WHERE id=$1', [req.params.id]);
  await pool.query('DELETE FROM task_types WHERE id=$1', [req.params.id]);
  await logAudit(req.user, 'delete', 'task_type', rows[0]?.name);
  res.status(204).end();
});

export default router;
