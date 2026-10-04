import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Navigation, Phone, RefreshCw, LogOut, Camera, Images, X, Check, AlertTriangle, Plus, Eye, EyeOff, MapPin, KeyRound, ScanLine } from 'lucide-react';
import { campoApi, getSession, saveSession } from './campoApi.js';
import { compressImage, SignaturePad } from './captura.jsx';
import { Scanner, isOsCode } from './Scanner.jsx';
import { TEAMS, teamOf, kindLabel } from '../constants.js';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function todayBR(){ return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); }
function shiftDate(key, n){
  const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
function dateLabel(key){
  const t = todayBR();
  if(key === t) return 'Hoje';
  if(key === shiftDate(t, 1)) return 'Amanhã';
  if(key === shiftDate(t, -1)) return 'Ontem';
  const d = new Date(key + 'T12:00:00Z');
  return `${WEEKDAYS[d.getUTCDay()]}, ${key.slice(8)}/${key.slice(5, 7)}`;
}

// Entrega/montagem: unidades saem. Retirada/desmontagem: unidades voltam.
const OUT_KINDS = ['entrega', 'montagem'];
const BACK_KINDS = ['retirada', 'desmontagem'];

const STATUS = {
  pendente:      { label: 'A fazer',       cls: 'bg-neutral-200 text-neutral-800' },
  em_rota:       { label: 'A caminho',     cls: 'bg-sky-100 text-sky-900' },
  concluido:     { label: 'Feito',         cls: 'bg-emerald-100 text-emerald-900' },
  nao_realizado: { label: 'Não realizado', cls: 'bg-red-100 text-red-800' },
};

function mapsUrl(stop){
  const { lat, lon, address } = stop.location || {};
  if(lat != null && lon != null) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address || '')}`;
}
function wazeUrl(stop){
  const { lat, lon, address } = stop.location || {};
  if(lat != null && lon != null) return `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;
  return `https://waze.com/ul?q=${encodeURIComponent(address || '')}&navigate=yes`;
}

// Localização para comprovar onde a O.S. foi concluída. Nunca trava o envio:
// o `timeout` do navegador não conta o tempo esperando a pessoa responder ao pedido
// de permissão, então há um limite próprio de 8 s; sem resposta, envia sem localização.
// Rota com várias paradas no Google Maps. No celular o link aceita no máximo 3 paradas
// intermediárias + o destino, então o dia é dividido em trechos de até 4 paradas,
// saindo de onde a equipe está (sem "origin" o Maps usa a localização atual).
const STOPS_PER_LEG = 4;
function stopPoint(stop){
  const { lat, lon, address } = stop.location || {};
  return lat != null && lon != null ? `${lat},${lon}` : (address || '');
}
function routeLegs(stops){
  const usable = stops.filter(s => stopPoint(s));
  const legs = [];
  for(let i = 0; i < usable.length; i += STOPS_PER_LEG){
    const part = usable.slice(i, i + STOPS_PER_LEG);
    const dest = part[part.length - 1];
    const mid = part.slice(0, -1).map(stopPoint);
    const url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(stopPoint(dest))}`
      + (mid.length ? `&waypoints=${encodeURIComponent(mid.join('|'))}` : '');
    legs.push({ from: i + 1, to: i + part.length, url });
  }
  return legs;
}

function getPosition(){
  return new Promise(resolve => {
    if(!navigator.geolocation) return resolve(null);
    const giveUp = setTimeout(() => resolve(null), 8000);
    navigator.geolocation.getCurrentPosition(
      p => { clearTimeout(giveUp); resolve({ lat: p.coords.latitude, lon: p.coords.longitude }); },
      () => { clearTimeout(giveUp); resolve(null); },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 }
    );
  });
}

const btn = {
  primary: 'w-full min-h-[52px] rounded-xl bg-brand-600 active:bg-brand-700 text-white text-lg font-semibold disabled:opacity-40',
  secondary: 'min-h-[48px] rounded-xl border-2 border-neutral-300 bg-white active:bg-neutral-100 text-neutral-900 font-medium',
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function CampoApp(){
  const [session, setSession] = useState(getSession);

  useEffect(() => {
    document.title = 'Flex Locações · Campo';
    document.documentElement.classList.remove('dark');
  }, []);

  const logout = () => { saveSession(null); setSession(null); };
  if(!session) return <Login onLogin={s => { saveSession(s); setSession(s); }} />;
  return <Dia session={session} onLogout={logout} />;
}

// ---------------------------------------------------------------------------
// LOGIN DA EQUIPE
// ---------------------------------------------------------------------------
function Login({ onLogin }){
  const [teamId, setTeamId] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if(!teamId || !password) return;
    setLoading(true); setError('');
    try{
      const r = await campoApi.login(teamId, password);
      onLogin({ token: r.token, teamId: r.teamId });
    }catch(err){ setError(err.message); setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex-1 flex flex-col justify-center px-5 py-8 max-w-md w-full mx-auto">
        <img src="/logo.png" alt="Flex Locações" className="h-14 w-auto self-start mb-6" />
        <h1 className="text-2xl font-bold mb-1">App da equipe</h1>
        <p className="text-neutral-600 mb-6">Escolha sua equipe e digite a senha.</p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Equipe">
            {TEAMS.map(t => (
              <button type="button" key={t.id} role="radio" aria-checked={teamId === t.id} onClick={() => setTeamId(t.id)}
                className="min-h-[64px] rounded-xl text-lg font-semibold border-4 transition-colors"
                style={{ background: teamId === t.id ? t.color : t.bg, color: teamId === t.id ? '#fff' : t.text, borderColor: teamId === t.id ? t.color : 'transparent' }}>
                {t.name.replace('Equipe ', '')}
              </button>
            ))}
          </div>
          <div className="relative">
            <input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Senha da equipe" aria-label="Senha da equipe" autoComplete="current-password"
              className="w-full min-h-[56px] rounded-xl border-2 border-neutral-300 bg-white px-4 pr-14 text-lg" />
            <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? 'Esconder senha' : 'Mostrar senha'}
              className="absolute inset-y-0 right-0 w-14 flex items-center justify-center text-neutral-500">
              {show ? <EyeOff size={22}/> : <Eye size={22}/>}
            </button>
          </div>
          {error && <p className="text-red-600 font-medium" role="alert">{error}</p>}
          <button type="submit" disabled={!teamId || !password || loading} className={btn.primary}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        <p className="text-sm text-neutral-500 mt-6 flex items-start gap-2">
          <KeyRound size={16} className="shrink-0 mt-0.5"/> A senha de cada equipe é definida pelo escritório, na aba Equipes da plataforma.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LISTA DO DIA
// ---------------------------------------------------------------------------
function Dia({ session, onLogout }){
  const team = teamOf(session.teamId);
  const [date, setDate] = useState(todayBR);
  const [stops, setStops] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try{
      setStops(await campoApi.stops(date));
      setError('');
    }catch(err){
      if(err.expired) return onLogout();
      setError(err.message);
    }finally{ setLoading(false); }
  }, [date]);

  useEffect(() => { setStops(null); load(); }, [load]);

  // Botão "voltar" do celular fecha a parada em vez de sair do app
  useEffect(() => {
    const onPop = () => setOpenId(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const open = (id) => { window.history.pushState({ parada: id }, ''); setOpenId(id); window.scrollTo(0, 0); };
  const close = () => { if(window.history.state?.parada) window.history.back(); else setOpenId(null); };

  const stop = stops?.find(s => s.id === openId);
  if(stop){
    return <Parada stop={stop} team={team} onBack={close} onChanged={load} onExpired={onLogout} />;
  }

  const todo = (stops || []).filter(s => ['pendente', 'em_rota'].includes(s.status));
  const done = (stops || []).filter(s => !['pendente', 'em_rota'].includes(s.status));

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 pb-10">
      <header className="text-white sticky top-0 z-10 shadow" style={{ background: team.color, paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-xl mx-auto px-4 pt-3 pb-2 flex items-center justify-between">
          <span className="text-lg font-bold">{team.name}</span>
          <div className="flex items-center gap-1">
            <button onClick={load} aria-label="Atualizar" className="w-11 h-11 flex items-center justify-center rounded-full active:bg-white/20">
              <RefreshCw size={20} className={loading ? 'animate-spin' : ''}/>
            </button>
            <button onClick={() => { if(window.confirm('Sair do app?')) onLogout(); }} aria-label="Sair" className="w-11 h-11 flex items-center justify-center rounded-full active:bg-white/20">
              <LogOut size={20}/>
            </button>
          </div>
        </div>
        <div className="max-w-xl mx-auto px-2 pb-3 flex items-center justify-between">
          <button onClick={() => setDate(d => shiftDate(d, -1))} aria-label="Dia anterior" className="w-12 h-12 flex items-center justify-center rounded-full active:bg-white/20"><ChevronLeft size={26}/></button>
          <div className="text-center">
            <p className="text-xl font-bold capitalize">{dateLabel(date)}</p>
            <p className="text-sm opacity-90">{stops ? `${todo.length} a fazer · ${done.length} feitas` : ' '}</p>
          </div>
          <button onClick={() => setDate(d => shiftDate(d, 1))} aria-label="Próximo dia" className="w-12 h-12 flex items-center justify-center rounded-full active:bg-white/20"><ChevronRight size={26}/></button>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-4 flex flex-col gap-3">
        {date !== todayBR() && (
          <button onClick={() => setDate(todayBR())} className="self-center text-sm font-medium text-brand-700 underline">Voltar para hoje</button>
        )}
        {error && <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-800" role="alert">{error}</div>}
        {!stops && !error && <p className="text-center text-neutral-500 py-10">Carregando...</p>}
        {stops && stops.length === 0 && (
          <div className="rounded-xl bg-white p-8 text-center">
            <p className="text-lg font-medium">Nenhuma parada {date === todayBR() ? 'hoje' : 'neste dia'}.</p>
            <p className="text-neutral-500 mt-1">Use as setas para ver outros dias.</p>
          </div>
        )}
        {todo.length > 0 && <RouteCard stops={todo} />}
        {todo.map((s, i) => <StopCard key={s.id} stop={s} n={i + 1} onOpen={() => open(s.id)} />)}
        {done.length > 0 && (
          <>
            <p className="text-sm font-semibold text-neutral-500 mt-3">Finalizadas</p>
            {done.map(s => <StopCard key={s.id} stop={s} onOpen={() => open(s.id)} />)}
          </>
        )}
      </main>
    </div>
  );
}

function RouteCard({ stops }){
  const legs = routeLegs(stops);
  const next = stops.find(s => stopPoint(s));
  if(!next) return null;
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm">
      <p className="font-semibold flex items-center gap-2"><Navigation size={18}/> Rota do dia</p>
      <p className="text-sm text-neutral-600 mb-3">
        {stops.length} parada(s) a fazer, na ordem da lista. Sai de onde você está agora.
      </p>
      <div className="flex flex-col gap-2">
        {legs.map((l, i) => (
          <a key={i} href={l.url} target="_blank" rel="noreferrer"
            className={`${i === 0 ? 'bg-brand-600 active:bg-brand-700 text-white border-brand-600' : 'bg-white text-neutral-900 border-neutral-300'} min-h-[52px] rounded-xl border-2 font-semibold flex items-center justify-center gap-2`}>
            <Navigation size={18}/> Google Maps: {legs.length === 1 ? (l.to === 1 ? 'próxima parada' : `paradas 1 a ${l.to}`) : `paradas ${l.from} a ${l.to}`}
          </a>
        ))}
        <a href={wazeUrl(next)} target="_blank" rel="noreferrer" className={`${btn.secondary} w-full flex items-center justify-center gap-2`}>
          <Navigation size={18}/> Waze: próxima parada
        </a>
      </div>
      {legs.length > 1 && <p className="text-xs text-neutral-500 mt-2">O Google Maps no celular aceita até 4 paradas por rota; ao terminar um trecho, abra o próximo.</p>}
    </section>
  );
}

function StopCard({ stop, n, onOpen }){
  const st = STATUS[stop.status] || STATUS.pendente;
  const finished = !['pendente', 'em_rota'].includes(stop.status);
  return (
    <button onClick={onOpen} className={`text-left rounded-xl bg-white p-4 shadow-sm active:bg-neutral-50 border-l-8 ${finished ? 'opacity-70' : ''}`}
      style={{ borderLeftColor: finished ? '#d4d4d4' : '#1f5ca3' }}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-lg font-bold leading-tight">
          {n && <span className="text-neutral-400 mr-1.5">{n}.</span>}
          {kindLabel(stop.kind)}
        </p>
        <span className={`shrink-0 text-sm font-semibold px-2.5 py-1 rounded-full ${st.cls}`}>{st.label}</span>
      </div>
      <p className="font-medium mt-1">{stop.client?.name}{stop.site?.name ? ` · ${stop.site.name}` : ''}</p>
      {stop.rental?.osCode && <p className="text-xs font-mono text-neutral-500 mt-0.5">{stop.rental.osCode}</p>}
      <p className="text-neutral-600 text-sm mt-0.5 flex items-start gap-1"><MapPin size={14} className="shrink-0 mt-0.5"/>{stop.location?.address || 'Endereço não informado'}</p>
      {stop.timeWindow && <p className="text-sm font-semibold text-amber-800 mt-1">Hora marcada: {stop.timeWindow}</p>}
      {stop.items?.length > 0 && <p className="text-sm text-neutral-700 mt-1">{stop.items.map(i => `${i.quantity}× ${i.name}`).join(', ')}</p>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PARADA
// ---------------------------------------------------------------------------
function Parada({ stop, team, onBack, onChanged, onExpired }){
  const [mode, setMode] = useState('ver'); // ver | concluir | falha | feito
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = ['pendente', 'em_rota'].includes(stop.status);
  const phone = stop.site?.contactPhone || stop.client?.phone;

  const handle = async (fn) => {
    setBusy(true); setError('');
    try{ await fn(); }
    catch(err){ if(err.expired) return onExpired(); setError(err.message); }
    finally{ setBusy(false); }
  };

  const start = () => handle(async () => { await campoApi.start(stop.id); await onChanged(); });

  if(mode === 'feito'){
    return (
      <Screen title="Pronto" onBack={onBack} color={team.color}>
        <div className="rounded-xl bg-white p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-3"><Check size={36} strokeWidth={3}/></div>
          <p className="text-xl font-bold">{result?.failed ? 'Registrado como não realizado' : `${kindLabel(stop.kind)} concluída`}</p>
          {result?.rentalStatus === 'encerrado' && <p className="text-neutral-600 mt-1">Todas as unidades voltaram. A locação foi encerrada.</p>}
        </div>
        {result?.warnings?.length > 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-300 p-4 mt-3">
            <p className="font-semibold text-amber-900 flex items-center gap-2"><AlertTriangle size={18}/> Avisos para o escritório</p>
            <ul className="mt-1 text-amber-900 text-sm list-disc pl-5">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
        <button onClick={onBack} className={`${btn.primary} mt-4`}>Voltar para a lista</button>
      </Screen>
    );
  }

  if(mode === 'concluir'){
    return <Concluir stop={stop} team={team} onCancel={() => setMode('ver')} onExpired={onExpired}
      onDone={async (r) => { setResult(r); setMode('feito'); await onChanged(); }} />;
  }

  if(mode === 'falha'){
    return <NaoRealizado stop={stop} onCancel={() => setMode('ver')} onExpired={onExpired}
      onDone={async () => { setResult({ failed: true }); setMode('feito'); await onChanged(); }} />;
  }

  const atSite = stop.rental?.assetsAtSite || [];

  return (
    <Screen title={kindLabel(stop.kind)} onBack={onBack} color={team.color}
      footer={open && (
        <div className="flex flex-col gap-2">
          {stop.status === 'pendente' && (
            <button onClick={start} disabled={busy} className={`${btn.secondary} w-full`}>Estou indo para cá</button>
          )}
          <button onClick={() => setMode('concluir')} className={btn.primary}>Concluir {kindLabel(stop.kind).toLowerCase()}</button>
        </div>
      )}>
      <section className="rounded-xl bg-white p-4">
        {stop.rental?.osCode && <p className="text-sm font-mono text-neutral-500">{stop.rental.osCode}</p>}
        <p className="text-xl font-bold">{stop.client?.name}</p>
        {stop.site?.name && <p className="font-medium text-neutral-700">{stop.site.name}</p>}
        <p className="text-neutral-700 mt-1">{stop.location?.address}</p>
        {stop.timeWindow && <p className="font-semibold text-amber-800 mt-2">Hora marcada com o cliente: {stop.timeWindow}</p>}
        <div className="grid grid-cols-2 gap-2 mt-4">
          <a href={mapsUrl(stop)} target="_blank" rel="noreferrer" className={`${btn.secondary} flex items-center justify-center gap-2`}><Navigation size={18}/> Google Maps</a>
          <a href={wazeUrl(stop)} target="_blank" rel="noreferrer" className={`${btn.secondary} flex items-center justify-center gap-2`}><Navigation size={18}/> Waze</a>
        </div>
        {phone && (
          <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className={`${btn.secondary} w-full mt-2 flex items-center justify-center gap-2`}>
            <Phone size={18}/> Ligar para {stop.site?.contactName || 'o cliente'}
          </a>
        )}
      </section>

      {stop.site?.accessNotes && (
        <section className="rounded-xl bg-amber-50 border border-amber-300 p-4">
          <p className="font-semibold text-amber-900">Como chegar / acesso</p>
          <p className="text-amber-900 mt-1 whitespace-pre-line">{stop.site.accessNotes}</p>
        </section>
      )}

      {stop.items?.length > 0 && (
        <section className="rounded-xl bg-white p-4">
          <p className="font-semibold mb-2">Itens</p>
          <ul className="flex flex-col gap-1">
            {stop.items.map(i => <li key={i.productTypeId} className="text-lg"><b>{i.quantity}×</b> {i.name}</li>)}
          </ul>
        </section>
      )}

      {atSite.length > 0 && (
        <section className="rounded-xl bg-white p-4">
          <p className="font-semibold mb-2">Unidades no local ({atSite.length})</p>
          <div className="flex flex-wrap gap-2">
            {atSite.map(a => <span key={a.id} className="font-mono px-2.5 py-1 rounded-lg bg-neutral-100 border border-neutral-300">{a.code}</span>)}
          </div>
        </section>
      )}

      {stop.tasks?.length > 0 && (
        <section className="rounded-xl bg-white p-4">
          <p className="font-semibold mb-2">Tarefas</p>
          <ul className="list-disc pl-5">{stop.tasks.map((t, i) => <li key={i}>{t.name}{t.quantity > 1 ? ` (×${t.quantity})` : ''}</li>)}</ul>
        </section>
      )}

      {stop.notes && (
        <section className="rounded-xl bg-white p-4">
          <p className="font-semibold mb-1">Observações</p>
          <p className="text-neutral-700 whitespace-pre-line">{stop.notes}</p>
        </section>
      )}

      {error && <p className="text-red-600 font-medium" role="alert">{error}</p>}

      {open && (
        <button onClick={() => setMode('falha')} className="text-red-700 font-medium underline self-center py-2">Não foi possível fazer</button>
      )}
      {!open && (
        <div className={`rounded-xl p-4 text-center font-semibold ${STATUS[stop.status]?.cls || ''}`}>
          {stop.status === 'concluido' ? 'Esta parada já foi concluída.' : 'Registrada como não realizada.'}
        </div>
      )}
    </Screen>
  );
}

function Screen({ title, onBack, children, footer, color = '#1f5ca3' }){
  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <header className="text-white sticky top-0 z-10 shadow" style={{ background: color, paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-xl mx-auto px-2 py-2 flex items-center gap-1">
          <button onClick={onBack} aria-label="Voltar" className="w-12 h-12 flex items-center justify-center rounded-full active:bg-white/20"><ChevronLeft size={28}/></button>
          <h1 className="text-xl font-bold truncate">{title}</h1>
        </div>
      </header>
      <main className={`max-w-xl mx-auto px-4 pt-4 flex flex-col gap-3 ${footer ? 'pb-48' : 'pb-10'}`}>{children}</main>
      {footer && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-neutral-200 shadow-[0_-4px_12px_rgba(0,0,0,.06)]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="max-w-xl mx-auto p-3">{footer}</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CONCLUIR
// ---------------------------------------------------------------------------
const CONDITIONS = [
  { id: 'ok', label: 'OK' },
  { id: 'sujo', label: 'Sujo' },
  { id: 'danificado', label: 'Danificado' },
  { id: 'extraviado', label: 'Não está lá' },
];

function Concluir({ stop, team, onCancel, onDone, onExpired }){
  const isOut = OUT_KINDS.includes(stop.kind);
  const isBack = BACK_KINDS.includes(stop.kind);
  const atSite = stop.rental?.assetsAtSite || [];

  // Saída: códigos digitados. Retorno: unidades do local marcadas + condição.
  const [outUnits, setOutUnits] = useState([]); // [{ code, productTypeId, productName, status, notFound }]
  const [backUnits, setBackUnits] = useState(() => atSite.map(a => ({ code: a.code, productName: a.productName, checked: true, condition: 'ok', notes: '' })));
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [codeMsg, setCodeMsg] = useState('');
  const [tasks, setTasks] = useState(() => (stop.tasks || []).map(t => ({ ...t, done: t.quantity })));
  const [photos, setPhotos] = useState([]);
  const [notes, setNotes] = useState('');
  const [signedBy, setSignedBy] = useState('');
  const [signature, setSignature] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const [scanning, setScanning] = useState(false);
  // Códigos já registrados nesta tela (ref = atualização imediata, para leituras em sequência)
  const seen = useRef(new Set(isOut ? [] : atSite.map(a => a.code)));
  const scanned = useRef(new Set());
  const items = stop.items || [];

  // Registra um código (lido pela câmera ou digitado). Devolve { ok, message } para o leitor.
  const registerCode = async (raw) => {
    const c = String(raw || '').trim().toUpperCase();
    if(!c) return { ok: false, message: 'Código vazio.' };
    if(isOsCode(c)) return { ok: false, message: `Esse é o QR da O.S. (${c}), não de um equipamento. Leia a etiqueta colada na unidade.` };

    if(isBack && seen.current.has(c)){
      // Retirada: unidade que já constava no local → conferida
      if(scanned.current.has(c)) return { ok: false, message: `${c} já foi conferida.` };
      scanned.current.add(c);
      setBackUnits(prev => prev.map(u => u.code === c ? { ...u, checked: true, scanned: true } : u));
      return { ok: true, message: `✓ ${c} conferida (${scanned.current.size} de ${seen.current.size})` };
    }
    if(isOut && seen.current.has(c)) return { ok: false, message: `${c} já foi lida.` };

    let a;
    try{ a = await campoApi.asset(c); }
    catch(err){
      if(err.expired){ onExpired(); return { ok: false, message: 'Sessão expirada.' }; }
      return { ok: false, message: err.status === 404 ? `${c} não está cadastrada. Confira a etiqueta.` : err.message };
    }
    if(seen.current.has(a.code)) return { ok: false, message: `${a.code} já está na lista.` };
    seen.current.add(a.code);
    scanned.current.add(a.code);
    if(isOut){
      setOutUnits(prev => [...prev, { code: a.code, productTypeId: a.productTypeId, productName: a.productName, status: a.status }]);
      const item = items.find(i => i.productTypeId === a.productTypeId);
      if(!item) return { ok: false, message: `⚠ ${a.code} (${a.productName}) não faz parte desta locação. Adicionada; toque no X para tirar.` };
      return { ok: true, message: `✓ ${a.code} · ${a.productName}` };
    }
    setBackUnits(prev => [...prev, { code: a.code, productName: a.productName, checked: true, condition: 'ok', notes: '', extra: true, scanned: true }]);
    return { ok: true, message: `✓ ${a.code} recolhida (não constava neste local)` };
  };
  const registerRef = useRef(registerCode);
  registerRef.current = registerCode;

  const addCode = async () => {
    if(!code.trim()) return;
    setCodeMsg(''); setChecking(true);
    const r = await registerCode(code);
    setChecking(false);
    if(r.ok) setCode('');
    if(!r.ok || r.message.startsWith('⚠')) setCodeMsg(r.message.replace(/^✓ /, ''));
  };

  const addPhotos = async (files) => {
    const room = 6 - photos.length;
    for(const f of [...files].slice(0, room)){
      try{ const p = await compressImage(f); setPhotos(prev => [...prev, p]); }
      catch(e){ setError(e.message); }
    }
  };

  // Progresso das saídas por produto
  const outCount = {};
  outUnits.forEach(u => { outCount[u.productTypeId] = (outCount[u.productTypeId] || 0) + 1; });
  const outMissing = isOut ? (stop.items || []).filter(i => (outCount[i.productTypeId] || 0) < i.quantity) : [];
  const totalWanted = (stop.items || []).reduce((n, i) => n + i.quantity, 0);
  const scannedBack = backUnits.filter(u => u.scanned).length;
  const unscannedChecked = backUnits.filter(u => u.checked && !u.scanned).length;
  const scanProgress = isOut ? `Lidas: ${outUnits.length} de ${totalWanted}` : `Conferidas: ${scannedBack} de ${backUnits.length}`;
  const scanButton = (
    <button type="button" onClick={() => setScanning(true)}
      className="w-full min-h-[56px] rounded-xl bg-brand-600 active:bg-brand-700 text-white text-lg font-semibold flex items-center justify-center gap-2 mb-3">
      <ScanLine size={24}/> Ler etiquetas com a câmera
    </button>
  );
  const backMissing = isBack ? backUnits.filter(u => !u.checked) : [];

  const submit = async () => {
    const pend = [];
    if(outMissing.length) pend.push(`Faltam unidades: ${outMissing.map(i => `${i.quantity - (outCount[i.productTypeId] || 0)}× ${i.name}`).join(', ')}.`);
    if(backMissing.length) pend.push(`${backMissing.length} unidade(s) não marcada(s) vão continuar no local.`);
    if(pend.length && !window.confirm(`${pend.join('\n')}\n\nConcluir mesmo assim?`)) return;

    setSending(true); setError('');
    const pos = await getPosition();
    const assets = isOut ? outUnits.map(u => ({ code: u.code }))
      : isBack ? backUnits.filter(u => u.checked).map(u => ({ code: u.code, condition: u.condition, notes: u.notes || undefined }))
      : [];
    try{
      const r = await campoApi.complete(stop.id, {
        assets,
        executedTasks: tasks.map(t => ({ taskId: t.taskId, quantity: Number(t.done) || 0 })),
        notes: notes.trim() || null,
        photos,
        signature,
        signedBy: signedBy.trim() || null,
        lat: pos?.lat ?? null,
        lon: pos?.lon ?? null,
      });
      onDone(r);
    }catch(err){
      if(err.expired) return onExpired();
      setError(err.message);
      setSending(false);
    }
  };

  return (
    <Screen title={`Concluir ${kindLabel(stop.kind).toLowerCase()}`} onBack={onCancel} color={team.color}
      footer={
        <button onClick={submit} disabled={sending} className={btn.primary}>
          {sending ? 'Enviando... (pegando localização)' : 'Enviar e concluir'}
        </button>
      }>
      <p className="font-medium">{stop.client?.name}{stop.site?.name ? ` · ${stop.site.name}` : ''}</p>

      {isOut && (
        <section className="rounded-xl bg-white p-4">
          <p className="font-semibold">Unidades entregues</p>
          <p className="text-sm text-neutral-600 mb-3">Leia a etiqueta (ou digite o código) de cada unidade que ficou no local.</p>
          <ul className="flex flex-col gap-1 mb-3">
            {(stop.items || []).map(i => {
              const have = outCount[i.productTypeId] || 0;
              const ok = have >= i.quantity;
              return (
                <li key={i.productTypeId} className={`flex justify-between font-medium ${ok ? 'text-emerald-700' : 'text-neutral-800'}`}>
                  <span>{i.name}</span><span>{have} de {i.quantity} {ok && '✓'}</span>
                </li>
              );
            })}
          </ul>
          {scanButton}
          <CodeInput code={code} setCode={setCode} onAdd={addCode} checking={checking} msg={codeMsg} label="Ou digite o código" />
          {outUnits.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {outUnits.map(u => (
                <span key={u.code} className={`font-mono pl-3 pr-1 py-1 rounded-lg border flex items-center gap-1 ${(stop.items || []).some(i => i.productTypeId === u.productTypeId) ? 'bg-neutral-100 border-neutral-300' : 'bg-amber-50 border-amber-400'}`}
                  title={u.productName}>
                  {u.code}
                  <button onClick={() => { seen.current.delete(u.code); scanned.current.delete(u.code); setOutUnits(prev => prev.filter(x => x.code !== u.code)); }} aria-label={`Tirar ${u.code}`} className="w-8 h-8 flex items-center justify-center text-neutral-500"><X size={16}/></button>
                </span>
              ))}
            </div>
          )}
          {outUnits.some(u => !(stop.items || []).some(i => i.productTypeId === u.productTypeId)) && (
            <p className="text-sm text-amber-800 mt-2">Os códigos em amarelo não fazem parte desta locação.</p>
          )}
        </section>
      )}

      {isBack && (
        <section className="rounded-xl bg-white p-4">
          <p className="font-semibold">Unidades recolhidas</p>
          <p className="text-sm text-neutral-600 mb-3">Leia a etiqueta de cada unidade recolhida (ou desmarque o que ficou no local) e informe o estado.</p>
          {scanButton}
          {scannedBack > 0 && unscannedChecked > 0 && (
            <button type="button" onClick={() => setBackUnits(prev => prev.map(u => u.scanned ? u : { ...u, checked: false }))}
              className="w-full min-h-[48px] rounded-xl border-2 border-amber-400 bg-amber-50 text-amber-900 font-semibold mb-3">
              {unscannedChecked === 1 ? 'Desmarcar a que não foi lida' : `Desmarcar as ${unscannedChecked} que não foram lidas`}
            </button>
          )}
          {backUnits.length === 0 && <p className="text-neutral-500 mb-3">Nenhuma unidade registrada neste local. Digite os códigos abaixo.</p>}
          <ul className="flex flex-col gap-3 mb-3">
            {backUnits.map((u, idx) => (
              <li key={u.code} className={`rounded-lg border p-3 ${u.checked ? 'border-neutral-300' : 'border-dashed border-neutral-300 opacity-60'}`}>
                <label className="flex items-center gap-3">
                  <input type="checkbox" checked={u.checked} className="w-6 h-6"
                    onChange={e => setBackUnits(prev => prev.map((x, i) => i === idx ? { ...x, checked: e.target.checked } : x))} />
                  <span className="font-mono text-lg font-semibold">{u.code}</span>
                  {u.scanned && <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 shrink-0">lida ✓</span>}
                  <span className="text-sm text-neutral-600 truncate">{u.productName}</span>
                </label>
                {u.checked && (
                  <div className="grid grid-cols-2 gap-2 mt-2" role="radiogroup" aria-label={`Estado de ${u.code}`}>
                    {CONDITIONS.map(c => (
                      <button key={c.id} type="button" role="radio" aria-checked={u.condition === c.id}
                        onClick={() => setBackUnits(prev => prev.map((x, i) => i === idx ? { ...x, condition: c.id } : x))}
                        className={`min-h-[48px] rounded-lg font-semibold border-2 ${u.condition === c.id
                          ? (c.id === 'ok' ? 'bg-emerald-600 border-emerald-600 text-white' : c.id === 'sujo' ? 'bg-amber-500 border-amber-500 text-white' : 'bg-red-600 border-red-600 text-white')
                          : 'bg-white border-neutral-300 text-neutral-700'}`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
                {u.checked && ['danificado', 'extraviado'].includes(u.condition) && (
                  <input value={u.notes} onChange={e => setBackUnits(prev => prev.map((x, i) => i === idx ? { ...x, notes: e.target.value } : x))}
                    placeholder="O que aconteceu? (ex.: porta quebrada)" className="w-full mt-2 min-h-[44px] rounded-lg border border-neutral-300 px-3" />
                )}
              </li>
            ))}
          </ul>
          <CodeInput code={code} setCode={setCode} onAdd={addCode} checking={checking} msg={codeMsg} label="Ou digite o código" />
        </section>
      )}

      {tasks.length > 0 && (
        <section className="rounded-xl bg-white p-4">
          <p className="font-semibold mb-2">Tarefas feitas</p>
          <ul className="flex flex-col gap-2">
            {tasks.map((t, idx) => (
              <li key={t.taskId} className="flex items-center justify-between gap-3">
                <span>{t.name}</span>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label={`Menos ${t.name}`} onClick={() => setTasks(prev => prev.map((x, i) => i === idx ? { ...x, done: Math.max(0, x.done - 1) } : x))}
                    className="w-11 h-11 rounded-lg border-2 border-neutral-300 text-xl">−</button>
                  <span className="w-8 text-center text-lg font-semibold">{t.done}</span>
                  <button type="button" aria-label={`Mais ${t.name}`} onClick={() => setTasks(prev => prev.map((x, i) => i === idx ? { ...x, done: x.done + 1 } : x))}
                    className="w-11 h-11 rounded-lg border-2 border-neutral-300 text-xl">+</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl bg-white p-4">
        <p className="font-semibold mb-2">Fotos {photos.length > 0 && <span className="text-neutral-500 font-normal">({photos.length} de 6)</span>}</p>
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <div key={i} className="relative aspect-square">
              <img src={p} alt={`Foto ${i + 1}`} className="w-full h-full object-cover rounded-lg" />
              <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))} aria-label={`Apagar foto ${i + 1}`}
                className="absolute top-1 right-1 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={16}/></button>
            </div>
          ))}
          {photos.length < 6 && (
            <label className="aspect-square rounded-lg border-2 border-dashed border-neutral-300 flex flex-col items-center justify-center text-neutral-600 cursor-pointer active:bg-neutral-50">
              <Camera size={28}/>
              <span className="text-sm mt-1">Tirar foto</span>
              <input type="file" accept="image/*" capture="environment" className="sr-only"
                onChange={e => { addPhotos(e.target.files); e.target.value = ''; }} />
            </label>
          )}
          {photos.length < 6 && (
            <label className="aspect-square rounded-lg border-2 border-dashed border-neutral-300 flex flex-col items-center justify-center text-neutral-600 cursor-pointer active:bg-neutral-50">
              <Images size={28}/>
              <span className="text-sm mt-1 text-center leading-tight">Da galeria</span>
              <input type="file" accept="image/*" multiple className="sr-only"
                onChange={e => { addPhotos(e.target.files); e.target.value = ''; }} />
            </label>
          )}
        </div>
      </section>

      <section className="rounded-xl bg-white p-4">
        <label className="font-semibold block mb-2" htmlFor="obs">Observações</label>
        <textarea id="obs" value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          placeholder="Algo que o escritório precisa saber?" className="w-full rounded-lg border border-neutral-300 p-3" />
      </section>

      <section className="rounded-xl bg-white p-4">
        <p className="font-semibold mb-2">Quem recebeu</p>
        <input value={signedBy} onChange={e => setSignedBy(e.target.value)} placeholder="Nome do responsável no local"
          aria-label="Nome do responsável no local" className="w-full min-h-[48px] rounded-lg border border-neutral-300 px-3 mb-3" />
        <SignaturePad onChange={setSignature} />
      </section>

      {error && <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-800" role="alert">{error}</div>}
      <button onClick={onCancel} className="text-neutral-600 underline self-center py-2">Cancelar</button>
      {scanning && (
        <Scanner title={`${kindLabel(stop.kind)} · ${stop.client?.name || ''}`} progress={scanProgress}
          onCode={(c) => registerRef.current(c)} onClose={() => setScanning(false)} />
      )}
    </Screen>
  );
}

function CodeInput({ code, setCode, onAdd, checking, msg, label = 'Código da unidade' }){
  return (
    <div>
      <div className="flex gap-2">
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} onKeyDown={e => { if(e.key === 'Enter'){ e.preventDefault(); onAdd(); } }}
          placeholder="Ex.: BQ-012" aria-label={label} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
          className="flex-1 min-w-0 min-h-[52px] rounded-xl border-2 border-neutral-300 px-4 text-lg font-mono uppercase" />
        <button type="button" onClick={onAdd} disabled={!code.trim() || checking} aria-label="Adicionar código"
          className="min-w-[56px] min-h-[52px] rounded-xl bg-brand-600 text-white flex items-center justify-center disabled:opacity-40">
          {checking ? <RefreshCw size={20} className="animate-spin"/> : <Plus size={26}/>}
        </button>
      </div>
      {msg && <p className="text-sm text-amber-800 mt-1.5" role="status">{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NÃO REALIZADO
// ---------------------------------------------------------------------------
const REASONS = ['Cliente ausente / local fechado', 'Sem acesso para o caminhão', 'Chuva / clima', 'Problema no veículo', 'Endereço não encontrado'];

function NaoRealizado({ stop, onCancel, onDone, onExpired }){
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const final = reason === 'outro' ? other.trim() : reason;

  const submit = async () => {
    setSending(true); setError('');
    try{ await campoApi.fail(stop.id, final); onDone(); }
    catch(err){ if(err.expired) return onExpired(); setError(err.message); setSending(false); }
  };

  return (
    <Screen title="Não foi possível fazer" onBack={onCancel} color="#b91c1c"
      footer={<button onClick={submit} disabled={!final || sending} className={btn.primary}>{sending ? 'Enviando...' : 'Avisar o escritório'}</button>}>
      <p className="font-medium">{kindLabel(stop.kind)} · {stop.client?.name}</p>
      <section className="rounded-xl bg-white p-4 flex flex-col gap-2" role="radiogroup" aria-label="Motivo">
        <p className="font-semibold">Qual o motivo?</p>
        {[...REASONS, 'outro'].map(r => (
          <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)}
            className={`min-h-[52px] rounded-xl border-2 px-4 text-left font-medium ${reason === r ? 'border-brand-600 bg-brand-50' : 'border-neutral-300 bg-white'}`}>
            {r === 'outro' ? 'Outro motivo' : r}
          </button>
        ))}
        {reason === 'outro' && (
          <textarea value={other} onChange={e => setOther(e.target.value)} rows={3} autoFocus placeholder="Descreva o que aconteceu"
            className="w-full rounded-lg border border-neutral-300 p-3 mt-1" />
        )}
      </section>
      {error && <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-800" role="alert">{error}</div>}
    </Screen>
  );
}
