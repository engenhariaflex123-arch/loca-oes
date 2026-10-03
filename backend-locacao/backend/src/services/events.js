// Mensagens automáticas do acompanhamento (chegou, concluiu, fora de rota...).
import { pool } from '../db.js';
import { uid } from '../utils.js';

const TEAM_NAMES = { verde: 'Equipe Verde', azul: 'Equipe Azul', laranja: 'Equipe Laranja', roxo: 'Equipe Roxa' };
export const teamName = (id) => TEAM_NAMES[id] || (id ? `Equipe ${id}` : 'Sem equipe');

const KIND_LABEL = {
  entrega: 'Entrega', montagem: 'Montagem', limpeza: 'Limpeza', retirada: 'Retirada',
  desmontagem: 'Desmontagem', manutencao: 'Manutenção', vistoria: 'Vistoria',
};
export const kindLabel = (k) => KIND_LABEL[k] || 'Visita';

export async function addEvent(db, { type, severity = 'info', teamId = null, vehicleId = null, appointmentId = null, message }){
  await (db || pool).query(
    `INSERT INTO fleet_events (id, type, severity, team_id, vehicle_id, appointment_id, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uid(), type, severity, teamId, vehicleId, appointmentId, message]
  );
}

// Já existe um evento desse tipo para essa visita (ou veículo) desde `sinceMinutes` atrás?
export async function hasRecentEvent(db, { type, appointmentId = null, vehicleId = null, sinceMinutes = 100000 }){
  const { rows } = await (db || pool).query(
    `SELECT 1 FROM fleet_events
      WHERE type=$1 AND ($2::text IS NULL OR appointment_id=$2) AND ($3::text IS NULL OR vehicle_id=$3)
        AND created_at > now() - ($4 || ' minutes')::interval LIMIT 1`,
    [type, appointmentId, vehicleId, String(sinceMinutes)]
  );
  return rows.length > 0;
}

// Descrição curta de uma visita: "Entrega · OS-2026-0012 · Prefeitura (Parque de Exposições)"
export async function describeAppointment(db, appointmentId){
  const { rows: [a] } = await (db || pool).query(
    `SELECT a.kind, c.name AS client, s.name AS site, r.os_code
       FROM appointments a
       LEFT JOIN clients c ON c.id = a.client_id
       LEFT JOIN rentals r ON r.id = a.rental_id
       LEFT JOIN sites s ON s.id = COALESCE(a.site_id, r.site_id)
      WHERE a.id=$1`, [appointmentId]
  );
  if(!a) return 'visita';
  return [kindLabel(a.kind), a.os_code, `${a.client || 'cliente'}${a.site ? ` (${a.site})` : ''}`].filter(Boolean).join(' · ');
}

// Próxima visita pendente da equipe no mesmo dia, na ordem da rota
export async function nextAppointment(db, teamId, date, exceptId){
  const { rows: [n] } = await (db || pool).query(
    `SELECT id FROM appointments
      WHERE team_id=$1 AND date=$2 AND id<>$3 AND COALESCE(status,'pendente') IN ('pendente','em_rota')
      ORDER BY route_order ASC NULLS LAST, time_window ASC NULLS LAST, created_at ASC LIMIT 1`,
    [teamId, date, exceptId]
  );
  return n?.id || null;
}
