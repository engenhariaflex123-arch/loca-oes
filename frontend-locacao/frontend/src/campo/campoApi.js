// Comunicação do app de campo com o backend. Usa um token próprio (da equipe),
// separado do login do painel, para os dois poderem ficar abertos no mesmo navegador.
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const KEY = 'campo-sessao';

export function getSession(){
  try{ return JSON.parse(localStorage.getItem(KEY)) || null; }catch(e){ return null; }
}
export function saveSession(s){
  try{ s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); }catch(e){}
}

async function request(path, options = {}){
  const session = getSession();
  const headers = { 'Content-Type': 'application/json' };
  if(session?.token) headers.Authorization = `Bearer ${session.token}`;
  let res;
  try{
    res = await fetch(`${BASE}/api/team-app${path}`, { ...options, headers });
  }catch(e){
    const err = new Error('Sem conexão com a internet. Tente de novo quando o sinal voltar.');
    err.offline = true;
    throw err;
  }
  let body = null;
  try{ body = await res.json(); }catch(e){}
  if(!res.ok){
    const err = new Error(body?.error || `Erro ${res.status}`);
    err.status = res.status;
    if(res.status === 401 && path !== '/login') err.expired = true;
    throw err;
  }
  return body;
}

export const campoApi = {
  login: (teamId, password) => request('/login', { method: 'POST', body: JSON.stringify({ teamId, password }) }),
  stops: (date) => request(`/appointments?date=${encodeURIComponent(date)}`),
  start: (id) => request(`/appointments/${id}/start`, { method: 'POST' }),
  fail: (id, reason) => request(`/appointments/${id}/fail`, { method: 'POST', body: JSON.stringify({ reason }) }),
  complete: (id, data) => request(`/appointments/${id}/complete`, { method: 'POST', body: JSON.stringify(data) }),
  asset: (code) => request(`/assets/${encodeURIComponent(code)}`),
};
