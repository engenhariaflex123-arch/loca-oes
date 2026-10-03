import { Router } from 'express';
import { pool } from '../db.js';
import { logAudit } from '../audit.js';

const router = Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM team_members');
  const result = { verde: [], azul: [], laranja: [], roxo: [] };
  rows.forEach(r => { if(result[r.team_id]) result[r.team_id].push(r.name); });
  res.json(result);
});

// Replace the full member list for a given team
router.put('/:teamId', async (req, res) => {
  const { teamId } = req.params;
  const { members } = req.body;
  await pool.query('DELETE FROM team_members WHERE team_id=$1', [teamId]);
  for(const name of (members || [])){
    await pool.query('INSERT INTO team_members (team_id, name) VALUES ($1,$2)', [teamId, name]);
  }
  await logAudit(req.user, 'update', 'team_member', teamId, { members });
  res.json({ teamId, members });
});

export default router;
