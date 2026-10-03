const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

let authToken = null;
export function setAuthToken(token){ authToken = token; }

async function request(path, options = {}){
  const headers = { 'Content-Type': 'application/json' };
  if(authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...options,
  });
  if(!res.ok && res.status !== 204){
    let message = `API error ${res.status} on ${path}`;
    let body = null;
    try{ body = await res.json(); if(body?.error) message = body.error; }catch(e){}
    const err = new Error(message);
    err.status = res.status;
    err.body = body; // detalhes extras, ex.: { shortages: [...] } quando falta estoque
    throw err;
  }
  if(res.status === 204) return null;
  return res.json();
}

function qs(params){
  if(!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? '?' + new URLSearchParams(entries).toString() : '';
}

export const api = {
  auth: {
    register: (data) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
    login: (data) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    me: () => request('/api/auth/me'),
    listUsers: () => request('/api/auth/users'),
  },
  auditLog: {
    list: () => request('/api/audit-log'),
  },
  clients: {
    list: () => request('/api/clients'),
    create: (data) => request('/api/clients', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/clients/${id}`, { method: 'DELETE' }),
    bulk: (clients) => request('/api/clients/bulk', { method: 'POST', body: JSON.stringify({ clients }) }),
  },
  taskTypes: {
    list: () => request('/api/task-types'),
    create: (data) => request('/api/task-types', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/task-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/task-types/${id}`, { method: 'DELETE' }),
  },
  appointments: {
    list: (params) => request('/api/appointments' + qs(params)),
    create: (data) => request('/api/appointments', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/appointments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/appointments/${id}`, { method: 'DELETE' }),
    getExecution: (id) => request(`/api/appointments/${id}/execution`),
  },
  teamMembers: {
    list: () => request('/api/team-members'),
    setForTeam: (teamId, members) => request(`/api/team-members/${teamId}`, { method: 'PUT', body: JSON.stringify({ members }) }),
  },
  settings: {
    get: (key) => request(`/api/settings/${key}`),
    set: (key, value) => request(`/api/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  },
  teamApp: {
    setPassword: (teamId, password) => request(`/api/team-app/password/${teamId}`, { method: 'PUT', body: JSON.stringify({ password }) }),
  },
  sites: {
    list: (clientId) => request('/api/sites' + qs({ clientId })),
    create: (data) => request('/api/sites', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/sites/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/sites/${id}`, { method: 'DELETE' }),
  },
  productTypes: {
    list: (all) => request('/api/product-types' + (all ? '?all=1' : '')),
    create: (data) => request('/api/product-types', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/product-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/product-types/${id}`, { method: 'DELETE' }),
  },
  assets: {
    list: (params) => request('/api/assets' + qs(params)),
    summary: () => request('/api/assets/summary'),
    create: (data) => request('/api/assets', { method: 'POST', body: JSON.stringify(data) }),
    bulk: (data) => request('/api/assets/bulk', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/assets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    setStatus: (id, status, notes) => request(`/api/assets/${id}/status`, { method: 'PUT', body: JSON.stringify({ status, notes }) }),
    history: (id) => request(`/api/assets/${id}/history`),
    remove: (id) => request(`/api/assets/${id}`, { method: 'DELETE' }),
  },
  rentals: {
    list: (params) => request('/api/rentals' + qs(params)),
    get: (id) => request(`/api/rentals/${id}`),
    availability: (start, end, excludeRentalId) => request('/api/rentals/availability' + qs({ start, end, excludeRentalId })),
    create: (data) => request('/api/rentals', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/rentals/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    confirm: (id, teamId) => request(`/api/rentals/${id}/confirm`, { method: 'POST', body: JSON.stringify({ teamId }) }),
    cancel: (id, reason) => request(`/api/rentals/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
    close: (id, missingAssetsStatus) => request(`/api/rentals/${id}/close`, { method: 'POST', body: JSON.stringify({ missingAssetsStatus }) }),
    remove: (id) => request(`/api/rentals/${id}`, { method: 'DELETE' }),
  },
};
