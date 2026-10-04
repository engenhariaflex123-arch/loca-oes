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

// Contrato mensal: as limpezas são criadas só até este horizonte e estendidas automaticamente
export const MONTHLY_HORIZON_DAYS = 28;
const weekday = (key) => new Date(key + 'T12:00:00Z').getUTCDay();

// Monta o plano de visitas de uma locação (sem gravar nada)
export function buildSchedule(rental, items, { horizon = null } = {}){
  const pick = it => ({ productTypeId: it.product_type_id, name: it.name, quantity: it.quantity });
  const groups = {};
  for(const it of items){
    const k = KINDS_BY_CATEGORY[it.category] || KINDS_BY_CATEGORY.acessorio;
    (groups[k.start] ||= { end: k.end, items: [] }).items.push(pick(it));
  }

  const plan = [];
  for(const [startKind, g] of Object.entries(groups)){
    plan.push({ kind: startKind, date: rental.start_date, items: g.items });
    // Mensal por prazo indeterminado: sem retirada até o cliente pedir
    if(rental.end_date) plan.push({ kind: g.end, date: rental.end_date, items: g.items });
  }

  const toilets = items.filter(i => i.category === 'banheiro');
  const monthly = rental.billing === 'mensal';
  // Até onde criar limpezas: fim do contrato e, no mensal, no máximo o horizonte (as próximas semanas)
  let limit = rental.end_date || null;                 // exclusivo: a limpeza fica antes da retirada
  if(monthly){
    const h = horizon || addDays(today(), MONTHLY_HORIZON_DAYS);
    const hEx = addDays(h, 1);
    limit = !limit || hEx < limit ? hEx : limit;
  }
  if(toilets.length && limit){
    const days = Array.isArray(rental.cleaning_weekdays) ? rental.cleaning_weekdays.map(Number) : [];
    if(monthly && days.length){
      // Mensal: limpezas nos dias da semana combinados (ex.: segunda e quinta)
      for(let d = addDays(rental.start_date, 1); d < limit; d = addDays(d, 1)){
        if(days.includes(weekday(d))) plan.push({ kind: 'limpeza', date: d, items: toilets.map(pick) });
      }
    }else{
      // Diária (ou mensal sem dias definidos): a cada N dias, pelo menor intervalo dos banheiros
      const intervals = toilets.map(i => i.cleaning_interval_days).filter(n => n > 0);
      if(intervals.length){
        const every = Math.min(...intervals);
        for(let d = addDays(rental.start_date, every); d < limit; d = addDays(d, every)){
          plan.push({ kind: 'limpeza', date: d, items: toilets.map(pick) });
        }
      }
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

// Contrato mensal: acrescenta as limpezas que faltam até o horizonte (próximas semanas).
// Só INSERE datas novas; nunca apaga nem recria visitas existentes (preserva equipe, histórico e eventos).
// As limpezas novas herdam a equipe da limpeza mais recente do contrato.
export async function extendRecurring(db, rentalId){
  const { rows: [rental] } = await db.query('SELECT * FROM rentals WHERE id=$1', [rentalId]);
  if(!rental || rental.billing !== 'mensal' || !['confirmado', 'em_andamento'].includes(rental.status)) return 0;
  const { rows: items } = await db.query(
    `SELECT ri.product_type_id, ri.quantity, pt.name, pt.category, pt.cleaning_interval_days
       FROM rental_items ri JOIN product_types pt ON pt.id = ri.product_type_id WHERE ri.rental_id = $1`, [rentalId]);
  const { rows: existing } = await db.query(
    `SELECT date, team_id FROM appointments WHERE rental_id=$1 AND kind='limpeza' ORDER BY date DESC`, [rentalId]);
  const have = new Set(existing.map(e => String(e.date)));
  const team = existing.find(e => e.team_id)?.team_id || rental.team_id || null;
  const { rows: s } = await db.query(`SELECT value FROM settings WHERE key='default_tasks_by_kind'`);
  const tasks = s[0]?.value?.limpeza || [];
  const now = today();
  let created = 0;
  for(const p of buildSchedule(rental, items)){
    if(p.kind !== 'limpeza' || p.date < now || have.has(p.date)) continue;
    await db.query(
      `INSERT INTO appointments (id, date, client_id, team_id, task_ids, notes, status, rental_id, site_id, kind, items, auto_generated)
       VALUES ($1,$2,$3,$4,$5,$6,'pendente',$7,$8,'limpeza',$9,true)`,
      [uid(), p.date, rental.client_id, team, JSON.stringify(tasks), p.notes, rental.id, rental.site_id, JSON.stringify(p.items)]);
    created++;
  }
  return created;
}

// Roda ao subir o servidor e a cada 6 horas para todos os contratos mensais ativos
export function startRecurringJob(pool){
  const run = async () => {
    try{
      const { rows } = await pool.query(`SELECT id FROM rentals WHERE billing='mensal' AND status IN ('confirmado','em_andamento')`);
      let total = 0;
      for(const r of rows) total += await extendRecurring(pool, r.id);
      if(total) console.log(`Contratos mensais: ${total} limpeza(s) nova(s) na Agenda.`);
    }catch(err){ console.error('Contratos mensais:', err.message); }
  };
  setTimeout(run, 15000);
  setInterval(run, 6 * 3600 * 1000);
}
