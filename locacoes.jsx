import React, { useState, useEffect, useMemo } from 'react';
import { Plus, X, Trash2, Edit2, MapPinned, AlertTriangle, Check, Search } from 'lucide-react';
import { api } from './api.js';
import {
  TEAMS, teamOf, kindLabel, CATEGORY_LABEL, RENTAL_STATUS, APPT_STATUS,
  fmtBRL, fmtDate, fmtShort, daysInclusive, ui,
} from './constants.js';

// ---------------------------------------------------------------------------
// Peças reaproveitadas
// ---------------------------------------------------------------------------
export function Modal({ title, onClose, children, footer, size = 'md' }){
  const width = { md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-3xl' }[size];
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className={`bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg w-full ${width} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="font-medium min-w-0">{title}</div>
          <button onClick={onClose} aria-label="Fechar" className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 shrink-0"><X size={18}/></button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-neutral-200 dark:border-neutral-800">{footer}</div>}
      </div>
    </div>
  );
}

export function StatusBadge({ meta }){
  if(!meta) return null;
  return <span className={`${ui.badge} ${meta.cls}`}>{meta.label}</span>;
}

function ShortagesBox({ shortages, title }){
  if(!shortages || shortages.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
      <p className="font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1.5 mb-1">
        <AlertTriangle size={14}/> {title || 'Falta estoque para essas datas'}
      </p>
      <ul className="text-amber-800 dark:text-amber-300 text-xs flex flex-col gap-0.5">
        {shortages.map(s => (
          <li key={s.productTypeId}>{s.name}: pedido {s.requested}, livres {s.available}</li>
        ))}
      </ul>
    </div>
  );
}

function itemsSummary(items){
  return (items || []).map(i => `${i.quantity}× ${i.name}`).join(', ');
}

const FILTERS = [
  { id: 'ativas', label: 'Ativas', status: 'orcamento,confirmado,em_andamento' },
  { id: 'orcamento', label: 'Orçamentos', status: 'orcamento' },
  { id: 'em_andamento', label: 'Em andamento', status: 'em_andamento' },
  { id: 'encerrado', label: 'Encerradas', status: 'encerrado' },
  { id: 'todas', label: 'Todas', status: null },
];

// ---------------------------------------------------------------------------
// ABA LOCAÇÕES
// ---------------------------------------------------------------------------
export function LocacoesTab({ clients, productTypes, sites, setSites, reloadAppointments }){
  const [filter, setFilter] = useState('ativas');
  const [rentals, setRentals] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null);     // { rental } | { rental: null }
  const [detail, setDetail] = useState(null); // { id, shortages }
  const [showSites, setShowSites] = useState(false);

  const load = async () => {
    try{
      const status = FILTERS.find(f => f.id === filter)?.status;
      setRentals(await api.rentals.list(status ? { status } : {}));
      setLoadError('');
    }catch(err){
      setLoadError(err.message);
    }
  };
  useEffect(() => { setRentals(null); load(); }, [filter]);

  const afterChange = async () => { await load(); await reloadAppointments(); };

  const q = search.trim().toLowerCase();
  const visible = (rentals || []).filter(r =>
    !q || `${r.clientName} ${r.siteName || ''} ${r.siteAddress || ''} ${itemsSummary(r.items)}`.toLowerCase().includes(q)
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 flex-wrap" role="tablist">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} role="tab" aria-selected={filter === f.id}
              className={`text-xs font-mono px-3 py-1.5 rounded border ${filter === f.id
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400'
                : 'border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowSites(true)} className={`${ui.secondary} flex items-center gap-1.5`}>
            <MapPinned size={14}/> Locais de instalação
          </button>
          <button onClick={() => setForm({ rental: null })} className={`${ui.primary} flex items-center gap-1.5`}>
            <Plus size={14}/> Nova locação
          </button>
        </div>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"/>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por cliente, local ou item..."
          className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg pl-9 pr-3 py-2.5 text-sm" />
      </div>

      {loadError && <p className="text-sm text-red-500">{loadError}</p>}
      {!rentals && !loadError && <p className="text-sm text-neutral-500 font-mono">Carregando locações...</p>}
      {rentals && visible.length === 0 && (
        <div className={`${ui.card} p-8 text-center`}>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {rentals.length === 0 ? 'Nenhuma locação neste filtro.' : `Nada encontrado para "${search}".`}
          </p>
          {rentals.length === 0 && filter === 'ativas' && (
            <button onClick={() => setForm({ rental: null })} className={`${ui.primary} mt-3`}>Criar a primeira locação</button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {visible.map(r => (
          <button key={r.id} onClick={() => setDetail({ id: r.id })}
            className={`${ui.card} text-left px-4 py-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 hover:border-brand-500 transition-colors`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{r.clientName}</span>
                {r.siteName && <span className="text-sm text-neutral-500">em {r.siteName}</span>}
              </div>
              <div className="text-xs text-neutral-500 mt-0.5 truncate">{itemsSummary(r.items)}</div>
            </div>
            <div className="flex sm:flex-col sm:items-end items-center gap-2 sm:gap-1">
              <StatusBadge meta={RENTAL_STATUS[r.status]} />
              <span className="text-xs font-mono text-neutral-600 dark:text-neutral-400">
                {fmtShort(r.startDate)} a {fmtShort(r.endDate)}
                {r.teamId && <span className="inline-block w-2 h-2 rounded-full ml-2 align-middle" style={{ background: teamOf(r.teamId).color }} title={teamOf(r.teamId).name}/>}
              </span>
              <span className="text-xs text-neutral-500">{fmtBRL(r.totalValue)}</span>
            </div>
          </button>
        ))}
      </div>

      {form && (
        <RentalFormModal
          rental={form.rental}
          clients={clients} productTypes={productTypes} sites={sites} setSites={setSites}
          onClose={() => setForm(null)}
          onSaved={async (saved, shortages) => {
            setForm(null);
            await afterChange();
            setDetail({ id: saved.id, shortages });
          }}
        />
      )}
      {detail && (
        <RentalDetailModal
          rentalId={detail.id}
          initialShortages={detail.shortages}
          onClose={() => setDetail(null)}
          onEdit={(rental) => { setDetail(null); setForm({ rental }); }}
          onChanged={afterChange}
        />
      )}
      {showSites && (
        <SitesModal clients={clients} sites={sites} setSites={setSites} onClose={() => setShowSites(false)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FORMULÁRIO DE LOCAÇÃO
// ---------------------------------------------------------------------------
function emptySite(){ return { name: '', address: '', lat: '', lon: '', contactName: '', contactPhone: '', accessNotes: '' }; }

function RentalFormModal({ rental, clients, productTypes, sites, setSites, onClose, onSaved }){
  const [clientId, setClientId] = useState(rental?.clientId || '');
  const [siteId, setSiteId] = useState(rental?.siteId || '');
  const [newSite, setNewSite] = useState(null);
  const [startDate, setStartDate] = useState(rental?.startDate || '');
  const [endDate, setEndDate] = useState(rental?.endDate || '');
  const [teamId, setTeamId] = useState(rental?.teamId || 'verde');
  const [items, setItems] = useState(() =>
    rental?.items?.length
      ? rental.items.map(i => ({ productTypeId: i.productTypeId, quantity: i.quantity, unitPrice: i.unitPrice ?? '' }))
      : [{ productTypeId: '', quantity: 1, unitPrice: '' }]
  );
  const [notes, setNotes] = useState(rental?.notes || '');
  const [totalOverride, setTotalOverride] = useState('');
  const [availability, setAvailability] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [shortages, setShortages] = useState(null);

  const clientSites = sites.filter(s => s.clientId === clientId);
  const productById = useMemo(() => Object.fromEntries(productTypes.map(p => [p.id, p])), [productTypes]);
  const datesOk = startDate && endDate && endDate >= startDate;
  const days = datesOk ? daysInclusive(startDate, endDate) : 0;

  useEffect(() => {
    if(!datesOk){ setAvailability(null); return; }
    let alive = true;
    api.rentals.availability(startDate, endDate, rental?.id)
      .then(list => { if(alive) setAvailability(Object.fromEntries(list.map(a => [a.productTypeId, a]))); })
      .catch(() => { if(alive) setAvailability(null); });
    return () => { alive = false; };
  }, [startDate, endDate]);

  // Quantidade pedida por produto (soma se o mesmo produto aparecer em duas linhas)
  const requestedByProduct = {};
  items.forEach(i => { if(i.productTypeId) requestedByProduct[i.productTypeId] = (requestedByProduct[i.productTypeId] || 0) + (Number(i.quantity) || 0); });

  const priceOf = (i) => {
    const typed = String(i.unitPrice).replace(',', '.');
    return typed !== '' && !isNaN(Number(typed)) ? Number(typed) : (productById[i.productTypeId]?.dailyPrice || 0);
  };
  const computedTotal = items.reduce((sum, i) => sum + priceOf(i) * (Number(i.quantity) || 0) * days, 0);

  const updateItem = (idx, patch) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  const validItems = items.filter(i => i.productTypeId && Number(i.quantity) > 0);
  const siteReady = newSite ? (newSite.name.trim() && newSite.address.trim()) : true;
  const canSave = clientId && datesOk && validItems.length > 0 && siteReady && !saving;

  const save = async () => {
    setSaving(true); setError(''); setShortages(null);
    try{
      let finalSiteId = siteId || null;
      if(newSite){
        const created = await api.sites.create({ ...newSite, clientId });
        setSites(prev => [created, ...prev]);
        finalSiteId = created.id;
      }
      const payload = {
        clientId, siteId: finalSiteId, startDate, endDate, teamId, notes,
        items: validItems.map(i => ({ productTypeId: i.productTypeId, quantity: Number(i.quantity), unitPrice: i.unitPrice })),
        totalValue: totalOverride || undefined,
      };
      const saved = rental ? await api.rentals.update(rental.id, payload) : await api.rentals.create(payload);
      onSaved(saved, saved.shortages);
    }catch(err){
      setError(err.message);
      if(err.body?.shortages) setShortages(err.body.shortages);
      setSaving(false);
    }
  };

  const title = rental ? `Editar locação de ${rental.clientName}` : 'Nova locação';

  return (
    <Modal title={title} onClose={onClose} size="lg" footer={
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          {days > 0 && <span className="text-neutral-500">{days} {days === 1 ? 'dia' : 'dias'} · </span>}
          <span className="font-medium">{fmtBRL(totalOverride ? Number(String(totalOverride).replace(',', '.')) : computedTotal)}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className={ui.secondary}>Cancelar</button>
          <button onClick={save} disabled={!canSave} className={ui.primary}>
            {saving ? 'Salvando...' : rental ? 'Salvar alterações' : 'Salvar orçamento'}
          </button>
        </div>
      </div>
    }>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={ui.label} htmlFor="rf-client">Cliente</label>
            <select id="rf-client" value={clientId} onChange={e => { setClientId(e.target.value); setSiteId(''); }} className={`${ui.input} w-full`}>
              <option value="">Selecione um cliente...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {clients.length === 0 && <p className="text-xs text-neutral-500 mt-1">Cadastre o cliente na aba Clientes primeiro.</p>}
          </div>

          {clientId && (
            <div className="sm:col-span-2">
              <label className={ui.label} htmlFor="rf-site">Local de instalação</label>
              {!newSite ? (
                <div className="flex gap-2">
                  <select id="rf-site" value={siteId} onChange={e => setSiteId(e.target.value)} className={`${ui.input} flex-1 min-w-0`}>
                    <option value="">Endereço do próprio cliente</option>
                    {clientSites.map(s => <option key={s.id} value={s.id}>{s.name} ({s.address})</option>)}
                  </select>
                  <button onClick={() => { setNewSite(emptySite()); setSiteId(''); }} className={`${ui.secondary} whitespace-nowrap`}>+ Novo local</button>
                </div>
              ) : (
                <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
                  <SiteFields value={newSite} onChange={setNewSite} />
                  <button onClick={() => setNewSite(null)} className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 mt-2">Usar um local já cadastrado</button>
                </div>
              )}
            </div>
          )}

          <div>
            <label className={ui.label} htmlFor="rf-start">Entrega / montagem</label>
            <input id="rf-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={`${ui.input} w-full`} />
          </div>
          <div>
            <label className={ui.label} htmlFor="rf-end">Retirada / desmontagem</label>
            <input id="rf-end" type="date" value={endDate} min={startDate || undefined} onChange={e => setEndDate(e.target.value)} className={`${ui.input} w-full`} />
          </div>
          {startDate && endDate && endDate < startDate && (
            <p className="text-xs text-red-500 sm:col-span-2">A retirada não pode ser antes da entrega.</p>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className={ui.label}>Itens</span>
            {!datesOk && <span className="text-xs text-neutral-500">Escolha as datas para ver o estoque livre</span>}
          </div>
          {productTypes.length === 0 ? (
            <p className="text-xs text-neutral-500">Nenhum produto no catálogo. Cadastre na aba Estoque.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {items.map((it, idx) => {
                const product = productById[it.productTypeId];
                const avail = availability?.[it.productTypeId];
                const short = avail && requestedByProduct[it.productTypeId] > avail.available;
                return (
                  <div key={idx} className="grid grid-cols-[1fr_4.5rem_6.5rem_auto] gap-2 items-start">
                    <div className="min-w-0">
                      <select aria-label="Produto" value={it.productTypeId} onChange={e => updateItem(idx, { productTypeId: e.target.value })} className={`${ui.input} w-full`}>
                        <option value="">Produto...</option>
                        {productTypes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      {avail && (
                        <p className={`text-xs mt-1 ${short ? 'text-red-500 font-medium' : 'text-neutral-500'}`}>
                          {Math.max(avail.available, 0)} livres de {avail.total} nesse período{short ? ' (não dá)' : ''}
                        </p>
                      )}
                    </div>
                    <input aria-label="Quantidade" type="number" min="1" value={it.quantity}
                      onChange={e => updateItem(idx, { quantity: e.target.value })}
                      className={`${ui.input} w-full text-center`} />
                    <input aria-label="Diária por unidade" value={it.unitPrice}
                      placeholder={product?.dailyPrice != null ? `${product.dailyPrice}` : 'Diária'}
                      onChange={e => updateItem(idx, { unitPrice: e.target.value })}
                      className={`${ui.input} w-full`} title="Diária por unidade (vazio = preço do catálogo)" />
                    <button onClick={() => removeItem(idx)} disabled={items.length === 1} aria-label="Remover item"
                      className="p-2 text-neutral-500 hover:text-red-400 disabled:opacity-30"><Trash2 size={14}/></button>
                  </div>
                );
              })}
              <button onClick={() => setItems(prev => [...prev, { productTypeId: '', quantity: 1, unitPrice: '' }])}
                className="text-sm text-brand-600 dark:text-brand-400 hover:underline self-start">+ Adicionar item</button>
            </div>
          )}
        </div>

        <div>
          <label className={ui.label}>Equipe responsável</label>
          <div className="flex gap-2">
            {TEAMS.map(t => (
              <button key={t.id} onClick={() => setTeamId(t.id)} aria-pressed={teamId === t.id}
                className="flex-1 px-3 py-2 rounded text-sm font-medium border-2"
                style={{ borderColor: teamId === t.id ? t.color : 'transparent', background: t.bg, color: t.text }}>
                {t.name.replace('Equipe ', '')}
              </button>
            ))}
          </div>
          <p className="text-xs text-neutral-500 mt-1">Todas as visitas geradas vão para essa equipe. Dá para trocar uma a uma na Agenda.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={ui.label} htmlFor="rf-total">Valor fechado (opcional)</label>
            <input id="rf-total" value={totalOverride} onChange={e => setTotalOverride(e.target.value)}
              placeholder={`Calculado: ${fmtBRL(computedTotal)}`} className={`${ui.input} w-full`} />
          </div>
          <div>
            <label className={ui.label} htmlFor="rf-notes">Observações</label>
            <input id="rf-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opcional" className={`${ui.input} w-full`} />
          </div>
        </div>

        <ShortagesBox shortages={shortages} />
        {error && !shortages && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// DETALHE DA LOCAÇÃO
// ---------------------------------------------------------------------------
function RentalDetailModal({ rentalId, initialShortages, onClose, onEdit, onChanged }){
  const [rental, setRental] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmTeam, setConfirmTeam] = useState(null);
  const [shortages, setShortages] = useState(initialShortages?.length ? initialShortages : null);
  const [missing, setMissing] = useState(null);
  const [notice, setNotice] = useState('');

  const load = async () => {
    try{
      const r = await api.rentals.get(rentalId);
      setRental(r);
      setConfirmTeam(prev => prev || r.teamId || 'verde');
    }catch(err){ setError(err.message); }
  };
  useEffect(() => { load(); }, [rentalId]);

  const run = async (fn, successMsg) => {
    setBusy(true); setError(''); setNotice('');
    try{
      const result = await fn();
      await load();
      await onChanged();
      if(successMsg) setNotice(typeof successMsg === 'function' ? successMsg(result) : successMsg);
      return result;
    }catch(err){
      setError(err.message);
      if(err.body?.shortages) setShortages(err.body.shortages);
      if(err.body?.missingAssets) setMissing(err.body.missingAssets);
      return null;
    }finally{
      setBusy(false);
    }
  };

  const confirm = () => run(async () => {
    const r = await api.rentals.confirm(rentalId, confirmTeam);
    setShortages(null);
    return r;
  }, r => `Locação confirmada. ${r.generatedAppointments} visita(s) criadas na Agenda.`);

  const cancel = () => {
    const reason = window.prompt('Motivo do cancelamento (opcional):');
    if(reason === null) return;
    run(() => api.rentals.cancel(rentalId, reason), 'Locação cancelada. As visitas pendentes saíram da Agenda.');
  };

  const close = (missingStatus) => run(async () => {
    const r = await api.rentals.close(rentalId, missingStatus);
    setMissing(null);
    return r;
  }, 'Locação encerrada.');

  const remove = async () => {
    if(!window.confirm('Excluir esta locação? Não dá para desfazer.')) return;
    setBusy(true);
    try{
      await api.rentals.remove(rentalId);
      await onChanged();
      onClose();
    }catch(err){ setError(err.message); setBusy(false); }
  };

  if(!rental){
    return (
      <Modal title="Locação" onClose={onClose}>
        {error ? <p className="text-sm text-red-500">{error}</p> : <p className="text-sm text-neutral-500 font-mono">Carregando...</p>}
      </Modal>
    );
  }

  const days = daysInclusive(rental.startDate, rental.endDate);
  const atSite = rental.assets.filter(a => a.deliveredAt && !a.returnedAt);
  const editable = ['orcamento', 'confirmado', 'em_andamento'].includes(rental.status);

  return (
    <Modal size="xl" onClose={onClose}
      title={
        <div className="flex items-center gap-2 flex-wrap">
          <span>{rental.clientName}</span>
          <StatusBadge meta={RENTAL_STATUS[rental.status]} />
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex gap-2">
            {['orcamento', 'cancelado'].includes(rental.status) && (
              <button onClick={remove} disabled={busy} className={`${ui.danger} flex items-center gap-1`}><Trash2 size={14}/> Excluir</button>
            )}
            {['orcamento', 'confirmado'].includes(rental.status) && (
              <button onClick={cancel} disabled={busy} className={ui.danger}>Cancelar locação</button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {editable && (
              <button onClick={() => onEdit(rental)} disabled={busy} className={`${ui.secondary} flex items-center gap-1`}><Edit2 size={14}/> Editar</button>
            )}
            {rental.status === 'em_andamento' && !missing && (
              <button onClick={() => close()} disabled={busy} className={ui.secondary}>Encerrar locação</button>
            )}
            {rental.status === 'orcamento' && (
              <button onClick={confirm} disabled={busy} className={ui.primary}>{busy ? 'Confirmando...' : 'Confirmar locação'}</button>
            )}
          </div>
        </div>
      }>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className={ui.label}>Local</p>
            <p>{rental.siteName || 'Endereço do cliente'}</p>
            {rental.siteAddress && <p className="text-xs text-neutral-500">{rental.siteAddress}</p>}
          </div>
          <div>
            <p className={ui.label}>Período</p>
            <p>{fmtDate(rental.startDate)} a {fmtDate(rental.endDate)}</p>
            <p className="text-xs text-neutral-500">{days} {days === 1 ? 'dia' : 'dias'}</p>
          </div>
          <div>
            <p className={ui.label}>Valor</p>
            <p className="font-medium">{fmtBRL(rental.totalValue)}</p>
            {rental.teamId && <p className="text-xs text-neutral-500">{teamOf(rental.teamId).name}</p>}
          </div>
        </div>

        <div>
          <p className={ui.label}>Itens</p>
          <ul className="text-sm divide-y divide-neutral-200 dark:divide-neutral-800 border-y border-neutral-200 dark:border-neutral-800">
            {rental.items.map(i => (
              <li key={i.productTypeId} className="flex justify-between py-1.5">
                <span>{i.quantity}× {i.name} <span className="text-xs text-neutral-500">{CATEGORY_LABEL[i.category]}</span></span>
                <span className="text-neutral-500 text-xs">{i.unitPrice != null ? `${fmtBRL(i.unitPrice)}/dia` : ''}</span>
              </li>
            ))}
          </ul>
          {rental.notes && <p className="text-xs text-neutral-500 mt-2 whitespace-pre-line">{rental.notes}</p>}
        </div>

        {rental.status === 'orcamento' && (
          <div>
            <p className={ui.label}>Equipe que vai atender</p>
            <div className="flex gap-2">
              {TEAMS.map(t => (
                <button key={t.id} onClick={() => setConfirmTeam(t.id)} aria-pressed={confirmTeam === t.id}
                  className="flex-1 px-3 py-2 rounded text-sm font-medium border-2"
                  style={{ borderColor: confirmTeam === t.id ? t.color : 'transparent', background: t.bg, color: t.text }}>
                  {t.name.replace('Equipe ', '')}
                </button>
              ))}
            </div>
            <p className="text-xs text-neutral-500 mt-1">Ao confirmar, o estoque fica reservado e as visitas de entrega, limpeza e retirada entram na Agenda.</p>
          </div>
        )}

        <ShortagesBox shortages={shortages} title={rental.status === 'orcamento' ? 'Falta estoque para confirmar' : undefined} />

        {missing && (
          <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-300 mb-1">
              {missing.length} unidade(s) ainda constam no local: {missing.join(', ')}
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-300 mb-2">O que aconteceu com elas?</p>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => close('higienizacao')} disabled={busy} className={ui.secondary}>Voltaram (mandar para higienização)</button>
              <button onClick={() => close('extraviado')} disabled={busy} className={ui.danger}>Marcar como extraviadas</button>
              <button onClick={() => setMissing(null)} className="text-xs text-neutral-500 px-2">Voltar</button>
            </div>
          </div>
        )}

        {notice && <p className="text-sm text-brand-600 dark:text-brand-400 flex items-center gap-1.5"><Check size={14}/> {notice}</p>}
        {error && !shortages && !missing && <p className="text-sm text-red-500">{error}</p>}

        {rental.appointments.length > 0 && (
          <div>
            <p className={ui.label}>Visitas</p>
            <ol className="flex flex-col gap-1">
              {rental.appointments.map(a => {
                const team = teamOf(a.teamId);
                return (
                  <li key={a.id} className="grid grid-cols-[3.5rem_7rem_1fr_auto] items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-neutral-500">{fmtShort(a.date)}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: team.color }} title={team.name}/>
                      {kindLabel(a.kind)}
                    </span>
                    <span className="text-xs text-neutral-500 truncate">{a.timeWindow || ''}</span>
                    <StatusBadge meta={APPT_STATUS[a.status] || APPT_STATUS.pendente} />
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {rental.assets.length > 0 && (
          <div>
            <p className={ui.label}>
              Unidades {atSite.length > 0 ? `(${atSite.length} no local agora)` : ''}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {rental.assets.map(a => {
                const out = a.deliveredAt && !a.returnedAt;
                const bad = ['danificado', 'extraviado'].includes(a.returnCondition);
                return (
                  <span key={a.id}
                    title={`${a.productName}${a.returnedAt ? ` · devolvida ${new Date(a.returnedAt).toLocaleDateString('pt-BR')}${a.returnCondition ? ` (${a.returnCondition})` : ''}` : ' · no local'}`}
                    className={`text-xs font-mono px-2 py-1 rounded border ${
                      out ? 'border-sky-400 text-sky-700 dark:text-sky-300'
                      : bad ? 'border-red-400 text-red-600 dark:text-red-400'
                      : 'border-neutral-300 dark:border-neutral-700 text-neutral-500'}`}>
                    {a.code}{bad ? ` · ${a.returnCondition}` : ''}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// LOCAIS DE INSTALAÇÃO
// ---------------------------------------------------------------------------
function SiteFields({ value, onChange }){
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <input aria-label="Nome do local" placeholder="Nome (ex.: Festa do Peão, Obra Rua X)" value={value.name} onChange={set('name')} className={`${ui.input} sm:col-span-2`} />
      <input aria-label="Endereço" placeholder="Endereço completo" value={value.address} onChange={set('address')} className={`${ui.input} sm:col-span-2`} />
      <input aria-label="Latitude" placeholder="Latitude (para o mapa)" value={value.lat ?? ''} onChange={set('lat')} className={ui.input} />
      <input aria-label="Longitude" placeholder="Longitude (para o mapa)" value={value.lon ?? ''} onChange={set('lon')} className={ui.input} />
      <input aria-label="Responsável no local" placeholder="Responsável no local" value={value.contactName || ''} onChange={set('contactName')} className={ui.input} />
      <input aria-label="Telefone do responsável" placeholder="Telefone do responsável" value={value.contactPhone || ''} onChange={set('contactPhone')} className={ui.input} />
      <textarea aria-label="Instruções de acesso" placeholder="Acesso: portão, horário, onde o caminhão de sucção pode parar..." value={value.accessNotes || ''} onChange={set('accessNotes')} rows={2} className={`${ui.input} sm:col-span-2`} />
    </div>
  );
}

function SitesModal({ clients, sites, setSites, onClose }){
  const [clientFilter, setClientFilter] = useState('');
  const [editing, setEditing] = useState(null); // { ...site } ou { ...emptySite, clientId }
  const [error, setError] = useState('');
  const clientName = (id) => clients.find(c => c.id === id)?.name || 'Sem cliente';

  const list = clientFilter ? sites.filter(s => s.clientId === clientFilter) : sites;

  const save = async () => {
    setError('');
    try{
      if(editing.id){
        const updated = await api.sites.update(editing.id, editing);
        setSites(prev => prev.map(s => s.id === updated.id ? updated : s));
      }else{
        const created = await api.sites.create(editing);
        setSites(prev => [created, ...prev]);
      }
      setEditing(null);
    }catch(err){ setError(err.message); }
  };

  const remove = async (s) => {
    if(!window.confirm(`Excluir o local "${s.name}"?`)) return;
    try{
      await api.sites.remove(s.id);
      setSites(prev => prev.filter(x => x.id !== s.id));
    }catch(err){ setError(err.message); }
  };

  return (
    <Modal title="Locais de instalação" onClose={onClose} size="lg">
      {editing ? (
        <div className="flex flex-col gap-3">
          <div>
            <label className={ui.label} htmlFor="sm-client">Cliente</label>
            <select id="sm-client" value={editing.clientId || ''} onChange={e => setEditing({ ...editing, clientId: e.target.value })} className={`${ui.input} w-full`}>
              <option value="">Selecione...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <SiteFields value={editing} onChange={setEditing} />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={!editing.clientId || !editing.name?.trim() || !editing.address?.trim()} className={ui.primary}>
              {editing.id ? 'Salvar local' : 'Cadastrar local'}
            </button>
            <button onClick={() => setEditing(null)} className={ui.secondary}>Voltar</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <select aria-label="Filtrar por cliente" value={clientFilter} onChange={e => setClientFilter(e.target.value)} className={`${ui.input} flex-1 min-w-0`}>
              <option value="">Todos os clientes</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => setEditing({ ...emptySite(), clientId: clientFilter })} className={`${ui.primary} whitespace-nowrap`}>+ Novo local</button>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          {list.length === 0 && <p className="text-sm text-neutral-500">Nenhum local cadastrado. Locais também podem ser criados direto no formulário da locação.</p>}
          <ul className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
            {list.map(s => (
              <li key={s.id} className="py-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{s.name} <span className="text-xs font-normal text-neutral-500">· {clientName(s.clientId)}</span></p>
                  <p className="text-xs text-neutral-500">{s.address}</p>
                  {(!s.lat || !s.lon) && <p className="text-xs text-amber-600 dark:text-amber-400">Sem coordenadas: não aparece no mapa</p>}
                </div>
                <div className="flex shrink-0">
                  <button onClick={() => setEditing({ ...s })} aria-label="Editar local" className="p-1.5 text-neutral-500 hover:text-brand-400"><Edit2 size={14}/></button>
                  <button onClick={() => remove(s)} aria-label="Excluir local" className="p-1.5 text-neutral-500 hover:text-red-400"><Trash2 size={14}/></button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
