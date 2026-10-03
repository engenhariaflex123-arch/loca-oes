import { uid, addDays, today, HttpError } from '../utils.js';

// Que tipo de visita cada categoria gera no início e no fim da locação
const KINDS_BY_CATEGORY = {
  tenda:     { start: 'montagem', end: 'desmontagem' },
  banheiro:  { start: 'entrega',  end: 'retirada' },
  acessorio: { start: 'entrega',  end: 'retirada' },
};

const LABELS = {
  entrega: 'Entrega', montagem: 'Montagem', limpeza: 'Limpeza',
  retirada: 'Retirada', desmontagem: 'Desmontagem',
};

function summary(items){
  return items.map(i => `${i.quantity}x ${i.name}`).join(', ');
}

// Monta o plano de visitas de uma locação (sem gravar nada)
export function buildSchedule(rental, items){
  const pick = it => ({ productTypeId: it.product_type_id, name: it.name, quantity: it.quantity });
  const groups = {};
  for(const it of items){
    const k = KINDS_BY_CATEGORY[it.category] || KINDS_BY_CATEGORY.acessorio;
    (groups[k.start] ||= { end: k.end, items: [] }).items.push(pick(it));
  }

  const plan = [];
  for(const [startKind, g] of Object.entries(groups)){
    plan.push({ kind: startKind, date: rental.start_date, items: g.items });
    plan.push({ kind: g.end, date: rental.end_date, items: g.items });
  }

  // Limpezas periódicas: usa o menor intervalo entre os banheiros da locação
  const toilets = items.filter(i => i.category === 'banheiro');
  const intervals = toilets.map(i => i.cleaning_interval_days).filter(n => n > 0);
  if(intervals.length){
    const every = Math.min(...intervals);
    for(let d = addDays(rental.start_date, every); d < rental.end_date; d = addDays(d, every)){
      plan.push({ kind: 'limpeza', date: d, items: toilets.map(pick) });
    }
  }

  plan.sort((a, b) => a.date.localeCompare(b.date));
  return plan.map(p => ({ ...p, notes: `${LABELS[p.kind] || p.kind} — ${summary(p.items)}` }));
}

// (Re)gera as O.S. automáticas de uma locação.
// Apaga só as automáticas ainda pendentes; o que já foi feito é preservado.
export async function generateAppointments(db, rentalId){
  const { rows: [rental] } = await db.query('SELECT * FROM rentals WHERE id=$1', [rentalId]);
  if(!rental) throw new HttpError(404, 'Locação não encontrada.');
  if(!rental.team_id) throw new HttpError(400, 'Defina a equipe responsável pela locação.');

  const { rows: items } = await db.query(
    `SELECT ri.product_type_id, ri.quantity, pt.name, pt.category, pt.cleaning_interval_days
       FROM rental_items ri JOIN product_types pt ON pt.id = ri.product_type_id
      WHERE ri.rental_id = $1`,
    [rentalId]
  );

  await db.query(
    `DELETE FROM appointments WHERE rental_id=$1 AND auto_generated AND status='pendente'`,
    [rentalId]
  );

  // O que já aconteceu não é recriado
  const { rows: done } = await db.query(
    `SELECT kind, date FROM appointments WHERE rental_id=$1 AND status IN ('concluido', 'em_rota')`,
    [rentalId]
  );
  const doneKinds = new Set(done.filter(d => d.kind !== 'limpeza').map(d => d.kind));
  const doneCleanings = new Set(done.filter(d => d.kind === 'limpeza').map(d => d.date));

  // Tarefas padrão por tipo de visita (opcional), ex.: settings "default_tasks_by_kind"
  // = { "limpeza": ["idSuccao", "idHigienizacao", "idReposicaoPapel"] }
  const { rows: s } = await db.query(`SELECT value FROM settings WHERE key='default_tasks_by_kind'`);
  const defaultTasks = s[0]?.value || {};

  const now = today();
  let created = 0;
  for(const p of buildSchedule(rental, items)){
    if(p.kind === 'limpeza' && (doneCleanings.has(p.date) || p.date < now)) continue;
    if(p.kind !== 'limpeza' && doneKinds.has(p.kind)) continue;
    await db.query(
      `INSERT INTO appointments
         (id, date, client_id, team_id, task_ids, notes, status, rental_id, site_id, kind, items, auto_generated)
       VALUES ($1,$2,$3,$4,$5,$6,'pendente',$7,$8,$9,$10,true)`,
      [uid(), p.date, rental.client_id, rental.team_id, JSON.stringify(defaultTasks[p.kind] || []),
       p.notes, rental.id, rental.site_id, p.kind, JSON.stringify(p.items)]
    );
    created++;
  }
  return created;
}
