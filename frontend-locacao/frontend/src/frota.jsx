import React, { useState, useEffect, useRef } from 'react';
import { Edit2, Trash2, RefreshCw, Route as RouteIcon, X, Bell } from 'lucide-react';
import { api } from './api.js';
import { TEAMS, teamOf, ui } from './constants.js';
import { Modal } from './locacoes.jsx';

const REFRESH_MS = 30000;

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


// ---------------------------------------------------------------------------
// DADOS DA FROTA (usado pela aba Mapa)
// ---------------------------------------------------------------------------
// `liveEnabled`: busca posições ao vivo (só faz sentido quando o mapa mostra hoje)
export function useFleet({ liveEnabled }){
  const [configured, setConfigured] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [live, setLive] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.fleet.status().then(s => setConfigured(s.configured)).catch(() => setConfigured(false));
    api.fleet.vehicles().then(setVehicles).catch(() => {});
  }, []);

  const refresh = async () => {
    setLoading(true);
    try{ setLive(await api.fleet.live()); setError(''); }
    catch(err){ setError(err.message); }
    finally{ setLoading(false); }
  };

  useEffect(() => {
    if(!configured || !liveEnabled) return;
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [configured, liveEnabled]);

  return { configured, vehicles: vehicles.filter(v => v.active), live: liveEnabled ? live : null, error: liveEnabled ? error : '', loading, refresh };
}

// Desenha veículos e trajeto num mapa Leaflet que já existe.
// As camadas levam a marca `fleet: true` para a aba Mapa não apagá-las ao redesenhar as paradas.
export function useFleetLayer({ mapRef, ready, live, track, vehicles, extraPoints = [], frameKey }){
  const groups = useRef(null);
  const markers = useRef({});
  const framedFor = useRef(null);

  useEffect(() => {
    if(!live && groups.current){ groups.current.vehicles.clearLayers(); markers.current = {}; }
  }, [live]);

  const ensure = () => {
    const L = window.L, map = mapRef.current;
    if(!L || !map) return null;
    if(!groups.current){
      groups.current = { vehicles: L.layerGroup().addTo(map), track: L.layerGroup().addTo(map) };
    }
    return groups.current;
  };

  // Veículos: marcadores persistentes que DESLIZAM até a nova posição (animação),
  // em vez de sumir e reaparecer a cada atualização.
  const anim = useRef({});
  useEffect(() => {
    const L = window.L;
    const g = ready && ensure();
    if(!g) return;
    const seen = new Set();
    (live?.vehicles || []).forEach(v => {
      if(!v.position) return;
      seen.add(v.id);
      const team = v.teamId ? teamOf(v.teamId) : null;
      const color = v.state === 'sem_sinal' ? '#a3a3a3' : (team?.color || '#2a6fbd');
      const meta = STATE_META[v.state] || STATE_META.sem_dados;
      const off = v.tracking?.offRoute;
      const late = v.tracking?.lateIds?.length > 0;
      const moving = v.state === 'em_movimento';
      const html = `<div style="display:flex;align-items:center;gap:4px;width:max-content;transform:translate(-11px,-11px)">
          <div style="position:relative;flex:none;box-sizing:border-box;width:22px;height:22px;border-radius:6px;background:${color};border:3px solid #fff;box-shadow:0 0 0 ${off ? '3px #f59e0b' : '0 transparent'},0 1px 5px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1"/></svg>
            ${moving ? '<span style="position:absolute;inset:-7px;border-radius:9px;border:2px solid ' + color + ';opacity:.5;animation:fleetPulse 1.6s ease-out infinite"></span>' : ''}
          </div>
          <span style="background:#fff;color:#171717;font:600 11px system-ui,sans-serif;padding:1px 5px;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.3);white-space:nowrap">${esc(v.plate || v.name)}${off ? ' · fora de rota' : late ? ' · atrasado' : ''}</span>
        </div>`;
      const icon = L.divIcon({ className: '', html, iconSize: [0, 0] });
      const popup = `<b>${esc(v.name)}</b>${v.plate ? ` (${esc(v.plate)})` : ''}<br>${esc(meta.label)}${v.position.speed ? `, ${Math.round(v.position.speed)} km/h` : ''}${off ? `<br><b style="color:#b45309">Fora da rota (${v.tracking.offRouteKm} km)</b>` : ''}${late ? '<br><b style="color:#b45309">Atrasado para a próxima parada</b>' : ''}<br><span style="color:#666">Posição ${esc(fmtAge(v.position.ageSec))}${team ? ` · ${esc(team.name)}` : ''}</span>`;
      const target = L.latLng(v.position.lat, v.position.lng);
      let m = markers.current[v.id];
      if(!m){
        m = L.marker(target, { icon, fleet: true, zIndexOffset: 1000 }).bindPopup(popup).addTo(g.vehicles);
        markers.current[v.id] = m;
        return;
      }
      m.setIcon(icon);
      m.setPopupContent(popup);
      // Desliza da posição atual até a nova em 1,5 s
      const from = m.getLatLng();
      if(from.distanceTo(target) < 1) return;
      cancelAnimationFrame(anim.current[v.id]);
      const t0 = performance.now(), dur = 1500;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // suaviza início e fim
        m.setLatLng([from.lat + (target.lat - from.lat) * e, from.lng + (target.lng - from.lng) * e]);
        if(k < 1) anim.current[v.id] = requestAnimationFrame(step);
      };
      anim.current[v.id] = requestAnimationFrame(step);
    });
    // Tira do mapa quem não veio mais na atualização
    Object.keys(markers.current).forEach(id => {
      if(!seen.has(id)){ g.vehicles.removeLayer(markers.current[id]); delete markers.current[id]; }
    });
    // Na primeira posição recebida (para cada data), enquadra veículos + paradas juntos
    const pts = [
      ...(live?.vehicles || []).filter(v => v.position && v.state !== 'sem_sinal').map(v => [v.position.lat, v.position.lng]),
      ...extraPoints,
    ];
    if(live && pts.length && framedFor.current !== frameKey){
      framedFor.current = frameKey;
      mapRef.current.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 15 });
    }
  }, [ready, live]);

  // Pulso do veículo em movimento (CSS uma vez só)
  useEffect(() => {
    if(document.getElementById('fleet-anim-css')) return;
    const st = document.createElement('style');
    st.id = 'fleet-anim-css';
    st.textContent = '@keyframes fleetPulse{0%{transform:scale(.8);opacity:.6}100%{transform:scale(1.6);opacity:0}}';
    document.head.appendChild(st);
  }, []);

  useEffect(() => {
    const L = window.L;
    const g = ready && ensure();
    if(!g) return;
    g.track.clearLayers();
    if(!track?.points?.length) return;
    const v = vehicles.find(x => x.id === track.vehicleId);
    const color = v?.teamId ? teamOf(v.teamId).color : '#2a6fbd';
    const latlngs = track.points.map(p => [p.lat, p.lng]);
    L.polyline(latlngs, { color, weight: 4, opacity: 0.85, dashArray: '1,7', lineCap: 'round', fleet: true }).addTo(g.track);
    L.circleMarker(latlngs[0], { radius: 6, color, fillColor: '#fff', fillOpacity: 1, weight: 3, fleet: true })
      .bindTooltip('Início do trajeto').addTo(g.track);
    L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color, fillColor: color, fillOpacity: 1, weight: 3, fleet: true })
      .bindTooltip('Último ponto').addTo(g.track);
    mapRef.current.fitBounds(L.latLngBounds(latlngs).pad(0.15), { maxZoom: 16 });
  }, [ready, track]);

  const focus = (vehicleId) => {
    const m = markers.current[vehicleId];
    if(m && mapRef.current){ mapRef.current.setView(m.getLatLng(), Math.max(mapRef.current.getZoom(), 15)); m.openPopup(); }
  };
  return { focus };
}

// Lista de veículos ao lado do mapa
export function FleetPanel({ fleet, isToday, dateKey, track, setTrack, onFocus }){
  const { configured, vehicles, live, error, loading, refresh } = fleet;
  if(configured === null) return null;
  if(vehicles.length === 0){
    return (
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
        <h3 className="text-sm font-medium mb-1">Veículos</h3>
        <p className="text-sm text-neutral-500">Cadastre os veículos na aba Equipes para vê-los aqui.</p>
      </div>
    );
  }
  const liveById = Object.fromEntries((live?.vehicles || []).map(v => [v.id, v]));

  const toggleTrack = async (v) => {
    if(track?.vehicleId === v.id){ setTrack(null); return; }
    setTrack({ vehicleId: v.id, points: null });
    try{
      const r = await api.fleet.track(v.id, dateKey);
      setTrack({ vehicleId: v.id, points: r.points, error: r.points.length ? '' : (isToday ? 'Sem trajeto registrado hoje.' : 'Sem trajeto registrado nesse dia.') });
    }catch(err){ setTrack({ vehicleId: v.id, points: [], error: err.message }); }
  };

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg">
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <h3 className="text-sm font-medium">{isToday ? 'Veículos agora' : 'Veículos'}</h3>
        {configured && isToday && (
          <button onClick={refresh} disabled={loading} aria-label="Atualizar posições" title="Atualizar posições" className="p-1 text-neutral-500 hover:text-brand-500">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/>
          </button>
        )}
      </div>
      {configured === false && (
        <p className="px-4 pb-2 text-xs text-amber-700 dark:text-amber-400">Falta ligar ao IOP GPS: defina IOPGPS_APPID e IOPGPS_API_KEY no Railway.</p>
      )}
      {error && <p className="px-4 pb-2 text-xs text-red-500">{error}</p>}
      {!isToday && configured && <p className="px-4 pb-2 text-xs text-neutral-500">Posição ao vivo só aparece no dia de hoje. Para esta data, veja o trajeto feito.</p>}
      <ul className="divide-y divide-neutral-200 dark:divide-neutral-800 border-t border-neutral-200 dark:border-neutral-800">
        {vehicles.map(v => {
          const lv = liveById[v.id];
          const meta = isToday && configured ? (STATE_META[lv?.state] || (live ? STATE_META.sem_dados : null)) : null;
          const team = v.teamId ? teamOf(v.teamId) : null;
          const tracking = track?.vehicleId === v.id;
          return (
            <li key={v.id} className="px-4 py-2">
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => onFocus(v.id)} disabled={!lv?.position} className="text-left min-w-0 disabled:cursor-default">
                  <p className="text-sm truncate flex items-center gap-1.5">
                    {team && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: team.color }} title={team.name}/>}
                    {v.name}{v.plate && <span className="text-xs text-neutral-500 font-mono">{v.plate}</span>}
                  </p>
                  {meta && (
                    <p className="text-xs text-neutral-500 flex items-center gap-1.5 mt-0.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.dot }}/>
                      {meta.label}
                      {lv?.state === 'em_movimento' && lv.position.speed != null && `, ${Math.round(lv.position.speed)} km/h`}
                      {lv?.position && lv.state !== 'em_movimento' && ` ${fmtAge(lv.position.ageSec)}`}
                    </p>
                  )}
                  {isToday && lv?.tracking?.offRoute && <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mt-0.5">🧭 Fora da rota ({lv.tracking.offRouteKm} km)</p>}
                  {isToday && lv?.tracking?.lateIds?.length > 0 && <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mt-0.5">⏰ Atrasado para {lv.tracking.lateIds.length} parada(s)</p>}
                </button>
                {configured && (
                  <button onClick={() => toggleTrack(v)} aria-pressed={tracking}
                    aria-label={`${tracking ? 'Esconder' : 'Mostrar'} trajeto de ${v.name}`} title={tracking ? 'Esconder trajeto' : 'Trajeto feito no dia'}
                    className={`p-1.5 shrink-0 ${tracking ? 'text-brand-600 dark:text-brand-400' : 'text-neutral-500 hover:text-brand-500'}`}>
                    {tracking ? <X size={14}/> : <RouteIcon size={14}/>}
                  </button>
                )}
              </div>
              {tracking && (
                <p className="text-xs mt-1 text-neutral-500">
                  {track.points === null ? 'Carregando trajeto...'
                    : track.error ? <span className="text-amber-600 dark:text-amber-400">{track.error}</span>
                    : `Trajeto feito: ${track.points.length} pontos (linha pontilhada)`}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CADASTRO DE VEÍCULOS
// ---------------------------------------------------------------------------
export function VehiclesSection(){
  const [vehicles, setVehicles] = useState([]);
  const [configured, setConfigured] = useState(null);
  const [form, setForm] = useState(null);
  const onChanged = async () => setVehicles(await api.fleet.vehicles());
  useEffect(() => {
    api.fleet.status().then(s => setConfigured(s.configured)).catch(() => setConfigured(false));
    onChanged().catch(() => {});
  }, []);
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

// ---------------------------------------------------------------------------
// MENSAGENS DO ACOMPANHAMENTO (sino no topo e painel no Mapa)
// ---------------------------------------------------------------------------
const EVENT_META = {
  chegada:            { icon: '📍', label: 'Chegou' },
  inicio:             { icon: '🚚', label: 'A caminho' },
  conclusao:          { icon: '✅', label: 'Concluiu' },
  nao_realizada:      { icon: '⛔', label: 'Não realizada' },
  saida_sem_concluir: { icon: '⚠️', label: 'Saiu sem concluir' },
  fora_de_rota:       { icon: '🧭', label: 'Fora de rota' },
  atraso:             { icon: '⏰', label: 'Atraso' },
};
const SEEN_KEY = 'eventos-vistos-ate';

function timeAgo(iso){
  const sec = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if(sec < 60) return 'agora';
  if(sec < 3600) return `${Math.round(sec / 60)} min`;
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function useEvents(pollMs = 30000){
  const [events, setEvents] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = () => api.events.list({ limit: 40 }).then(e => { if(alive) setEvents(e); }).catch(() => {});
    load();
    const id = setInterval(load, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return events;
}

export function EventItem({ e, compact }){
  const meta = EVENT_META[e.type] || { icon: '•', label: e.type };
  const team = e.teamId ? teamOf(e.teamId) : null;
  const color = e.severity === 'alerta' ? 'border-l-amber-500' : e.severity === 'sucesso' ? 'border-l-emerald-500' : 'border-l-sky-500';
  return (
    <li className={`border-l-4 ${color} pl-2.5 py-1`}>
      <p className={`${compact ? 'text-xs' : 'text-sm'} leading-snug`}><span aria-hidden="true">{meta.icon} </span>{e.message}</p>
      <p className="text-[11px] text-neutral-500 mt-0.5 flex items-center gap-1.5">
        {team && <span className="w-1.5 h-1.5 rounded-full" style={{ background: team.color }}/>}
        {meta.label} · {timeAgo(e.createdAt)}
      </p>
    </li>
  );
}

export function EventsBell(){
  const events = useEvents();
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(() => { try{ return localStorage.getItem(SEEN_KEY) || ''; }catch(e){ return ''; } });
  const unread = events.filter(e => !seenAt || e.createdAt > seenAt);
  const alerts = unread.filter(e => e.severity === 'alerta').length;
  const markSeen = () => {
    const last = events[0]?.createdAt || new Date().toISOString();
    setSeenAt(last);
    try{ localStorage.setItem(SEEN_KEY, last); }catch(e){}
  };
  const ref = useRef(null);
  useEffect(() => {
    if(!open) return;
    const close = (ev) => { if(ref.current && !ref.current.contains(ev.target)){ setOpen(false); markSeen(); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, events]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => { if(open) markSeen(); setOpen(o => !o); }}
        aria-label={`Mensagens das equipes${unread.length ? `, ${unread.length} nova(s)` : ''}`} title="Mensagens das equipes"
        className="relative p-2 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <Bell size={16}/>
        {unread.length > 0 && (
          <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center ${alerts ? 'bg-amber-500' : 'bg-brand-600'}`}>
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[22rem] max-w-[90vw] max-h-[70vh] overflow-y-auto bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-xl p-3">
          <p className="text-sm font-medium mb-2">Mensagens das equipes</p>
          {events.length === 0 && <p className="text-sm text-neutral-500">Nenhuma mensagem ainda. Elas aparecem quando as equipes chegam, concluem ou saem da rota.</p>}
          <ul className="flex flex-col gap-2">
            {events.map(e => (
              <div key={e.id} className={!seenAt || e.createdAt > seenAt ? '' : 'opacity-60'}><EventItem e={e} /></div>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ANDAMENTO DAS EQUIPES (aba Mapa)
// ---------------------------------------------------------------------------
export function useProgress(dateKey, pollMs = 30000){
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.fleet.progress(dateKey).then(d => { if(alive) setData(d); }).catch(() => {});
    setData(null); load();
    const id = setInterval(load, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [dateKey]);
  return data;
}

const STOP_STATE = (s) => s.status === 'concluido' ? { label: 'Feita', cls: 'bg-emerald-500 border-emerald-500' }
  : s.status === 'nao_realizado' ? { label: 'Não realizada', cls: 'bg-red-500 border-red-500' }
  : s.arrivedAt && !s.departedAt ? { label: 'No local', cls: 'bg-sky-500 border-sky-500 animate-pulse' }
  : s.late ? { label: 'Atrasada', cls: 'bg-white border-amber-500 border-2' }
  : { label: 'A fazer', cls: 'bg-white border-neutral-400 border-2' };

export function TeamProgressPanel({ progress, live, isToday, onFocusStop }){
  if(!progress) return null;
  const teams = progress.teams.filter(t => t.total > 0);
  if(teams.length === 0) return null;
  const liveByTeam = {};
  (live?.vehicles || []).forEach(v => { if(v.teamId) (liveByTeam[v.teamId] ||= []).push(v); });

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
      <h3 className="text-sm font-medium mb-3">Andamento das equipes</h3>
      <div className="flex flex-col gap-4">
        {teams.map(t => {
          const team = teamOf(t.teamId);
          const pct = Math.round((t.done / t.total) * 100);
          const current = t.stops.find(s => s.arrivedAt && !s.departedAt && ['pendente', 'em_rota'].includes(s.status));
          const next = t.stops.find(s => ['pendente', 'em_rota'].includes(s.status) && !s.arrivedAt);
          const vs = liveByTeam[t.teamId] || [];
          const offRoute = vs.find(v => v.tracking?.offRoute);
          const late = t.stops.filter(s => s.late);
          return (
            <div key={t.teamId || 'none'}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: team.color }}/>{team.name}
                </p>
                <span className="text-xs text-neutral-500">{t.done}/{t.total} feitas</span>
              </div>
              <div className="h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 mt-1.5 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: team.color }} />
              </div>
              {/* Linha do tempo das paradas */}
              <ol className="flex items-center gap-1 mt-2 flex-wrap" aria-label={`Paradas da ${team.name}`}>
                {t.stops.map((s, i) => {
                  const st = STOP_STATE(s);
                  return (
                    <li key={s.id} className="flex items-center gap-1">
                      {i > 0 && <span className="w-2 h-px bg-neutral-300 dark:bg-neutral-700"/>}
                      <button onClick={() => onFocusStop?.(s)} title={`${i + 1}. ${kindLabelShort(s.kind)} · ${s.clientName || ''}${s.timeWindow ? ` · ${s.timeWindow}` : ''} · ${st.label}`}
                        className={`w-3.5 h-3.5 rounded-full ${st.cls}`} aria-label={`Parada ${i + 1}: ${st.label}`} />
                    </li>
                  );
                })}
              </ol>
              <div className="text-xs mt-1.5 flex flex-col gap-0.5">
                {!t.teamId && <p className="text-amber-700 dark:text-amber-400">Distribua essas visitas para uma equipe na Agenda.</p>}
                {current && <p><span className="text-sky-700 dark:text-sky-400 font-medium">No local:</span> {kindLabelShort(current.kind)} · {current.clientName}</p>}
                {next && <p><span className="text-neutral-500">Próxima:</span> {kindLabelShort(next.kind)} · {next.clientName}{next.timeWindow ? ` às ${next.timeWindow}` : ''}</p>}
                {isToday && offRoute && <p className="text-amber-700 dark:text-amber-400 font-medium">🧭 {offRoute.name} fora da rota ({offRoute.tracking.offRouteKm} km do trajeto)</p>}
                {isToday && late.length > 0 && <p className="text-amber-700 dark:text-amber-400 font-medium">⏰ Atrasada para {late.length} parada(s)</p>}
                {t.done === t.total && <p className="text-emerald-700 dark:text-emerald-400 font-medium">Todas as paradas finalizadas.</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const KIND_SHORT = { entrega: 'Entrega', montagem: 'Montagem', limpeza: 'Limpeza', retirada: 'Retirada', desmontagem: 'Desmontagem', manutencao: 'Manutenção', vistoria: 'Vistoria' };
function kindLabelShort(k){ return KIND_SHORT[k] || 'Visita'; }

export function EventsFeed({ dateKey }){
  const events = useEvents();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  if(dateKey !== today) return null;
  const list = events.filter(e => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(e.createdAt)) === today).slice(0, 12);
  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
      <h3 className="text-sm font-medium mb-2">Mensagens de hoje</h3>
      {list.length === 0
        ? <p className="text-xs text-neutral-500">Nenhuma ainda. Aparecem quando as equipes chegam aos locais, concluem tarefas, saem da rota ou se atrasam.</p>
        : <ul className="flex flex-col gap-2">{list.map(e => <EventItem key={e.id} e={e} compact />)}</ul>}
    </div>
  );
}

// Rota programada de cada equipe: linha contínua no que já foi feito, tracejada no que falta,
// e cada parada marcada pelo andamento (feita, no local, atrasada, a fazer).
export function useProgressLayer({ mapRef, ready, progress, enabled }){
  const group = useRef(null);
  useEffect(() => {
    const L = window.L, map = mapRef.current;
    if(!ready || !L || !map) return;
    if(!group.current) group.current = L.layerGroup().addTo(map);
    const g = group.current;
    g.clearLayers();
    if(!enabled || !progress) return;
    progress.teams.forEach(t => {
      if(!t.teamId) return;
      const team = teamOf(t.teamId);
      const pts = t.stops.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
      if(pts.length === 0) return;
      // Até onde a equipe já chegou (última parada finalizada ou com chegada registrada)
      let reached = -1;
      pts.forEach((s, i) => { if(!['pendente', 'em_rota'].includes(s.status) || s.arrivedAt) reached = i; });
      const latlngs = pts.map(s => [s.lat, s.lon]);
      if(reached > 0) L.polyline(latlngs.slice(0, reached + 1), { color: team.color, weight: 5, opacity: 0.9, fleet: true }).addTo(g);
      if(reached < latlngs.length - 1) L.polyline(latlngs.slice(Math.max(reached, 0)), { color: team.color, weight: 3, opacity: 0.7, dashArray: '8,8', fleet: true }).addTo(g);
      pts.forEach((s, i) => {
        const done = s.status === 'concluido', failed = s.status === 'nao_realizado';
        const here = s.arrivedAt && !s.departedAt && !done && !failed;
        const bg = done ? team.color : failed ? '#dc2626' : '#fff';
        const fg = done || failed ? '#fff' : team.color;
        const ring = here ? `box-shadow:0 0 0 4px ${team.color}55;` : s.late ? 'box-shadow:0 0 0 3px #f59e0b;' : '';
        const icon = L.divIcon({
          className: '',
          html: `<div style="transform:translate(-11px,-11px);width:22px;height:22px;border-radius:50%;background:${bg};border:2.5px solid ${failed ? '#dc2626' : team.color};${ring}color:${fg};font:700 11px system-ui,sans-serif;display:flex;align-items:center;justify-content:center">${done ? '✓' : failed ? '✕' : i + 1}</div>`,
          iconSize: [0, 0],
        });
        const st = done ? 'Feita' : failed ? 'Não realizada' : here ? 'Equipe no local' : s.late ? 'Atrasada' : 'A fazer';
        L.marker([s.lat, s.lon], { icon, fleet: true, zIndexOffset: 500 })
          .bindPopup(`<b>${i + 1}. ${esc(kindLabelShort(s.kind))}</b>${s.osCode ? ` · ${esc(s.osCode)}` : ''}<br>${esc(s.clientName || '')}${s.siteName ? ` (${esc(s.siteName)})` : ''}${s.timeWindow ? `<br>Horário combinado: ${esc(s.timeWindow)}` : ''}<br><b>${st}</b>${s.arrivedAt ? `<br><span style="color:#666">Chegou ${new Date(s.arrivedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>` : ''}<br><span style="color:#666">${esc(team.name)}</span>`)
          .addTo(g);
      });
    });
  }, [ready, progress, enabled]);
}
