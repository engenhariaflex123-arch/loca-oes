import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// ?since=ISO (só as mais novas) &limit=50 &date=AAAA-MM-DD
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const params = [];
  const conds = [];
  if(req.query.since){ params.push(req.query.since); conds.push(`created_at > $${params.length}`); }
  if(req.query.date){ params.push(req.query.date); conds.push(`(created_at AT TIME ZONE 'America/Sao_Paulo')::date = $${params.length}::date`); }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT * FROM fleet_events ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
      ORDER BY created_at DESC LIMIT $${params.length}`, params
  );
  res.json(rows.map(e => ({
    id: e.id, type: e.type, severity: e.severity, teamId: e.team_id, vehicleId: e.vehicle_id,
    appointmentId: e.appointment_id, message: e.message, createdAt: e.created_at,
  })));
});

export default router;
