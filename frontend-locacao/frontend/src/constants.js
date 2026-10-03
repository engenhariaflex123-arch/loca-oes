export const TEAMS = [
  { id: 'verde',   name: 'Equipe Verde',   color: '#2f9e44', bg: '#ebfbee', text: '#2b8a3e' },
  { id: 'azul',    name: 'Equipe Azul',    color: '#1971c2', bg: '#e7f5ff', text: '#1864ab' },
  { id: 'laranja', name: 'Equipe Laranja', color: '#e8590c', bg: '#fff4e6', text: '#d9480f' },
  { id: 'roxo',    name: 'Equipe Roxa',    color: '#7c3aed', bg: '#f3e8ff', text: '#6b21a8' },
];

export function teamOf(id){ return TEAMS.find(t => t.id === id) || TEAMS[0]; }

// Tipos de visita gerados pelas locações
export const KIND_META = {
  entrega:     { label: 'Entrega' },
  montagem:    { label: 'Montagem' },
  limpeza:     { label: 'Limpeza' },
  retirada:    { label: 'Retirada' },
  desmontagem: { label: 'Desmontagem' },
  manutencao:  { label: 'Manutenção' },
  vistoria:    { label: 'Vistoria' },
};
export function kindLabel(kind){ return KIND_META[kind]?.label || 'Visita'; }

export const CATEGORY_LABEL = { tenda: 'Tenda', banheiro: 'Banheiro', acessorio: 'Acessório' };

export const RENTAL_STATUS = {
  orcamento:    { label: 'Orçamento',    cls: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300' },
  confirmado:   { label: 'Confirmada',   cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300' },
  em_andamento: { label: 'Em andamento', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' },
  encerrado:    { label: 'Encerrada',    cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' },
  cancelado:    { label: 'Cancelada',    cls: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300' },
};

// color = cor da barra no resumo de estoque
export const ASSET_STATUS = {
  disponivel:   { label: 'Disponível',   one: 'disponível', many: 'disponíveis', color: '#059669', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' },
  locado:       { label: 'Locada',       one: 'locada', many: 'locadas', color: '#0284c7', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300' },
  higienizacao: { label: 'Higienização', one: 'em higienização', many: 'em higienização', color: '#d97706', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' },
  manutencao:   { label: 'Manutenção',   one: 'em manutenção', many: 'em manutenção', color: '#ea580c', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300' },
  extraviado:   { label: 'Extraviada',   one: 'extraviada', many: 'extraviadas', color: '#dc2626', cls: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300' },
  baixado:      { label: 'Baixada',      one: 'baixada', many: 'baixadas', color: '#737373', cls: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400' },
};

export const APPT_STATUS = {
  pendente:      { label: 'Pendente',      cls: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300' },
  em_rota:       { label: 'Em rota',       cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300' },
  concluido:     { label: 'Concluída',     cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' },
  nao_realizado: { label: 'Não realizada', cls: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300' },
  cancelado:     { label: 'Cancelada',     cls: 'bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500' },
};

export function fmtBRL(n){
  if(n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
export function fmtDate(key){
  if(!key) return '';
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}
export function fmtShort(key){
  if(!key) return '';
  const [, m, d] = key.split('-');
  return `${d}/${m}`;
}
export function daysInclusive(start, end){
  if(!start || !end) return 0;
  return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000) + 1;
}

// Classes reaproveitadas (mesmo visual do resto da plataforma)
export const ui = {
  input: 'bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded px-3 py-2 text-sm',
  label: 'text-xs font-mono uppercase text-neutral-500 mb-1 block',
  card: 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg',
  primary: 'px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white font-medium',
  secondary: 'px-3 py-2 text-sm rounded border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800 disabled:opacity-40',
  danger: 'px-3 py-2 text-sm rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-40',
  badge: 'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium whitespace-nowrap',
};
