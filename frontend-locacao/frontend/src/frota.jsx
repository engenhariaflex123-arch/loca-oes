import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Edit2, Trash2, RefreshCw, Route as RouteIcon, X, Crosshair } from 'lucide-react';
import { api } from './api.js';
import { TEAMS, teamOf, kindLabel, ui } from './constants.js';
import { Modal } from './locacoes.jsx';

const REFRESH_MS = 30000;
const DEFAULT_CENTER = [-20.1436, -44.8891];

const STATE_META = {
  em_movimento: { label: 'Em movimento', dot: '#2a6fbd' },
  parado:       { label: 'Parado',       dot: '#059669' },
  sem_sinal:    { label: 'Sem sinal',    dot: '#a3a3a3' },
  sem_dados:    { label: 'Não encontrado no IOP GPS', dot: '#d4d4d4' },
};

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtAge(sec){
  if(sec == null) return '';
  if(sec < 60) return 'agora';
  if(sec < 3600) return `há ${Math.round(sec / 60)} min`;
  if(sec < 86400) return `há ${Math.round(sec / 3600)} h`;
  return `há ${Math.round(sec / 86400)} dia(s)`;
}

function todayBR(){
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

// Carrega o Leaflet uma vez só (o mesmo arquivo que a aba Mapa usa)
let leafletPromise = null;
function loadLeaflet(){
  if(window.L) return Promise.resolve(window.L);
  if(leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    const js = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    if(!document.querySelector(`link[href="${css}"]`)){
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = css; document.head.appendChild(link);
    }
    const existing = document.querySelector(`script[src="${js}"]`);
    const script = existing || document.createElement('script');
    script.addEventListener('load', () => resolve(window.L));
    script.addEventListener('error', () => { leafletPromise = null; reject(new Error('Não foi possível carregar o mapa.')); });
    if(!existing){ script.src = js; document.body.appendChild(script); }
    else if(window.L) resolve(window.L);
  });
  return leafletPromise;
}

// ---------------------------------------------------------------------------
// ABA FROTA
// ---------------------------------------------------------------------------
export function FrotaTab({ appointments, clients, sites }){
  const [configured, setConfigured] = useState(null);
  const [live, setLive] = useState(null);
  const [liveError, setLiveError] = useState('');
  const [loading, setLoading] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState(null);
  const [track, setTrack] = useState(null); // { vehicleId, points, error }
  const [selected, setSelected] = useState(null);
  const [mapError, setMapError] = useState('');
  const [tick, setTick] = useState(0);

  const mapEl = useRef(null);
  const map = useRef(null);
  const layers = useRef({});

  const loadVehicles = async () => setVehicles(await api.fleet.vehicles());
  const loadLive = async () => {
    setLoading(true);
    try{
      setLive(await api.fleet.live());
      setLiveError('');
    }catch(err){
      setLiveError(err.message);
    }finally{ setLoading(false); }
  };

  useEffect(() => {
    api.fleet.status().then(s => setConfigured(s.configured)).catch(() => setConfigured(false));
    loadVehicles().catch(() => {});
  }, []);

  useEffect(() => {
    if(!configured) return;
    loadLive();
    const id = setInterval(loadLive, REFRESH_MS);
    return () => clearInterval(id);
  }, [configured]);

  // Relógio para o "atualizado há X s"
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 5000); return () => clearInterval(id); }, []);

  // Visitas de hoje, com o endereço onde acontecem
  const today = todayBR();
  const todayStops = useMemo(() => {
    const siteById = Object.fromEntries(sites.map(s => [s.id, s]));
    const clientById = Object.fromEntries(clients.map(c => [c.id, c]));
    return appointments
      .filter(a => a.date === today && a.status !== 'cancelado')
      .map(a => {
        const site = a.siteId ? siteById[a.siteId] : null;
        const client = clientById[a.clientId];
        const lat = parseFloat(site ? site.lat : client?.lat);
        const lon = parseFloat(site ? site.lon : client?.lon);
        return { appt: a, name: client?.name || 'Cliente', place: site?.name || client?.address || '', lat, lon };
      })
      .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  }, [appointments, clients, sites, today]);

  // Monta o mapa
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then(L => {
      if(cancelled || !mapEl.current || map.current) return;
      map.current = L.map(mapEl.current, { zoomControl: true }).setView(DEFAULT_CENTER, 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap',
      }).addTo(map.current);
      layers.current.stops = L.layerGroup().addTo(map.current);
      layers.current.track = L.layerGroup().addTo(map.current);
      layers.current.vehicles = L.layerGroup().addTo(map.current);
      layers.current.markers = {};
      setTick(t => t + 1);
    }).catch(err => setMapError(err.message));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => { if(map.current){ map.current.remove(); map.current = null; } }, []);

  // Desenha visitas do dia
  useEffect(() => {
    const L = window.L;
    if(!L || !map.current) return;
    const g = layers.current.stops; g.clearLayers();
    todayStops.forEach(s => {
      const team = teamOf(s.appt.teamId);
      const done = s.appt.status === 'concluido';
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:14px;height:14px;border-radius:3px;background:${done ? '#fff' : team.color};border:2px solid ${team.color};box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>`,
        iconSize: [14, 14], iconAnchor: [7, 7],
      });
      L.marker([s.lat, s.lon], { icon, zIndexOffset: -100 })
        .bindPopup(`<b>${esc(kindLabel(s.appt.kind))}</b>: ${esc(s.name)}<br><span style="color:#666">${esc(s.place)}</span><br>${esc(team.name)}${done ? ' (concluída)' : ''}`)
        .addTo(g);
    });
  }, [todayStops, tick]);

  // Desenha veículos
  useEffect(() => {
    const L = window.L;
    if(!L || !map.current || !live) return;
    const g = layers.current.vehicles; g.clearLayers();
    layers.current.markers = {};
    live.vehicles.forEach(v => {
      if(!v.position) return;
      const team = v.teamId ? teamOf(v.teamId) : null;
      const color = v.state === 'sem_sinal' ? '#a3a3a3' : (team?.color || '#2a6fbd');
      const label = esc(v.plate || v.name);
      const icon = L.divIcon({
        className: '',
        html: `<div style="display:flex;align-items:center;gap:4px;width:max-content;transform:translate(-11px,-11px)">
          <div style="flex:none;box-sizing:border-box;width:22px;height:22px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45)"></div>
          <span style="background:#fff;color:#171717;font:600 11px system-ui,sans-serif;padding:1px 5px;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.3);white-space:nowrap">${label}</span>
        </div>`,
        iconSize: [0, 0],
      });
      const meta = STATE_META[v.state] || STATE_META.sem_dados;
      const m = L.marker([v.position.lat, v.position.lng], { icon })
        .bindPopup(`<b>${esc(v.name)}</b>${v.plate ? ` (${esc(v.plate)})` : ''}<br>${esc(meta.label)}${v.position.speed ? `, ${Math.round(v.position.speed)} km/h` : ''}<br><span style="color:#666">Posição ${esc(fmtAge(v.position.ageSec))}${team ? ` · ${esc(team.name)}` : ''}</span>`)
        .addTo(g);
      layers.current.markers[v.id] = m;
    });
  }, [live, tick]);

  // Enquadra tudo na primeira carga
  const framed = useRef(false);
  useEffect(() => {
    const L = window.L;
    if(!L || !map.current || framed.current || !live) return;
    const pts = [
      ...live.vehicles.filter(v => v.position).map(v => [v.position.lat, v.position.lng]),
      ...todayStops.map(s => [s.lat, s.lon]),
    ];
    if(pts.length){ map.current.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 15 }); framed.current = true; }
  }, [live, todayStops, tick]);

  // Trajeto
  useEffect(() => {
    const L = window.L;
    if(!L || !map.current) return;
    const g = layers.current.track; g.clearLayers();
    if(!track?.points?.length) return;
    const v = vehicles.find(x => x.id === track.vehicleId);
    const color = v?.teamId ? teamOf(v.teamId).color : '#2a6fbd';
    const latlngs = track.points.map(p => [p.lat, p.lng]);
    L.polyline(latlngs, { color, weight: 4, opacity: 0.8 }).addTo(g);
    L.circleMarker(latlngs[0], { radius: 6, color, fillColor: '#fff', fillOpacity: 1, weight: 3 })
      .bindTooltip('Início do dia').addTo(g);
    map.current.fitBounds(L.latLngBounds(latlngs).pad(0.15), { maxZoom: 16 });
  }, [track, tick]);

  const focus = (v) => {
    setSelected(v.id);
    const m = layers.current.markers?.[v.id];
    if(m && map.current){ map.current.setView(m.getLatLng(), Math.max(map.current.getZoom(), 15)); m.openPopup(); }
  };

  const showTrack = async (v) => {
    if(track?.vehicleId === v.id){ setTrack(null); return; }
    setTrack({ vehicleId: v.id, points: null });
    try{
      const r = await api.fleet.track(v.id);
      setTrack({ vehicleId: v.id, points: r.points, error: r.points.length ? '' : 'Sem trajeto registrado hoje.' });
    }catch(err){
      setTrack({ vehicleId: v.id, points: [], error: err.message });
    }
  };

  const liveById = Object.fromEntries((live?.vehicles || []).map(v => [v.id, v]));
  const updatedAgo = live ? Math.round((Date.now() - Date.parse(live.updatedAt)) / 1000) : null;

  return (
    <div className="flex flex-col gap-6">
      {configured === false && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">Falta ligar a plataforma ao IOP GPS</p>
          <p className="text-amber-800 dark:text-amber-300 mt-1">
            No Railway, no serviço do backend, crie as variáveis <code className="font-mono">IOPGPS_APPID</code> e <code className="font-mono">IOPGPS_API_KEY</code> com os dados fornecidos pelo IOP GPS. Você já pode cadastrar os veículos abaixo enquanto isso.
          </p>
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-lg font-medium">Frota agora</h2>
          <div className="flex items-center gap-3 text-xs text-neutral-500">
            {updatedAgo != null && <span>Atualizado {updatedAgo < 10 ? 'agora' : `há ${updatedAgo} s`}</span>}
            {configured && (
              <button onClick={loadLive} disabled={loading} className={`${ui.secondary} flex items-center gap-1.5 !py-1.5 text-xs`}>
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/> Atualizar
              </button>
            )}
          </div>
        </div>

        {liveError && <p className="text-sm text-red-500 mb-2">{liveError}</p>}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-4">
          <div className={`${ui.card} overflow-hidden relative`}>
            <div ref={mapEl} className="h-[26rem] lg:h-[32rem] w-full z-0" role="region" aria-label="Mapa da frota" />
            {mapError && <p className="absolute inset-0 flex items-center justify-center text-sm text-red-500">{mapError}</p>}
            <div className="absolute bottom-2 left-2 z-[400] bg-white/90 dark:bg-neutral-900/90 rounded px-2 py-1 text-[11px] text-neutral-600 dark:text-neutral-300 flex gap-3">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-neutral-500 border-2 border-white"/>Veículo</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-neutral-500"/>Visita de hoje</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm border-2 border-neutral-500 bg-white"/>Concluída</span>
            </div>
          </div>

          <div className={`${ui.card} divide-y divide-neutral-200 dark:divide-neutral-800 self-start`}>
            {vehicles.filter(v => v.active).length === 0 && (
              <p className="p-4 text-sm text-neutral-500">Nenhum veículo cadastrado. Use o botão abaixo para ligar cada veículo ao seu rastreador.</p>
            )}
            {vehicles.filter(v => v.active).map(v => {
              const lv = liveById[v.id];
              const meta = STATE_META[lv?.state] || (configured ? STATE_META.sem_dados : null);
              const team = v.teamId ? teamOf(v.teamId) : null;
              const tracking = track?.vehicleId === v.id;
              return (
                <div key={v.id} className={`px-3 py-2.5 ${selected === v.id ? 'bg-neutral-50 dark:bg-neutral-800/50' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <button onClick={() => focus(v)} disabled={!lv?.position} className="text-left min-w-0 disabled:cursor-default">
                      <p className="text-sm font-medium truncate flex items-center gap-1.5">
                        {team && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: team.color }} title={team.name}/>}
                        {v.name}
                      </p>
                      <p className="text-xs text-neutral-500 flex items-center gap-1.5 mt-0.5">
                        {meta && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.dot }}/>}
                        {meta?.label || 'Aguardando integração'}
                        {lv?.state === 'em_movimento' && lv.position.speed != null && `, ${Math.round(lv.position.speed)} km/h`}
                        {lv?.position && lv.state !== 'em_movimento' && ` ${fmtAge(lv.position.ageSec)}`}
                      </p>
                    </button>
                    <div className="flex shrink-0">
                      {lv?.position && (
                        <button onClick={() => focus(v)} aria-label={`Centralizar ${v.name}`} title="Mostrar no mapa" className="p-1.5 text-neutral-500 hover:text-brand-500"><Crosshair size={14}/></button>
                      )}
                      {configured && (
                        <button onClick={() => showTrack(v)} aria-pressed={tracking} aria-label={`Trajeto de hoje de ${v.name}`} title={tracking ? 'Esconder trajeto' : 'Trajeto de hoje'}
                          className={`p-1.5 ${tracking ? 'text-brand-600 dark:text-brand-400' : 'text-neutral-500 hover:text-brand-500'}`}>
                          {tracking ? <X size={14}/> : <RouteIcon size={14}/>}
                        </button>
                      )}
                    </div>
                  </div>
                  {tracking && (
                    <p className="text-xs mt-1 text-neutral-500">
                      {track.points === null ? 'Carregando trajeto...' : track.error ? <span className={track.points.length ? '' : 'text-amber-600 dark:text-amber-400'}>{track.error}</span> : `Trajeto de hoje: ${track.points.length} pontos`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <VehiclesSection vehicles={vehicles} configured={configured} onChanged={async () => { await loadVehicles(); if(configured) await loadLive(); }}
        form={form} setForm={setForm} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CADASTRO DE VEÍCULOS
// ---------------------------------------------------------------------------
function VehiclesSection({ vehicles, configured, onChanged, form, setForm }){
  const [error, setError] = useState('');
  const remove = async (v) => {
    if(!window.confirm(`Remover "${v.name}" da plataforma? O rastreador continua funcionando no IOP GPS.`)) return;
    try{ await api.fleet.remove(v.id); await onChanged(); }catch(err){ setError(err.message); }
  };
  return (
    <section>
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-lg font-medium">Veículos</h2>
        <button onClick={() => setForm({ name: '', plate: '', imei: '', teamId: '', active: true })} className={ui.primary}>+ Cadastrar veículo</button>
      </div>
      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}
      <div className={`${ui.card} overflow-x-auto`}>
        {vehicles.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">Cadastre cada veículo com o IMEI do rastreador instalado nele (o mesmo que aparece no IOP GPS).</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500 font-mono uppercase border-b border-neutral-200 dark:border-neutral-800">
                <th className="px-4 py-2 font-normal">Veículo</th>
                <th className="px-4 py-2 font-normal">Placa</th>
                <th className="px-4 py-2 font-normal">Rastreador (IMEI)</th>
                <th className="px-4 py-2 font-normal">Equipe</th>
                <th className="px-4 py-2 font-normal"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map(v => {
                const team = v.teamId ? teamOf(v.teamId) : null;
                return (
                  <tr key={v.id} className={`border-t border-neutral-100 dark:border-neutral-800 ${v.active ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2">{v.name}{!v.active && <span className="text-xs text-neutral-500"> (inativo)</span>}</td>
                    <td className="px-4 py-2 font-mono text-xs">{v.plate || '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs">{v.imei}</td>
                    <td className="px-4 py-2">
                      {team ? <span className={ui.badge} style={{ background: team.bg, color: team.text }}>{team.name.replace('Equipe ', '')}</span> : <span className="text-xs text-neutral-500">Nenhuma</span>}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setForm({ ...v })} aria-label={`Editar ${v.name}`} className="p-1.5 text-neutral-500 hover:text-brand-500"><Edit2 size={14}/></button>
                      <button onClick={() => remove(v)} aria-label={`Remover ${v.name}`} className="p-1.5 text-neutral-500 hover:text-red-400"><Trash2 size={14}/></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {form && <VehicleModal value={form} configured={configured} onClose={() => setForm(null)} onSaved={async () => { setForm(null); await onChanged(); }} />}
    </section>
  );
}

function VehicleModal({ value, configured, onClose, onSaved }){
  const [v, setV] = useState(value);
  const [devices, setDevices] = useState(null);
  const [devicesError, setDevicesError] = useState('');
  const [manual, setManual] = useState(!configured);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });

  useEffect(() => {
    if(!configured) return;
    api.fleet.devices().then(setDevices).catch(err => { setDevicesError(err.message); setManual(true); });
  }, [configured]);

  const pickDevice = (imei) => {
    const d = devices?.find(x => x.imei === imei);
    setV(prev => ({ ...prev, imei, name: prev.name || d?.name || '' }));
  };

  const save = async () => {
    setSaving(true); setError('');
    try{
      if(v.id) await api.fleet.update(v.id, v); else await api.fleet.create(v);
      onSaved();
    }catch(err){ setError(err.message); setSaving(false); }
  };

  const imeiOk = /^\d{10,17}$/.test(String(v.imei || '').trim());

  return (
    <Modal title={v.id ? `Editar ${value.name}` : 'Cadastrar veículo'} onClose={onClose} footer={
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={ui.secondary}>Cancelar</button>
        <button onClick={save} disabled={!v.name?.trim() || !imeiOk || saving} className={ui.primary}>{saving ? 'Salvando...' : 'Salvar veículo'}</button>
      </div>
    }>
      <div className="flex flex-col gap-3">
        <div>
          <label className={ui.label} htmlFor="vm-imei">Rastreador</label>
          {!manual ? (
            <>
              <select id="vm-imei" value={v.imei} onChange={e => pickDevice(e.target.value)} className={`${ui.input} w-full`}>
                <option value="">{devices ? 'Escolha o rastreador do IOP GPS...' : 'Carregando rastreadores...'}</option>
                {(devices || []).map(d => (
                  <option key={d.imei} value={d.imei} disabled={d.usedBy && d.imei !== value.imei}>
                    {d.name} ({d.imei}){d.usedBy && d.imei !== value.imei ? `, já está em ${d.usedBy}` : ''}
                  </option>
                ))}
              </select>
              <button onClick={() => setManual(true)} className="text-xs text-neutral-500 hover:underline mt-1">Digitar o IMEI</button>
            </>
          ) : (
            <>
              <input id="vm-imei" inputMode="numeric" value={v.imei} onChange={set('imei')} placeholder="IMEI (15 dígitos)" className={`${ui.input} w-full font-mono`} />
              {devicesError && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Não deu para listar os rastreadores do IOP GPS: {devicesError}</p>}
              {!devicesError && configured && <button onClick={() => setManual(false)} className="text-xs text-neutral-500 hover:underline mt-1">Escolher da lista do IOP GPS</button>}
              {!configured && <p className="text-xs text-neutral-500 mt-1">O IMEI aparece no cadastro do rastreador no IOP GPS e na etiqueta do aparelho.</p>}
            </>
          )}
          {v.imei && !imeiOk && <p className="text-xs text-red-500 mt-1">O IMEI tem só números, normalmente 15.</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_9rem] gap-3">
          <div>
            <label className={ui.label} htmlFor="vm-name">Nome do veículo</label>
            <input id="vm-name" value={v.name} onChange={set('name')} placeholder="Ex.: Caminhão de sucção 1" className={`${ui.input} w-full`} />
          </div>
          <div>
            <label className={ui.label} htmlFor="vm-plate">Placa</label>
            <input id="vm-plate" value={v.plate || ''} onChange={set('plate')} placeholder="ABC1D23" className={`${ui.input} w-full uppercase font-mono`} />
          </div>
        </div>
        <div>
          <label className={ui.label}>Equipe que usa o veículo</label>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setV({ ...v, teamId: '' })} aria-pressed={!v.teamId}
              className={`px-3 py-2 rounded text-sm border-2 ${!v.teamId ? 'border-neutral-500' : 'border-transparent'} bg-neutral-100 dark:bg-neutral-800`}>Nenhuma</button>
            {TEAMS.map(t => (
              <button key={t.id} onClick={() => setV({ ...v, teamId: t.id })} aria-pressed={v.teamId === t.id}
                className="flex-1 px-3 py-2 rounded text-sm font-medium border-2"
                style={{ borderColor: v.teamId === t.id ? t.color : 'transparent', background: t.bg, color: t.text }}>
                {t.name.replace('Equipe ', '')}
              </button>
            ))}
          </div>
        </div>
        {v.id && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.active} onChange={e => setV({ ...v, active: e.target.checked })} />
            Ativo (desmarque para tirar do mapa sem apagar)
          </label>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}
