import React, { useState, useEffect, useMemo } from 'react';
import { Plus, X, Trash2, Edit2, MapPinned, AlertTriangle, Check, Search, Copy, FileDown, Clock, Building2, Users, Satellite, Image as ImageIcon } from 'lucide-react';
import { api } from './api.js';
import {
  teamOf, kindLabel, CATEGORY_LABEL, RENTAL_STATUS, APPT_STATUS, ASSET_STATUS,
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
export function LocacoesTab({ clients, productTypes, sites, setSites, reloadAppointments, initialOs, onOsOpened }){
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

  // Abrir direto pela O.S. (link do QR code ou busca pelo código)
  const openByCode = async (code) => {
    try{
      const r = await api.rentals.byCode(code);
      setDetail({ id: r.id });
      return true;
    }catch(err){ setLoadError(err.message); return false; }
  };
  useEffect(() => {
    if(initialOs){ openByCode(initialOs); onOsOpened?.(); }
  }, [initialOs]);
  const searchIsCode = /^OS-\d{4}-\d+$/i.test(search.trim());

  const q = search.trim().toLowerCase();
  const visible = (rentals || []).filter(r =>
    !q || `${r.osCode || ''} ${r.clientName} ${r.siteName || ''} ${r.siteAddress || ''} ${itemsSummary(r.items)}`.toLowerCase().includes(q)
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
          onKeyDown={e => { if(e.key === 'Enter' && searchIsCode) openByCode(search.trim()); }}
          placeholder="Buscar por O.S. (ex.: OS-2026-0012), cliente, local ou item..."
          className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg pl-9 pr-3 py-2.5 text-sm" />
        {searchIsCode && (
          <button onClick={() => openByCode(search.trim())} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded bg-brand-600 text-white">Abrir O.S.</button>
        )}
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
                {r.osCode && <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">{r.osCode}</span>}
                <span className="text-sm font-medium">{r.clientName}</span>
                {r.siteName && <span className="text-sm text-neutral-500">em {r.siteName}</span>}
              </div>
              <div className="text-xs text-neutral-500 mt-0.5 truncate">{itemsSummary(r.items)}</div>
            </div>
            <div className="flex sm:flex-col sm:items-end items-center gap-2 sm:gap-1">
              <StatusBadge meta={RENTAL_STATUS[r.status]} />
              <span className="text-xs font-mono text-neutral-600 dark:text-neutral-400">
                {fmtShort(r.startDate)}{r.startTime ? ` ${r.startTime}` : ''} a {fmtShort(r.endDate)}{r.endTime ? ` ${r.endTime}` : ''}
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
  const [startTime, setStartTime] = useState(rental?.startTime || '');
  const [endTime, setEndTime] = useState(rental?.endTime || '');
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
        clientId, siteId: finalSiteId, startDate, endDate, startTime: startTime || null, endTime: endTime || null, notes,
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
            <div className="flex gap-2">
              <input id="rf-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={`${ui.input} flex-1 min-w-0`} />
              <input type="time" aria-label="Horário combinado para a entrega" value={startTime} onChange={e => setStartTime(e.target.value)} className={`${ui.input} w-28`} />
            </div>
          </div>
          <div>
            <label className={ui.label} htmlFor="rf-end">Retirada / desmontagem</label>
            <div className="flex gap-2">
              <input id="rf-end" type="date" value={endDate} min={startDate || undefined} onChange={e => setEndDate(e.target.value)} className={`${ui.input} flex-1 min-w-0`} />
              <input type="time" aria-label="Horário combinado para a retirada" value={endTime} onChange={e => setEndTime(e.target.value)} className={`${ui.input} w-28`} />
            </div>
          </div>
          <p className="text-xs text-neutral-500 sm:col-span-2 -mt-1 flex items-center gap-1"><Clock size={12}/> Horário combinado com o cliente (opcional). Ele vai para a Agenda e para o app da equipe.</p>
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
export function RentalDetailModal({ rentalId, initialShortages, onClose, onEdit, onChanged, readOnly = false }){
  const [rental, setRental] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shortages, setShortages] = useState(initialShortages?.length ? initialShortages : null);
  const [missing, setMissing] = useState(null);
  const [notice, setNotice] = useState('');

  const [history, setHistory] = useState(null);
  const load = async () => {
    try{
      const [r, h] = await Promise.all([api.rentals.get(rentalId), api.rentals.history(rentalId).catch(() => null)]);
      setRental(r);
      setHistory(h);
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
    const r = await api.rentals.confirm(rentalId);
    setShortages(null);
    return r;
  }, r => `Locação confirmada. ${r.generatedAppointments} visita(s) enviadas para a Agenda; o gerente de logística distribui entre as equipes.`);

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
  const editable = !readOnly && ['orcamento', 'confirmado', 'em_andamento'].includes(rental.status);

  return (
    <Modal size="xl" onClose={onClose}
      title={
        <div className="flex items-center gap-2 flex-wrap">
          {rental.osCode && <span className="font-mono text-sm px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800">{rental.osCode}</span>}
          <span>{rental.clientName}</span>
          <StatusBadge meta={RENTAL_STATUS[rental.status]} />
        </div>
      }
      footer={readOnly ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-neutral-500">Consulta. Alterações na O.S. são feitas pelo comercial, na aba Locações.</p>
          {rental.osCode && <PdfButton rentalId={rental.id} code={rental.osCode} />}
        </div>
      ) : (
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
      )}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className={ui.label}>Local</p>
            <p>{rental.siteName || 'Endereço do cliente'}</p>
            {rental.siteAddress && <p className="text-xs text-neutral-500">{rental.siteAddress}</p>}
          </div>
          <div>
            <p className={ui.label}>Período</p>
            <p>{fmtDate(rental.startDate)}{rental.startTime ? ` às ${rental.startTime}` : ''} a {fmtDate(rental.endDate)}{rental.endTime ? ` às ${rental.endTime}` : ''}</p>
            <p className="text-xs text-neutral-500">{days} {days === 1 ? 'dia' : 'dias'}</p>
          </div>
          <div>
            <p className={ui.label}>Valor</p>
            <p className="font-medium">{fmtBRL(rental.totalValue)}</p>

          </div>
        </div>

        {history && <StageBar stages={history.stages} />}

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

        {rental.status === 'orcamento' && !readOnly && (
          <p className="text-xs text-neutral-500">Ao confirmar, o estoque fica reservado e as visitas de entrega, limpeza e retirada vão para a Agenda. O gerente de logística escolhe a equipe de cada uma.</p>
        )}

        {rental.osCode && <OsCodeBox code={rental.osCode} rentalId={rental.id} />}

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
                    <span className="text-xs text-neutral-500 truncate">{[a.timeWindow, a.teamId ? team.name : 'Aguardando equipe'].filter(Boolean).join(' · ')}</span>
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

        {history && <Timeline items={history.items} />}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// HISTÓRIA DA O.S.
// ---------------------------------------------------------------------------
const brTime = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const brDateTime = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const brDay = (iso) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });

function StageBar({ stages }){
  const lastDone = stages.reduce((n, s, i) => (s.at ? i : n), -1);
  return (
    <div>
      <p className={ui.label}>Etapas</p>
      <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
        {stages.map((s, i) => {
          const done = !!s.at;
          const current = !done && i === lastDone + 1;
          return (
            <li key={s.key} className="flex flex-col items-center text-center min-w-0">
              <div className="flex items-center w-full">
                <span className={`flex-1 h-0.5 ${i === 0 ? 'opacity-0' : done || current ? 'bg-brand-500' : 'bg-neutral-300 dark:bg-neutral-700'}`} />
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 border-2 ${
                  done ? 'bg-brand-600 border-brand-600 text-white'
                  : current ? 'bg-white dark:bg-neutral-900 border-brand-500 text-brand-600'
                  : 'bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700 text-neutral-400'}`}>
                  {done ? <Check size={13} strokeWidth={3}/> : i + 1}
                </span>
                <span className={`flex-1 h-0.5 ${i === stages.length - 1 ? 'opacity-0' : done ? 'bg-brand-500' : 'bg-neutral-300 dark:bg-neutral-700'}`} />
              </div>
              <p className={`text-xs mt-1 font-medium ${done || current ? '' : 'text-neutral-500'}`}>{s.label}{s.progress ? ` ${s.progress}` : ''}</p>
              <p className="text-[11px] text-neutral-500 leading-tight">{s.at ? brDateTime(s.at) : s.partial ? 'em parte' : current ? 'próxima' : '—'}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const SOURCE = {
  escritorio: { icon: Building2, label: 'Escritório', cls: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300' },
  equipe:     { icon: Users,     label: 'Equipe',     cls: 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-400' },
  rastreador: { icon: Satellite, label: 'Rastreador', cls: 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300' },
};
const ROLE_NAME = { admin: 'Administrador', gerente: 'Gerente de Logística', comercial: 'Comercial', team: 'App de campo' };

function Timeline({ items }){
  const [photos, setPhotos] = useState({}); // appointmentId → [dataUrl] | 'loading'
  const [zoom, setZoom] = useState(null);
  const loadPhotos = async (apptId) => {
    setPhotos(p => ({ ...p, [apptId]: 'loading' }));
    try{
      const recs = await api.appointments.getExecution(apptId);
      setPhotos(p => ({ ...p, [apptId]: recs.flatMap(r => r.photos || []) }));
    }catch(e){ setPhotos(p => ({ ...p, [apptId]: [] })); }
  };
  // agrupa por dia
  const days = [];
  items.forEach(it => {
    const key = brDay(it.at);
    if(!days.length || days[days.length - 1].key !== key) days.push({ key, items: [] });
    days[days.length - 1].items.push(it);
  });
  return (
    <div>
      <p className={ui.label}>Histórico completo</p>
      <div className="flex flex-col gap-4">
        {days.map(d => (
          <div key={d.key}>
            <p className="text-xs font-medium text-neutral-500 capitalize mb-2">{d.key}</p>
            <ol className="relative border-l-2 border-neutral-200 dark:border-neutral-800 ml-3 flex flex-col gap-3">
              {d.items.map((it, i) => {
                const src = SOURCE[it.source] || SOURCE.escritorio;
                const Icon = src.icon;
                const alert = it.severity === 'alerta';
                return (
                  <li key={i} className="ml-5 relative">
                    <span className={`absolute -left-[33px] top-0 w-6 h-6 rounded-full flex items-center justify-center ring-4 ring-white dark:ring-neutral-900 ${alert ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : src.cls}`}>
                      <Icon size={12}/>
                    </span>
                    <p className="text-sm leading-snug">
                      <span className="font-mono text-xs text-neutral-500 mr-1.5">{brTime(it.at)}</span>
                      <span className={alert ? 'text-amber-800 dark:text-amber-300' : ''}>{it.message}</span>
                    </p>
                    {it.details?.length > 0 && (
                      <ul className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 list-disc pl-4">{it.details.map((x, j) => <li key={j}>{x}</li>)}</ul>
                    )}
                    {it.notes && <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 italic">"{it.notes}"</p>}
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                      {src.label}{it.actor ? ` · ${it.actor}` : ''}{it.actorRole && ROLE_NAME[it.actorRole] && it.source === 'escritorio' ? ` (${ROLE_NAME[it.actorRole]})` : ''}
                      {it.photoCount > 0 && !photos[it.appointmentId] && (
                        <button onClick={() => loadPhotos(it.appointmentId)} className="ml-2 text-brand-600 dark:text-brand-400 hover:underline inline-flex items-center gap-1"><ImageIcon size={11}/> ver {it.photoCount} foto(s)</button>
                      )}
                    </p>
                    {photos[it.appointmentId] === 'loading' && <p className="text-xs text-neutral-500 mt-1">Carregando fotos...</p>}
                    {Array.isArray(photos[it.appointmentId]) && it.photoCount > 0 && (
                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        {photos[it.appointmentId].map((p, k) => (
                          <button key={k} onClick={() => setZoom(p)} aria-label={`Ampliar foto ${k + 1}`}>
                            <img src={p} alt={`Foto ${k + 1}`} className="w-16 h-16 object-cover rounded border border-neutral-200 dark:border-neutral-700" />
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
      {zoom && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={() => setZoom(null)}>
          <img src={zoom} alt="Foto ampliada" className="max-w-full max-h-full rounded" />
        </div>
      )}
    </div>
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

// ---------------------------------------------------------------------------
// CÓDIGO DA O.S. + PDF
// ---------------------------------------------------------------------------
export function osLink(code){ return `${window.location.origin}/?os=${encodeURIComponent(code)}`; }

export function PdfButton({ rentalId, code, className = '' }){
  const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e?.stopPropagation();
    setBusy(true);
    try{ await api.rentals.pdf(rentalId, code); }catch(err){ window.alert(`Não foi possível gerar o PDF: ${err.message}`); }
    setBusy(false);
  };
  return (
    <button onClick={go} disabled={busy} className={`${ui.secondary} !py-1.5 text-xs flex items-center gap-1 ${className}`}>
      <FileDown size={13}/> {busy ? 'Gerando PDF...' : 'Gerar PDF'}
    </button>
  );
}

function OsCodeBox({ code, rentalId }){
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try{ await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch(e){ window.prompt('Copie:', code); }
  };
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p className={ui.label}>Ordem de serviço</p>
        <p className="text-2xl font-mono font-semibold tracking-tight">{code}</p>
        <p className="text-xs text-neutral-500">Acompanha a locação em todas as etapas. O PDF traz o pedido, as etapas, o histórico e os comprovantes.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={copy} className={`${ui.secondary} !py-1.5 text-xs flex items-center gap-1`}><Copy size={12}/> {copied ? 'Copiado!' : 'Copiar código'}</button>
        <PdfButton rentalId={rentalId} code={code} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ESTOQUE LIVRE POR DATA (para o comercial responder o cliente)
// ---------------------------------------------------------------------------
function todayISO(){ return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); }
function plusDays(key, n){ const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

export function DisponibilidadePanel(){
  const [start, setStart] = useState(todayISO);
  const [end, setEnd] = useState(todayISO);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const ok = start && end && end >= start;

  useEffect(() => {
    if(!ok){ setRows(null); return; }
    let alive = true;
    setRows(null);
    api.rentals.availability(start, end)
      .then(r => { if(alive){ setRows(r); setError(''); } })
      .catch(err => { if(alive) setError(err.message); });
    return () => { alive = false; };
  }, [start, end]);

  // Atalhos de período comuns em pedidos de clientes
  const today = todayISO();
  const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  const sat = plusDays(today, (6 - dow + 7) % 7 || 7);
  const presets = [
    { label: 'Hoje', s: today, e: today },
    { label: 'Amanhã', s: plusDays(today, 1), e: plusDays(today, 1) },
    { label: 'Próximo fim de semana', s: sat, e: plusDays(sat, 1) },
    { label: 'Próximos 7 dias', s: today, e: plusDays(today, 6) },
  ];
  const byCat = {};
  (rows || []).forEach(r => { (byCat[r.category] ||= []).push(r); });

  return (
    <div className="flex flex-col gap-4">
      <div className={`${ui.card} p-4`}>
        <p className="text-sm font-medium mb-1">Consultar estoque livre</p>
        <p className="text-xs text-neutral-500 mb-3">Escolha o período que o cliente pediu. "Livres" já desconta o que está reservado, locado e os dias de higienização depois de cada retirada.</p>
        <div className="flex gap-3 flex-wrap items-end">
          <div>
            <label className={ui.label} htmlFor="dp-start">De</label>
            <input id="dp-start" type="date" value={start} onChange={e => { setStart(e.target.value); if(e.target.value > end) setEnd(e.target.value); }} className={ui.input} />
          </div>
          <div>
            <label className={ui.label} htmlFor="dp-end">Até</label>
            <input id="dp-end" type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} className={ui.input} />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {presets.map(p => (
              <button key={p.label} onClick={() => { setStart(p.s); setEnd(p.e); }}
                className={`text-xs px-2.5 py-1.5 rounded border ${start === p.s && end === p.e ? 'border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-400' : 'border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400'}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {start && end && end < start && <p className="text-xs text-red-500 mt-2">A data final não pode ser antes da inicial.</p>}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {ok && !rows && !error && <p className="text-sm text-neutral-500 font-mono">Consultando...</p>}
      {rows && rows.length === 0 && <p className="text-sm text-neutral-500">Nenhum produto no catálogo ainda.</p>}
      {rows && Object.entries(byCat).map(([cat, list]) => (
        <div key={cat} className={`${ui.card} divide-y divide-neutral-200 dark:divide-neutral-800`}>
          <p className="px-4 py-2 text-xs font-mono uppercase text-neutral-500">{CATEGORY_LABEL[cat] || cat}</p>
          {list.map(r => {
            const free = Math.max(r.available, 0);
            const pct = r.total ? (free / r.total) * 100 : 0;
            return (
              <div key={r.productTypeId} className="px-4 py-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 items-center">
                <span className="text-sm font-medium">{r.name}</span>
                <span className={`text-sm font-semibold ${free === 0 ? 'text-red-600 dark:text-red-400' : free <= Math.ceil(r.total * 0.15) ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                  {free} livre{free === 1 ? '' : 's'} <span className="text-neutral-500 font-normal">de {r.total}</span>
                </span>
                <div className="col-span-2 h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden" role="img" aria-label={`${free} de ${r.total} livres`}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ASSET_STATUS.disponivel.color }} />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CARDS DE STATUS (comercial e logística)
// ---------------------------------------------------------------------------
export function StatusCards({ appointments, onPick }){
  const [rentals, setRentals] = useState(null);
  const [free, setFree] = useState(null);
  const today = todayISO();
  useEffect(() => {
    api.rentals.list({ status: 'orcamento,confirmado,em_andamento' }).then(setRentals).catch(() => setRentals([]));
    api.rentals.availability(today, today)
      .then(rows => setFree({ free: rows.reduce((n, r) => n + Math.max(r.available, 0), 0), total: rows.reduce((n, r) => n + r.total, 0) }))
      .catch(() => {});
  }, [appointments.length]);

  const todayAppts = appointments.filter(a => a.date === today && a.status !== 'cancelado');
  const doneToday = todayAppts.filter(a => !['pendente', 'em_rota'].includes(a.status || 'pendente')).length;
  const unassigned = appointments.filter(a => !a.teamId && a.date >= today && ['pendente', 'em_rota'].includes(a.status || 'pendente')).length;
  const count = (st) => (rentals || []).filter(r => r.status === st).length;

  const cards = [
    { id: 'orcamento', label: 'Orçamentos abertos', value: rentals ? count('orcamento') : '…' },
    { id: 'confirmado', label: 'Confirmadas a entregar', value: rentals ? count('confirmado') : '…' },
    { id: 'em_andamento', label: 'Em andamento', value: rentals ? count('em_andamento') : '…' },
    { id: 'hoje', label: 'Visitas hoje', value: `${doneToday}/${todayAppts.length}`, hint: 'feitas' },
    { id: 'sem_equipe', label: 'Visitas sem equipe', value: unassigned, alert: unassigned > 0 },
    { id: 'livres', label: 'Unidades livres hoje', value: free ? `${free.free}/${free.total}` : '…' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {cards.map(c => {
        const Tag = onPick ? 'button' : 'div';
        return (
          <Tag key={c.id} onClick={onPick ? () => onPick(c.id) : undefined}
            className={`${ui.card} px-3 py-2.5 text-left ${onPick ? 'hover:border-brand-500' : ''} ${c.alert ? '!border-amber-400 dark:!border-amber-700 bg-amber-50 dark:bg-amber-950/30' : ''}`}>
            <p className={`text-xl font-semibold ${c.alert ? 'text-amber-800 dark:text-amber-300' : ''}`}>{c.value}</p>
            <p className="text-xs text-neutral-500 leading-tight">{c.label}</p>
          </Tag>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ABA ORDENS DE SERVIÇO (todos os perfis: consulta + PDF)
// ---------------------------------------------------------------------------
const OS_FILTERS = [
  { id: 'todas', label: 'Todas', status: null },
  { id: 'abertas', label: 'Em aberto', status: 'orcamento,confirmado,em_andamento' },
  { id: 'em_andamento', label: 'Em andamento', status: 'em_andamento' },
  { id: 'encerrado', label: 'Encerradas', status: 'encerrado' },
  { id: 'cancelado', label: 'Canceladas', status: 'cancelado' },
];

export function OrdensTab({ initialOs, onOsOpened }){
  const [filter, setFilter] = useState('todas');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    setRows(null);
    const st = OS_FILTERS.find(f => f.id === filter)?.status;
    api.rentals.list(st ? { status: st } : {}).then(r => { setRows(r); setError(''); }).catch(e => setError(e.message));
  }, [filter]);
  useEffect(() => {
    if(!initialOs) return;
    api.rentals.byCode(initialOs).then(r => setOpen(r.id)).catch(e => setError(e.message));
    onOsOpened?.();
  }, [initialOs]);

  const q = search.trim().toLowerCase();
  const list = (rows || [])
    .filter(r => !q || `${r.osCode || ''} ${r.clientName} ${r.siteName || ''} ${itemsSummary(r.items)}`.toLowerCase().includes(q))
    .sort((a, b) => (b.osCode || '').localeCompare(a.osCode || '', 'pt-BR', { numeric: true }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 flex-wrap" role="tablist">
          {OS_FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} role="tab" aria-selected={filter === f.id}
              className={`text-xs font-mono px-3 py-1.5 rounded border ${filter === f.id
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400'
                : 'border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-80">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar O.S., cliente, local..."
            className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg pl-9 pr-3 py-2 text-sm" />
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className={`${ui.card} overflow-x-auto`}>
        {!rows && !error && <p className="p-4 text-sm text-neutral-500 font-mono">Carregando...</p>}
        {rows && list.length === 0 && <p className="p-4 text-sm text-neutral-500">Nenhuma O.S. encontrada.</p>}
        {list.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500 font-mono uppercase border-b border-neutral-200 dark:border-neutral-800">
                <th className="px-4 py-2 font-normal">O.S.</th>
                <th className="px-4 py-2 font-normal">Cliente</th>
                <th className="px-4 py-2 font-normal">Período</th>
                <th className="px-4 py-2 font-normal">Itens</th>
                <th className="px-4 py-2 font-normal">Situação</th>
                <th className="px-4 py-2 font-normal"><span className="sr-only">PDF</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id} onClick={() => setOpen(r.id)} className="border-t border-neutral-100 dark:border-neutral-800 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                  <td className="px-4 py-2.5 font-mono font-medium whitespace-nowrap">{r.osCode}</td>
                  <td className="px-4 py-2.5">
                    <p>{r.clientName}</p>
                    {r.siteName && <p className="text-xs text-neutral-500">{r.siteName}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-xs whitespace-nowrap">{fmtShort(r.startDate)} a {fmtShort(r.endDate)}</td>
                  <td className="px-4 py-2.5 text-xs text-neutral-600 dark:text-neutral-400 max-w-[18rem] truncate">{itemsSummary(r.items)}</td>
                  <td className="px-4 py-2.5"><StatusBadge meta={RENTAL_STATUS[r.status]} /></td>
                  <td className="px-4 py-2.5 text-right" onClick={e => e.stopPropagation()}><PdfButton rentalId={r.id} code={r.osCode} className="ml-auto" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open && <RentalDetailModal rentalId={open} readOnly onClose={() => setOpen(null)} onEdit={() => {}} onChanged={async () => {}} />}
    </div>
  );
}
