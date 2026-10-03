import React, { useState, useEffect } from 'react';
import { Edit2, Trash2, History, Search, Printer, Wrench } from 'lucide-react';
import { api } from './api.js';
import { CATEGORY_LABEL, ASSET_STATUS, fmtBRL, fmtShort, ui } from './constants.js';
import { Modal, StatusBadge } from './locacoes.jsx';
import { printLabels, LABEL_SIZES } from './etiquetas.js';

const STATUS_ORDER = ['disponivel', 'locado', 'higienizacao', 'manutencao', 'extraviado', 'baixado'];

const MOVEMENT_LABEL = {
  saida: 'Saiu para locação', retorno: 'Voltou da locação', limpeza: 'Limpeza no local',
  manutencao: 'Manutenção', vistoria: 'Vistoria', ajuste: 'Status alterado no pátio',
};

export function EstoqueTab({ setProductTypes }){
  const [products, setProducts] = useState(null);
  const [summary, setSummary] = useState([]);
  const [assets, setAssets] = useState(null);
  const [filters, setFilters] = useState({ productTypeId: '', status: '', code: '' });
  const [productForm, setProductForm] = useState(null);
  const [showBulk, setShowBulk] = useState(false);
  const [historyOf, setHistoryOf] = useState(null);
  const [labels, setLabels] = useState(null); // { codes?: [...] } abre a impressão de etiquetas
  const [usage, setUsage] = useState({});     // assetId → contador de uso
  const [sort, setSort] = useState('codigo');
  const [onlyService, setOnlyService] = useState(false);
  const [error, setError] = useState('');

  const loadProducts = async () => {
    const all = await api.productTypes.list(true);
    setProducts(all);
    setProductTypes(all.filter(p => p.active));
  };
  const loadSummary = async () => setSummary(await api.assets.summary());
  const loadAssets = async () => setAssets(await api.assets.list(filters));
  const loadUsage = async () => {
    try{ setUsage(Object.fromEntries((await api.assets.usage()).map(u => [u.assetId, u]))); }catch(e){}
  };

  useEffect(() => { loadProducts().catch(e => setError(e.message)); loadSummary().catch(() => {}); loadUsage(); }, []);
  useEffect(() => {
    const t = setTimeout(() => loadAssets().catch(e => setError(e.message)), filters.code ? 250 : 0);
    return () => clearTimeout(t);
  }, [filters.productTypeId, filters.status, filters.code]);

  const refreshAll = async () => { await Promise.all([loadSummary(), loadAssets(), loadUsage()]); };

  // Ordenação e filtro pelo contador de uso
  const serviceDue = Object.values(usage).filter(u => u.service === 'vencida');
  const shown = (assets || [])
    .filter(a => !onlyService || ['vencida', 'proxima'].includes(usage[a.id]?.service))
    .slice()
    .sort((x, y) => {
      const ux = usage[x.id] || {}, uy = usage[y.id] || {};
      if(sort === 'mais') return (uy.uses || 0) - (ux.uses || 0) || (uy.daysRented || 0) - (ux.daysRented || 0);
      if(sort === 'menos') return (ux.uses || 0) - (uy.uses || 0) || (ux.daysRented || 0) - (uy.daysRented || 0);
      if(sort === 'ocupacao') return (uy.occupancy90 || 0) - (ux.occupancy90 || 0);
      if(sort === 'avarias') return (uy.damaged || 0) - (ux.damaged || 0);
      return x.code.localeCompare(y.code, 'pt-BR', { numeric: true });
    });

  const changeStatus = async (asset, status) => {
    if(asset.status === 'locado' && !window.confirm(`${asset.code} consta como locada${asset.currentRental ? ` para ${asset.currentRental.clientName}` : ''}. Mudar mesmo assim?`)) return;
    try{
      await api.assets.setStatus(asset.id, status);
      await refreshAll();
    }catch(err){ setError(err.message); }
  };

  const removeAsset = async (asset) => {
    if(!window.confirm(`Excluir a unidade ${asset.code}?`)) return;
    try{ await api.assets.remove(asset.id); await refreshAll(); }
    catch(err){ setError(err.message); }
  };

  const toClean = summary.reduce((n, s) => n + (s.byStatus.higienizacao || 0), 0);

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <p className="text-sm text-red-500 flex justify-between gap-2">
          {error}<button onClick={() => setError('')} className="text-xs underline">ok</button>
        </p>
      )}

      {/* Resumo: uma barra por produto, dividida por status */}
      <section>
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-lg font-medium">Estoque hoje</h2>
          {toClean > 0 && (
            <button onClick={() => setFilters({ productTypeId: '', status: 'higienizacao', code: '' })}
              className="text-sm text-amber-700 dark:text-amber-400 hover:underline">
              {toClean} {toClean === 1 ? 'unidade esperando' : 'unidades esperando'} higienização
            </button>
          )}
        </div>
        {summary.length === 0 ? (
          <p className="text-sm text-neutral-500">Cadastre produtos e unidades abaixo para ver o estoque aqui.</p>
        ) : (
          <div className={`${ui.card} divide-y divide-neutral-200 dark:divide-neutral-800`}>
            {summary.map(s => (
              <div key={s.productTypeId} className="px-4 py-3 grid grid-cols-1 md:grid-cols-[14rem_1fr] gap-2 md:gap-4 items-center">
                <button onClick={() => setFilters({ productTypeId: s.productTypeId, status: '', code: '' })} className="text-left">
                  <span className="text-sm font-medium">{s.name}</span>
                  <span className="text-xs text-neutral-500 ml-2">{s.total} un.</span>
                </button>
                <div>
                  <div className="flex h-2.5 rounded-full overflow-hidden bg-neutral-200 dark:bg-neutral-800" role="img"
                    aria-label={STATUS_ORDER.filter(k => s.byStatus[k]).map(k => `${s.byStatus[k]} ${ASSET_STATUS[k].label}`).join(', ') || 'sem unidades'}>
                    {STATUS_ORDER.map(k => s.byStatus[k] ? (
                      <div key={k} style={{ width: `${(s.byStatus[k] / s.total) * 100}%`, background: ASSET_STATUS[k].color }} />
                    ) : null)}
                  </div>
                  <div className="flex gap-x-4 gap-y-0.5 flex-wrap mt-1.5">
                    {s.total === 0 && <span className="text-xs text-neutral-500">Nenhuma unidade cadastrada</span>}
                    {STATUS_ORDER.filter(k => s.byStatus[k]).map(k => (
                      <button key={k} onClick={() => setFilters({ productTypeId: s.productTypeId, status: k, code: '' })}
                        className="text-xs text-neutral-600 dark:text-neutral-400 flex items-center gap-1.5 hover:text-neutral-900 dark:hover:text-neutral-100">
                        <span className="w-2 h-2 rounded-full" style={{ background: ASSET_STATUS[k].color }}/>
                        {s.byStatus[k]} {s.byStatus[k] === 1 ? ASSET_STATUS[k].one : ASSET_STATUS[k].many}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Unidades */}
      <section>
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-lg font-medium">
            Unidades {assets && <span className="text-sm font-normal text-neutral-500">{assets.length} {assets.length === 1 ? 'encontrada' : 'encontradas'}</span>}
          </h2>
          <div className="flex gap-2">
            <button onClick={() => setLabels({})} disabled={!assets?.length} className={`${ui.secondary} flex items-center gap-1.5`}><Printer size={14}/> Imprimir etiquetas</button>
            <button onClick={() => setShowBulk(true)} disabled={!products?.some(p => p.active)} className={ui.primary}>+ Cadastrar unidades</button>
          </div>
        </div>
        {serviceDue.length > 0 && (
          <button onClick={() => setOnlyService(v => !v)}
            className="w-full mb-3 rounded-lg border border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 px-4 py-2.5 text-sm text-left text-orange-900 dark:text-orange-200 flex items-center gap-2">
            <Wrench size={15}/> <b>{serviceDue.length} unidade(s) com revisão preventiva vencida</b>
            <span className="ml-auto text-xs underline">{onlyService ? 'mostrar todas' : 'mostrar só essas'}</span>
          </button>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"/>
            <input aria-label="Buscar código" placeholder="Código (ex.: BQ-012)" value={filters.code}
              onChange={e => setFilters(f => ({ ...f, code: e.target.value }))} className={`${ui.input} w-full pl-9`} />
          </div>
          <select aria-label="Filtrar produto" value={filters.productTypeId} onChange={e => setFilters(f => ({ ...f, productTypeId: e.target.value }))} className={ui.input}>
            <option value="">Todos os produtos</option>
            {(products || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select aria-label="Filtrar status" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className={ui.input}>
            <option value="">Todos os status</option>
            {STATUS_ORDER.map(k => <option key={k} value={k}>{ASSET_STATUS[k].label}</option>)}
          </select>
          <select aria-label="Ordenar" value={sort} onChange={e => setSort(e.target.value)} className={ui.input}>
            <option value="codigo">Ordenar por código</option>
            <option value="mais">Mais usadas primeiro</option>
            <option value="menos">Menos usadas primeiro</option>
            <option value="ocupacao">Maior ocupação (90 dias)</option>
            <option value="avarias">Mais avarias</option>
          </select>
        </div>

        <div className={`${ui.card} overflow-auto max-h-[28rem]`}>
          {!assets && <p className="text-sm text-neutral-500 p-4 font-mono">Carregando...</p>}
          {assets && assets.length === 0 && <p className="text-sm text-neutral-500 p-4">Nenhuma unidade com esses filtros.</p>}
          {assets && assets.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500 font-mono uppercase border-b border-neutral-200 dark:border-neutral-800 sticky top-0 bg-white dark:bg-neutral-900 z-10">
                  <th className="px-4 py-2 font-normal">Código</th>
                  <th className="px-4 py-2 font-normal">Produto</th>
                  <th className="px-4 py-2 font-normal">Situação</th>
                  <th className="px-4 py-2 font-normal">Onde está</th>
                  <th className="px-4 py-2 font-normal text-right" title="Locações em que a unidade foi">Usos</th>
                  <th className="px-4 py-2 font-normal text-right" title="Dias locada, somando todas as locações">Dias</th>
                  <th className="px-4 py-2 font-normal text-right" title="Ocupação nos últimos 90 dias">Ocup. 90d</th>
                  <th className="px-4 py-2 font-normal"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map(a => { const u = usage[a.id]; return (
                  <tr key={a.id} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-4 py-2 font-mono">{a.code}</td>
                    <td className="px-4 py-2">{a.productName}</td>
                    <td className="px-4 py-2">
                      <select aria-label={`Situação de ${a.code}`} value={a.status} onChange={e => changeStatus(a, e.target.value)}
                        className={`${ui.badge} ${ASSET_STATUS[a.status]?.cls} border-0 cursor-pointer`}>
                        {STATUS_ORDER.map(k => (
                          <option key={k} value={k} disabled={k === 'locado'}>{ASSET_STATUS[k].label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-xs text-neutral-500">
                      {a.currentRental ? `${a.currentRental.clientName}, até ${fmtShort(a.currentRental.endDate)}` : 'Pátio'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {u?.uses ?? '—'}
                      {u?.service === 'vencida' && <span title="Revisão preventiva vencida" className="ml-1 text-orange-600"><Wrench size={12} className="inline"/></span>}
                      {u?.service === 'proxima' && <span title="Revisão preventiva chegando" className="ml-1 text-amber-500"><Wrench size={12} className="inline"/></span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{u?.daysRented ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-xs">{u ? `${u.occupancy90}%` : '—'}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setHistoryOf(a)} aria-label={`Histórico de ${a.code}`} className="p-1.5 text-neutral-500 hover:text-brand-400"><History size={14}/></button>
                      <button onClick={() => removeAsset(a)} aria-label={`Excluir ${a.code}`} className="p-1.5 text-neutral-500 hover:text-red-400"><Trash2 size={14}/></button>
                    </td>
                  </tr>
                ); })}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-neutral-500 mt-2">
          "Locada" é marcado pelo app da equipe na entrega. Depois da retirada, a unidade fica em higienização até alguém liberar aqui.
        </p>
      </section>

      {/* Catálogo */}
      <section>
        <div className="flex items-center justify-between mb-3 gap-3">
          <h2 className="text-lg font-medium">Catálogo de produtos</h2>
          <button onClick={() => setProductForm(emptyProduct())} className={ui.secondary}>+ Novo produto</button>
        </div>
        {products && products.length === 0 && (
          <div className={`${ui.card} p-6 text-sm text-neutral-600 dark:text-neutral-400`}>
            Comece cadastrando o que você aluga, por exemplo "Banheiro Standard", "Banheiro PNE" ou "Tenda 10x10".
          </div>
        )}
        <div className="flex flex-col gap-2">
          {(products || []).map(p => (
            <div key={p.id} className={`${ui.card} px-4 py-3 flex items-center justify-between gap-3 ${p.active ? '' : 'opacity-60'}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {p.name} <span className="text-xs font-normal text-neutral-500">{CATEGORY_LABEL[p.category]}{!p.active && ', desativado'}</span>
                </p>
                <p className="text-xs text-neutral-500">
                  {p.dailyPrice != null ? `${fmtBRL(p.dailyPrice)}/dia` : 'Sem preço'}
                  {p.cleaningIntervalDays ? `, limpeza a cada ${p.cleaningIntervalDays} dia(s)` : ''}
                  {`, ${p.turnaroundDays ?? 0} dia(s) parado após voltar`}
                  {(p.serviceEveryUses || p.serviceEveryDays) ? `, revisão a cada ${[p.serviceEveryUses && `${p.serviceEveryUses} locações`, p.serviceEveryDays && `${p.serviceEveryDays} dias`].filter(Boolean).join(' ou ')}` : ''}
                </p>
              </div>
              <button onClick={() => setProductForm({ ...p })} aria-label={`Editar ${p.name}`} className="p-1.5 text-neutral-500 hover:text-brand-400 shrink-0"><Edit2 size={14}/></button>
            </div>
          ))}
        </div>
      </section>

      {productForm && (
        <ProductModal value={productForm} onClose={() => setProductForm(null)}
          onSaved={async () => { setProductForm(null); await loadProducts(); await refreshAll(); }} />
      )}
      {showBulk && (
        <BulkAssetsModal products={(products || []).filter(p => p.active)} onClose={() => setShowBulk(false)}
          onSaved={refreshAll} onPrint={(codes) => { setShowBulk(false); setLabels({ codes }); }} />
      )}
      {labels && <LabelsModal products={products || []} presetCodes={labels.codes} onClose={() => setLabels(null)} />}
      {historyOf && <HistoryModal asset={historyOf} onClose={() => setHistoryOf(null)} onChanged={loadUsage} />}
    </div>
  );
}

function emptyProduct(){
  return { category: 'banheiro', name: '', dailyPrice: '', cleaningIntervalDays: 3, turnaroundDays: 1, setupMinutes: 30, teardownMinutes: 30, active: true };
}

function ProductModal({ value, onClose, onSaved }){
  const [p, setP] = useState(value);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value });

  const save = async () => {
    setSaving(true); setError('');
    const payload = { ...p, cleaningIntervalDays: p.category === 'banheiro' ? p.cleaningIntervalDays : null };
    try{
      if(p.id) await api.productTypes.update(p.id, payload);
      else await api.productTypes.create(payload);
      onSaved();
    }catch(err){ setError(err.message); setSaving(false); }
  };

  const remove = async () => {
    if(!window.confirm(`Excluir "${p.name}"?`)) return;
    try{ await api.productTypes.remove(p.id); onSaved(); }
    catch(err){ setError(err.message); }
  };

  return (
    <Modal title={p.id ? `Editar ${value.name}` : 'Novo produto'} onClose={onClose} footer={
      <div className="flex justify-between gap-2">
        {p.id ? <button onClick={remove} className={ui.danger}>Excluir</button> : <span/>}
        <div className="flex gap-2">
          <button onClick={onClose} className={ui.secondary}>Cancelar</button>
          <button onClick={save} disabled={!p.name.trim() || saving} className={ui.primary}>{saving ? 'Salvando...' : 'Salvar produto'}</button>
        </div>
      </div>
    }>
      <div className="flex flex-col gap-3">
        <div>
          <label className={ui.label}>Tipo</label>
          <div className="flex gap-2">
            {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
              <button key={k} onClick={() => setP({ ...p, category: k })} aria-pressed={p.category === k}
                className={`flex-1 px-3 py-2 rounded text-sm border-2 ${p.category === k ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40' : 'border-neutral-200 dark:border-neutral-700'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={ui.label} htmlFor="pm-name">Nome</label>
          <input id="pm-name" value={p.name} onChange={set('name')} placeholder="Ex.: Banheiro PNE" className={`${ui.input} w-full`} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={ui.label} htmlFor="pm-price">Diária (R$)</label>
            <input id="pm-price" value={p.dailyPrice ?? ''} onChange={set('dailyPrice')} placeholder="0,00" className={`${ui.input} w-full`} />
          </div>
          <div>
            <label className={ui.label} htmlFor="pm-turn">Dias parado após voltar</label>
            <input id="pm-turn" type="number" min="0" value={p.turnaroundDays ?? 0} onChange={set('turnaroundDays')} className={`${ui.input} w-full`} />
          </div>
          {p.category === 'banheiro' && (
            <div className="col-span-2">
              <label className={ui.label} htmlFor="pm-clean">Limpeza no local a cada quantos dias</label>
              <input id="pm-clean" type="number" min="1" value={p.cleaningIntervalDays ?? ''} onChange={set('cleaningIntervalDays')} className={`${ui.input} w-full`} />
              <p className="text-xs text-neutral-500 mt-1">Vazio = sem limpezas automáticas.</p>
            </div>
          )}
          <div>
            <label className={ui.label} htmlFor="pm-setup">{p.category === 'tenda' ? 'Montagem' : 'Instalação'} (min/un.)</label>
            <input id="pm-setup" type="number" min="0" value={p.setupMinutes ?? 30} onChange={set('setupMinutes')} className={`${ui.input} w-full`} />
          </div>
          <div>
            <label className={ui.label} htmlFor="pm-tear">{p.category === 'tenda' ? 'Desmontagem' : 'Retirada'} (min/un.)</label>
            <input id="pm-tear" type="number" min="0" value={p.teardownMinutes ?? 30} onChange={set('teardownMinutes')} className={`${ui.input} w-full`} />
          </div>
        </div>
        <div>
          <p className={ui.label}>Revisão preventiva (opcional)</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1" htmlFor="pm-svc-uses">A cada quantas locações</label>
              <input id="pm-svc-uses" type="number" min="1" value={p.serviceEveryUses ?? ''} onChange={set('serviceEveryUses')} placeholder="ex.: 30" className={`${ui.input} w-full`} />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1" htmlFor="pm-svc-days">Ou a cada quantos dias locada</label>
              <input id="pm-svc-days" type="number" min="1" value={p.serviceEveryDays ?? ''} onChange={set('serviceEveryDays')} placeholder="ex.: 120" className={`${ui.input} w-full`} />
            </div>
          </div>
          <p className="text-xs text-neutral-500 mt-1">O que vencer primeiro. A plataforma avisa no Estoque quando uma unidade chegar ao limite.</p>
        </div>
        {p.id && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={p.active} onChange={e => setP({ ...p, active: e.target.checked })} />
            Ativo (desmarque para tirar do catálogo sem perder o histórico)
          </label>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

function BulkAssetsModal({ products, onClose, onSaved, onPrint }){
  const [form, setForm] = useState({ productTypeId: products[0]?.id || '', prefix: '', count: 10, startNumber: 1 });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const n = parseInt(form.count) || 0;
  const start = parseInt(form.startNumber) || 1;
  const prefix = form.prefix.trim().toUpperCase();
  const preview = prefix && n > 0
    ? `${prefix}-${String(start).padStart(3, '0')}${n > 1 ? ` até ${prefix}-${String(start + n - 1).padStart(3, '0')}` : ''}`
    : '';

  const save = async () => {
    setSaving(true); setError('');
    try{
      const r = await api.assets.bulk({ ...form, count: n, startNumber: start });
      setResult(r);
      await onSaved();
    }catch(err){ setError(err.message); }
    setSaving(false);
  };

  return (
    <Modal title="Cadastrar unidades" onClose={onClose} footer={
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={ui.secondary}>{result ? 'Fechar' : 'Cancelar'}</button>
        {!result && <button onClick={save} disabled={!form.productTypeId || !prefix || n < 1 || saving} className={ui.primary}>
          {saving ? 'Cadastrando...' : `Cadastrar ${n || ''} unidade${n === 1 ? '' : 's'}`}
        </button>}
      </div>
    }>
      {result ? (
        <div className="text-sm flex flex-col gap-2">
          <p>{result.created} unidade(s) cadastrada(s).</p>
          {result.created > 0 && onPrint && (
            <button onClick={() => {
              const codes = Array.from({ length: n }, (_, i) => `${prefix}-${String(start + i).padStart(3, '0')}`).filter(c => !result.skipped.includes(c));
              onPrint(codes);
            }} className={`${ui.primary} self-start flex items-center gap-1.5`}><Printer size={14}/> Imprimir as etiquetas dessas unidades</button>
          )}
          {result.skipped.length > 0 && (
            <p className="text-amber-700 dark:text-amber-400">Já existiam e foram puladas: {result.skipped.join(', ')}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <label className={ui.label} htmlFor="ba-product">Produto</label>
            <select id="ba-product" value={form.productTypeId} onChange={set('productTypeId')} className={`${ui.input} w-full`}>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={ui.label} htmlFor="ba-prefix">Prefixo</label>
              <input id="ba-prefix" value={form.prefix} onChange={set('prefix')} placeholder="BQ" className={`${ui.input} w-full uppercase`} />
            </div>
            <div>
              <label className={ui.label} htmlFor="ba-count">Quantidade</label>
              <input id="ba-count" type="number" min="1" max="1000" value={form.count} onChange={set('count')} className={`${ui.input} w-full`} />
            </div>
            <div>
              <label className={ui.label} htmlFor="ba-start">Começa em</label>
              <input id="ba-start" type="number" min="1" value={form.startNumber} onChange={set('startNumber')} className={`${ui.input} w-full`} />
            </div>
          </div>
          {preview && <p className="text-sm text-neutral-600 dark:text-neutral-400">Códigos: <span className="font-mono">{preview}</span></p>}
          <p className="text-xs text-neutral-500">Use o mesmo código da etiqueta colada em cada unidade. É ele que a equipe digita na entrega e na retirada.</p>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

function HistoryModal({ asset, onClose, onChanged }){
  const [rows, setRows] = useState(null);
  const [usage, setUsage] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = () => {
    api.assets.history(asset.id).then(setRows).catch(() => setRows([]));
    api.assets.usageOf(asset.id).then(setUsage).catch(() => setUsage(null));
  };
  useEffect(load, [asset.id]);
  const registerService = async () => {
    const notes = window.prompt('Revisão feita. O que foi verificado ou trocado? (opcional)');
    if(notes === null) return;
    setSaving(true);
    try{ await api.assets.service(asset.id, notes.trim()); load(); onChanged?.(); }catch(e){ window.alert(e.message); }
    setSaving(false);
  };
  return (
    <Modal size="lg" title={<span>Histórico de <span className="font-mono">{asset.code}</span></span>} onClose={onClose}>
      <div className="flex items-center gap-2 mb-4 text-sm">
        <span className="text-neutral-500">{asset.productName}</span>
        <StatusBadge meta={ASSET_STATUS[asset.status]} />
      </div>
      {usage && <UsagePanel u={usage} onService={registerService} saving={saving} />}
      <p className={ui.label}>Movimentações</p>
      {!rows && <p className="text-sm text-neutral-500 font-mono">Carregando...</p>}
      {rows && rows.length === 0 && <p className="text-sm text-neutral-500">Essa unidade ainda não saiu para nenhuma locação.</p>}
      {rows && rows.length > 0 && (
        <ol className="flex flex-col gap-3 border-l-2 border-neutral-200 dark:border-neutral-800 pl-4">
          {rows.map(h => (
            <li key={h.id} className="text-sm">
              <p className="text-xs font-mono text-neutral-500">{new Date(h.createdAt).toLocaleString('pt-BR')}</p>
              <p>
                {MOVEMENT_LABEL[h.movement] || h.movement}
                {h.condition && h.condition !== 'ok' && <span className="text-red-500"> ({h.condition})</span>}
              </p>
              {(h.clientName || h.siteName) && <p className="text-xs text-neutral-500">{[h.clientName, h.siteName].filter(Boolean).join(', ')}</p>}
              {h.notes && <p className="text-xs text-neutral-500">{h.notes}</p>}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// IMPRESSÃO DE ETIQUETAS
// ---------------------------------------------------------------------------
const codeCmp = (a, b) => a.localeCompare(b, 'pt-BR', { numeric: true });

function LabelsModal({ products, presetCodes, onClose }){
  const [all, setAll] = useState(null);
  const [productTypeId, setProductTypeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [size, setSize] = useState('padrao');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.assets.list({}).then(setAll).catch(e => setError(e.message)); }, []);

  const list = (all || [])
    .filter(a => a.status !== 'baixado')
    .filter(a => presetCodes ? presetCodes.includes(a.code) : true)
    .filter(a => !productTypeId || a.productTypeId === productTypeId)
    .filter(a => !from.trim() || codeCmp(a.code, from.trim().toUpperCase()) >= 0)
    .filter(a => !to.trim() || codeCmp(a.code, to.trim().toUpperCase()) <= 0)
    .sort((a, b) => codeCmp(a.code, b.code));
  const sz = LABEL_SIZES[size];
  const sheets = Math.ceil(list.length / (sz.cols * sz.rows));

  const print = async () => {
    setBusy(true); setError('');
    try{ await printLabels(list.map(a => ({ code: a.code, productName: a.productName })), size); }
    catch(e){ setError(e.message); }
    setBusy(false);
  };

  return (
    <Modal title="Imprimir etiquetas" onClose={onClose} footer={
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-neutral-500">{all ? `${list.length} etiqueta(s) · ${sheets} folha(s) A4` : 'Carregando...'}</span>
        <div className="flex gap-2">
          <button onClick={onClose} className={ui.secondary}>Fechar</button>
          <button onClick={print} disabled={!list.length || busy} className={`${ui.primary} flex items-center gap-1.5`}><Printer size={14}/> {busy ? 'Gerando...' : 'Imprimir'}</button>
        </div>
      </div>
    }>
      <div className="flex flex-col gap-3">
        {presetCodes ? (
          <p className="text-sm">Etiquetas das {presetCodes.length} unidade(s) que você acabou de cadastrar.</p>
        ) : (
          <>
            <div>
              <label className={ui.label} htmlFor="lb-prod">Produto</label>
              <select id="lb-prod" value={productTypeId} onChange={e => setProductTypeId(e.target.value)} className={`${ui.input} w-full`}>
                <option value="">Todos</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={ui.label} htmlFor="lb-from">Do código</label>
                <input id="lb-from" value={from} onChange={e => setFrom(e.target.value)} placeholder="ex.: BQ-021" className={`${ui.input} w-full font-mono uppercase`} />
              </div>
              <div>
                <label className={ui.label} htmlFor="lb-to">Até o código</label>
                <input id="lb-to" value={to} onChange={e => setTo(e.target.value)} placeholder="ex.: BQ-040" className={`${ui.input} w-full font-mono uppercase`} />
              </div>
            </div>
          </>
        )}
        <div>
          <p className={ui.label}>Tamanho</p>
          <div className="flex flex-col gap-1.5">
            {Object.entries(LABEL_SIZES).map(([k, v]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="radio" name="lb-size" checked={size === k} onChange={() => setSize(k)} /> {v.label}
              </label>
            ))}
          </div>
        </div>
        {list.length > 0 && (
          <p className="text-xs text-neutral-500 font-mono truncate">{list.slice(0, 8).map(a => a.code).join(', ')}{list.length > 8 ? ` … ${list[list.length - 1].code}` : ''}</p>
        )}
        <p className="text-xs text-neutral-500">Imprima em escala 100%. Para uso em campo, prefira etiqueta de vinil ou poliéster com laminação: o papel comum não resiste à lavagem dos banheiros.</p>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// CONTADOR DE USO DE UMA UNIDADE
// ---------------------------------------------------------------------------
function UsagePanel({ u, onService, saving }){
  const card = (value, label, warn) => (
    <div className={`rounded-lg px-3 py-2 ${warn ? 'bg-orange-50 dark:bg-orange-950/40' : 'bg-neutral-100 dark:bg-neutral-800'}`}>
      <p className={`text-lg font-semibold tabular-nums ${warn ? 'text-orange-700 dark:text-orange-300' : ''}`}>{value}</p>
      <p className="text-[11px] text-neutral-500 leading-tight">{label}</p>
    </div>
  );
  const svcText = u.service === 'vencida' ? 'Revisão vencida' : u.service === 'proxima' ? 'Revisão chegando' : u.service === 'ok' ? 'Revisão em dia' : null;
  const limits = [u.serviceEveryUses && `${u.serviceEveryUses} locações`, u.serviceEveryDays && `${u.serviceEveryDays} dias locada`].filter(Boolean).join(' ou ');
  return (
    <div className="flex flex-col gap-3 mb-5">
      <div className="grid grid-cols-3 gap-2">
        {card(u.uses, u.uses === 1 ? 'locação' : 'locações')}
        {card(u.daysRented, 'dias locada')}
        {card(u.cleanings, 'limpezas no local')}
        {card(u.damaged, u.damaged === 1 ? 'vez voltou danificada' : 'vezes voltou danificada', u.damaged > 0)}
        {card(fmtBRL(u.revenue), 'faturado (estimado)')}
        {card(`${u.occupancy90}%`, 'ocupação nos últimos 90 dias')}
      </div>
      <div className={`rounded-lg border px-3 py-2.5 text-sm flex items-center gap-3 flex-wrap ${u.service === 'vencida' ? 'border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30' : 'border-neutral-200 dark:border-neutral-800'}`}>
        <Wrench size={16} className={u.service === 'vencida' ? 'text-orange-600' : 'text-neutral-500'} />
        <div className="flex-1 min-w-0">
          {svcText ? <p className="font-medium">{svcText}</p> : <p className="font-medium">Revisão preventiva</p>}
          <p className="text-xs text-neutral-500">
            Desde a última revisão{u.lastServiceAt ? ` (${new Date(u.lastServiceAt).toLocaleDateString('pt-BR')})` : ' (nenhuma registrada)'}: {u.usesSinceService} locação(ões), {u.daysSinceService} dia(s) locada.
            {limits ? ` Revisar a cada ${limits}.` : ' Defina o intervalo de revisão no cadastro do produto.'}
          </p>
        </div>
        <button onClick={onService} disabled={saving} className={`${ui.secondary} !py-1.5 text-xs whitespace-nowrap`}>{saving ? 'Salvando...' : 'Registrar revisão feita'}</button>
      </div>
      {u.history?.length > 0 && (
        <div>
          <p className={ui.label}>Locações desta unidade</p>
          <ul className="text-sm divide-y divide-neutral-200 dark:divide-neutral-800 border-y border-neutral-200 dark:border-neutral-800">
            {u.history.slice().reverse().map((h, i) => (
              <li key={i} className="py-1.5 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {h.osCode && <span className="font-mono text-xs mr-1.5 text-neutral-500">{h.osCode}</span>}
                  {h.clientName}
                </span>
                <span className="text-xs text-neutral-500 whitespace-nowrap">
                  {new Date(h.deliveredAt).toLocaleDateString('pt-BR')} · {h.days} dia(s){h.cleanings ? ` · ${h.cleanings} limp.` : ''}
                  {!h.returnedAt ? ' · no local' : h.returnCondition && h.returnCondition !== 'ok' ? <span className="text-red-500"> · {h.returnCondition}</span> : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
