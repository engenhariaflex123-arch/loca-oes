// Cliente da API aberta do IOP GPS (open.iopgps.com).
// Só LEITURA: posições, lista de rastreadores e histórico. Nunca envia comandos
// (bloqueio de motor etc.) — isso continua sendo feito no próprio IOP GPS.
//
// Variáveis de ambiente (Railway → Variables):
//   IOPGPS_APPID     nome da conta / appid fornecido pelo IOP GPS
//   IOPGPS_API_KEY   chave secreta (NUNCA colocar no frontend)
//   IOPGPS_API_BASE  opcional, padrão https://open.iopgps.com
//
// Autenticação: POST /api/auth { appid, time, signature: md5(md5(chave) + time) }
// devolve um accessToken (~2h) que vai no cabeçalho `accessToken` das demais chamadas.
// Limites informados pelo IOP GPS: 10 req/s e 2 autenticações por minuto —
// por isso o token é reaproveitado e as posições ficam em cache por alguns segundos.

import crypto from 'node:crypto';

const md5 = (s) => crypto.createHash('md5').update(String(s)).digest('hex');

const BASE = (process.env.IOPGPS_API_BASE || 'https://open.iopgps.com').replace(/\/+$/, '');
const APPID = process.env.IOPGPS_APPID || '';
const SECRET = process.env.IOPGPS_API_KEY || '';
const TIMEOUT_MS = 15000;
const LIVE_CACHE_MS = 20000;

export class GpsError extends Error {
  constructor(message, status = 502){ super(message); this.status = status; }
}

export function isConfigured(){ return Boolean(APPID && SECRET); }

let token = null;
let tokenExp = 0;        // epoch ms
let lastAuthAttempt = 0; // para não estourar o limite de 2 autenticações/min
let authInFlight = null;

async function getJson(path, opts = {}){
  let r;
  try{
    r = await fetch(`${BASE}${path}`, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
  }catch(err){
    throw new GpsError(`Não foi possível conectar ao IOP GPS (${err.name === 'TimeoutError' ? 'tempo esgotado' : err.message}).`);
  }
  const text = await r.text();
  let json = null;
  try{ json = JSON.parse(text); }catch{ /* resposta não-JSON */ }
  return { status: r.status, json, text };
}

async function authenticate(){
  if(!isConfigured()) throw new GpsError('Integração com o IOP GPS não configurada. Defina IOPGPS_APPID e IOPGPS_API_KEY no Railway.', 503);
  if(authInFlight) return authInFlight;
  const wait = 31000 - (Date.now() - lastAuthAttempt);
  if(wait > 0 && !token) throw new GpsError('Aguardando para autenticar de novo no IOP GPS (limite de 2 por minuto). Tente em alguns segundos.', 429);
  lastAuthAttempt = Date.now();
  authInFlight = (async () => {
    const time = Math.floor(Date.now() / 1000);
    const res = await getJson('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appid: APPID, time, signature: md5(md5(SECRET) + time) }),
    });
    if(res.json?.code !== 0 || !res.json?.accessToken){
      token = null;
      const why = res.json?.result || res.json?.msg || res.text.slice(0, 160) || `HTTP ${res.status}`;
      throw new GpsError(`O IOP GPS recusou a autenticação: ${why}. Confira IOPGPS_APPID e IOPGPS_API_KEY.`, 502);
    }
    token = res.json.accessToken;
    // expiresIn pode vir em segundos ou milissegundos; na dúvida, no máximo 2h
    let ttl = Number(res.json.expiresIn) || 7200;
    if(ttl < 100000) ttl *= 1000;
    tokenExp = Date.now() + Math.min(ttl, 7200000);
    return token;
  })();
  try{ return await authInFlight; } finally { authInFlight = null; }
}

async function ensureToken(){
  if(token && Date.now() < tokenExp - 5 * 60000) return token;
  token = null;
  return authenticate();
}

async function call(path, retry = true){
  const t = await ensureToken();
  const res = await getJson(path, { headers: { accessToken: t } });
  const code = res.json?.code;
  const expired = res.status === 401 || code === 401 || /token/i.test(String(res.json?.result || ''));
  if(expired && retry){
    token = null;
    return call(path, false);
  }
  if(res.status >= 400) throw new GpsError(`IOP GPS respondeu com erro ${res.status}.`);
  return res.json || {};
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function toPosition(o){
  const gpsTime = num(o.gpsTime);
  return {
    imei: String(o.imei || '').trim(),
    lat: num(o.lat),
    lng: num(o.lng),
    speed: num(o.speed),
    course: num(o.course),
    accOn: o.accStatus == null ? null : Boolean(Number(o.accStatus)),
    gpsTime: gpsTime && gpsTime > 0 ? gpsTime : null, // unix, segundos
  };
}

let liveCache = { at: 0, data: null };

// Última posição de TODOS os rastreadores da conta, numa chamada só.
export async function liveLocations(){
  if(liveCache.data && Date.now() - liveCache.at < LIVE_CACHE_MS) return liveCache.data;
  const json = await call('/api/device/locations/search-by-organization?isTakeSub=1');
  if(json.code != null && json.code !== 0) throw new GpsError(`IOP GPS: ${json.result || json.msg || 'erro ao buscar posições'}`);
  const data = (json.data || []).map(toPosition).filter(p => p.imei && p.lat != null && p.lng != null);
  liveCache = { at: Date.now(), data };
  return data;
}

// Rastreadores cadastrados na conta (para escolher o IMEI ao cadastrar um veículo).
export async function listDevices(){
  const out = new Map();
  for(let page = 1; page <= 50; page++){
    const json = await call(`/api/device?currentPage=${page}&pageSize=100`);
    if(json.code != null && json.code !== 0) break;
    const rows = json.data || [];
    for(const d of rows){
      const imei = String(d.imei || '').trim();
      if(imei && !out.has(imei)) out.set(imei, { imei, name: String(d.deviceName || '').trim() || imei });
    }
    const total = Number(json.page?.count) || 0;
    if(rows.length === 0 || page * 100 >= total) break;
  }
  return [...out.values()];
}

// Trajeto de um rastreador entre dois instantes (unix, segundos).
export async function history(imei, startSec, endSec){
  const q = `imei=${encodeURIComponent(imei)}&startTime=${Math.floor(startSec)}&endTime=${Math.floor(endSec)}`;
  const json = await call(`/api/device/track/history?${q}`);
  if(json.code != null && json.code !== 0) throw new GpsError(`IOP GPS: ${json.result || json.msg || 'erro ao buscar o trajeto'}`);
  return (json.data || []).map(toPosition)
    .filter(p => p.lat != null && p.lng != null)
    .sort((a, b) => (a.gpsTime || 0) - (b.gpsTime || 0));
}
