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
  // team_id pode ser nulo: as visitas ficam "sem equipe" até o gerente distribuir na Agenda

  const { rows: items } = await db.query(
    `SELECT ri.product_type_id, ri.quantity, pt.name, pt.category, pt.cleaning_interval_days
       FROM rental_items ri JOIN product_types pt ON pt.id = ri.product_type_id
      WHERE ri.rental_id = $1`,
    [rentalId]
  );

  // Guarda a distribuição feita pelo gerente (equipe, ordem na rota, horário ajustado)
  // para reaplicar nas visitas refeitas: editar a locação não pode desfazer a Agenda.
  const { rows: previous } = await db.query(
    `SELECT kind, date, team_id, route_order, time_window FROM appointments
      WHERE rental_id=$1 AND auto_generated AND status='pendente'`, [rentalId]
  );
  const keep = {};
  for(const p of previous){
    keep[`${p.kind}|${p.date}`] = p;
    if(p.team_id && !keep[p.kind]) keep[p.kind] = p; // mesma etapa em outra data
  }
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
    // Horário combinado com o cliente: entrega/montagem usa o da entrega; retirada/desmontagem, o da retirada
    const time = ['entrega', 'montagem'].includes(p.kind) ? rental.start_time
               : ['retirada', 'desmontagem'].includes(p.kind) ? rental.end_time : null;
    const same = keep[`${p.kind}|${p.date}`];
    const similar = same || keep[p.kind];
    await db.query(
      `INSERT INTO appointments
         (id, date, client_id, team_id, task_ids, notes, status, rental_id, site_id, kind, items, auto_generated, time_window, route_order)
       VALUES ($1,$2,$3,$4,$5,$6,'pendente',$7,$8,$9,$10,true,$11,$12)`,
      [uid(), p.date, rental.client_id, similar?.team_id || rental.team_id, JSON.stringify(defaultTasks[p.kind] || []),
       p.notes, rental.id, rental.site_id, p.kind, JSON.stringify(p.items),
       time || same?.time_window || null, same?.route_order ?? null]
    );
    created++;
  }
  return created;
}
