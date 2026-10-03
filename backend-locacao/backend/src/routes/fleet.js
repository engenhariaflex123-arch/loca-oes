import { Router } from 'express';
import { pool } from '../db.js';
import { logAudit } from '../audit.js';
import { uid, HttpError, isDate } from '../utils.js';
import { isConfigured, liveLocations, listDevices, history, GpsError } from '../services/iopgps.js';
import { trackerState, dayStops } from '../services/tracker.js';

const router = Router();

// Rastreador sem posição nova há mais que isso aparece como "sem sinal"
const OFFLINE_AFTER_MIN = 30;
const MOVING_KMH = 5;

function toVehicle(r){
  return {
    id: r.id, name: r.name, plate: r.plate, imei: r.imei,
    teamId: r.team_id, active: r.active, notes: r.notes,
  };
}

function dupImei(err){
  if(err.code === '23505') return new HttpError(409, 'Esse rastreador (IMEI) já está cadastrado em outro veículo.');
  return err;
}

function gpsFail(err){
  if(err instanceof GpsError) return new HttpError(err.status, err.message);
  return err;
}

// --- A integração está configurada?
router.get('/status', (req, res) => {
  res.json({ configured: isConfigured() });
});

// --- Rastreadores existentes na conta do IOP GPS (para escolher o IMEI)
router.get('/devices', async (req, res) => {
  let devices;
  try{ devices = await listDevices(); }catch(err){ throw gpsFail(err); }
  const { rows } = await pool.query('SELECT imei, name FROM vehicles');
  const used = Object.fromEntries(rows.map(r => [r.imei, r.name]));
  res.json(devices.map(d => ({ ...d, usedBy: used[d.imei] || null })));
});

// --- Cadastro de veículos
router.get('/vehicles', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM vehicles ORDER BY active DESC, name');
  res.json(rows.map(toVehicle));
});

function validate(b){
  if(!b.name?.trim()) throw new HttpError(400, 'Informe o nome do veículo.');
  if(!/^\d{10,17}$/.test(String(b.imei || '').trim())) throw new HttpError(400, 'IMEI inválido: são só números (normalmente 15 dígitos).');
}

router.post('/vehicles', async (req, res) => {
  validate(req.body);
  const b = req.body;
  const { rows } = await pool.query(
    `INSERT INTO vehicles (id, name, plate, imei, team_id, active, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [uid(), b.name.trim(), b.plate?.trim().toUpperCase() || null, String(b.imei).trim(),
     b.teamId || null, b.active !== false, b.notes || null]
  ).catch(err => { throw dupImei(err); });
  await logAudit(req.user, 'create', 'vehicle', b.name);
  res.status(201).json(toVehicle(rows[0]));
});

router.put('/vehicles/:id', async (req, res) => {
  validate(req.body);
  const b = req.body;
  const { rows } = await pool.query(
    `UPDATE vehicles SET name=$1, plate=$2, imei=$3, team_id=$4, active=$5, notes=$6 WHERE id=$7 RETURNING *`,
    [b.name.trim(), b.plate?.trim().toUpperCase() || null, String(b.imei).trim(),
     b.teamId || null, b.active !== false, b.notes || null, req.params.id]
  ).catch(err => { throw dupImei(err); });
  if(!rows[0]) throw new HttpError(404, 'Veículo não encontrado.');
  await logAudit(req.user, 'update', 'vehicle', b.name);
  res.json(toVehicle(rows[0]));
});

router.delete('/vehicles/:id', async (req, res) => {
  const { rows } = await pool.query('DELETE FROM vehicles WHERE id=$1 RETURNING name', [req.params.id]);
  if(!rows[0]) throw new HttpError(404, 'Veículo não encontrado.');
  await logAudit(req.user, 'delete', 'vehicle', rows[0].name);
  res.status(204).end();
});

// --- Posição atual de cada veículo cadastrado
router.get('/live', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM vehicles WHERE active ORDER BY name');
  let positions;
  try{ positions = await liveLocations(); }catch(err){ throw gpsFail(err); }
  const byImei = Object.fromEntries(positions.map(p => [p.imei, p]));
  const now = Math.floor(Date.now() / 1000);
  res.json({
    updatedAt: new Date().toISOString(),
    vehicles: rows.map(r => {
      const p = byImei[r.imei];
      const ageSec = p?.gpsTime ? Math.max(0, now - p.gpsTime) : null;
      let state = 'sem_dados';
      if(p){
        if(ageSec == null || ageSec > OFFLINE_AFTER_MIN * 60) state = 'sem_sinal';
        else if((p.speed || 0) >= MOVING_KMH) state = 'em_movimento';
        else state = 'parado';
      }
      return {
        ...toVehicle(r),
        position: p ? { lat: p.lat, lng: p.lng, speed: p.speed, course: p.course, accOn: p.accOn, gpsTime: p.gpsTime, ageSec } : null,
        state,
        tracking: trackerState()[r.id] || null, // fora de rota, parada atual/próxima, atrasos
      };
    }),
  });
});

// --- Andamento das equipes num dia: paradas na ordem, chegada/saída, atraso
router.get('/progress', async (req, res) => {
  const date = req.query.date || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  if(!isDate(date)) throw new HttpError(400, 'Data inválida.');
  const stops = await dayStops(pool, date);
  const { rows: vehicles } = await pool.query('SELECT id, name, plate, team_id FROM vehicles WHERE active');
  const isToday = date === new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const nowMin = Number(parts.find(x => x.type === 'hour').value) * 60 + Number(parts.find(x => x.type === 'minute').value);
  const byTeam = {};
  for(const s of stops){
    const key = s.team_id || '';
    const open = ['pendente', 'em_rota'].includes(s.status);
    const [h, m] = String(s.time_window || '').split(':').map(Number);
    const due = Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
    (byTeam[key] ||= []).push({
      id: s.id, kind: s.kind, status: s.status, timeWindow: s.time_window,
      arrivedAt: s.arrived_at, departedAt: s.departed_at,
      clientName: s.client_name, siteName: s.site_name, osCode: s.os_code, address: s.address,
      lat: s.lat != null ? Number(s.lat) : null, lon: s.lon != null ? Number(s.lon) : null,
      late: isToday && open && !s.arrived_at && due != null && nowMin > due + 15,
    });
  }
  res.json({
    date,
    teams: Object.entries(byTeam).map(([teamId, list]) => ({
      teamId: teamId || null,
      vehicles: vehicles.filter(v => v.team_id && v.team_id === teamId).map(v => ({ id: v.id, name: v.name, plate: v.plate })),
      total: list.length,
      done: list.filter(s => !['pendente', 'em_rota'].includes(s.status)).length,
      stops: list,
    })),
  });
});

// --- Trajeto de um veículo num dia (?date=AAAA-MM-DD, padrão hoje no fuso de Brasília)
router.get('/vehicles/:id/track', async (req, res) => {
  const { rows: [v] } = await pool.query('SELECT * FROM vehicles WHERE id=$1', [req.params.id]);
  if(!v) throw new HttpError(404, 'Veículo não encontrado.');
  const date = req.query.date || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  if(!isDate(date)) throw new HttpError(400, 'Data inválida.');
  // Dia inteiro no horário de Brasília (UTC-3)
  const start = Date.parse(`${date}T00:00:00-03:00`) / 1000;
  const end = Math.min(start + 86400, Math.floor(Date.now() / 1000));
  if(end <= start) return res.json({ date, points: [] });
  let points;
  try{ points = await history(v.imei, start, end); }catch(err){ throw gpsFail(err); }
  res.json({ date, points: points.map(p => ({ lat: p.lat, lng: p.lng, speed: p.speed, accOn: p.accOn, gpsTime: p.gpsTime })) });
});

export default router;
