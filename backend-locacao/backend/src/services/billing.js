// Resumo mensal das locações mensais.
// Ciclo = do dia da entrega até a véspera do mesmo dia no mês seguinte (ex.: 15/09 a 14/10).
// Valor = unidades que estiveram no local no ciclo × valor mensal fixo por unidade (sem proporcional).
import { pool } from '../db.js';
import { addDays, today } from '../utils.js';

const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // m: 0-11

// Mesmo dia do mês, k meses depois; se o mês não tem esse dia (31 → fevereiro), usa o último dia
export function addMonthsClamp(key, k){
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + k, 1));
  const ty = t.getUTCFullYear(), tm = t.getUTCMonth();
  const day = Math.min(d, daysInMonth(ty, tm));
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function cyclePeriod(startKey, n){
  return { start: addMonthsClamp(startKey, n - 1), end: addDays(addMonthsClamp(startKey, n), -1) };
}

export async function rentalCycles(rentalId){
  const { rows: [r] } = await pool.query(
    `SELECT r.*, c.name AS client_name FROM rentals r LEFT JOIN clients c ON c.id = r.client_id WHERE r.id=$1`, [rentalId]);
  if(!r) return null;
  const base = { rentalId: r.id, osCode: r.os_code, clientName: r.client_name, billing: r.billing, cycles: [] };
  if(r.billing !== 'mensal' || !['em_andamento', 'encerrado', 'confirmado'].includes(r.status)) return base;

  const { rows: items } = await pool.query(
    `SELECT ri.product_type_id, ri.quantity, ri.unit_price, pt.name, pt.monthly_price
       FROM rental_items ri JOIN product_types pt ON pt.id = ri.product_type_id WHERE ri.rental_id=$1`, [rentalId]);
  const priceOf = {}, nameOf = {};
  items.forEach(i => { priceOf[i.product_type_id] = Number(i.unit_price ?? i.monthly_price ?? 0); nameOf[i.product_type_id] = i.name; });
  base.monthlyValue = items.reduce((n, i) => n + priceOf[i.product_type_id] * i.quantity, 0);

  const { rows: units } = await pool.query(
    `SELECT a.code, a.product_type_id, pt.name,
            (ra.delivered_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS from_day,
            (ra.returned_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS to_day
       FROM rental_assets ra JOIN assets a ON a.id = ra.asset_id JOIN product_types pt ON pt.id = a.product_type_id
      WHERE ra.rental_id=$1 AND ra.delivered_at IS NOT NULL`, [rentalId]);
  const { rows: visits } = await pool.query(
    `SELECT date::text AS date, COALESCE(status,'pendente') AS status FROM appointments
      WHERE rental_id=$1 AND kind='limpeza' AND COALESCE(status,'pendente') <> 'cancelado'`, [rentalId]);
  const { rows: invoices } = await pool.query(`SELECT * FROM rental_invoices WHERE rental_id=$1`, [rentalId]);
  const invByCycle = Object.fromEntries(invoices.map(i => [i.cycle_no, i]));

  const now = today();
  const lastDay = r.end_date && r.end_date < now ? r.end_date : now;
  for(let n = 1; n <= 600; n++){
    const { start, end } = cyclePeriod(r.start_date, n);
    if(start > lastDay) break;
    // Unidades que estiveram no local em algum dia do ciclo
    let byProduct = {};
    let basis = 'unidades';
    if(units.length){
      units.filter(u => u.from_day <= end && (!u.to_day || u.to_day >= start)).forEach(u => {
        (byProduct[u.product_type_id] ||= { productTypeId: u.product_type_id, name: u.name, codes: [] }).codes.push(u.code);
      });
    }else{
      // Nenhuma etiqueta registrada ainda: usa as quantidades contratadas
      basis = 'contratado';
      items.forEach(i => { byProduct[i.product_type_id] = { productTypeId: i.product_type_id, name: i.name, codes: [], count: i.quantity }; });
    }
    const lines = Object.values(byProduct).map(p => {
      const count = p.count ?? p.codes.length;
      const unitPrice = priceOf[p.productTypeId] ?? 0;
      return { productTypeId: p.productTypeId, name: p.name || nameOf[p.productTypeId], count, unitPrice,
               subtotal: Math.round(count * unitPrice * 100) / 100, codes: p.codes.sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })) };
    });
    const inCycle = visits.filter(v => v.date >= start && v.date <= end);
    const inv = invByCycle[n];
    const closed = end < now || (r.end_date && r.end_date <= end && r.end_date < now);
    base.cycles.push({
      n, start, end: r.end_date && r.end_date < end ? r.end_date : end,
      status: inv ? 'faturado' : closed ? 'a_faturar' : 'em_curso',
      lines, basis,
      amount: Math.round(lines.reduce((s, l) => s + l.subtotal, 0) * 100) / 100,
      cleaningsDone: inCycle.filter(v => v.status === 'concluido').length,
      cleaningsPlanned: inCycle.length,
      invoice: inv ? { ref: inv.invoice_ref, at: inv.invoiced_at, by: inv.invoiced_by, amount: Number(inv.amount) } : null,
    });
  }
  return base;
}

// Meses já fechados e ainda não faturados, de todos os contratos mensais
export async function pendingCycles(){
  const { rows } = await pool.query(`SELECT id FROM rentals WHERE billing='mensal' AND status IN ('em_andamento','encerrado','confirmado')`);
  const out = [];
  for(const { id } of rows){
    const c = await rentalCycles(id);
    c.cycles.filter(x => x.status === 'a_faturar').forEach(x => out.push({
      rentalId: c.rentalId, osCode: c.osCode, clientName: c.clientName, n: x.n, start: x.start, end: x.end, amount: x.amount,
    }));
  }
  return out.sort((a, b) => a.end.localeCompare(b.end));
}
