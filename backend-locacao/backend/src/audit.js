import { pool } from './db.js';

function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

export async function logAudit(user, action, entity, entityLabel, details = null){
  try{
    await pool.query(
      `INSERT INTO audit_log (id, user_id, user_name, user_role, action, entity, entity_label, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uid(), user?.id || null, user?.name || 'desconhecido', user?.role || null, action, entity, entityLabel || null, details ? JSON.stringify(details) : null]
    );
  }catch(err){
    console.error('Falha ao registrar auditoria:', err.message);
  }
}
