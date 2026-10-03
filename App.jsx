import React, { useState, useEffect, useRef } from 'react';
import { Calendar, Users, ClipboardList, MapPin, Plus, X, Trash2, Edit2, ChevronLeft, ChevronRight, ExternalLink, Sun, Moon, Maximize, Minimize, Route, LogOut, ShieldCheck, History, FileBarChart, Upload, UserPlus, Check, Tent, Boxes } from 'lucide-react';
import { api, setAuthToken } from './api.js';
import * as XLSX from 'xlsx';
import { TEAMS, teamOf, kindLabel, APPT_STATUS } from './constants.js';
import { LocacoesTab } from './locacoes.jsx';
import { EstoqueTab } from './estoque.jsx';


const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const WEEKDAYS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const WEEKDAYS_FULL_PT = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

function uid(){ return Math.random().toString(36).slice(2,10); }

function escapeHtml(str){
  if(str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function normalizeTasks(taskIds){
  if(!Array.isArray(taskIds)) return [];
  return taskIds.map(t => typeof t === 'string' ? { taskId: t, quantity: 1 } : t);
}

function formatTaskList(taskIds, taskTypes){
  return normalizeTasks(taskIds)
    .map(({ taskId, quantity }) => {
      const t = taskTypes.find(tt => tt.id === taskId);
      const name = t ? t.name : 'Tarefa removida';
      return quantity > 1 ? `${name} ×${quantity}` : name;
    })
    .filter(Boolean)
    .join(', ');
}
function fmtDateKey(y,m,d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function todayKey(){ const d = new Date(); return fmtDateKey(d.getFullYear(), d.getMonth(), d.getDate()); }

function formatDateLabel(dateKey){
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS_FULL_PT[date.getDay()]}, ${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}`;
}

function addDays(date, n){ const d = new Date(date); d.setDate(d.getDate() + n); return d; }
function mondayOf(date){ const d = new Date(date); const day = d.getDay(); const diff = (day === 0 ? -6 : 1 - day); return addDays(d, diff); }
function dateKeyFromDate(d){ return fmtDateKey(d.getFullYear(), d.getMonth(), d.getDate()); }

// Índices preenchidos pelo App a cada render, usados pelo mapa, rotas e relatórios.
let SITE_INDEX = {};
let PRODUCT_INDEX = {};

// Onde a visita acontece: o local de instalação da locação, se houver; senão, o endereço do cliente.
// Devolve um objeto no mesmo formato de cliente ({ name, address, lat, lon }) para o resto do código não mudar.
// `source` pode ser a lista de clientes ou um mapa { id: cliente }.
function stopOf(appt, source){
  if(!appt) return undefined;
  const client = Array.isArray(source) ? source.find(c => c.id === appt.clientId) : source[appt.clientId];
  const site = appt.siteId ? SITE_INDEX[appt.siteId] : null;
  if(!site) return client;
  return {
    ...(client || {}),
    id: client?.id ?? appt.clientId,
    name: client ? `${client.name} (${site.name})` : site.name,
    address: site.address,
    lat: site.lat,
    lon: site.lon,
  };
}

export default function App(){
  const [tab, setTab] = useState('locacoes');
  const [clients, setClients] = useState([]);
  const [taskTypes, setTaskTypes] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [teamMembers, setTeamMembers] = useState({ verde: [], azul: [], laranja: [], roxo: [] });
  const [sites, setSites] = useState([]);
  const [productTypes, setProductTypes] = useState([]);
  const [base, setBase] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [theme, setTheme] = useState(() => {
    try{ return localStorage.getItem('logistica-theme') || 'light'; }catch(e){ return 'light'; }
  });

  useEffect(() => {
    const root = document.documentElement;
    if(theme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
    try{ localStorage.setItem('logistica-theme', theme); }catch(e){}
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  useEffect(() => {
    (async () => {
      let savedToken = null;
      try{ savedToken = localStorage.getItem('logistica-token'); }catch(e){}
      if(!savedToken){ setAuthChecked(true); return; }
      setAuthToken(savedToken);
      try{
        const { user: me } = await api.auth.me();
        setUser(me);
      }catch(err){
        try{ localStorage.removeItem('logistica-token'); }catch(e){}
        setAuthToken(null);
      }
      setAuthChecked(true);
    })();
  }, []);

  const handleAuthSuccess = ({ token, user: loggedUser }) => {
    try{ localStorage.setItem('logistica-token', token); }catch(e){}
    setAuthToken(token);
    setUser(loggedUser);
  };

  const handleLogout = () => {
    try{ localStorage.removeItem('logistica-token'); }catch(e){}
    setAuthToken(null);
    setUser(null);
    setLoaded(false);
  };

  const updateBase = async (value) => {
    await api.settings.set('base', value);
    setBase(value);
  };

  useEffect(() => {
    if(!user) return;
    (async () => {
      try{
        const [c, t, a, tm, baseRes, st, pt] = await Promise.all([
          api.clients.list(), api.taskTypes.list(), api.appointments.list(), api.teamMembers.list(), api.settings.get('base'),
          api.sites.list(), api.productTypes.list(),
        ]);
        setClients(c); setTaskTypes(t); setAppointments(a); setTeamMembers(tm); setSites(st); setProductTypes(pt);
        setBase(baseRes.value);
        setLoaded(true);
      }catch(err){
        console.error(err);
        setError('Não foi possível conectar à API. Verifique se o backend está no ar e se VITE_API_URL está configurado.');
      }
    })();
  }, [user]);

  // Locações geram visitas no servidor; a Agenda precisa recarregar depois de confirmar/editar/cancelar
  const reloadAppointments = async () => {
    try{ setAppointments(await api.appointments.list()); }catch(err){ console.error(err); }
  };

  SITE_INDEX = Object.fromEntries(sites.map(x => [x.id, x]));
  PRODUCT_INDEX = Object.fromEntries(productTypes.map(x => [x.id, x]));

  const TABS = [
    { id: 'locacoes', label: 'Locações', icon: Tent },
    { id: 'estoque',  label: 'Estoque',  icon: Boxes },
    { id: 'agenda',   label: 'Agenda',   icon: Calendar },
    { id: 'clientes', label: 'Clientes', icon: Users },
    { id: 'tarefas',  label: 'Tarefas',  icon: ClipboardList },
    { id: 'equipes',  label: 'Equipes',  icon: Users },
    { id: 'mapa',     label: 'Mapa',     icon: MapPin },
    { id: 'relatorios', label: 'Relatórios', icon: FileBarChart },
    { id: 'auditoria', label: 'Auditoria', icon: History },
    ...(user?.role === 'admin' ? [{ id: 'usuarios', label: 'Usuários', icon: UserPlus }] : []),
  ];

  if(!authChecked){
    return <div className="w-full min-h-screen flex items-center justify-center bg-neutral-100 dark:bg-neutral-950">
      <p className="text-sm text-neutral-600 dark:text-neutral-400 font-mono">Verificando sessão...</p>
    </div>;
  }

  if(!user){
    return <AuthScreen onSuccess={handleAuthSuccess} theme={theme} onToggleTheme={toggleTheme} />;
  }

  if(error){
    return <div className="w-full min-h-screen flex items-center justify-center bg-neutral-100 dark:bg-neutral-950 p-6">
      <p className="text-sm text-red-400 font-mono max-w-md text-center">{error}</p>
    </div>;
  }
  if(!loaded){
    return <div className="w-full min-h-screen flex items-center justify-center bg-neutral-100 dark:bg-neutral-950">
      <p className="text-sm text-neutral-600 dark:text-neutral-400 font-mono">Carregando dados da plataforma...</p>
    </div>;
  }

  return (
    <div className="w-full min-h-screen bg-neutral-100 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="border-b border-neutral-200 dark:border-neutral-800 px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Logo da empresa" className="h-16 w-auto" />
          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-brand-500">Plataforma de logística</div>
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">Locações, agenda e equipes</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-neutral-500 flex items-center gap-1.5">
            <ShieldCheck size={14}/> {user.name} · {user.role === 'admin' ? 'Administrador' : 'Gerente de Logística'}
          </span>
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
            className="p-2 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}
          </button>
          <button
            onClick={handleLogout}
            title="Sair"
            className="p-2 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <LogOut size={16}/>
          </button>
        </div>
      </div>

      <div className="border-b border-neutral-200 dark:border-neutral-800 px-6 flex gap-1 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === id ? 'border-brand-500 text-brand-400' : 'border-transparent text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'
            }`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      <div className={tab === 'agenda' ? 'w-full px-5 p-5' : 'max-w-6xl mx-auto p-5'}>
        {tab === 'locacoes' && (
          <LocacoesTab clients={clients} productTypes={productTypes} sites={sites} setSites={setSites} reloadAppointments={reloadAppointments} />
        )}
        {tab === 'estoque' && (
          <EstoqueTab setProductTypes={setProductTypes} />
        )}
        {tab === 'agenda' && (
          <AgendaTab clients={clients} taskTypes={taskTypes} appointments={appointments} setAppointments={setAppointments} />
        )}
        {tab === 'clientes' && (
          <ClientesTab clients={clients} setClients={setClients} appointments={appointments} taskTypes={taskTypes} />
        )}
        {tab === 'tarefas' && (
          <TarefasTab taskTypes={taskTypes} setTaskTypes={setTaskTypes} />
        )}
        {tab === 'equipes' && (
          <EquipesTab teamMembers={teamMembers} setTeamMembers={setTeamMembers} appointments={appointments} user={user} />
        )}
        {tab === 'mapa' && (
          <MapaTab clients={clients} appointments={appointments} taskTypes={taskTypes} base={base} setBase={updateBase} setAppointments={setAppointments} />
        )}
        {tab === 'relatorios' && (
          <RelatoriosTab clients={clients} appointments={appointments} taskTypes={taskTypes} base={base} />
        )}
        {tab === 'auditoria' && (
          <AuditoriaTab />
        )}
        {tab === 'usuarios' && user?.role === 'admin' && (
          <UsuariosTab />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AGENDA
// ---------------------------------------------------------------------------
function AgendaTab({ clients, taskTypes, appointments, setAppointments }){
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [modal, setModal] = useState(null);
  const [showTwoMonths, setShowTwoMonths] = useState(false);

  const prevMonth = () => { if(month === 0){ setMonth(11); setYear(y => y-1); } else setMonth(m => m-1); };
  const nextMonth = () => { if(month === 11){ setMonth(0); setYear(y => y+1); } else setMonth(m => m+1); };

  const apptsByDate = {};
  appointments.forEach(a => { (apptsByDate[a.date] = apptsByDate[a.date] || []).push(a); });

  const saveAppointment = async (data) => {
    if(data.id){
      await api.appointments.update(data.id, data);
      setAppointments(prev => prev.map(a => a.id === data.id ? data : a));
    }else{
      const withId = { ...data, id: uid() };
      await api.appointments.create(withId);
      setAppointments(prev => [...prev, withId]);
    }
    setModal(null);
  };
  const deleteAppointment = async (id) => {
    await api.appointments.remove(id);
    setAppointments(prev => prev.filter(a => a.id !== id));
    setModal(null);
  };

  const [draggingId, setDraggingId] = useState(null);
  const [dragOverDate, setDragOverDate] = useState(null);

  const moveAppointment = async (apptId, newDateKey) => {
    const appt = appointments.find(a => a.id === apptId);
    if(!appt || appt.date === newDateKey) return;
    const updated = { ...appt, date: newDateKey };
    setAppointments(prev => prev.map(a => a.id === apptId ? updated : a));
    try{
      await api.appointments.update(apptId, updated);
    }catch(err){
      setAppointments(prev => prev.map(a => a.id === apptId ? appt : a));
    }
  };

  const renderMonthGrid = (y, m) => {
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for(let i = 0; i < firstDow; i++) cells.push(null);
    for(let d = 1; d <= daysInMonth; d++) cells.push(d);

    return (
      <div className="grid grid-cols-7 gap-px bg-neutral-100 dark:bg-neutral-800 rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-800">
        {WEEKDAYS_PT.map(w => (
          <div key={w} className="bg-white dark:bg-neutral-900 text-center text-xs font-mono text-neutral-500 py-2">{w}</div>
        ))}
        {cells.map((d, i) => {
          if(d === null) return <div key={i} className="bg-neutral-100 dark:bg-neutral-950 min-h-[110px]" />;
          const dateKey = fmtDateKey(y, m, d);
          const dayAppts = apptsByDate[dateKey] || [];
          const isToday = dateKey === todayKey();
          return (
            <div key={i}
              onDragOver={e => { e.preventDefault(); setDragOverDate(dateKey); }}
              onDragLeave={() => setDragOverDate(prev => prev === dateKey ? null : prev)}
              onDrop={e => { e.preventDefault(); if(draggingId) moveAppointment(draggingId, dateKey); setDragOverDate(null); setDraggingId(null); }}
              className={`bg-white dark:bg-neutral-900 min-h-[110px] p-1.5 flex flex-col gap-1 transition-colors ${dragOverDate === dateKey ? 'ring-2 ring-inset ring-brand-500 bg-brand-50 dark:bg-brand-950/30' : ''}`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-mono ${isToday ? 'text-brand-400 font-semibold' : 'text-neutral-500'}`}>{d}</span>
                <button onClick={() => setModal({ dateKey })} className="text-neutral-500 dark:text-neutral-600 hover:text-brand-400">
                  <Plus size={14} />
                </button>
              </div>
              <div className="flex flex-col gap-1 overflow-hidden">
                {dayAppts.map(a => {
                  const team = teamOf(a.teamId);
                  const client = clients.find(c => c.id === a.clientId);
                  const done = a.status === 'concluido';
                  const failed = a.status === 'nao_realizado';
                  const site = a.siteId ? SITE_INDEX[a.siteId] : null;
                  const label = (client ? client.name : '(cliente removido)') + (site ? ` (${site.name})` : '');
                  return (
                    <button key={a.id} onClick={() => setModal({ dateKey, editingId: a.id })}
                      draggable
                      onDragStart={e => { setDraggingId(a.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragEnd={() => { setDraggingId(null); setDragOverDate(null); }}
                      className={`text-left text-[11px] leading-tight px-1.5 py-1 rounded truncate flex items-center gap-1 cursor-grab active:cursor-grabbing ${done ? 'opacity-70' : ''} ${draggingId === a.id ? 'opacity-40' : ''}`}
                      style={{ background: team.bg, color: team.text }}
                      title={`${a.rentalId ? kindLabel(a.kind) + ': ' : ''}${label}${done ? ' (concluída)' : failed ? ' (não realizada)' : ''}`}>
                      {done && <Check size={11} className="shrink-0" strokeWidth={3} />}
                      {failed && <X size={11} className="shrink-0 text-red-600" strokeWidth={3} />}
                      <span className={`truncate ${done ? 'line-through' : ''}`}>
                        {a.rentalId && <span className="font-semibold">{kindLabel(a.kind)} </span>}
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const secondMonth = month === 11 ? 0 : month + 1;
  const secondYear = month === 11 ? year + 1 : year;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} className="p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"><ChevronLeft size={18}/></button>
          <h2 className="text-lg font-medium w-44 text-center">
            {MONTHS_PT[month]} {year}{showTwoMonths ? ` – ${MONTHS_PT[secondMonth]} ${secondYear}` : ''}
          </h2>
          <button onClick={nextMonth} className="p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"><ChevronRight size={18}/></button>
          <button
            onClick={() => setShowTwoMonths(v => !v)}
            className={`text-xs font-mono px-3 py-1.5 rounded border ${showTwoMonths ? 'border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400' : 'border-neutral-300 dark:border-neutral-700 text-neutral-500'}`}
            title="Mostra dois meses lado a lado, pra arrastar agendamentos de um mês pro outro"
          >
            {showTwoMonths ? 'Ver 1 mês' : 'Ver 2 meses'}
          </button>
        </div>
        <div className="flex gap-3 text-xs font-mono text-neutral-500">
          {TEAMS.map(t => (
            <span key={t.id} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: t.color }}></span>{t.name}
            </span>
          ))}
        </div>
      </div>

      {!showTwoMonths && renderMonthGrid(year, month)}

      {showTwoMonths && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-mono uppercase text-neutral-500 mb-2 text-center">{MONTHS_PT[month]} {year}</p>
            {renderMonthGrid(year, month)}
          </div>
          <div>
            <p className="text-xs font-mono uppercase text-neutral-500 mb-2 text-center">{MONTHS_PT[secondMonth]} {secondYear}</p>
            {renderMonthGrid(secondYear, secondMonth)}
          </div>
        </div>
      )}

      {modal && (
        <AppointmentModal modal={modal} clients={clients} taskTypes={taskTypes} appointments={appointments}
          onClose={() => setModal(null)} onSave={saveAppointment} onDelete={deleteAppointment} />
      )}
    </div>
  );
}

function AppointmentModal({ modal, clients, taskTypes, appointments, onClose, onSave, onDelete }){
  const editing = modal.editingId ? appointments.find(a => a.id === modal.editingId) : null;
  const [clientId, setClientId] = useState(editing?.clientId || '');
  const [taskQuantities, setTaskQuantities] = useState(() => {
    const initial = {};
    normalizeTasks(editing?.taskIds).forEach(({ taskId, quantity }) => { initial[taskId] = quantity; });
    return initial;
  });
  const [teamId, setTeamId] = useState(editing?.teamId || 'verde');
  const [notes, setNotes] = useState(editing?.notes || '');
  const [execution, setExecution] = useState(null);
  const [execError, setExecError] = useState('');
  const [expandedPhoto, setExpandedPhoto] = useState(null);

  useEffect(() => {
    if(editing?.status === 'concluido'){
      api.appointments.getExecution(editing.id)
        .then(setExecution)
        .catch(() => setExecError('Não foi possível carregar o registro de execução.'));
    }
  }, [editing?.id, editing?.status]);

  const toggleTask = (id) => {
    setTaskQuantities(prev => {
      const next = { ...prev };
      if(id in next) delete next[id]; else next[id] = 1;
      return next;
    });
  };
  const setTaskQuantity = (id, value) => {
    const n = Math.max(1, parseInt(value) || 1);
    setTaskQuantities(prev => ({ ...prev, [id]: n }));
  };
  const handleSave = () => {
    if(!clientId) return;
    const taskIds = Object.entries(taskQuantities).map(([taskId, quantity]) => ({ taskId, quantity }));
    // Mantém os campos da locação (tipo, itens, local, janela) ao salvar
    onSave({ ...(editing || {}), id: editing?.id, date: modal.dateKey, clientId, taskIds, teamId, notes });
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" style={{ minHeight: '400px' }}>
      <div className="bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{editing ? 'Editar agendamento' : 'Novo agendamento'} — {modal.dateKey}</h3>
            {editing?.status === 'concluido' && (
              <span className="flex items-center gap-1 text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 shrink-0">
                <Check size={11} strokeWidth={3}/> Concluída
              </span>
            )}
            {editing?.status && !['pendente', 'concluido'].includes(editing.status) && APPT_STATUS[editing.status] && (
              <span className={`text-[10px] px-2 py-0.5 rounded shrink-0 ${APPT_STATUS[editing.status].cls}`}>{APPT_STATUS[editing.status].label}</span>
            )}
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"><X size={18}/></button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          {editing?.rentalId && (
            <div className="rounded-lg bg-neutral-100 dark:bg-neutral-800 p-3 text-sm">
              <p className="font-medium">{kindLabel(editing.kind)} da locação</p>
              {editing.siteId && SITE_INDEX[editing.siteId] && (
                <p className="text-xs text-neutral-500">{SITE_INDEX[editing.siteId].name}, {SITE_INDEX[editing.siteId].address}</p>
              )}
              {editing.items?.length > 0 && (
                <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1">{editing.items.map(i => `${i.quantity}× ${i.name}`).join(', ')}</p>
              )}
              <p className="text-xs text-neutral-500 mt-1">Datas e itens da locação se mudam na aba Locações. Aqui dá para trocar dia, equipe e tarefas desta visita.</p>
            </div>
          )}
          <div>
            <label className="text-xs font-mono uppercase text-neutral-500 mb-1 block">Cliente</label>
            {clients.length === 0 ? (
              <p className="text-xs text-neutral-500">Nenhum cliente cadastrado ainda. Cadastre um na aba Clientes.</p>
            ) : (
              <select value={clientId} onChange={e => setClientId(e.target.value)} className="w-full bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm">
                <option value="">Selecione um cliente...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {clientId && <p className="text-xs text-neutral-500 mt-1">{clients.find(c => c.id === clientId)?.address}</p>}
          </div>

          <div>
            <label className="text-xs font-mono uppercase text-neutral-500 mb-1 block">Tarefas</label>
            {taskTypes.length === 0 ? (
              <p className="text-xs text-neutral-500">Nenhuma tarefa cadastrada. Cadastre na aba Tarefas.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {taskTypes.map(t => (
                  <div key={t.id} className="flex items-center gap-2 text-sm">
                    <label className="flex items-center gap-2 cursor-pointer flex-1">
                      <input type="checkbox" checked={t.id in taskQuantities} onChange={() => toggleTask(t.id)} />
                      {t.name}
                    </label>
                    {t.id in taskQuantities && (
                      <input
                        type="number"
                        min="1"
                        value={taskQuantities[t.id]}
                        onChange={e => setTaskQuantity(t.id, e.target.value)}
                        className="w-16 bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-2 py-1 text-xs text-center"
                        title="Quantidade"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-mono uppercase text-neutral-500 mb-1 block">Equipe</label>
            <div className="flex gap-2">
              {TEAMS.map(t => (
                <button key={t.id} onClick={() => setTeamId(t.id)}
                  className="flex-1 px-3 py-2 rounded text-sm font-medium border-2"
                  style={{ borderColor: teamId === t.id ? t.color : 'transparent', background: t.bg, color: t.text }}>
                  {t.name.replace('Equipe ', '')}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-mono uppercase text-neutral-500 mb-1 block">Observações</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm" placeholder="Opcional" />
          </div>

          {editing?.status === 'concluido' && (
            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
              <p className="text-xs font-mono uppercase text-brand-600 dark:text-brand-400 mb-2 flex items-center gap-1">
                <Check size={12} strokeWidth={3}/> Registro de execução (feito pelo app de campo)
              </p>
              {execError && <p className="text-xs text-red-500">{execError}</p>}
              {!execution && !execError && <p className="text-xs text-neutral-500">Carregando...</p>}
              {execution && execution.length === 0 && <p className="text-xs text-neutral-500">Nenhum registro encontrado.</p>}
              {execution && execution.map(rec => (
                <div key={rec.id} className="bg-neutral-100 dark:bg-neutral-800 rounded-lg p-3 flex flex-col gap-2 mb-2">
                  <p className="text-[11px] font-mono text-neutral-500">
                    {new Date(rec.createdAt).toLocaleString('pt-BR')}
                  </p>
                  {rec.executedTasks.length > 0 && (
                    <ul className="text-sm flex flex-col gap-0.5">
                      {rec.executedTasks.map((t, i) => {
                        const taskName = taskTypes.find(tt => tt.id === t.taskId)?.name || 'Tarefa removida';
                        return <li key={i}>{taskName}: <span className="font-medium">{t.quantity}</span> executada(s)</li>;
                      })}
                    </ul>
                  )}
                  {rec.notes && <p className="text-sm text-neutral-700 dark:text-neutral-300">{rec.notes}</p>}
                  {rec.assets?.length > 0 && (
                    <p className="text-xs">
                      <span className="text-neutral-500">Unidades: </span>
                      {rec.assets.map((m, i) => (
                        <span key={i} className={`font-mono ${m.condition && m.condition !== 'ok' ? 'text-red-500' : ''}`}>
                          {i > 0 ? ', ' : ''}{m.code}{m.condition && m.condition !== 'ok' ? ` (${m.condition})` : ''}
                        </span>
                      ))}
                    </p>
                  )}
                  {rec.signedBy && <p className="text-xs text-neutral-500">Recebido por {rec.signedBy}</p>}
                  {rec.signature && <img src={rec.signature} alt={`Assinatura de ${rec.signedBy || 'cliente'}`} className="h-16 bg-white rounded border border-neutral-300 dark:border-neutral-700 self-start" />}
                  {rec.photos.length > 0 && (
                    <div className="grid grid-cols-4 gap-1.5">
                      {rec.photos.map((p, i) => (
                        <button key={i} onClick={() => setExpandedPhoto(p)} className="aspect-square rounded overflow-hidden border border-neutral-300 dark:border-neutral-700">
                          <img src={p} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-t border-neutral-200 dark:border-neutral-800">
          {editing ? (
            <button onClick={() => onDelete(editing.id)} className="text-red-400 hover:text-red-300 text-sm flex items-center gap-1">
              <Trash2 size={14}/> Remover
            </button>
          ) : <span/>}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 text-sm rounded border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800">Cancelar</button>
            <button onClick={handleSave} disabled={!clientId} className="px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white font-medium">Salvar</button>
          </div>
        </div>
      </div>

      {expandedPhoto && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4" onClick={() => setExpandedPhoto(null)}>
          <img src={expandedPhoto} alt="" className="max-w-full max-h-full rounded" />
          <button onClick={() => setExpandedPhoto(null)} className="absolute top-4 right-4 text-white"><X size={24}/></button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CLIENTES
// ---------------------------------------------------------------------------
function emptyClientForm(){ return { id: null, name: '', address: '', phone: '', lat: '', lon: '', notes: '' }; }

function ClientesTab({ clients, setClients, appointments, taskTypes }){
  const [form, setForm] = useState(emptyClientForm());
  const [expanded, setExpanded] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [search, setSearch] = useState('');

  const importClients = async (rows) => {
    const withIds = rows.map(row => ({
      id: uid(), name: row.name, address: row.address, phone: row.phone || '',
      lat: row.lat || '', lon: row.lon || '', notes: row.notes || '',
    }));
    const result = await api.clients.bulk(withIds);
    setClients(prev => [...prev, ...withIds]);
    return result.created;
  };

  const submit = async () => {
    if(!form.name.trim() || !form.address.trim()) return;
    if(form.id){
      await api.clients.update(form.id, form);
      setClients(prev => prev.map(c => c.id === form.id ? { ...form } : c));
    }else{
      const withId = { ...form, id: uid() };
      await api.clients.create(withId);
      setClients(prev => [...prev, withId]);
    }
    setForm(emptyClientForm());
  };

  const edit = (c) => setForm({ ...emptyClientForm(), ...c });
  const remove = async (id) => {
    await api.clients.remove(id);
    setClients(prev => prev.filter(c => c.id !== id));
    if(form.id === id) setForm(emptyClientForm());
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <button
          onClick={() => setShowImport(true)}
          className="flex items-center gap-1.5 text-xs font-mono px-3 py-2 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <Upload size={14}/> Importar planilha
        </button>
      </div>
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
        <h3 className="text-sm font-medium mb-3">{form.id ? 'Editar cliente' : 'Novo cliente'}</h3>
        <div className="grid grid-cols-2 gap-3">
          <input placeholder="Nome" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm col-span-2" />
          <input placeholder="Endereço completo" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm col-span-2" />
          <input placeholder="Telefone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm" />
          <div />
          <input placeholder="Latitude (opcional)" value={form.lat} onChange={e => setForm({ ...form, lat: e.target.value })} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm" />
          <input placeholder="Longitude (opcional)" value={form.lon} onChange={e => setForm({ ...form, lon: e.target.value })} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm" />
          <textarea placeholder="Notas (opcional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm col-span-2" />
        </div>
        <p className="text-xs text-neutral-500 mt-2">Latitude/longitude são opcionais — preencha para que o cliente apareça no mapa (copie do Google Maps clicando com o botão direito no local).</p>
        <div className="flex gap-2 mt-3">
          <button onClick={submit} className="px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-500 text-white font-medium">{form.id ? 'Salvar alterações' : '+ Cadastrar cliente'}</button>
          {form.id && <button onClick={() => setForm(emptyClientForm())} className="px-4 py-2 text-sm rounded border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300">Cancelar</button>}
        </div>
      </div>

      <div className="relative">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar cliente por nome, endereço ou telefone..."
          className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg px-3 py-2.5 text-sm"
        />
      </div>

      <div className="flex flex-col gap-2">
        {(() => {
          const q = search.trim().toLowerCase();
          const filteredClients = q
            ? clients.filter(c => `${c.name} ${c.address} ${c.phone}`.toLowerCase().includes(q))
            : clients;
          if(clients.length === 0) return <p className="text-sm text-neutral-500">Nenhum cliente cadastrado ainda.</p>;
          if(filteredClients.length === 0) return <p className="text-sm text-neutral-500">Nenhum cliente encontrado para "{search}".</p>;
          return filteredClients.map(c => {
          const history = appointments.filter(a => a.clientId === c.id).sort((a,b) => a.date < b.date ? 1 : -1);
          const isOpen = expanded === c.id;
          return (
            <div key={c.id} className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg">
              <div className="flex items-center justify-between px-4 py-3">
                <button onClick={() => setExpanded(isOpen ? null : c.id)} className="text-left flex-1">
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-neutral-500">{c.address}{c.phone ? ' · ' + c.phone : ''}</div>
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-neutral-500 dark:text-neutral-600">{history.length} agend.</span>
                  <button onClick={() => edit(c)} className="p-1.5 text-neutral-500 hover:text-brand-400"><Edit2 size={14}/></button>
                  <button onClick={() => remove(c.id)} className="p-1.5 text-neutral-500 hover:text-red-400"><Trash2 size={14}/></button>
                </div>
              </div>
              {isOpen && (
                <div className="border-t border-neutral-200 dark:border-neutral-800 px-4 py-3">
                  {history.length === 0 ? (
                    <p className="text-xs text-neutral-500">Sem histórico de agendamentos.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {history.map(a => {
                        const team = teamOf(a.teamId);
                        const names = formatTaskList(a.taskIds, taskTypes);
                        return (
                          <li key={a.id} className="text-xs flex items-center gap-2">
                            <span className="font-mono text-neutral-500">{a.date}</span>
                            <span className="px-1.5 py-0.5 rounded" style={{ background: team.bg, color: team.text }}>{team.name.replace('Equipe ','')}</span>
                            <span className="text-neutral-600 dark:text-neutral-400">{names || 'sem tarefas'}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
          });
        })()}
      </div>

      {showImport && (
        <ImportClientsModal onClose={() => setShowImport(false)} onImport={importClients} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TAREFAS
// ---------------------------------------------------------------------------
function TarefasTab({ taskTypes, setTaskTypes }){
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState(60);
  const [editingId, setEditingId] = useState(null);

  const submit = async () => {
    if(!name.trim()) return;
    if(editingId){
      await api.taskTypes.update(editingId, { name, description, estimatedMinutes });
      setTaskTypes(prev => prev.map(t => t.id === editingId ? { ...t, name, description, estimatedMinutes } : t));
    }else{
      const withId = { id: uid(), name, description, estimatedMinutes };
      await api.taskTypes.create(withId);
      setTaskTypes(prev => [...prev, withId]);
    }
    setName(''); setDescription(''); setEstimatedMinutes(60); setEditingId(null);
  };
  const edit = (t) => { setEditingId(t.id); setName(t.name); setDescription(t.description || ''); setEstimatedMinutes(t.estimatedMinutes || 60); };
  const remove = async (id) => {
    await api.taskTypes.remove(id);
    setTaskTypes(prev => prev.filter(t => t.id !== id));
    if(editingId === id){ setEditingId(null); setName(''); setDescription(''); setEstimatedMinutes(60); }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
        <h3 className="text-sm font-medium mb-3">{editingId ? 'Editar tarefa' : 'Nova tarefa do catálogo'}</h3>
        <div className="grid grid-cols-2 gap-3">
          <input placeholder="Nome (ex: Entrega, Coleta...)" value={name} onChange={e => setName(e.target.value)} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm" />
          <input placeholder="Descrição padrão (opcional)" value={description} onChange={e => setDescription(e.target.value)} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm" />
          <div>
            <label className="text-xs font-mono uppercase text-neutral-500 mb-1 block">Tempo estimado de execução (minutos)</label>
            <input
              type="number"
              min="5"
              step="5"
              value={estimatedMinutes}
              onChange={e => setEstimatedMinutes(Math.max(5, parseInt(e.target.value) || 60))}
              className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm w-full"
            />
          </div>
        </div>
        <p className="text-xs text-neutral-500 mt-2">Usado pela plataforma pra sugerir rotas e agendamentos otimizados na semana, na aba Mapa.</p>
        <div className="flex gap-2 mt-3">
          <button onClick={submit} className="px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-500 text-white font-medium">{editingId ? 'Salvar' : '+ Adicionar tarefa'}</button>
          {editingId && <button onClick={() => { setEditingId(null); setName(''); setDescription(''); setEstimatedMinutes(60); }} className="px-4 py-2 text-sm rounded border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300">Cancelar</button>}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {taskTypes.length === 0 && <p className="text-sm text-neutral-500">Nenhuma tarefa cadastrada ainda.</p>}
        {taskTypes.map(t => (
          <div key={t.id} className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{t.name}</div>
              {t.description && <div className="text-xs text-neutral-500">{t.description}</div>}
              <div className="text-xs text-neutral-500 mt-0.5">~{t.estimatedMinutes || 60} min por execução</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => edit(t)} className="p-1.5 text-neutral-500 hover:text-brand-400"><Edit2 size={14}/></button>
              <button onClick={() => remove(t.id)} className="p-1.5 text-neutral-500 hover:text-red-400"><Trash2 size={14}/></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EQUIPES
// ---------------------------------------------------------------------------
function EquipesTab({ teamMembers, setTeamMembers, appointments, user }){
  const [inputs, setInputs] = useState({ verde: '', azul: '', laranja: '', roxo: '' });
  const [teamPasswords, setTeamPasswords] = useState({});
  const [pwStatus, setPwStatus] = useState({});

  const addMember = async (teamId) => {
    const value = inputs[teamId].trim();
    if(!value) return;
    const next = [...(teamMembers[teamId] || []), value];
    await api.teamMembers.setForTeam(teamId, next);
    setTeamMembers(prev => ({ ...prev, [teamId]: next }));
    setInputs({ ...inputs, [teamId]: '' });
  };
  const removeMember = async (teamId, idx) => {
    const next = teamMembers[teamId].filter((_, i) => i !== idx);
    await api.teamMembers.setForTeam(teamId, next);
    setTeamMembers(prev => ({ ...prev, [teamId]: next }));
  };

  const savePassword = async (teamId) => {
    const pw = (teamPasswords[teamId] || '').trim();
    if(pw.length < 4){
      setPwStatus(prev => ({ ...prev, [teamId]: 'Mínimo 4 caracteres.' }));
      return;
    }
    try{
      await api.teamApp.setPassword(teamId, pw);
      setPwStatus(prev => ({ ...prev, [teamId]: 'Senha salva!' }));
      setTeamPasswords(prev => ({ ...prev, [teamId]: '' }));
    }catch(err){
      setPwStatus(prev => ({ ...prev, [teamId]: err.message || 'Erro ao salvar.' }));
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {TEAMS.map(t => {
        const count = appointments.filter(a => a.teamId === t.id).length;
        return (
          <div key={t.id} className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
            <div className="h-1.5" style={{ background: t.color }} />
            <div className="p-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-medium">{t.name}</h3>
                <span className="text-xs font-mono text-neutral-500">{count} agend.</span>
              </div>
              <p className="text-xs text-neutral-500 mb-3">Integrantes da equipe</p>
              <ul className="flex flex-col gap-1 mb-3">
                {(teamMembers[t.id] || []).map((m, i) => (
                  <li key={i} className="flex items-center justify-between text-sm bg-neutral-100 dark:bg-neutral-800 rounded px-2 py-1.5">
                    {m}
                    <button onClick={() => removeMember(t.id, i)} className="text-neutral-500 hover:text-red-400"><X size={13}/></button>
                  </li>
                ))}
                {(teamMembers[t.id] || []).length === 0 && <li className="text-xs text-neutral-500 dark:text-neutral-600">Nenhum integrante ainda.</li>}
              </ul>
              <div className="flex gap-1.5">
                <input value={inputs[t.id]} onChange={e => setInputs({ ...inputs, [t.id]: e.target.value })}
                  onKeyDown={e => { if(e.key === 'Enter') addMember(t.id); }}
                  placeholder="Nome do integrante" className="flex-1 bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-2 py-1.5 text-sm" />
                <button onClick={() => addMember(t.id)} className="px-2 rounded bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300"><Plus size={14}/></button>
              </div>

              {user?.role === 'admin' && (
                <div className="mt-4 pt-3 border-t border-neutral-200 dark:border-neutral-800">
                  <p className="text-xs font-mono uppercase text-neutral-500 mb-1.5">Senha do app de campo</p>
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      value={teamPasswords[t.id] || ''}
                      onChange={e => setTeamPasswords(prev => ({ ...prev, [t.id]: e.target.value }))}
                      placeholder="Nova senha"
                      className="flex-1 bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-2 py-1.5 text-sm"
                    />
                    <button onClick={() => savePassword(t.id)} className="px-3 rounded bg-brand-600 hover:bg-brand-500 text-white text-sm">Salvar</button>
                  </div>
                  {pwStatus[t.id] && <p className="text-[11px] text-neutral-500 mt-1">{pwStatus[t.id]}</p>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MAPA
// ---------------------------------------------------------------------------
function MapaTab({ clients, appointments, taskTypes, base, setBase, setAppointments }){
  const [dateKey, setDateKey] = useState(todayKey());
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const fullscreenRef = useRef(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showBaseForm, setShowBaseForm] = useState(false);
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [baseForm, setBaseForm] = useState({ name: base?.name || 'Base', address: base?.address || '', lat: base?.lat || '', lon: base?.lon || '' });
  const [routes, setRoutes] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeStatus, setRouteStatus] = useState('');
  const [weekStart, setWeekStart] = useState(() => mondayOf(addDays(new Date(), 7)));
  const [weekRoutes, setWeekRoutes] = useState(null);
  const [weekLoading, setWeekLoading] = useState(false);
  const [weekStatus, setWeekStatus] = useState('');
  const [weekWarnings, setWeekWarnings] = useState([]);
  const [mapMode, setMapMode] = useState('day'); // 'day' | 'week'
  const weekDates = Array.from({ length: 5 }, (_, i) => dateKeyFromDate(addDays(weekStart, i)));

  useEffect(() => {
    if(weekRoutes && weekRoutes[dateKey]){
      setRoutes(weekRoutes[dateKey]);
      setRouteStatus('');
    }else{
      setRoutes(null);
      setRouteStatus('');
    }
  }, [dateKey]);

  useEffect(() => {
    setBaseForm({ name: base?.name || 'Base', address: base?.address || '', lat: base?.lat || '', lon: base?.lon || '' });
  }, [base]);

  const saveBase = () => {
    if(!baseForm.address.trim()) return;
    setBase(baseForm);
    setShowBaseForm(false);
  };

  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement === fullscreenRef.current;
      setIsFullscreen(active);
      setTimeout(() => { mapInstance.current?.invalidateSize(); }, 100);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if(document.fullscreenElement){
      document.exitFullscreen();
    }else{
      fullscreenRef.current?.requestFullscreen();
    }
  };

  useEffect(() => {
    if(window.L){ setLeafletReady(true); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    script.onload = () => setLeafletReady(true);
    document.body.appendChild(script);

    const style = document.createElement('style');
    style.textContent = `
      .map-task-tooltip {
        background: #171717; color: #f5f5f5; border: 1px solid #404040;
        font-size: 11px; padding: 2px 6px; border-radius: 4px; box-shadow: none;
      }
      .map-task-tooltip::before { border-top-color: #404040; }
    `;
    document.head.appendChild(style);
  }, []);

  const dayAppts = appointments.filter(a => a.date === dateKey);
  const pins = dayAppts.map(a => ({ appt: a, client: stopOf(a, clients) })).filter(p => p.client);

  const generateDayRoutes = async () => {
    if(!base?.lat || !base?.lon){
      setRouteStatus('Defina a base (com latitude/longitude) primeiro.');
      return;
    }
    setRouteLoading(true);
    setRouteStatus('');
    const newRoutes = {};
    for(const team of TEAMS){
      const teamStops = pins.filter(p => p.appt.teamId === team.id && p.client.lat && p.client.lon);
      if(teamStops.length === 0) continue;
      setRouteStatus(`Calculando rota: ${team.name}...`);
      try{
        const coordsAll = [
          { lat: parseFloat(base.lat), lon: parseFloat(base.lon), name: base.name || 'Base', isBase: true },
          ...teamStops.map(p => ({ lat: parseFloat(p.client.lat), lon: parseFloat(p.client.lon), name: p.client.name, address: p.client.address })),
        ];
        const coordStr = coordsAll.map(p => `${p.lon},${p.lat}`).join(';');
        const tripUrl = `https://router.project-osrm.org/trip/v1/driving/${coordStr}?source=first&roundtrip=true&geometries=geojson&overview=full`;
        const res = await fetch(tripUrl);
        const data = await res.json();
        if(data.code !== 'Ok') throw new Error(data.code);
        const trip = data.trips[0];
        newRoutes[team.id] = {
          distance: trip.distance, duration: trip.duration, geometry: trip.geometry,
          firstLegDistance: trip.legs[0]?.distance || 0, firstLegDuration: trip.legs[0]?.duration || 0,
        };
      }catch(err){
        newRoutes[team.id] = { error: true };
      }
      await new Promise(r => setTimeout(r, 250));
    }
    setRoutes(newRoutes);
    setRouteStatus(Object.keys(newRoutes).length ? '' : 'Nenhuma parada com coordenadas para calcular rota.');
    setRouteLoading(false);
  };

  const computeOpenTrip = async (entryPoint, stops, endAtBase) => {
    try{
      const coordsAll = endAtBase
        ? [entryPoint, ...stops, { lat: parseFloat(base.lat), lon: parseFloat(base.lon), name: base.name || 'Base', isBase: true }]
        : [entryPoint, ...stops];
      const coordStr = coordsAll.map(p => `${p.lon},${p.lat}`).join(';');
      const destParam = endAtBase ? 'last' : 'any';
      const tripUrl = `https://router.project-osrm.org/trip/v1/driving/${coordStr}?source=first&destination=${destParam}&roundtrip=false&geometries=geojson&overview=full`;
      const res = await fetch(tripUrl);
      const data = await res.json();
      if(data.code !== 'Ok') throw new Error(data.code);
      const trip = data.trips[0];
      const orderedIdx = new Array(coordsAll.length);
      data.waypoints.forEach((wp, inputIdx) => { orderedIdx[wp.waypoint_index] = inputIdx; });
      const lastPoint = coordsAll[orderedIdx[orderedIdx.length - 1]];
      return {
        distance: trip.distance, duration: trip.duration, geometry: trip.geometry,
        firstLegDistance: trip.legs[0]?.distance || 0, firstLegDuration: trip.legs[0]?.duration || 0,
        exitPoint: lastPoint,
      };
    }catch(err){
      return { error: true, exitPoint: entryPoint };
    }
  };

  const generateWeekRoutes = async () => {
    if(!base?.lat || !base?.lon){
      setWeekStatus('Defina a base (com latitude/longitude) primeiro.');
      return;
    }
    setWeekLoading(true);
    setWeekStatus('');
    const newWeekRoutes = {};
    const newWarnings = [];
    weekDates.forEach(d => { newWeekRoutes[d] = {}; });

    for(const team of TEAMS){
      const teamDays = [];
      for(const wDateKey of weekDates){
        const dayTeamAppts = appointments.filter(a => a.date === wDateKey && a.teamId === team.id);
        if(dayTeamAppts.length === 0) continue;
        const stopsRaw = dayTeamAppts.map(a => ({ appt: a, client: stopOf(a, clients) }));
        const stops = stopsRaw.filter(p => p.client && p.client.lat && p.client.lon)
          .map(p => ({ lat: parseFloat(p.client.lat), lon: parseFloat(p.client.lon), name: p.client.name, address: p.client.address }));
        const missing = stopsRaw.filter(p => p.client && (!p.client.lat || !p.client.lon));
        missing.forEach(p => newWarnings.push(`${p.client.name} (${formatDateLabel(wDateKey)}, ${team.name}) — sem coordenadas`));
        if(stops.length > 0) teamDays.push({ dateKey: wDateKey, stops });
      }

      let entryPoint = { lat: parseFloat(base.lat), lon: parseFloat(base.lon), name: base.name || 'Base', isBase: true };
      for(let i = 0; i < teamDays.length; i++){
        const { dateKey: wDateKey, stops } = teamDays[i];
        const isLastWorkingDay = i === teamDays.length - 1;
        setWeekStatus(`Calculando rota: ${team.name} — ${formatDateLabel(wDateKey)}...`);
        const result = await computeOpenTrip(entryPoint, stops, isLastWorkingDay);
        newWeekRoutes[wDateKey][team.id] = result;
        if(!result.error) entryPoint = result.exitPoint;
        await new Promise(r => setTimeout(r, 250));
      }
    }

    setWeekRoutes(newWeekRoutes);
    setWeekWarnings(newWarnings);
    setWeekStatus('Rotas da semana calculadas — sequenciais, uma equipe emenda de uma parada pra outra ao longo dos dias.');
    setWeekLoading(false);
    setMapMode('week');
  };

  const UNREALISTIC_MINUTES = 480;
  const UNREALISTIC_KM = 300;
  const adjustedKm = (r) => (r.distance - (r.firstLegDistance || 0)) / 1000;
  const adjustedMin = (r) => (r.duration - (r.firstLegDuration || 0)) / 60;
  const isUnrealistic = (r) => r && !r.error && (adjustedMin(r) > UNREALISTIC_MINUTES || adjustedKm(r) > UNREALISTIC_KM);

  const clearWeekResults = () => { setWeekRoutes(null); setWeekWarnings([]); setWeekStatus(''); };
  const goPrevWeek = () => { setWeekStart(d => addDays(d, -7)); clearWeekResults(); };
  const goNextWeek = () => { setWeekStart(d => addDays(d, 7)); clearWeekResults(); };
  const jumpToWeekDate = (dateStr) => {
    if(!dateStr) return;
    const [y, m, d] = dateStr.split('-').map(Number);
    setWeekStart(mondayOf(new Date(y, m - 1, d)));
    clearWeekResults();
  };

  const DASH_BY_WEEKDAY = [null, '12,6', '2,6', '16,6,2,6', '5,5'];

  useEffect(() => {
    if(!leafletReady || !mapRef.current) return;
    const L = window.L;
    if(!mapInstance.current){
      mapInstance.current = L.map(mapRef.current).setView([-20.1436, -44.8891], 12);
      const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
      });
      const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri', maxZoom: 19,
      });
      streets.addTo(mapInstance.current);
      L.control.layers({ 'Mapa': streets, 'Satélite': satellite }, {}, { position: 'topright' }).addTo(mapInstance.current);
    }
    const map = mapInstance.current;
    map.eachLayer(layer => { if(layer instanceof L.Marker || layer instanceof L.Polyline || layer instanceof L.GeoJSON) map.removeLayer(layer); });

    const group = L.featureGroup();
    let hasAny = false;

    if(base?.lat && base?.lon){
      const baseIcon = L.divIcon({
        className: '',
        html: `<div style="background:#171717;width:26px;height:26px;border-radius:6px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:white;font-size:14px;">🏠</div>`,
        iconSize: [26,26], iconAnchor: [13,13],
      });
      L.marker([parseFloat(base.lat), parseFloat(base.lon)], { icon: baseIcon, zIndexOffset: 1000 })
        .bindPopup(`<b>${escapeHtml(base.name || 'Base')}</b><br>${escapeHtml(base.address)}`)
        .addTo(group);
      hasAny = true;
    }

    if(mapMode === 'week' && weekRoutes){
      weekDates.forEach((wDateKey, dayIdx) => {
        const dayLabel = formatDateLabel(wDateKey);
        const dayAppts2 = appointments.filter(a => a.date === wDateKey);
        const dayPins = dayAppts2.map(a => ({ appt: a, client: stopOf(a, clients) }))
          .filter(p => p.client && p.client.lat && p.client.lon);

        dayPins.forEach(p => {
          const team = teamOf(p.appt.teamId);
          const taskNames = formatTaskList(p.appt.taskIds, taskTypes);
          const icon = L.divIcon({ className: '', html: `<div style="background:${team.color};width:18px;height:18px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`, iconSize: [18,18], iconAnchor: [9,9] });
          const popupHtml = `
            <div style="min-width:160px">
              <b>${escapeHtml(p.client.name)}</b><br>
              <span style="color:#666">${escapeHtml(p.client.address)}</span><br>
              <span style="display:inline-block;margin-top:4px;padding:1px 6px;border-radius:8px;font-size:11px;background:${team.bg};color:${team.text}">${escapeHtml(team.name.replace('Equipe ',''))}</span>
              <div style="margin-top:4px;font-size:12px"><b>${escapeHtml(dayLabel)}</b></div>
              ${taskNames ? `<div style="font-size:12px">${escapeHtml(taskNames)}</div>` : ''}
            </div>`;
          L.marker([parseFloat(p.client.lat), parseFloat(p.client.lon)], { icon }).bindPopup(popupHtml).addTo(group);
        });

        const dayResults = weekRoutes[wDateKey] || {};
        Object.entries(dayResults).forEach(([teamId, r]) => {
          if(r.error) return;
          const team = teamOf(teamId);
          L.geoJSON(r.geometry, {
            style: { color: team.color, weight: 4, opacity: 0.85, dashArray: DASH_BY_WEEKDAY[dayIdx] },
          }).bindPopup(`<b>${team.name}</b><br>${dayLabel}<br>${(r.distance/1000).toFixed(1)} km · ${Math.round(r.duration/60)} min`).addTo(group);
        });

        if(dayPins.length || Object.keys(dayResults).length) hasAny = true;
      });
    } else {
      const withCoords = pins.filter(p => p.client.lat && p.client.lon);
      if(withCoords.length){
        withCoords.forEach(p => {
          const team = teamOf(p.appt.teamId);
          const taskNames = formatTaskList(p.appt.taskIds, taskTypes);
          const icon = L.divIcon({ className: '', html: `<div style="background:${team.color};width:22px;height:22px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`, iconSize: [22,22], iconAnchor: [11,11] });
          const popupHtml = `
            <div style="min-width:160px">
              <b>${escapeHtml(p.client.name)}</b><br>
              <span style="color:#666">${escapeHtml(p.client.address)}</span><br>
              <span style="display:inline-block;margin-top:4px;padding:1px 6px;border-radius:8px;font-size:11px;background:${team.bg};color:${team.text}">${escapeHtml(team.name.replace('Equipe ',''))}</span>
              ${taskNames ? `<div style="margin-top:4px;font-size:12px"><b>Tarefa:</b> ${escapeHtml(taskNames)}</div>` : ''}
            </div>`;
          const marker = L.marker([parseFloat(p.client.lat), parseFloat(p.client.lon)], { icon }).bindPopup(popupHtml);
          if(taskNames){
            marker.bindTooltip(escapeHtml(taskNames), {
              permanent: true, direction: 'top', offset: [0, -12], className: 'map-task-tooltip',
            });
          }
          marker.addTo(group);
        });
        hasAny = true;
      }

      if(routes){
        Object.entries(routes).forEach(([teamId, r]) => {
          if(r.error) return;
          const team = teamOf(teamId);
          L.geoJSON(r.geometry, { style: { color: team.color, weight: 4, opacity: 0.85 } }).addTo(group);
        });
        hasAny = true;
      }
    }

    if(hasAny){
      group.addTo(map);
      try{ map.fitBounds(group.getBounds(), { padding: [30,30] }); }catch(e){}
    }
  }, [leafletReady, dateKey, pins.length, base, routes, mapMode, weekRoutes]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={goPrevWeek} className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500">
          <ChevronLeft size={18}/>
        </button>
        <span className="text-sm font-medium">
          {formatDateLabel(weekDates[0]).split(', ')[1]} – {formatDateLabel(weekDates[4]).split(', ')[1]}
        </span>
        <button onClick={goNextWeek} className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500">
          <ChevronRight size={18}/>
        </button>
        <input
          type="date"
          value={weekDates[0]}
          onChange={e => jumpToWeekDate(e.target.value)}
          className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-2 py-1.5 text-xs"
          title="Pular para a semana que contém esta data"
        />
        <button
          onClick={generateWeekRoutes}
          disabled={weekLoading}
          className="flex items-center gap-1.5 text-xs font-mono px-3 py-2 rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-medium"
        >
          <Route size={14}/> {weekLoading ? 'Calculando semana...' : 'Gerar rotas da semana (Seg-Sex)'}
        </button>
        <button
          onClick={() => setShowSuggestion(true)}
          className="flex items-center gap-1.5 text-xs font-mono px-3 py-2 rounded border border-brand-500 text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/30 font-medium"
        >
          🧭 Sugestão de rotas e agendamentos da semana
        </button>
      </div>

      {weekStatus && <p className="text-xs font-mono text-neutral-500">{weekStatus}</p>}
      {weekWarnings.length > 0 && (
        <div className="text-xs text-amber-700 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded p-2">
          <b>{weekWarnings.length} parada(s) da semana ignorada(s) por falta de coordenadas:</b>
          <ul className="list-disc list-inside mt-1">
            {weekWarnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      {weekRoutes && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setMapMode('week')}
            className={`text-xs font-mono px-3 py-1.5 rounded border ${mapMode === 'week' ? 'border-brand-500 text-brand-600 dark:text-brand-400' : 'border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
          >
            Ver semana inteira no mapa
          </button>
          <span className="text-xs text-neutral-500">ou clique num dia abaixo pra ver só ele</span>
        </div>
      )}
      {weekRoutes && mapMode === 'week' && (
        <div className="flex items-center gap-4 flex-wrap text-xs text-neutral-500 font-mono">
          <span>Linha por dia:</span>
          {weekDates.map((wDateKey, i) => (
            <span key={wDateKey} className="flex items-center gap-1.5">
              <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="currentColor" strokeWidth="2" strokeDasharray={DASH_BY_WEEKDAY[i] || 'none'} /></svg>
              {formatDateLabel(wDateKey).split(', ')[0].slice(0, 3)}
            </span>
          ))}
        </div>
      )}
      {weekRoutes && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          {weekDates.map(wDateKey => {
            const dayResults = weekRoutes[wDateKey] || {};
            const teamIds = Object.keys(dayResults);
            return (
              <button
                key={wDateKey}
                onClick={() => { setDateKey(wDateKey); setMapMode('day'); }}
                className={`text-left p-2 rounded border text-xs ${
                  mapMode === 'day' && dateKey === wDateKey
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/20'
                    : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                }`}
              >
                <div className="font-medium mb-1">{formatDateLabel(wDateKey)}</div>
                {teamIds.length === 0 && <div className="text-neutral-500">sem agendamentos</div>}
                {teamIds.map(teamId => {
                  const r = dayResults[teamId];
                  const team = teamOf(teamId);
                  if(r.error) return <div key={teamId} className="text-red-500">{team.name}: erro</div>;
                  const warn = isUnrealistic(r);
                  return (
                    <div key={teamId} className={`flex items-center gap-1 ${warn ? 'text-red-600 dark:text-red-400' : 'text-neutral-500'}`}>
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: team.color }}></span>
                      {(r.distance/1000).toFixed(0)} km {warn && '⚠️'}
                    </div>
                  );
                })}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs font-mono uppercase text-neutral-500">Data</label>
        <input type="date" value={dateKey} onChange={e => setDateKey(e.target.value)} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm" />
        <span className="text-xs text-neutral-500">{pins.length} parada(s) nesta data</span>
        <button
          onClick={generateDayRoutes}
          disabled={routeLoading}
          className="flex items-center gap-1.5 text-xs font-mono px-3 py-2 rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-medium"
        >
          <Route size={14}/> {routeLoading ? 'Calculando...' : 'Calcular rota do dia'}
        </button>
        <button
          onClick={() => setShowBaseForm(v => !v)}
          className="flex items-center gap-1.5 text-xs font-mono px-3 py-2 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          🏠 {base ? 'Editar base' : 'Definir base'}
        </button>
        <button
          onClick={toggleFullscreen}
          className="flex items-center gap-1.5 text-xs font-mono px-3 py-2 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {isFullscreen ? <Minimize size={14}/> : <Maximize size={14}/>} {isFullscreen ? 'Sair da tela cheia' : 'Expandir mapa'}
        </button>
      </div>

      {routeStatus && <p className="text-xs font-mono text-neutral-500">{routeStatus}</p>}

      {routes && (
        <div className="flex flex-col gap-2">
          {Object.entries(routes).map(([teamId, r]) => {
            const team = teamOf(teamId);
            if(r.error){
              return <p key={teamId} className="text-xs text-red-500">{team.name}: não foi possível calcular a rota.</p>;
            }
            const warn = isUnrealistic(r);
            return (
              <div
                key={teamId}
                className={`flex items-center gap-2 text-xs px-3 py-2 rounded border ${
                  warn
                    ? 'border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400'
                    : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: team.color }}></span>
                <span className="font-medium">{team.name}</span>
                <span className="font-mono">
                  {(r.distance/1000).toFixed(1)} km total · {Math.round(r.duration/60)} min
                  <span className="text-neutral-400 dark:text-neutral-600"> (após 1ª parada: {adjustedKm(r).toFixed(1)} km · {Math.round(adjustedMin(r))} min)</span>
                </span>
                {warn && <span>⚠️ Deslocamento entre paradas do dia muito longo (sem contar o trajeto até a 1ª parada, que pode ser feito no dia anterior) — confira as coordenadas ou redistribua entre equipes.</span>}
              </div>
            );
          })}
        </div>
      )}

      {showBaseForm && (
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Base de logística</h3>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Nome (ex: Base Central)" value={baseForm.name} onChange={e => setBaseForm({ ...baseForm, name: e.target.value })} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm col-span-2" />
            <input placeholder="Endereço completo" value={baseForm.address} onChange={e => setBaseForm({ ...baseForm, address: e.target.value })} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm col-span-2" />
            <input placeholder="Latitude" value={baseForm.lat} onChange={e => setBaseForm({ ...baseForm, lat: e.target.value })} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm" />
            <input placeholder="Longitude" value={baseForm.lon} onChange={e => setBaseForm({ ...baseForm, lon: e.target.value })} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm" />
          </div>
          <p className="text-xs text-neutral-500 mt-2">Copie a latitude/longitude do Google Maps (botão direito no local → "O que há aqui?").</p>
          <div className="flex gap-2 mt-3">
            <button onClick={saveBase} className="px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-500 text-white font-medium">Salvar base</button>
            <button onClick={() => setShowBaseForm(false)} className="px-4 py-2 text-sm rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300">Cancelar</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div
          ref={fullscreenRef}
          className={`relative bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden ${isFullscreen ? 'flex flex-col' : ''}`}
        >
          <div ref={mapRef} style={isFullscreen ? { flex: 1 } : { height: 380 }} />
        </div>
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Paradas do dia</h3>
          {pins.length === 0 && <p className="text-sm text-neutral-500">Nenhum agendamento para esta data.</p>}
          <ul className="flex flex-col gap-2">
            {pins.map(({ appt, client }) => {
              const team = teamOf(appt.teamId);
              const names = formatTaskList(appt.taskIds, taskTypes);
              const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.address)}`;
              return (
                <li key={appt.id} className="flex items-start justify-between gap-3 border border-neutral-200 dark:border-neutral-800 rounded px-3 py-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: team.color }}></span>
                      <span className="text-sm font-medium">{client.name}</span>
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5">{client.address}</div>
                    {names && <div className="text-xs text-neutral-500">{names}</div>}
                    {!client.lat && <div className="text-[11px] text-neutral-500 dark:text-neutral-600 mt-0.5">sem coordenadas — não aparece no mapa</div>}
                  </div>
                  <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-neutral-500 hover:text-brand-400 shrink-0" title="Abrir no Google Maps">
                    <ExternalLink size={15}/>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {showSuggestion && (
        <WeekSuggestionModal
          clients={clients}
          appointments={appointments}
          taskTypes={taskTypes}
          base={base}
          setAppointments={setAppointments}
          onClose={() => setShowSuggestion(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SUGESTÃO DE ROTAS E AGENDAMENTOS DA SEMANA
// ---------------------------------------------------------------------------
const WORKDAY_BUDGET_MIN = 600; // 8:00 às 18:00
const AVG_SPEED_KMH = 35; // velocidade média assumida pra estimar deslocamento

function haversineKm(a, b){
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function travelMinutes(a, b){ return (haversineKm(a, b) / AVG_SPEED_KMH) * 60; }

function apptTaskMinutes(appt, taskTypes){
  let mins = 0;
  normalizeTasks(appt.taskIds).forEach(({ taskId, quantity }) => {
    const t = taskTypes.find(tt => tt.id === taskId);
    mins += (t?.estimatedMinutes || 60) * quantity;
  });
  if(mins === 0 && appt.items?.length){
    // Estimativa pelo catálogo: montagem/instalação e desmontagem/retirada por unidade; limpeza ~10 min por banheiro
    appt.items.forEach(i => {
      const p = PRODUCT_INDEX[i.productTypeId];
      const perUnit = ['entrega', 'montagem'].includes(appt.kind) ? (p?.setupMinutes ?? 30)
                    : ['retirada', 'desmontagem'].includes(appt.kind) ? (p?.teardownMinutes ?? 30)
                    : 10;
      mins += perUnit * (Number(i.quantity) || 1);
    });
  }
  return mins;
}

// Sugestão gulosa: preenche a Equipe 1 o máximo possível (rota mais próxima primeiro,
// dia a dia), depois passa o que sobrar pra Equipe 2, e assim por diante.
function computeWeekSuggestion(weekDates, appointments, clients, taskTypes, base){
  const clientById = {};
  clients.forEach(c => { clientById[c.id] = c; });

  const weekAppts = appointments.filter(a => weekDates.includes(a.date));
  const geolocated = weekAppts.filter(a => {
    const c = stopOf(a, clientById);
    return c && c.lat && c.lon;
  });
  const overflow = weekAppts
    .filter(a => { const c = stopOf(a, clientById); return !(c && c.lat && c.lon); })
    .map(a => a.id);

  let unassigned = [...geolocated];
  const baseLoc = (base?.lat && base?.lon) ? { lat: parseFloat(base.lat), lon: parseFloat(base.lon) } : null;

  const plan = {};
  TEAMS.forEach(team => {
    plan[team.id] = {};
    weekDates.forEach(d => { plan[team.id][d] = []; });
  });

  for(const team of TEAMS){
    for(const dKey of weekDates){
      let currentPos = baseLoc;
      let budget = WORKDAY_BUDGET_MIN;
      while(unassigned.length > 0){
        if(!currentPos){
          const c0 = stopOf(unassigned[0], clientById);
          currentPos = { lat: parseFloat(c0.lat), lon: parseFloat(c0.lon) };
        }
        let bestIdx = -1, bestTravel = Infinity;
        unassigned.forEach((a, i) => {
          const c = stopOf(a, clientById);
          const loc = { lat: parseFloat(c.lat), lon: parseFloat(c.lon) };
          const travel = travelMinutes(currentPos, loc);
          if(travel < bestTravel){ bestTravel = travel; bestIdx = i; }
        });
        if(bestIdx === -1) break;
        const candidate = unassigned[bestIdx];
        const needed = bestTravel + apptTaskMinutes(candidate, taskTypes);
        if(needed > budget) break; // não cabe mais nesse dia, passa pro próximo dia/equipe
        plan[team.id][dKey].push(candidate.id);
        budget -= needed;
        const c = stopOf(candidate, clientById);
        currentPos = { lat: parseFloat(c.lat), lon: parseFloat(c.lon) };
        unassigned.splice(bestIdx, 1);
      }
    }
  }

  return { plan, overflow: [...overflow, ...unassigned.map(a => a.id)] };
}

function WeekSuggestionModal({ clients, appointments, taskTypes, base, setAppointments, onClose }){
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const weekDates = Array.from({ length: 5 }, (_, i) => dateKeyFromDate(addDays(weekStart, i)));
  const [plan, setPlan] = useState(null);
  const [overflow, setOverflow] = useState([]);
  const [originalPlan, setOriginalPlan] = useState(null);
  const [originalOverflow, setOriginalOverflow] = useState([]);
  const [dragging, setDragging] = useState(null); // { apptId, fromTeam, fromDay } | { apptId, fromOverflow: true }
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState('');

  const [leafletReady, setLeafletReady] = useState(false);
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const [mapRoutes, setMapRoutes] = useState(null); // { [dateKey]: { [teamId]: { distance, duration, geometry } } }
  const [calculatingRoutes, setCalculatingRoutes] = useState(false);
  const [routeCalcStatus, setRouteCalcStatus] = useState('');
  const [mapDay, setMapDay] = useState(weekDates[0]);

  useEffect(() => {
    if(window.L){ setLeafletReady(true); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    script.onload = () => setLeafletReady(true);
    document.body.appendChild(script);
  }, []);

  const clientById = {};
  clients.forEach(c => { clientById[c.id] = c; });
  const appointmentById = {};
  appointments.forEach(a => { appointmentById[a.id] = a; });

  const goPrevWeek = () => { setWeekStart(d => addDays(d, -7)); setPlan(null); setOverflow([]); };
  const goNextWeek = () => { setWeekStart(d => addDays(d, 7)); setPlan(null); setOverflow([]); };

  const generate = () => {
    const result = computeWeekSuggestion(weekDates, appointments, clients, taskTypes, base);
    setPlan(result.plan);
    setOverflow(result.overflow);
    setOriginalPlan(result.plan);
    setOriginalOverflow(result.overflow);
    setApplyMessage('');
    setMapRoutes(null);
  };

  const undoChanges = () => {
    if(!originalPlan) return;
    setPlan(originalPlan);
    setOverflow(originalOverflow);
    setApplyMessage('');
  };

  const hasUnsavedEdits = plan && originalPlan && JSON.stringify(plan) !== JSON.stringify(originalPlan);

  const computeRoutesForPlan = async () => {
    if(!base?.lat || !base?.lon || !plan) return;
    setCalculatingRoutes(true);
    setRouteCalcStatus('');
    const newMapRoutes = {};
    weekDates.forEach(d => { newMapRoutes[d] = {}; });

    for(const team of TEAMS){
      for(const dKey of weekDates){
        const apptIds = plan[team.id][dKey];
        if(apptIds.length === 0) continue;
        setRouteCalcStatus(`Calculando: ${team.name} — ${formatDateLabel(dKey)}...`);
        const stops = apptIds.map(id => {
          const c = stopOf(appointmentById[id], clientById);
          return { lat: parseFloat(c.lat), lon: parseFloat(c.lon) };
        });
        const coordsAll = [{ lat: parseFloat(base.lat), lon: parseFloat(base.lon) }, ...stops];
        const coordStr = coordsAll.map(p => `${p.lon},${p.lat}`).join(';');
        const tripUrl = `https://router.project-osrm.org/trip/v1/driving/${coordStr}?source=first&roundtrip=true&geometries=geojson&overview=full`;
        try{
          const res = await fetch(tripUrl);
          const data = await res.json();
          if(data.code === 'Ok'){
            const trip = data.trips[0];
            newMapRoutes[dKey][team.id] = { distance: trip.distance, duration: trip.duration, geometry: trip.geometry };
          }else{
            newMapRoutes[dKey][team.id] = { error: true };
          }
        }catch(err){
          newMapRoutes[dKey][team.id] = { error: true };
        }
        await new Promise(r => setTimeout(r, 200));
      }
    }
    setMapRoutes(newMapRoutes);
    setRouteCalcStatus('Rotas calculadas.');
    setCalculatingRoutes(false);
  };

  const moveAppt = (apptId, toTeam, toDay) => {
    setPlan(prev => {
      const next = {};
      TEAMS.forEach(t => { next[t.id] = {}; weekDates.forEach(d => { next[t.id][d] = prev[t.id][d].filter(id => id !== apptId); }); });
      if(toTeam && toDay) next[toTeam][toDay] = [...next[toTeam][toDay], apptId];
      return next;
    });
    setOverflow(prev => {
      const withoutIt = prev.filter(id => id !== apptId);
      return (toTeam && toDay) ? withoutIt : [...withoutIt, apptId];
    });
    setMapRoutes(null);
  };

  const cellMinutes = (teamId, dKey) => {
    if(!plan) return 0;
    return plan[teamId][dKey].reduce((sum, apptId) => sum + apptTaskMinutes(appointmentById[apptId], taskTypes), 0);
  };

  const applySuggestion = async () => {
    if(!plan) return;
    const changes = [];
    TEAMS.forEach(team => {
      weekDates.forEach(dKey => {
        plan[team.id][dKey].forEach(apptId => {
          const appt = appointmentById[apptId];
          if(appt && (appt.teamId !== team.id || appt.date !== dKey)){
            changes.push({ appt, newTeamId: team.id, newDate: dKey });
          }
        });
      });
    });
    if(changes.length === 0){
      setApplyMessage('Nenhuma mudança pra aplicar — já está tudo como sugerido.');
      return;
    }
    if(!window.confirm(`Isso vai mover ${changes.length} agendamento(s) de equipe/dia. Confirma?`)) return;
    setApplying(true);
    try{
      for(const { appt, newTeamId, newDate } of changes){
        const updated = { ...appt, teamId: newTeamId, date: newDate };
        await api.appointments.update(appt.id, updated);
        setAppointments(prev => prev.map(a => a.id === appt.id ? updated : a));
      }
      setApplyMessage(`${changes.length} agendamento(s) atualizado(s) com sucesso.`);
      setOriginalPlan(plan);
      setOriginalOverflow(overflow);
    }catch(err){
      setApplyMessage('Ocorreu um erro ao salvar algumas mudanças — confira a agenda.');
    }
    setApplying(false);
  };

  useEffect(() => {
    if(!leafletReady || !mapRef.current) return;
    const L = window.L;
    if(!mapInstance.current){
      mapInstance.current = L.map(mapRef.current).setView([-20.1436, -44.8891], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
      }).addTo(mapInstance.current);
    }
    const map = mapInstance.current;
    map.eachLayer(layer => { if(layer instanceof L.Marker || layer instanceof L.Polyline || layer instanceof L.GeoJSON) map.removeLayer(layer); });

    const group = L.featureGroup();
    let hasAny = false;

    if(base?.lat && base?.lon){
      const baseIcon = L.divIcon({
        className: '',
        html: `<div style="background:#171717;width:24px;height:24px;border-radius:6px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:white;font-size:12px;">🏠</div>`,
        iconSize: [24,24], iconAnchor: [12,12],
      });
      L.marker([parseFloat(base.lat), parseFloat(base.lon)], { icon: baseIcon, zIndexOffset: 1000 }).addTo(group);
      hasAny = true;
    }

    if(plan){
      TEAMS.forEach(team => {
        const apptIds = plan[team.id][mapDay] || [];
        apptIds.forEach(apptId => {
          const appt = appointmentById[apptId];
          const c = stopOf(appt, clientById);
          if(!c || !c.lat || !c.lon) return;
          const icon = L.divIcon({ className: '', html: `<div style="background:${team.color};width:18px;height:18px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`, iconSize: [18,18], iconAnchor: [9,9] });
          L.marker([parseFloat(c.lat), parseFloat(c.lon)], { icon })
            .bindPopup(`<b>${escapeHtml(c.name)}</b><br><span style="color:${team.color}">${escapeHtml(team.name)}</span>`)
            .addTo(group);
          hasAny = true;
        });

        const r = mapRoutes?.[mapDay]?.[team.id];
        if(r && !r.error){
          L.geoJSON(r.geometry, { style: { color: team.color, weight: 4, opacity: 0.85 } })
            .bindPopup(`<b>${team.name}</b><br>${(r.distance/1000).toFixed(1)} km · ${Math.round(r.duration/60)} min`)
            .addTo(group);
          hasAny = true;
        }
      });
    }

    if(hasAny){
      group.addTo(map);
      try{ map.fitBounds(group.getBounds(), { padding: [30,30] }); }catch(e){}
    }
  }, [leafletReady, plan, mapRoutes, mapDay, base]);

  const AppointmentChip = ({ apptId, fromTeam, fromDay }) => {
    const appt = appointmentById[apptId];
    if(!appt) return null;
    const client = stopOf(appt, clientById);
    const mins = apptTaskMinutes(appt, taskTypes);
    return (
      <div
        draggable
        onDragStart={() => setDragging({ apptId, fromTeam, fromDay })}
        onDragEnd={() => setDragging(null)}
        className="bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded px-2 py-1.5 text-[11px] cursor-grab active:cursor-grabbing"
        title={`${client?.name || 'Cliente removido'} — ~${mins} min`}
      >
        <div className="font-medium truncate">{client?.name || '(cliente removido)'}</div>
        <div className="text-neutral-500 font-mono">~{mins} min</div>
      </div>
    );
  };

  const DropCell = ({ teamId, dKey }) => {
    const mins = cellMinutes(teamId, dKey);
    const over = mins > WORKDAY_BUDGET_MIN;
    return (
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if(dragging) moveAppt(dragging.apptId, teamId, dKey); }}
        className={`min-h-[70px] border rounded p-1.5 flex flex-col gap-1 ${over ? 'border-red-400 bg-red-50 dark:bg-red-950/20' : 'border-neutral-200 dark:border-neutral-800'}`}
      >
        {plan[teamId][dKey].map(apptId => (
          <AppointmentChip key={apptId} apptId={apptId} fromTeam={teamId} fromDay={dKey} />
        ))}
        <div className={`text-[10px] font-mono mt-auto ${over ? 'text-red-500' : 'text-neutral-400'}`}>
          {mins} / {WORKDAY_BUDGET_MIN} min
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg w-full max-w-6xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="font-medium">Sugestão de rotas e agendamentos da semana</h3>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"><X size={18}/></button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={goPrevWeek} className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500"><ChevronLeft size={18}/></button>
            <span className="text-sm font-medium">
              {formatDateLabel(weekDates[0]).split(', ')[1]} – {formatDateLabel(weekDates[4]).split(', ')[1]}
            </span>
            <button onClick={goNextWeek} className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500"><ChevronRight size={18}/></button>
            <button onClick={generate} className="px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-500 text-white font-medium">
              Gerar sugestão
            </button>
            {plan && (
              <button
                onClick={undoChanges}
                disabled={!hasUnsavedEdits}
                className="px-4 py-2 text-sm rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 font-medium"
              >
                Desfazer alterações
              </button>
            )}
            {plan && (
              <button onClick={applySuggestion} disabled={applying} className="px-4 py-2 text-sm rounded border border-brand-500 text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/30 disabled:opacity-50 font-medium">
                {applying ? 'Aplicando...' : 'Aplicar à agenda'}
              </button>
            )}
          </div>

          {!base?.lat && (
            <p className="text-xs text-amber-700 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded p-2">
              Defina a base (com latitude/longitude) na aba Mapa antes de gerar — sem ela não dá pra calcular deslocamento.
            </p>
          )}
          {plan && hasUnsavedEdits && (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              ⚠ Você ajustou as rotas na tela — isso ainda não mudou a agenda de verdade. Clique em "Aplicar à agenda" pra confirmar, ou "Desfazer alterações" pra voltar à sugestão original.
            </p>
          )}
          {applyMessage && <p className="text-xs text-brand-600 dark:text-brand-400">{applyMessage}</p>}

          <p className="text-[11px] text-neutral-500">
            Isso é uma sugestão automática (rota mais próxima primeiro, jornada até as 18h, cadastro de tempo de execução por tarefa).
            Arraste os cartões entre os quadros pra ajustar do seu jeito — isso só muda o que aparece aqui na tela.
            Nada é salvo na agenda de verdade até você clicar em "Aplicar à agenda".
            O tempo mostrado em cada quadro é só a soma das tarefas; não recalcula o deslocamento depois de um ajuste manual.
          </p>

          {plan && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={computeRoutesForPlan}
                  disabled={calculatingRoutes || !base?.lat}
                  className="flex items-center gap-1.5 text-xs font-mono px-3 py-2 rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-medium"
                >
                  <Route size={14}/> {calculatingRoutes ? 'Calculando rotas...' : 'Calcular rotas no mapa'}
                </button>
                {weekDates.map(d => (
                  <button
                    key={d}
                    onClick={() => setMapDay(d)}
                    className={`text-xs font-mono px-3 py-1.5 rounded border ${mapDay === d ? 'border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400' : 'border-neutral-300 dark:border-neutral-700 text-neutral-500'}`}
                  >
                    {formatDateLabel(d).split(', ')[0].slice(0, 3)} {d.slice(8, 10)}
                  </button>
                ))}
              </div>
              {routeCalcStatus && <p className="text-xs font-mono text-neutral-500">{routeCalcStatus}</p>}
              {!mapRoutes && (
                <p className="text-[11px] text-neutral-500">
                  Depois de ajustar as rotas do jeito que quiser, clica em "Calcular rotas no mapa" pra ver o desenho de verdade (com ruas), dia por dia.
                </p>
              )}
              <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
                <div ref={mapRef} style={{ height: 320 }} />
              </div>
            </div>
          )}

          {plan && (
            <div className="overflow-x-auto">
              <table className="w-full border-separate" style={{ borderSpacing: '6px' }}>
                <thead>
                  <tr>
                    <th className="text-left text-xs font-mono uppercase text-neutral-500 w-24">Equipe</th>
                    {weekDates.map(d => (
                      <th key={d} className="text-left text-xs font-mono uppercase text-neutral-500">
                        {formatDateLabel(d).split(', ')[0].slice(0, 3)} {d.slice(8, 10)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TEAMS.map(team => (
                    <tr key={team.id}>
                      <td className="align-top">
                        <span className="text-xs font-medium px-2 py-1 rounded" style={{ background: team.bg, color: team.text }}>
                          {team.name.replace('Equipe ', '')}
                        </span>
                      </td>
                      {weekDates.map(d => (
                        <td key={d} className="align-top w-40">
                          <DropCell teamId={team.id} dKey={d} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {plan && (
            <div>
              <p className="text-xs font-mono uppercase text-neutral-500 mb-2">
                Não coube na semana ({overflow.length})
              </p>
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); if(dragging) moveAppt(dragging.apptId, null, null); }}
                className="min-h-[60px] border-2 border-dashed border-neutral-300 dark:border-neutral-700 rounded p-2 flex flex-wrap gap-2"
              >
                {overflow.length === 0 && <p className="text-xs text-neutral-500">Nenhum — a semana toda coube na sugestão.</p>}
                {overflow.map(apptId => (
                  <div key={apptId} className="w-40">
                    <AppointmentChip apptId={apptId} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {!plan && (
            <p className="text-sm text-neutral-500">Clique em "Gerar sugestão" pra ver a proposta dessa semana.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AUTENTICAÇÃO
// ---------------------------------------------------------------------------
function AuthScreen({ onSuccess, theme, onToggleTheme }){
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('gerente');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError('');
    if(!email.trim() || !password.trim() || (mode === 'register' && !name.trim())){
      setError('Preencha todos os campos.');
      return;
    }
    setLoading(true);
    try{
      const result = mode === 'login'
        ? await api.auth.login({ email: email.trim(), password })
        : await api.auth.register({ name: name.trim(), email: email.trim(), password, role });
      onSuccess(result);
    }catch(err){
      setError(err.message || 'Não foi possível entrar.');
    }
    setLoading(false);
  };

  return (
    <div className={`relative w-full min-h-screen flex items-center justify-center bg-neutral-100 dark:bg-neutral-950 p-6 ${theme === 'dark' ? 'dark' : ''}`}>
      {onToggleTheme && (
        <button
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
          aria-label={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
          className="absolute top-4 right-4 p-2 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800"
        >
          {theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}
        </button>
      )}
      <div className="w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-6">
        <img src="/logo.png" alt="Logo da empresa" className="h-20 w-auto mb-4" />
        <div className="text-xs font-mono uppercase tracking-widest text-brand-500 mb-1">Plataforma de logística</div>
        <h1 className="text-xl font-semibold mb-5 text-neutral-900 dark:text-neutral-50">
          {mode === 'login' ? 'Entrar' : 'Criar conta'}
        </h1>

        <div className="flex flex-col gap-3">
          {mode === 'register' && (
            <input
              placeholder="Nome completo"
              value={name}
              onChange={e => setName(e.target.value)}
              className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm"
            />
          )}
          <input
            placeholder="E-mail"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm"
          />
          <input
            placeholder="Senha"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if(e.key === 'Enter') submit(); }}
            className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm"
          />
          {mode === 'register' && (
            <div>
              <label className="text-xs font-mono uppercase text-neutral-500 mb-1 block">Cargo</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRole('gerente')}
                  className={`flex-1 px-3 py-2 rounded text-sm border-2 ${role === 'gerente' ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/20' : 'border-neutral-200 dark:border-neutral-700'}`}
                >
                  Gerente de Logística
                </button>
                <button
                  type="button"
                  onClick={() => setRole('admin')}
                  className={`flex-1 px-3 py-2 rounded text-sm border-2 ${role === 'admin' ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/20' : 'border-neutral-200 dark:border-neutral-700'}`}
                >
                  Administrador
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            onClick={submit}
            disabled={loading}
            className="mt-1 px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-medium"
          >
            {loading ? 'Enviando...' : (mode === 'login' ? 'Entrar' : 'Criar conta')}
          </button>

          <button
            type="button"
            onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); setError(''); }}
            className="text-xs text-neutral-500 hover:text-brand-500 mt-1"
          >
            {mode === 'login' ? 'Não tem conta? Criar uma agora' : 'Já tem conta? Entrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AUDITORIA
// ---------------------------------------------------------------------------
const ACTION_LABELS = {
  create: 'Criou', update: 'Atualizou', delete: 'Excluiu', login: 'Entrou', register: 'Criou conta',
};
const ENTITY_LABELS = {
  client: 'cliente', task_type: 'tarefa', appointment: 'agendamento',
  team_member: 'integrante de equipe', settings: 'configuração', auth: 'conta',
  rental: 'locação', asset: 'unidade', product_type: 'produto', site: 'local',
};

function AuditoriaTab(){
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try{
        const rows = await api.auditLog.list();
        setLogs(rows);
      }catch(err){
        setError('Não foi possível carregar o histórico.');
      }
    })();
  }, []);

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
        <h3 className="text-sm font-medium">Histórico de ações</h3>
        <p className="text-xs text-neutral-500 mt-1">Quem fez o quê, e quando — últimas 200 ações.</p>
      </div>
      {error && <p className="text-xs text-red-500 p-4">{error}</p>}
      {!logs && !error && <p className="text-xs text-neutral-500 p-4 font-mono">Carregando...</p>}
      {logs && logs.length === 0 && <p className="text-sm text-neutral-500 p-4">Nenhuma ação registrada ainda.</p>}
      {logs && logs.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-neutral-500 font-mono uppercase">
              <th className="px-4 py-2">Quando</th>
              <th className="px-4 py-2">Quem</th>
              <th className="px-4 py-2">Ação</th>
              <th className="px-4 py-2">Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-4 py-2 font-mono text-neutral-500 whitespace-nowrap">
                  {new Date(log.created_at).toLocaleString('pt-BR')}
                </td>
                <td className="px-4 py-2">
                  {log.user_name} <span className="text-neutral-500">({log.user_role === 'admin' ? 'Admin' : 'Gerente'})</span>
                </td>
                <td className="px-4 py-2">
                  {ACTION_LABELS[log.action] || log.action} {ENTITY_LABELS[log.entity] || log.entity}
                </td>
                <td className="px-4 py-2 text-neutral-500">{log.entity_label || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RELATÓRIOS (por semana ou por mês, por equipe)
// ---------------------------------------------------------------------------
function RelatoriosTab({ clients, appointments, taskTypes, base }){
  const now = new Date();
  const [period, setPeriod] = useState('semana'); // 'semana' | 'mes'

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const weekDates = Array.from({ length: 5 }, (_, i) => dateKeyFromDate(addDays(weekStart, i)));

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthDates = Array.from({ length: daysInMonth }, (_, i) => fmtDateKey(year, month, i + 1));

  const activeDates = period === 'semana' ? weekDates : monthDates;

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [report, setReport] = useState(null);

  const clearReport = () => { setReport(null); setWarnings([]); setStatus(''); };
  const goPrevWeek = () => { setWeekStart(d => addDays(d, -7)); clearReport(); };
  const goNextWeek = () => { setWeekStart(d => addDays(d, 7)); clearReport(); };
  const jumpToWeekDate = (dateStr) => {
    if(!dateStr) return;
    const [y, m, d] = dateStr.split('-').map(Number);
    setWeekStart(mondayOf(new Date(y, m - 1, d)));
    clearReport();
  };
  const prevMonth = () => { if(month === 0){ setMonth(11); setYear(y => y-1); } else setMonth(m => m-1); clearReport(); };
  const nextMonth = () => { if(month === 11){ setMonth(0); setYear(y => y+1); } else setMonth(m => m+1); clearReport(); };
  const jumpToMonthDate = (dateStr) => {
    if(!dateStr) return;
    const [y, m] = dateStr.split('-').map(Number);
    setYear(y); setMonth(m - 1);
    clearReport();
  };

  const computeOpenTrip = async (entryPoint, stops, endAtBase) => {
    try{
      const coordsAll = endAtBase
        ? [entryPoint, ...stops, { lat: parseFloat(base.lat), lon: parseFloat(base.lon) }]
        : [entryPoint, ...stops];
      const coordStr = coordsAll.map(p => `${p.lon},${p.lat}`).join(';');
      const destParam = endAtBase ? 'last' : 'any';
      const tripUrl = `https://router.project-osrm.org/trip/v1/driving/${coordStr}?source=first&destination=${destParam}&roundtrip=false&overview=false`;
      const res = await fetch(tripUrl);
      const data = await res.json();
      if(data.code !== 'Ok') throw new Error(data.code);
      const trip = data.trips[0];
      const orderedIdx = new Array(coordsAll.length);
      data.waypoints.forEach((wp, inputIdx) => { orderedIdx[wp.waypoint_index] = inputIdx; });
      const lastPoint = coordsAll[orderedIdx[orderedIdx.length - 1]];
      return { distance: trip.distance, exitPoint: lastPoint, error: false };
    }catch(err){
      return { distance: 0, exitPoint: entryPoint, error: true };
    }
  };

  const generate = async () => {
    setLoading(true);
    setStatus('');
    const newWarnings = [];
    const newReport = {};

    for(const team of TEAMS){
      newReport[team.id] = { km: 0, appointmentsCount: 0, taskCounts: {}, routeError: false };

      for(const dKey of activeDates){
        const dayTeamAppts = appointments.filter(a => a.date === dKey && a.teamId === team.id);
        newReport[team.id].appointmentsCount += dayTeamAppts.length;
        dayTeamAppts.forEach(a => {
          normalizeTasks(a.taskIds).forEach(({ taskId, quantity }) => {
            const t = taskTypes.find(tt => tt.id === taskId);
            const name = t ? t.name : 'Tarefa removida';
            newReport[team.id].taskCounts[name] = (newReport[team.id].taskCounts[name] || 0) + quantity;
          });
        });
      }

      if(!base?.lat || !base?.lon) continue;

      const teamDays = [];
      for(const dKey of activeDates){
        const dayTeamAppts = appointments.filter(a => a.date === dKey && a.teamId === team.id);
        if(dayTeamAppts.length === 0) continue;
        const stopsRaw = dayTeamAppts.map(a => ({ appt: a, client: stopOf(a, clients) }));
        const stops = stopsRaw.filter(p => p.client && p.client.lat && p.client.lon)
          .map(p => ({ lat: parseFloat(p.client.lat), lon: parseFloat(p.client.lon) }));
        const missing = stopsRaw.filter(p => p.client && (!p.client.lat || !p.client.lon));
        missing.forEach(p => newWarnings.push(`${p.client.name} (${formatDateLabel(dKey)}, ${team.name}) — sem coordenadas`));
        if(stops.length > 0) teamDays.push({ dateKey: dKey, stops });
      }

      let entryPoint = { lat: parseFloat(base.lat), lon: parseFloat(base.lon) };
      for(let i = 0; i < teamDays.length; i++){
        const { dateKey: dKey, stops } = teamDays[i];
        const isLastWorkingDay = i === teamDays.length - 1;
        setStatus(`Calculando KM: ${team.name} — ${formatDateLabel(dKey)}... (${i + 1}/${teamDays.length} dias)`);
        const result = await computeOpenTrip(entryPoint, stops, isLastWorkingDay);
        if(result.error) newReport[team.id].routeError = true;
        newReport[team.id].km += result.distance / 1000;
        entryPoint = result.exitPoint;
        await new Promise(r => setTimeout(r, 250));
      }
    }

    setReport(newReport);
    setWarnings(newWarnings);
    setStatus('Relatório gerado.');
    setLoading(false);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => { setPeriod('semana'); clearReport(); }}
            className={`text-xs font-mono px-3 py-1.5 rounded border ${period === 'semana' ? 'border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400' : 'border-neutral-300 dark:border-neutral-700 text-neutral-500'}`}
          >
            Por semana
          </button>
          <button
            onClick={() => { setPeriod('mes'); clearReport(); }}
            className={`text-xs font-mono px-3 py-1.5 rounded border ${period === 'mes' ? 'border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400' : 'border-neutral-300 dark:border-neutral-700 text-neutral-500'}`}
          >
            Por mês
          </button>
        </div>

        {period === 'semana' && (
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <button onClick={goPrevWeek} className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500">
              <ChevronLeft size={18}/>
            </button>
            <span className="text-sm font-medium">
              {formatDateLabel(weekDates[0]).split(', ')[1]} – {formatDateLabel(weekDates[4]).split(', ')[1]}
            </span>
            <button onClick={goNextWeek} className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500">
              <ChevronRight size={18}/>
            </button>
            <input
              type="date"
              value={weekDates[0]}
              onChange={e => jumpToWeekDate(e.target.value)}
              className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-2 py-1.5 text-xs"
              title="Pular para a semana que contém esta data"
            />
          </div>
        )}

        {period === 'mes' && (
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <button onClick={prevMonth} className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500">
              <ChevronLeft size={18}/>
            </button>
            <span className="text-sm font-medium w-40 text-center">
              {MONTHS_PT[month]} {year}
            </span>
            <button onClick={nextMonth} className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500">
              <ChevronRight size={18}/>
            </button>
            <input
              type="date"
              value={monthDates[0]}
              onChange={e => jumpToMonthDate(e.target.value)}
              className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-2 py-1.5 text-xs"
              title="Pular para o mês que contém esta data"
            />
          </div>
        )}

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-sm font-medium">Relatório {period === 'semana' ? 'semanal' : 'mensal'} por equipe</h3>
            <p className="text-xs text-neutral-500 mt-1">
              KM percorrido (rota planejada) e tarefas executadas {period === 'semana' ? 'na semana selecionada, segunda a sexta.' : 'no mês inteiro.'}
            </p>
          </div>
          <button
            onClick={generate}
            disabled={loading}
            className="px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-medium flex items-center gap-2"
          >
            <FileBarChart size={15}/> {loading ? 'Calculando...' : 'Gerar relatório'}
          </button>
        </div>
        {status && <p className="text-xs font-mono text-neutral-500 mt-3">{status}</p>}
        {!base?.lat && (
          <p className="text-xs text-amber-700 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded p-2 mt-3">
            Base não definida (com latitude/longitude) — o relatório vai mostrar as tarefas executadas, mas não vai calcular KM. Defina a base na aba Mapa.
          </p>
        )}
        {warnings.length > 0 && (
          <div className="mt-3 text-xs text-amber-700 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded p-2 max-h-40 overflow-y-auto">
            <b>{warnings.length} parada(s) ignorada(s) no cálculo de KM por falta de coordenadas:</b>
            <ul className="list-disc list-inside mt-1">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
        <p className="text-[11px] text-neutral-500 mt-3">
          O KM é calculado com base na rota planejada/otimizada, não no rastreamento real do veículo.
          {period === 'mes' && ' Meses com muitos dias de trabalho podem levar um pouco mais pra calcular.'}
        </p>
      </div>

      {!report && !loading && (
        <p className="text-sm text-neutral-500">Clique em "Gerar relatório" para ver o resumo do período selecionado.</p>
      )}

      {report && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TEAMS.map(team => {
            const r = report[team.id];
            const taskEntries = Object.entries(r.taskCounts).sort((a, b) => b[1] - a[1]);
            return (
              <div key={team.id} className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
                <div className="h-1.5" style={{ background: team.color }} />
                <div className="p-4">
                  <h3 className="text-sm font-medium mb-3">{team.name}</h3>

                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded p-2 text-center">
                      <div className="text-lg font-semibold">{r.km > 0 ? r.km.toFixed(1) : (base?.lat ? '0.0' : '—')}</div>
                      <div className="text-[10px] font-mono uppercase text-neutral-500">km {period === 'semana' ? 'na semana' : 'no mês'}</div>
                    </div>
                    <div className="bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded p-2 text-center">
                      <div className="text-lg font-semibold">{r.appointmentsCount}</div>
                      <div className="text-[10px] font-mono uppercase text-neutral-500">agendamentos</div>
                    </div>
                  </div>

                  {r.routeError && (
                    <p className="text-[11px] text-red-500 mb-2">Falha ao calcular parte da rota — o KM pode estar incompleto.</p>
                  )}

                  <p className="text-xs font-mono uppercase text-neutral-500 mb-1.5">Tarefas executadas</p>
                  {taskEntries.length === 0 && <p className="text-xs text-neutral-500">Nenhuma tarefa registrada nesse período.</p>}
                  <ul className="flex flex-col gap-1">
                    {taskEntries.map(([name, count]) => (
                      <li key={name} className="flex items-center justify-between text-xs">
                        <span>{name}</span>
                        <span className="font-mono text-neutral-500">{count}x</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IMPORTAR CLIENTES DE PLANILHA
// ---------------------------------------------------------------------------
const IMPORT_FIELDS = [
  { key: 'name', label: 'Nome', required: true, candidates: ['nome', 'cliente', 'razaosocial', 'nomecompleto', 'name'] },
  { key: 'address', label: 'Endereço', required: false, candidates: ['endereco', 'enderecocompleto', 'address', 'rua', 'logradouro'] },
  { key: 'phone', label: 'Telefone', required: false, candidates: ['telefone', 'fone', 'celular', 'contato', 'whatsapp', 'phone'] },
  { key: 'lat', label: 'Latitude', required: false, candidates: ['latitude', 'lat'] },
  { key: 'lon', label: 'Longitude', required: false, candidates: ['longitude', 'lon', 'lng', 'long'] },
  { key: 'notes', label: 'Notas', required: false, candidates: ['notas', 'observacao', 'observacoes', 'obs', 'notes'] },
];

function normalizeHeader(s){
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function guessMapping(headers){
  const mapping = {};
  IMPORT_FIELDS.forEach(field => {
    const match = headers.find(h => field.candidates.includes(normalizeHeader(h)));
    mapping[field.key] = match || '';
  });
  return mapping;
}

function ImportClientsModal({ onClose, onImport }){
  const [step, setStep] = useState('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [error, setError] = useState('');
  const [importedCount, setImportedCount] = useState(0);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    setError('');
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try{
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const parsed = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if(parsed.length === 0){
          setError('A planilha parece estar vazia.');
          return;
        }
        const hdrs = Object.keys(parsed[0]);
        setHeaders(hdrs);
        setRows(parsed);
        setMapping(guessMapping(hdrs));
        setStep('map');
      }catch(err){
        setError('Não foi possível ler esse arquivo. Confira se é um .xlsx, .xls ou .csv válido.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const parseCoord = (v) => {
    if(v === undefined || v === null || v === '') return '';
    const n = parseFloat(String(v).trim().replace(',', '.'));
    return Number.isFinite(n) ? String(n) : '';
  };

  const mappedRows = rows.map(row => ({
    name: mapping.name ? String(row[mapping.name] || '').trim() : '',
    address: mapping.address ? String(row[mapping.address] || '').trim() : '',
    phone: mapping.phone ? String(row[mapping.phone] || '').trim() : '',
    lat: mapping.lat ? parseCoord(row[mapping.lat]) : '',
    lon: mapping.lon ? parseCoord(row[mapping.lon]) : '',
    notes: mapping.notes ? String(row[mapping.notes] || '').trim() : '',
  })).filter(r => r.name);

  const confirmImport = async () => {
    setStep('importing');
    try{
      const count = await onImport(mappedRows);
      setImportedCount(count);
      setStep('done');
    }catch(err){
      setError(err.message || 'Falha ao importar. Nada foi salvo.');
      setStep('map');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="font-medium">Importar clientes de planilha</h3>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"><X size={18}/></button>
        </div>

        <div className="p-5">
          {step === 'upload' && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Selecione um arquivo Excel (.xlsx, .xls) ou CSV com sua base de clientes. A primeira linha deve ter os nomes das colunas.
              </p>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile}
                className="text-sm file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-brand-600 file:text-white file:text-sm hover:file:bg-brand-500" />
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
          )}

          {step === 'map' && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {fileName} — {rows.length} linha(s) encontrada(s). Confira qual coluna corresponde a cada campo:
              </p>
              <div className="grid grid-cols-2 gap-3">
                {IMPORT_FIELDS.map(field => (
                  <div key={field.key}>
                    <label className="text-xs font-mono uppercase text-neutral-500 mb-1 block">
                      {field.label}{field.required && ' *'}
                    </label>
                    <select
                      value={mapping[field.key] || ''}
                      onChange={e => setMapping({ ...mapping, [field.key]: e.target.value })}
                      className="w-full bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-2 py-1.5 text-sm"
                    >
                      <option value="">Nenhuma coluna</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              {!mapping.name && <p className="text-xs text-red-500">Selecione a coluna do nome — é obrigatória.</p>}
              {error && <p className="text-xs text-red-500">{error}</p>}

              <div>
                <p className="text-xs font-mono uppercase text-neutral-500 mb-2">Pré-visualização ({mappedRows.length} cliente(s) válido(s))</p>
                <div className="border border-neutral-200 dark:border-neutral-800 rounded overflow-x-auto max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-neutral-500 font-mono uppercase bg-neutral-50 dark:bg-neutral-950">
                        <th className="px-3 py-2">Nome</th>
                        <th className="px-3 py-2">Endereço</th>
                        <th className="px-3 py-2">Telefone</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mappedRows.slice(0, 8).map((r, i) => (
                        <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                          <td className="px-3 py-1.5">{r.name}</td>
                          <td className="px-3 py-1.5 text-neutral-500">{r.address || '—'}</td>
                          <td className="px-3 py-1.5 text-neutral-500">{r.phone || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {mappedRows.length > 8 && (
                    <p className="text-[11px] text-neutral-500 px-3 py-1.5">e mais {mappedRows.length - 8}...</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 'importing' && (
            <p className="text-sm text-neutral-500 font-mono">Importando {mappedRows.length} cliente(s)...</p>
          )}

          {step === 'done' && (
            <p className="text-sm">{importedCount} cliente(s) importado(s) com sucesso.</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-neutral-200 dark:border-neutral-800">
          {step === 'map' && (
            <>
              <button onClick={() => setStep('upload')} className="px-3 py-2 text-sm rounded border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300">Voltar</button>
              <button
                onClick={confirmImport}
                disabled={!mapping.name || mappedRows.length === 0}
                className="px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white font-medium"
              >
                Importar {mappedRows.length} cliente(s)
              </button>
            </>
          )}
          {(step === 'upload' || step === 'done') && (
            <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-500 text-white font-medium">
              {step === 'done' ? 'Concluir' : 'Cancelar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// USUÁRIOS (somente admin)
// ---------------------------------------------------------------------------
function UsuariosTab(){
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('gerente');
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const loadUsers = async () => {
    try{
      const rows = await api.auth.listUsers();
      setUsers(rows);
    }catch(err){
      setLoadError('Não foi possível carregar a lista de usuários.');
    }
  };

  useEffect(() => { loadUsers(); }, []);

  const submit = async () => {
    setFormError(''); setSuccess('');
    if(!name.trim() || !email.trim() || !password.trim()){
      setFormError('Preencha nome, e-mail e senha.');
      return;
    }
    setLoading(true);
    try{
      await api.auth.register({ name: name.trim(), email: email.trim(), password, role });
      setSuccess(`Conta criada para ${name.trim()}.`);
      setName(''); setEmail(''); setPassword(''); setRole('gerente');
      loadUsers();
    }catch(err){
      setFormError(err.message || 'Não foi possível criar a conta.');
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
        <h3 className="text-sm font-medium mb-1">Criar novo usuário</h3>
        <p className="text-xs text-neutral-500 mb-3">Somente administradores podem cadastrar novas contas.</p>
        <div className="grid grid-cols-2 gap-3">
          <input placeholder="Nome completo" value={name} onChange={e => setName(e.target.value)} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm col-span-2" />
          <input placeholder="E-mail" type="email" value={email} onChange={e => setEmail(e.target.value)} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm" />
          <input placeholder="Senha (mín. 6 caracteres)" type="password" value={password} onChange={e => setPassword(e.target.value)} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm" />
          <div className="col-span-2 flex gap-2">
            <button
              type="button"
              onClick={() => setRole('gerente')}
              className={`flex-1 px-3 py-2 rounded text-sm border-2 ${role === 'gerente' ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/20' : 'border-neutral-200 dark:border-neutral-700'}`}
            >
              Gerente de Logística
            </button>
            <button
              type="button"
              onClick={() => setRole('admin')}
              className={`flex-1 px-3 py-2 rounded text-sm border-2 ${role === 'admin' ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/20' : 'border-neutral-200 dark:border-neutral-700'}`}
            >
              Administrador
            </button>
          </div>
        </div>
        {formError && <p className="text-xs text-red-500 mt-2">{formError}</p>}
        {success && <p className="text-xs text-green-600 mt-2">{success}</p>}
        <button onClick={submit} disabled={loading} className="mt-3 px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-medium">
          {loading ? 'Criando...' : '+ Criar conta'}
        </button>
      </div>

      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="text-sm font-medium">Contas cadastradas</h3>
        </div>
        {loadError && <p className="text-xs text-red-500 p-4">{loadError}</p>}
        {!users && !loadError && <p className="text-xs text-neutral-500 p-4 font-mono">Carregando...</p>}
        {users && users.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-neutral-500 font-mono uppercase">
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">E-mail</th>
                <th className="px-4 py-2">Cargo</th>
                <th className="px-4 py-2">Desde</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-4 py-2">{u.name}</td>
                  <td className="px-4 py-2 text-neutral-500">{u.email}</td>
                  <td className="px-4 py-2">{u.role === 'admin' ? 'Administrador' : 'Gerente de Logística'}</td>
                  <td className="px-4 py-2 text-neutral-500">{new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
