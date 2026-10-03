import { pool } from './db.js';

export function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

export function toCoord(v){
  if(v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function toNumber(v){
  if(v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function isDate(s){
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
}

export function addDays(dateStr, n){
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a, b){
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

// "Hoje" no fuso de Brasília (o servidor no Railway roda em UTC)
export function today(){
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export class HttpError extends Error {
  constructor(status, message, details = null){
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function withTransaction(fn){
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  }catch(err){
    await client.query('ROLLBACK');
    throw err;
  }finally{
    client.release();
  }
}
