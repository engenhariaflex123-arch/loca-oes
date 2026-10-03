import React, { useState, useEffect } from 'react';
import { Edit2, Trash2, History, Search } from 'lucide-react';
import { api } from './api.js';
import { CATEGORY_LABEL, ASSET_STATUS, fmtBRL, fmtShort, ui } from './constants.js';
import { Modal, StatusBadge } from './locacoes.jsx';

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
  const [error, setError] = useState('');

  const loadProducts = async () => {
    const all = await api.productTypes.list(true);
    setProducts(all);
    setProductTypes(all.filter(p => p.active));
  };
  const loadSummary = async () => setSummary(await api.assets.summary());
  const loadAssets = async () => setAssets(await api.assets.list(filters));

  useEffect(() => { loadProducts().catch(e => setError(e.message)); loadSummary().catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => loadAssets().catch(e => setError(e.message)), filters.code ? 250 : 0);
    return () => clearTimeout(t);
  }, [filters.productTypeId, filters.status, filters.code]);

  const refreshAll = async () => { await Promise.all([loadSummary(), loadAssets()]); };

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
          <button onClick={() => setShowBulk(true)} disabled={!products?.some(p => p.active)} className={ui.primary}>+ Cadastrar unidades</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
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
                  <th className="px-4 py-2 font-normal"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {assets.map(a => (
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
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setHistoryOf(a)} aria-label={`Histórico de ${a.code}`} className="p-1.5 text-neutral-500 hover:text-brand-400"><History size={14}/></button>
                      <button onClick={() => removeAsset(a)} aria-label={`Excluir ${a.code}`} className="p-1.5 text-neutral-500 hover:text-red-400"><Trash2 size={14}/></button>
                    </td>
                  </tr>
                ))}
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
          onSaved={refreshAll} />
      )}
      {historyOf && <HistoryModal asset={historyOf} onClose={() => setHistoryOf(null)} />}
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

function BulkAssetsModal({ products, onClose, onSaved }){
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

function HistoryModal({ asset, onClose }){
  const [rows, setRows] = useState(null);
  useEffect(() => { api.assets.history(asset.id).then(setRows).catch(() => setRows([])); }, [asset.id]);
  return (
    <Modal title={<span>Histórico de <span className="font-mono">{asset.code}</span></span>} onClose={onClose}>
      <div className="flex items-center gap-2 mb-4 text-sm">
        <span className="text-neutral-500">{asset.productName}</span>
        <StatusBadge meta={ASSET_STATUS[asset.status]} />
      </div>
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
