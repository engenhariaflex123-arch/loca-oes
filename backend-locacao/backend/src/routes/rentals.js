import { Router } from 'express';
import { pool } from '../db.js';
import { logAudit } from '../audit.js';
import { uid, isDate, diffDays, toNumber, HttpError, withTransaction } from '../utils.js';
import { getAvailability, findShortages, lockAvailability } from '../services/availability.js';
import { generateAppointments, extendRecurring } from '../services/schedule.js';
import { rentalCycles, pendingCycles } from '../services/billing.js';
import { addHistory, rentalTimeline } from '../services/history.js';
import { buildOsPdf } from '../services/osPdf.js';

const router = Router();
const ACTIVE = ['confirmado', 'em_andamento'];

const dmy = (d) => d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}/${String(d).slice(0, 4)}` : '';
const itemsText = (list) => list.map(i => `${i.quantity}× ${i.name}`).join(', ');
async function itemsWithNames(db, items){
  const { rows } = await db.query('SELECT id, name FROM product_types WHERE id = ANY($1)', [items.map(i => i.productTypeId)]);
  const name = Object.fromEntries(rows.map(r => [r.id, r.name]));
  return items.map(i => ({ productTypeId: i.productTypeId, quantity: Number(i.quantity), name: name[i.productTypeId] || 'produto' }));
}


const SELECT = `
  SELECT r.*, c.name AS client_name, s.name AS site_name, s.address AS site_address,
    COALESCE((
      SELECT json_agg(json_build_object(
               'productTypeId', ri.product_type_id, 'name', pt.name, 'category', pt.category,
               'quantity', ri.quantity, 'unitPrice', ri.unit_price)
             ORDER BY pt.category, pt.name)
        FROM rental_items ri JOIN product_types pt ON pt.id = ri.product_type_id
       WHERE ri.rental_id = r.id), '[]') AS items
  FROM rentals r
  LEFT JOIN clients c ON c.id = r.client_id
  LEFT JOIN sites s ON s.id = r.site_id`;

function toRental(r){
  return {
    id: r.id, osCode: r.os_code, clientId: r.client_id, clientName: r.client_name,
    siteId: r.site_id, siteName: r.site_name, siteAddress: r.site_address,
    startDate: r.start_date, endDate: r.end_date, startTime: r.start_time, endTime: r.end_time,
    status: r.status, teamId: r.team_id,
    billing: r.billing || 'diaria', cleaningWeekdays: r.cleaning_weekdays || [],
    totalValue: r.total_value, notes: r.notes, items: r.items || [], createdAt: r.created_at,
  };
}

async function fetchRental(db, id){
  const { rows } = await db.query(`${SELECT} WHERE r.id=$1`, [id]);
  if(!rows[0]) throw new HttpError(404, 'Locação não encontrada.');
  return toRental(rows[0]);
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeOrNull = (t) => (t && TIME_RE.test(t) ? t : null);

const billingOf = (b) => (b.billing === 'mensal' ? 'mensal' : 'diaria');
const weekdaysOf = (b) => (billingOf(b) === 'mensal' && Array.isArray(b.cleaningWeekdays)
  ? [...new Set(b.cleaningWeekdays.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
  : null);

function validate(body){
  const { clientId, startDate, items } = body;
  const monthly = billingOf(body) === 'mensal';
  // Mensal pode ser por prazo indeterminado (sem data de retirada)
  const endDate = body.endDate || null;
  for(const t of [body.startTime, body.endTime]){
    if(t && !TIME_RE.test(t)) throw new HttpError(400, 'Horário inválido (use HH:MM, ex.: 08:30).');
  }
  if(!clientId) throw new HttpError(400, 'Selecione o cliente.');
  if(!isDate(startDate)) throw new HttpError(400, 'Data de entrega inválida (use AAAA-MM-DD).');
  if(!endDate && !monthly) throw new HttpError(400, 'Informe a data de retirada.');
  if(endDate && !isDate(endDate)) throw new HttpError(400, 'Data de retirada inválida (use AAAA-MM-DD).');
  if(endDate && endDate < startDate) throw new HttpError(400, 'A data de retirada não pode ser antes da entrega.');
  if(!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Adicione pelo menos um item.');
  for(const it of items){
    const q = Number(it.quantity);
    if(!it.productTypeId || !Number.isInteger(q) || q <= 0) {
      throw new HttpError(400, 'Há um item com produto ou quantidade inválida.');
    }
  }
}

// Grava os itens e devolve o valor calculado.
// Diária: unitPrice = diária por unidade (padrão: diária do catálogo); total = diária × unidades × dias.
// Mensal: unitPrice = valor mensal por unidade (padrão: mensal do catálogo); total = valor de UM mês.
async function saveItems(db, rentalId, items, startDate, endDate, billing = 'diaria'){
  await db.query('DELETE FROM rental_items WHERE rental_id=$1', [rentalId]);
  const { rows } = await db.query(
    'SELECT id, daily_price, monthly_price FROM product_types WHERE id = ANY($1)',
    [items.map(i => i.productTypeId)]
  );
  const monthly = billing === 'mensal';
  const priceById = Object.fromEntries(rows.map(r => [r.id, monthly ? r.monthly_price : r.daily_price]));
  const days = monthly ? 1 : diffDays(startDate, endDate) + 1;
  let total = 0;
  for(const it of items){
    if(!(it.productTypeId in priceById)) throw new HttpError(400, 'Produto não encontrado no catálogo.');
    const unitPrice = toNumber(it.unitPrice) ?? priceById[it.productTypeId];
    await db.query(
      'INSERT INTO rental_items (id, rental_id, product_type_id, quantity, unit_price) VALUES ($1,$2,$3,$4,$5)',
      [uid(), rentalId, it.productTypeId, Number(it.quantity), unitPrice ?? null]
    );
    if(unitPrice) total += unitPrice * Number(it.quantity) * days;
  }
  return Math.round(total * 100) / 100;
}

// --- Listagem: ?status=confirmado,em_andamento&from=2026-10-01&to=2026-10-31&clientId=...
router.get('/', async (req, res) => {
  const conds = [], params = [];
  if(req.query.status){ params.push(req.query.status.split(',')); conds.push(`r.status = ANY($${params.length})`); }
  if(req.query.from){ params.push(req.query.from); conds.push(`COALESCE(r.end_date, DATE '9999-12-31') >= $${params.length}`); }
  if(req.query.to){ params.push(req.query.to); conds.push(`r.start_date <= $${params.length}`); }
  if(req.query.clientId){ params.push(req.query.clientId); conds.push(`r.client_id = $${params.length}`); }
  const { rows } = await pool.query(
    `${SELECT} ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY r.start_date DESC`,
    params
  );
  res.json(rows.map(toRental));
});

// --- Disponibilidade: ?start=2026-10-10&end=2026-10-12&excludeRentalId=...
router.get('/availability', async (req, res) => {
  const { start, end, excludeRentalId } = req.query;
  if(!isDate(start) || !isDate(end) || end < start) throw new HttpError(400, 'Informe início e fim válidos.');
  res.json(await getAvailability(pool, start, end, excludeRentalId || null));
});

// --- Achar a locação pelo código da O.S. (QR code, busca)
router.get('/by-code/:code', async (req, res) => {
  const { rows: [r] } = await pool.query('SELECT id FROM rentals WHERE upper(os_code)=upper($1)', [req.params.code.trim()]);
  if(!r) throw new HttpError(404, 'Nenhuma O.S. com esse código.');
  res.json(await fetchRental(pool, r.id));
});

// --- PDF da O.S. (pedido, etapas, visitas, unidades, histórico e comprovantes)
router.get('/:id/pdf', async (req, res) => {
  const ok = await buildOsPdf(req.params.id, res, req.user?.name);
  if(!ok) throw new HttpError(404, 'Locação não encontrada.');
});

// --- Meses fechados e ainda não faturados (todas as locações mensais)
router.get('/billing/pending', async (req, res) => {
  res.json(await pendingCycles());
});

// --- Resumo mensal de uma locação mensal (cada mês do contrato)
router.get('/:id/cycles', async (req, res) => {
  const c = await rentalCycles(req.params.id);
  if(!c) throw new HttpError(404, 'Locação não encontrada.');
  res.json(c);
});

// --- Marcar um mês como faturado (a nota sai no sistema de faturamento; aqui fica o registro)
router.post('/:id/cycles/:n/invoice', async (req, res) => {
  const n = parseInt(req.params.n);
  const c = await rentalCycles(req.params.id);
  const cyc = c?.cycles.find(x => x.n === n);
  if(!cyc) throw new HttpError(404, 'Mês do contrato não encontrado.');
  if(cyc.status === 'faturado') throw new HttpError(409, 'Esse mês já está marcado como faturado.');
  if(cyc.status === 'em_curso') throw new HttpError(409, 'Esse mês ainda não fechou.');
  const ref = String(req.body.invoiceRef || '').trim() || null;
  await pool.query(
    `INSERT INTO rental_invoices (rental_id, cycle_no, period_start, period_end, amount, invoice_ref, invoiced_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [req.params.id, n, cyc.start, cyc.end, cyc.amount, ref, req.user.name]);
  await addHistory(null, { rentalId: req.params.id, type: 'faturado', user: req.user,
    message: `Mês ${n} (${dmy(cyc.start)} a ${dmy(cyc.end)}) marcado como faturado: ${cyc.lines.map(l => `${l.count}× ${l.name}`).join(', ')} = R$ ${cyc.amount.toFixed(2).replace('.', ',')}${ref ? `. Nota/fatura ${ref}` : ''}.` });
  res.status(201).json({ ok: true });
});

router.delete('/:id/cycles/:n/invoice', async (req, res) => {
  const n = parseInt(req.params.n);
  const r = await pool.query('DELETE FROM rental_invoices WHERE rental_id=$1 AND cycle_no=$2 RETURNING invoice_ref', [req.params.id, n]);
  if(!r.rowCount) throw new HttpError(404, 'Esse mês não estava marcado como faturado.');
  await addHistory(null, { rentalId: req.params.id, type: 'faturado', user: req.user,
    message: `Marcação de faturado do mês ${n} desfeita${r.rows[0].invoice_ref ? ` (nota ${r.rows[0].invoice_ref})` : ''}.` });
  res.status(204).end();
});

// --- Locação mensal: o cliente pediu a retirada → define a data e agenda a retirada
router.post('/:id/request-pickup', async (req, res) => {
  const { date, time } = req.body;
  if(!isDate(date)) throw new HttpError(400, 'Informe a data da retirada.');
  if(time && !TIME_RE.test(time)) throw new HttpError(400, 'Horário inválido (use HH:MM).');
  const out = await withTransaction(async db => {
    const { rows: [cur] } = await db.query('SELECT * FROM rentals WHERE id=$1 FOR UPDATE', [req.params.id]);
    if(!cur) throw new HttpError(404, 'Locação não encontrada.');
    if(cur.billing !== 'mensal') throw new HttpError(400, 'Pedido de retirada é para locações mensais. Nas diárias, edite a data de retirada.');
    if(!ACTIVE.includes(cur.status)) throw new HttpError(409, 'Só contratos confirmados ou em andamento.');
    if(date < cur.start_date) throw new HttpError(400, 'A retirada não pode ser antes do início do contrato.');
    await db.query('UPDATE rentals SET end_date=$1, end_time=$2 WHERE id=$3', [date, timeOrNull(time), cur.id]);
    const generated = await generateAppointments(db, cur.id);
    await addHistory(db, { rentalId: cur.id, type: 'retirada_solicitada', user: req.user,
      message: `Cliente pediu a retirada: contrato mensal termina em ${dmy(date)}${time ? ` às ${time}` : ''}. Retirada agendada; limpezas depois dessa data foram removidas.` });
    return { rental: await fetchRental(db, cur.id), generated };
  });
  await logAudit(req.user, 'update', 'rental', `Retirada pedida — ${out.rental.clientName} em ${date}`);
  res.json(out.rental);
});

// --- História completa da O.S. (etapas + linha do tempo)
router.get('/:id/history', async (req, res) => {
  const t = await rentalTimeline(req.params.id);
  if(!t) throw new HttpError(404, 'Locação não encontrada.');
  res.json(t);
});

// --- Detalhe com unidades alocadas e O.S.
router.get('/:id', async (req, res) => {
  const rental = await fetchRental(pool, req.params.id);
  const assets = await pool.query(
    `SELECT a.id, a.code, pt.name AS product_name, ra.delivered_at, ra.returned_at, ra.return_condition
       FROM rental_assets ra JOIN assets a ON a.id = ra.asset_id
       JOIN product_types pt ON pt.id = a.product_type_id
      WHERE ra.rental_id = $1 ORDER BY a.code`,
    [req.params.id]
  );
  const appts = await pool.query(
    `SELECT id, date, kind, status, team_id, notes, time_window FROM appointments
      WHERE rental_id = $1 ORDER BY date, created_at`,
    [req.params.id]
  );
  res.json({
    ...rental,
    assets: assets.rows.map(a => ({
      id: a.id, code: a.code, productName: a.product_name,
      deliveredAt: a.delivered_at, returnedAt: a.returned_at, returnCondition: a.return_condition,
    })),
    appointments: appts.rows.map(a => ({
      id: a.id, date: a.date, kind: a.kind, status: a.status, teamId: a.team_id,
      notes: a.notes, timeWindow: a.time_window,
    })),
  });
});

// --- Criar (sempre nasce como orçamento; não reserva estoque ainda)
router.post('/', async (req, res) => {
  validate(req.body);
  const { clientId, siteId, startDate, items, notes, teamId, totalValue, startTime, endTime } = req.body;
  const endDate = req.body.endDate || null;
  const billing = billingOf(req.body);
  const id = req.body.id || uid();
  const rental = await withTransaction(async db => {
    // Código da O.S. que acompanha a locação em todas as etapas: OS-AAAA-0001.
    // Contador próprio por ano, na mesma transação: sem buracos e sem reaproveitar número.
    const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date()));
    const { rows: [cnt] } = await db.query(
      `INSERT INTO os_counter (year, last) VALUES ($1, 1)
       ON CONFLICT (year) DO UPDATE SET last = os_counter.last + 1 RETURNING last`, [year]);
    const osCode = `OS-${year}-${String(cnt.last).padStart(4, '0')}`;
    await db.query(
      `INSERT INTO rentals (id, os_code, client_id, site_id, start_date, end_date, start_time, end_time, status, team_id, notes, created_by,
                            billing, cleaning_weekdays)
       VALUES ($1,$11,$2,$3,$4,$5,$6,$7,'orcamento',$8,$9,$10,$12,$13)`,
      [id, clientId, siteId || null, startDate, endDate, timeOrNull(startTime), timeOrNull(endTime), teamId || null, notes || null, req.user.id, osCode,
       billing, weekdaysOf(req.body)]
    );
    const computed = await saveItems(db, id, items, startDate, endDate, billing);
    await db.query('UPDATE rentals SET total_value=$1 WHERE id=$2', [toNumber(totalValue) ?? computed, id]);
    const named = await itemsWithNames(db, items);
    await addHistory(db, { rentalId: id, type: 'criada', user: req.user,
      message: billing === 'mensal'
        ? `Orçamento de locação mensal criado: ${itemsText(named)}, a partir de ${dmy(startDate)}${startTime ? ` às ${startTime}` : ''}${endDate ? ` até ${dmy(endDate)}` : ', por prazo indeterminado'}.`
        : `Orçamento criado: ${itemsText(named)}, de ${dmy(startDate)}${startTime ? ` às ${startTime}` : ''} a ${dmy(endDate)}${endTime ? ` às ${endTime}` : ''}.` });
    return fetchRental(db, id);
  });
  // Aviso antecipado: o orçamento é salvo mesmo se faltar estoque
  const shortages = await findShortages(pool, startDate, endDate, items, id);
  await logAudit(req.user, 'create', 'rental', `${rental.osCode} · ${rental.clientName} — ${startDate} a ${endDate || 'indeterminado'}`);
  res.status(201).json({ ...rental, shortages });
});

// --- Editar. Se já confirmada, revalida estoque e regenera as O.S. pendentes.
router.put('/:id', async (req, res) => {
  validate(req.body);
  const { clientId, siteId, startDate, items, notes, teamId, totalValue, startTime, endTime } = req.body;
  const endDate = req.body.endDate || null;
  const billing = billingOf(req.body);
  const { id } = req.params;
  const out = await withTransaction(async db => {
    await lockAvailability(db);
    const { rows: [cur] } = await db.query('SELECT * FROM rentals WHERE id=$1 FOR UPDATE', [id]);
    if(!cur) throw new HttpError(404, 'Locação não encontrada.');
    if(['encerrado', 'cancelado'].includes(cur.status)) {
      throw new HttpError(409, 'Locações encerradas ou canceladas não podem ser editadas.');
    }
    const active = ACTIVE.includes(cur.status);
    const { rows: oldItems } = await db.query(
      `SELECT ri.product_type_id AS "productTypeId", ri.quantity, pt.name FROM rental_items ri
         JOIN product_types pt ON pt.id = ri.product_type_id WHERE ri.rental_id=$1`, [id]);
    if(active){
      const shortages = await findShortages(db, startDate, endDate, items, id);
      if(shortages.length) throw new HttpError(409, 'Não há estoque suficiente para essa alteração.', { shortages });
    }
    await db.query(
      `UPDATE rentals SET client_id=$1, site_id=$2, start_date=$3, end_date=$4, team_id=$5, notes=$6,
         start_time=$8, end_time=$9, billing=$10, cleaning_weekdays=$11 WHERE id=$7`,
      [clientId, siteId || null, startDate, endDate, teamId || cur.team_id, notes || null, id, timeOrNull(startTime), timeOrNull(endTime),
       billing, weekdaysOf(req.body)]
    );
    const computed = await saveItems(db, id, items, startDate, endDate, billing);
    await db.query('UPDATE rentals SET total_value=$1 WHERE id=$2', [toNumber(totalValue) ?? computed, id]);
    const generated = active ? await generateAppointments(db, id) : 0;
    // O que mudou, em palavras
    const changes = [];
    const endTxt = (d) => d ? dmy(d) : 'indeterminado';
    if(cur.start_date !== startDate || (cur.end_date || null) !== endDate) changes.push(`período de ${dmy(cur.start_date)}–${endTxt(cur.end_date)} para ${dmy(startDate)}–${endTxt(endDate)}`);
    if((cur.billing || 'diaria') !== billing) changes.push(`cobrança ${cur.billing || 'diaria'} → ${billing}`);
    if(JSON.stringify(cur.cleaning_weekdays || []) !== JSON.stringify(weekdaysOf(req.body) || [])) changes.push('dias das limpezas');
    if((cur.start_time || '') !== (startTime || '')) changes.push(`horário da entrega ${cur.start_time || 'sem horário'} → ${startTime || 'sem horário'}`);
    if((cur.end_time || '') !== (endTime || '')) changes.push(`horário da retirada ${cur.end_time || 'sem horário'} → ${endTime || 'sem horário'}`);
    const named = await itemsWithNames(db, items);
    const sig = (l) => l.map(i => `${i.productTypeId}:${i.quantity}`).sort().join(',');
    if(sig(oldItems) !== sig(named)) changes.push(`itens de "${itemsText(oldItems)}" para "${itemsText(named)}"`);
    if((cur.site_id || null) !== (siteId || null)) changes.push('local de instalação');
    if(cur.client_id !== clientId) changes.push('cliente');
    if((cur.notes || '') !== (notes || '')) changes.push('observações');
    await addHistory(db, { rentalId: id, type: 'editada', user: req.user,
      message: changes.length ? `Locação alterada: ${changes.join('; ')}.` : 'Locação salva sem alterações relevantes.' });
    return { rental: await fetchRental(db, id), generated };
  });
  await logAudit(req.user, 'update', 'rental', `${out.rental.clientName} — ${startDate} a ${endDate || 'indeterminado'}`);
  res.json({ ...out.rental, generatedAppointments: out.generated });
});

// --- Confirmar: reserva o estoque e gera entrega, limpezas e retirada
router.post('/:id/confirm', async (req, res) => {
  const { id } = req.params;
  const out = await withTransaction(async db => {
    await lockAvailability(db);
    const { rows: [cur] } = await db.query('SELECT * FROM rentals WHERE id=$1 FOR UPDATE', [id]);
    if(!cur) throw new HttpError(404, 'Locação não encontrada.');
    if(cur.status !== 'orcamento') throw new HttpError(409, 'Somente orçamentos podem ser confirmados.');
    // A equipe é opcional: o comercial confirma e o gerente de logística distribui na Agenda
    const teamId = req.body.teamId || cur.team_id || null;

    const { rows: items } = await db.query(
      'SELECT product_type_id AS "productTypeId", quantity FROM rental_items WHERE rental_id=$1', [id]
    );
    const shortages = await findShortages(db, cur.start_date, cur.end_date, items, id);
    if(shortages.length) throw new HttpError(409, 'Não há estoque suficiente para confirmar.', { shortages });

    await db.query(`UPDATE rentals SET status='confirmado', team_id=$2 WHERE id=$1`, [id, teamId]);
    const generated = await generateAppointments(db, id);
    await extendRecurring(db, id);
    await addHistory(db, { rentalId: id, type: 'confirmada', user: req.user,
      message: `Locação confirmada e estoque reservado. ${generated} visita(s) enviada(s) para a Agenda${teamId ? '' : ', aguardando o gerente de logística distribuir'}.` });
    return { rental: await fetchRental(db, id), generated };
  });
  await logAudit(req.user, 'update', 'rental', `Confirmada — ${out.rental.clientName}`, { generated: out.generated });
  res.json({ ...out.rental, generatedAppointments: out.generated });
});

// --- Cancelar (só antes de os equipamentos saírem)
router.post('/:id/cancel', async (req, res) => {
  const { id } = req.params;
  const rental = await withTransaction(async db => {
    const { rows: [cur] } = await db.query('SELECT * FROM rentals WHERE id=$1 FOR UPDATE', [id]);
    if(!cur) throw new HttpError(404, 'Locação não encontrada.');
    if(!['orcamento', 'confirmado'].includes(cur.status)) {
      throw new HttpError(409, 'Essa locação já está em andamento. Faça a retirada e encerre em vez de cancelar.');
    }
    await db.query(`DELETE FROM appointments WHERE rental_id=$1 AND status='pendente'`, [id]);
    await db.query(`UPDATE rentals SET status='cancelado', notes=concat_ws(E'\n', notes, $2::text) WHERE id=$1`,
      [id, req.body.reason ? `Cancelada: ${req.body.reason}` : null]);
    await addHistory(db, { rentalId: id, type: 'cancelada', user: req.user,
      message: `Locação cancelada${req.body.reason ? `. Motivo: ${req.body.reason}` : '.'}` });
    return fetchRental(db, id);
  });
  await logAudit(req.user, 'update', 'rental', `Cancelada — ${rental.clientName}`, { reason: req.body.reason });
  res.json(rental);
});

// --- Encerrar manualmente.
// Se ainda houver unidades no local, é preciso dizer o que aconteceu com elas:
// { missingAssetsStatus: "extraviado" | "higienizacao" }
router.post('/:id/close', async (req, res) => {
  const { id } = req.params;
  const { missingAssetsStatus } = req.body;
  const rental = await withTransaction(async db => {
    const { rows: [cur] } = await db.query('SELECT * FROM rentals WHERE id=$1 FOR UPDATE', [id]);
    if(!cur) throw new HttpError(404, 'Locação não encontrada.');
    if(!ACTIVE.includes(cur.status)) throw new HttpError(409, 'Só locações confirmadas ou em andamento podem ser encerradas.');

    const { rows: missing } = await db.query(
      `SELECT a.id, a.code FROM rental_assets ra JOIN assets a ON a.id = ra.asset_id
        WHERE ra.rental_id=$1 AND ra.returned_at IS NULL`, [id]
    );
    if(missing.length){
      if(!['extraviado', 'higienizacao'].includes(missingAssetsStatus)){
        throw new HttpError(409, `${missing.length} unidade(s) ainda constam no local.`, {
          missingAssets: missing.map(m => m.code),
        });
      }
      for(const m of missing){
        await db.query(
          `UPDATE rental_assets SET returned_at=now(), return_condition=$3 WHERE rental_id=$1 AND asset_id=$2`,
          [id, m.id, missingAssetsStatus === 'extraviado' ? 'extraviado' : 'ok']
        );
        await db.query('UPDATE assets SET status=$1 WHERE id=$2', [missingAssetsStatus, m.id]);
        await db.query(
          `INSERT INTO asset_movements (id, asset_id, rental_id, movement, condition, notes)
           VALUES ($1,$2,$3,'retorno',$4,'Baixa manual no encerramento')`,
          [uid(), m.id, id, missingAssetsStatus === 'extraviado' ? 'extraviado' : 'ok']
        );
      }
    }
    await db.query(`DELETE FROM appointments WHERE rental_id=$1 AND status='pendente'`, [id]);
    await db.query(`UPDATE rentals SET status='encerrado' WHERE id=$1`, [id]);
    await addHistory(db, { rentalId: id, type: 'encerrada', user: req.user,
      message: missing.length
        ? `Locação encerrada manualmente. ${missing.length} unidade(s) que constavam no local foram marcadas como ${missingAssetsStatus === 'extraviado' ? 'extraviadas' : 'devolvidas (higienização)'}: ${missing.map(m => m.code).join(', ')}.`
        : 'Locação encerrada manualmente.' });
    return fetchRental(db, id);
  });
  await logAudit(req.user, 'update', 'rental', `Encerrada — ${rental.clientName}`);
  res.json(rental);
});

router.delete('/:id', async (req, res) => {
  const { rows: [cur] } = await pool.query(
    `SELECT r.status, c.name FROM rentals r LEFT JOIN clients c ON c.id=r.client_id WHERE r.id=$1`, [req.params.id]
  );
  if(!cur) throw new HttpError(404, 'Locação não encontrada.');
  if(!['orcamento', 'cancelado'].includes(cur.status)) {
    throw new HttpError(409, 'Só é possível excluir orçamentos ou locações canceladas.');
  }
  await pool.query('DELETE FROM rentals WHERE id=$1', [req.params.id]);
  await logAudit(req.user, 'delete', 'rental', cur.name);
  res.status(204).end();
});

export default router;
