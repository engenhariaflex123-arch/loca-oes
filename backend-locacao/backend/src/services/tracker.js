// Acompanhamento automático das equipes pelo rastreador.
// A cada minuto cruza a posição de cada veículo (IOP GPS) com as visitas do dia da equipe dele e:
//  - registra a CHEGADA quando o veículo para perto do local (arrived_at + mensagem)
//  - registra a SAÍDA quando ele se afasta; avisa se saiu sem concluir a O.S.
//  - avisa quando o veículo está FORA DE ROTA (longe do trecho entre a última parada e a próxima)
//  - avisa quando a equipe está ATRASADA para o horário combinado com o cliente
import { pool } from '../db.js';
import { today } from '../utils.js';
import { isConfigured, liveLocations } from './iopgps.js';
import { addEvent, hasRecentEvent, describeAppointment, teamName } from './events.js';

const INTERVAL_MS = Number(process.env.TRACKER_INTERVAL_MS) || 60000;
const ARRIVE_M = 150;            // raio para considerar "chegou"
const STOPPED_KMH = 5;           // abaixo disso o veículo está parado
const LEAVE_M = 400;             // afastou-se do local
const OFF_ROUTE_M = 2000;        // distância do trajeto previsto para "fora de rota"
const MOVING_KMH = 10;
const OFF_ROUTE_REPEAT_MIN = 30; // não repete o alerta de fora de rota antes disso
const LATE_TOLERANCE_MIN = 15;   // tolerância sobre o horário combinado
const STALE_SEC = 30 * 60;       // posição velha demais é ignorada

// Situação de cada veículo, consultada pela rota /api/fleet/live
const state = {};
export function trackerState(){ return state; }

function distM(a, b){
  const R = 6371000, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Distância de um ponto ao segmento A→B (projeção plana local, suficiente para poucos km)
function distToSegmentM(p, a, b){
  const k = 111320, cos = Math.cos(p.lat * Math.PI / 180);
  const P = { x: p.lon * k * cos, y: p.lat * k }, A = { x: a.lon * k * cos, y: a.lat * k }, B = { x: b.lon * k * cos, y: b.lat * k };
  const dx = B.x - A.x, dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy));
}

function nowMinutesBR(){
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (t) => Number(parts.find(x => x.type === t)?.value || 0);
  return get('hour') * 60 + get('minute');
}
const toMin = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };
const OPEN = ['pendente', 'em_rota'];

// Visitas do dia com coordenadas do local (local de instalação, ou endereço do cliente se não houver local)
export async function dayStops(db, date){
  const { rows } = await (db || pool).query(
    `SELECT a.id, a.team_id, COALESCE(a.status,'pendente') AS status, a.kind, a.time_window, a.arrived_at, a.departed_at,
            a.route_order, a.created_at, a.client_id, a.rental_id,
            c.name AS client_name, s.name AS site_name, r.os_code,
            CASE WHEN s.id IS NOT NULL THEN s.lat ELSE c.lat END AS lat,
            CASE WHEN s.id IS NOT NULL THEN s.lon ELSE c.lon END AS lon,
            CASE WHEN s.id IS NOT NULL THEN s.address ELSE c.address END AS address
       FROM appointments a
       LEFT JOIN rentals r ON r.id = a.rental_id
       LEFT JOIN sites s ON s.id = COALESCE(a.site_id, r.site_id)
       LEFT JOIN clients c ON c.id = a.client_id
      WHERE a.date = $1 AND COALESCE(a.status,'pendente') <> 'cancelado'
      ORDER BY a.route_order ASC NULLS LAST, a.time_window ASC NULLS LAST, a.created_at ASC`,
    [date]
  );
  return rows;
}

async function getBase(){
  const { rows: [r] } = await pool.query(`SELECT value FROM settings WHERE key='base'`);
  const b = r?.value;
  const lat = parseFloat(b?.lat), lon = parseFloat(b?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

export async function trackOnce(){
  if(!isConfigured()) return;
  const { rows: vehicles } = await pool.query('SELECT * FROM vehicles WHERE active AND team_id IS NOT NULL');
  if(!vehicles.length) return;
  const positions = await liveLocations();
  const byImei = Object.fromEntries(positions.map(p => [p.imei, p]));
  const date = today();
  const stops = (await dayStops(pool, date)).map(s => ({ ...s, lat: parseFloat(s.lat), lon: parseFloat(s.lon) }));
  const base = await getBase();
  const nowSec = Math.floor(Date.now() / 1000);
  const nowMin = nowMinutesBR();

  for(const v of vehicles){
    const p = byImei[v.imei];
    if(!p || !p.gpsTime || nowSec - p.gpsTime > STALE_SEC){
      state[v.id] = { stale: true, at: new Date().toISOString() };
      continue;
    }
    const pos = { lat: p.lat, lon: p.lng };
    const speed = p.speed || 0;
    const team = teamName(v.team_id);
    const mine = stops.filter(s => s.team_id === v.team_id && Number.isFinite(s.lat) && Number.isFinite(s.lon));

    // 1) Chegada: parado perto de uma visita ainda aberta
    if(speed < STOPPED_KMH){
      const near = mine
        .filter(s => !s.arrived_at && OPEN.includes(s.status))
        .map(s => ({ s, d: distM(pos, s) }))
        .filter(x => x.d <= ARRIVE_M)
        .sort((a, b) => a.d - b.d)[0];
      if(near){
        const upd = await pool.query(`UPDATE appointments SET arrived_at=now(), departed_at=NULL WHERE id=$1 AND arrived_at IS NULL RETURNING arrived_at`, [near.s.id]);
        if(upd.rowCount){
          near.s.arrived_at = upd.rows[0].arrived_at;
          const late = toMin(near.s.time_window) != null && nowMin > toMin(near.s.time_window) + LATE_TOLERANCE_MIN;
          await addEvent(null, {
            type: 'chegada', severity: 'info', teamId: v.team_id, vehicleId: v.id, appointmentId: near.s.id,
            message: `${team} chegou: ${await describeAppointment(null, near.s.id)}${late ? ` (horário combinado era ${near.s.time_window})` : ''}.`,
          });
        }
      }
    }

    // 2) Saída: afastou-se de um local onde tinha chegado
    for(const s of mine.filter(s => s.arrived_at && !s.departed_at)){
      if(distM(pos, s) > LEAVE_M){
        await pool.query(`UPDATE appointments SET departed_at=now() WHERE id=$1`, [s.id]);
        s.departed_at = new Date();
        if(OPEN.includes(s.status)){
          await addEvent(null, {
            type: 'saida_sem_concluir', severity: 'alerta', teamId: v.team_id, vehicleId: v.id, appointmentId: s.id,
            message: `${team} saiu do local sem concluir no app: ${await describeAppointment(null, s.id)}.`,
          });
        }
      }
    }

    // Onde a equipe está e para onde vai
    const current = mine.find(s => s.arrived_at && !s.departed_at) || null;
    const next = mine.find(s => OPEN.includes(s.status) && !s.arrived_at) || null;
    const visited = mine.filter(s => s.arrived_at || !OPEN.includes(s.status));
    const last = visited.sort((a, b) => new Date(b.departed_at || b.arrived_at || 0) - new Date(a.departed_at || a.arrived_at || 0))[0];
    const from = last && Number.isFinite(last.lat) ? last : base;

    // 3) Fora de rota: em movimento, longe do trecho "última parada → próxima"
    let offRouteM = null;
    if(next && from && speed >= MOVING_KMH && !current){
      offRouteM = distToSegmentM(pos, from, next);
      if(offRouteM > OFF_ROUTE_M && !(await hasRecentEvent(null, { type: 'fora_de_rota', vehicleId: v.id, sinceMinutes: OFF_ROUTE_REPEAT_MIN }))){
        await addEvent(null, {
          type: 'fora_de_rota', severity: 'alerta', teamId: v.team_id, vehicleId: v.id, appointmentId: next.id,
          message: `${v.name}${v.plate ? ` (${v.plate})` : ''} da ${team} está fora da rota, a ${(offRouteM / 1000).toFixed(1)} km do caminho até ${await describeAppointment(null, next.id)}.`,
        });
      }
    }

    // 4) Atraso: passou do horário combinado e ainda não chegou
    const lateIds = [];
    for(const s of mine.filter(s => OPEN.includes(s.status) && !s.arrived_at && toMin(s.time_window) != null)){
      if(nowMin > toMin(s.time_window) + LATE_TOLERANCE_MIN){
        lateIds.push(s.id);
        if(!(await hasRecentEvent(null, { type: 'atraso', appointmentId: s.id }))){
          await addEvent(null, {
            type: 'atraso', severity: 'alerta', teamId: v.team_id, vehicleId: v.id, appointmentId: s.id,
            message: `${team} está atrasada para ${await describeAppointment(null, s.id)}: horário combinado ${s.time_window}.`,
          });
        }
      }
    }

    state[v.id] = {
      at: new Date().toISOString(),
      currentStopId: current?.id || null,
      nextStopId: next?.id || null,
      offRoute: offRouteM != null && offRouteM > OFF_ROUTE_M,
      offRouteKm: offRouteM != null ? Math.round(offRouteM / 100) / 10 : null,
      lateIds,
    };
  }
}

let running = false;
export function startTracker(){
  const tick = async () => {
    if(running) return;
    running = true;
    try{ await trackOnce(); }
    catch(err){ console.error('Acompanhamento das equipes:', err.message); }
    finally{ running = false; }
  };
  setTimeout(tick, Math.min(10000, INTERVAL_MS));
  setInterval(tick, INTERVAL_MS);
}
