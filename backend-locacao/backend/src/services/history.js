// Linha do tempo da O.S.: junta as ações do escritório (rental_history) com o que
// aconteceu em campo (fleet_events, execution_records, asset_movements).
import { pool } from '../db.js';
import { uid } from '../utils.js';
import { kindLabel, teamName } from './events.js';

export async function addHistory(db, { rentalId, appointmentId = null, type, message, user = null }){
  if(!rentalId) return;
  await (db || pool).query(
    `INSERT INTO rental_history (id, rental_id, appointment_id, type, message, actor_name, actor_role)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uid(), rentalId, appointmentId, type, message, user?.name || null, user?.role || null]
  );
}

const fmtDay = (d) => d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}` : '';
const OUT = ['entrega', 'montagem'], BACK = ['retirada', 'desmontagem'];

export async function rentalTimeline(rentalId){
  const { rows: [r] } = await pool.query(
    `SELECT r.*, u.name AS creator FROM rentals r LEFT JOIN users u ON u.id = r.created_by WHERE r.id=$1`, [rentalId]);
  if(!r) return null;

  const { rows: hist } = await pool.query(
    `SELECT * FROM rental_history WHERE rental_id=$1 ORDER BY created_at`, [rentalId]);
  const { rows: appts } = await pool.query(
    `SELECT id, kind, date, team_id, status, time_window, arrived_at, departed_at FROM appointments WHERE rental_id=$1`, [rentalId]);
  const apptById = Object.fromEntries(appts.map(a => [a.id, a]));
  const ids = appts.map(a => a.id);

  const { rows: events } = ids.length ? await pool.query(
    `SELECT * FROM fleet_events WHERE appointment_id = ANY($1) AND type <> 'conclusao' ORDER BY created_at`, [ids]) : { rows: [] };
  const { rows: execs } = ids.length ? await pool.query(
    `SELECT id, appointment_id, team_id, signed_by, notes, created_at,
            jsonb_array_length(COALESCE(photos,'[]'::jsonb)) AS photo_count,
            checkin_lat IS NOT NULL AS has_gps, signature IS NOT NULL AS has_signature
       FROM execution_records WHERE appointment_id = ANY($1) ORDER BY created_at`, [ids]) : { rows: [] };
  const { rows: moves } = await pool.query(
    `SELECT m.appointment_id, m.movement, m.condition, a.code
       FROM asset_movements m JOIN assets a ON a.id = m.asset_id
      WHERE m.rental_id=$1 ORDER BY a.code`, [rentalId]);
  const movesByAppt = {};
  moves.forEach(m => { if(m.appointment_id) (movesByAppt[m.appointment_id] ||= []).push(m); });

  const items = [];
  // Orçamento criado (locações antigas, de antes do histórico, também aparecem)
  if(!hist.some(h => h.type === 'criada')){
    items.push({ at: r.created_at, type: 'criada', source: 'escritorio', message: `Orçamento criado.`, actor: r.creator || null });
  }
  hist.forEach(h => items.push({
    at: h.created_at, type: h.type, source: h.actor_role === 'team' ? 'equipe' : 'escritorio', message: h.message,
    actor: h.actor_name, actorRole: h.actor_role, appointmentId: h.appointment_id,
  }));
  events.forEach(e => {
    const a = apptById[e.appointment_id];
    items.push({
      at: e.created_at, type: e.type, source: e.type === 'inicio' || e.type === 'nao_realizada' ? 'equipe' : 'rastreador',
      severity: e.severity, message: e.message, actor: teamName(e.team_id), appointmentId: e.appointment_id,
      kind: a?.kind,
    });
  });
  execs.forEach(x => {
    const a = apptById[x.appointment_id];
    const ms = movesByAppt[x.appointment_id] || [];
    const bad = ms.filter(m => m.condition && m.condition !== 'ok');
    const parts = [];
    if(ms.length) parts.push(`${ms.length} unidade(s) ${OUT.includes(a?.kind) ? 'entregue(s)' : BACK.includes(a?.kind) ? 'recolhida(s)' : 'registrada(s)'}: ${ms.map(m => m.code).join(', ')}`);
    if(bad.length) parts.push(`com problema: ${bad.map(m => `${m.code} (${m.condition})`).join(', ')}`);
    if(x.signed_by) parts.push(`recebido por ${x.signed_by}${x.has_signature ? ' (assinado)' : ''}`);
    if(x.photo_count > 0) parts.push(`${x.photo_count} foto(s)`);
    if(x.has_gps) parts.push('localização registrada');
    items.push({
      at: x.created_at, type: 'concluida', source: 'equipe', severity: 'sucesso',
      message: `${kindLabel(a?.kind)} de ${fmtDay(a?.date)} concluída pela ${teamName(x.team_id)}.`,
      details: parts, notes: x.notes || null, actor: teamName(x.team_id),
      appointmentId: x.appointment_id, kind: a?.kind, photoCount: x.photo_count,
    });
  });
  // Mesmo instante (ex.: retirada e encerramento gravados juntos): o encerramento vem por último
  const rank = (i) => (i.type === 'encerrada' || i.type === 'cancelada' ? 2 : i.type === 'criada' ? 0 : 1);
  items.sort((a, b) => (new Date(a.at) - new Date(b.at)) || (rank(a) - rank(b)));

  // Etapas principais com o horário em que cada uma aconteceu
  const firstAt = (pred) => items.find(pred)?.at || null;
  const lastAt = (pred) => [...items].reverse().find(pred)?.at || null;
  const cleanings = appts.filter(a => a.kind === 'limpeza');
  const outAppts = appts.filter(a => OUT.includes(a.kind)), backAppts = appts.filter(a => BACK.includes(a.kind));
  const allDone = (list) => list.length > 0 && list.every(a => a.status === 'concluido');
  const stages = [
    { key: 'orcamento', label: 'Orçamento', at: firstAt(i => i.type === 'criada') },
    { key: 'confirmada', label: 'Confirmada', at: lastAt(i => i.type === 'confirmada') },
    { key: 'entregue', label: outAppts.some(a => a.kind === 'montagem') && !outAppts.some(a => a.kind === 'entrega') ? 'Montada' : 'Entregue',
      at: allDone(outAppts) ? lastAt(i => i.type === 'concluida' && OUT.includes(i.kind)) : null,
      partial: outAppts.some(a => a.status === 'concluido') && !allDone(outAppts) },
    ...(cleanings.length ? [{ key: 'limpezas', label: 'Limpezas',
      at: allDone(cleanings) ? lastAt(i => i.type === 'concluida' && i.kind === 'limpeza') : null,
      progress: `${cleanings.filter(a => a.status === 'concluido').length}/${cleanings.length}` }] : []),
    { key: 'retirada', label: backAppts.some(a => a.kind === 'desmontagem') && !backAppts.some(a => a.kind === 'retirada') ? 'Desmontada' : 'Retirada',
      at: allDone(backAppts) ? lastAt(i => i.type === 'concluida' && BACK.includes(i.kind)) : null,
      partial: backAppts.some(a => a.status === 'concluido') && !allDone(backAppts) },
    { key: 'encerrada', label: r.status === 'cancelado' ? 'Cancelada' : 'Encerrada',
      at: lastAt(i => i.type === (r.status === 'cancelado' ? 'cancelada' : 'encerrada')) },
  ];
  return { osCode: r.os_code, status: r.status, stages, items };
}
