import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  const { rows } = await pool.query(
    'SELECT id, user_name, user_role, action, entity, entity_label, details, created_at FROM audit_log ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  res.json(rows);
});

export default router;
