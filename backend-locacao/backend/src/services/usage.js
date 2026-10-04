// Contador de uso de cada unidade (banheiro, tenda...), calculado a partir do que o app de campo já registra:
// saídas/retornos (rental_assets), limpezas concluídas no período em que a unidade estava no local,
// avarias na volta e revisões feitas no pátio.
import { pool } from '../db.js';

const DAY = 86400000;
const days = (from, to) => Math.max(1, Math.ceil((to - from) / DAY));
const toDate = (d) => (d instanceof Date ? d : new Date(d));

export async function computeUsage({ productTypeId = null, assetId = null } = {}){
  const params = [productTypeId, assetId];
  const { rows: assets } = await pool.query(
    `SELECT a.id, a.code, a.status, a.created_at, pt.id AS product_type_id, pt.name AS product_name, pt.daily_price,
            pt.service_every_uses, pt.service_every_days
       FROM assets a JOIN product_types pt ON pt.id = a.product_type_id
      WHERE ($1::text IS NULL OR a.product_type_id = $1) AND ($2::text IS NULL OR a.id = $2) AND a.status <> 'baixado'`,
    params);
  if(!assets.length) return [];
  const ids = assets.map(a => a.id);

  const { rows: uses } = await pool.query(
    `SELECT ra.asset_id, ra.rental_id, ra.delivered_at, ra.returned_at, ra.return_condition,
            r.start_date, r.end_date, r.os_code, r.billing, c.name AS client_name,
            (SELECT ri.unit_price FROM rental_items ri JOIN assets x ON x.id = ra.asset_id
              WHERE ri.rental_id = ra.rental_id AND ri.product_type_id = x.product_type_id LIMIT 1) AS unit_price
       FROM rental_assets ra
       JOIN rentals r ON r.id = ra.rental_id
       LEFT JOIN clients c ON c.id = r.client_id
      WHERE ra.asset_id = ANY($1) AND ra.delivered_at IS NOT NULL
      ORDER BY ra.delivered_at`, [ids]);

  const rentalIds = [...new Set(uses.map(u => u.rental_id))];
  // Limpezas contadas pelo horário em que foram concluídas no app (registro de execução)
  const { rows: cleanings } = rentalIds.length ? await pool.query(
    `SELECT a.rental_id, x.created_at AS done_at
       FROM appointments a JOIN execution_records x ON x.appointment_id = a.id
      WHERE a.rental_id = ANY($1) AND a.kind='limpeza' AND a.status='concluido'`,
    [rentalIds]) : { rows: [] };
  const cleaningsByRental = {};
  cleanings.forEach(c => (cleaningsByRental[c.rental_id] ||= []).push(toDate(c.done_at).getTime()));

  // Última revisão: registro manual de revisão, ou saída do status "manutenção" para "disponível"
  const { rows: services } = await pool.query(
    `SELECT asset_id, MAX(created_at) AS at FROM asset_movements
      WHERE asset_id = ANY($1)
        AND ((movement='manutencao' AND rental_id IS NULL) OR (movement='ajuste' AND notes LIKE 'manutencao → disponivel%'))
      GROUP BY asset_id`, [ids]);
  const lastService = Object.fromEntries(services.map(s => [s.asset_id, s.at]));

  const now = new Date();
  const since90 = new Date(now.getTime() - 90 * DAY);
  const byAsset = {};
  uses.forEach(u => (byAsset[u.asset_id] ||= []).push(u));

  return assets.map(a => {
    const list = byAsset[a.id] || [];
    const svc = lastService[a.id] ? toDate(lastService[a.id]) : null;
    let daysRented = 0, cleaningsDone = 0, revenue = 0, occ = 0, usesSince = 0, daysSince = 0;
    const history = list.map(u => {
      const from = toDate(u.delivered_at), to = u.returned_at ? toDate(u.returned_at) : now;
      const d = days(from, to);
      daysRented += d;
      const cl = (cleaningsByRental[u.rental_id] || []).filter(t => t >= from.getTime() && t <= to.getTime()).length;
      cleaningsDone += cl;
      const price = u.unit_price != null ? Number(u.unit_price) : (a.daily_price != null ? Number(a.daily_price) : 0);
      // Diária × dias em que ESTA unidade ficou no local (não o período inteiro da locação)
      // No contrato mensal o preço é por mês: a diária equivalente é o valor mensal ÷ 30
      revenue += (u.billing === 'mensal' ? price / 30 : price) * d;
      const oFrom = Math.max(from.getTime(), since90.getTime()), oTo = Math.min(to.getTime(), now.getTime());
      if(oTo > oFrom) occ += (oTo - oFrom) / DAY;
      if(!svc || from > svc){ usesSince++; }
      if(!svc || to > svc){ daysSince += days(svc && from < svc ? svc : from, to); }
      return {
        rentalId: u.rental_id, osCode: u.os_code, clientName: u.client_name,
        deliveredAt: u.delivered_at, returnedAt: u.returned_at, days: d, cleanings: cl, returnCondition: u.return_condition,
      };
    });
    const damaged = list.filter(u => u.return_condition === 'danificado').length;
    const lost = list.filter(u => u.return_condition === 'extraviado').length;
    const everyUses = a.service_every_uses, everyDays = a.service_every_days;
    const ratio = Math.max(everyUses ? usesSince / everyUses : 0, everyDays ? daysSince / everyDays : 0);
    return {
      assetId: a.id, code: a.code, status: a.status, productTypeId: a.product_type_id, productName: a.product_name,
      uses: list.length,
      daysRented,
      cleanings: cleaningsDone,
      damaged, lost,
      revenue: Math.round(revenue * 100) / 100,
      occupancy90: Math.min(100, Math.round((occ / 90) * 100)),
      firstUse: list[0]?.delivered_at || null,
      lastUse: list.length ? (list[list.length - 1].returned_at || 'em_uso') : null,
      lastServiceAt: svc,
      usesSinceService: usesSince, daysSinceService: daysSince,
      serviceEveryUses: everyUses, serviceEveryDays: everyDays,
      service: !everyUses && !everyDays ? null : ratio >= 1 ? 'vencida' : ratio >= 0.8 ? 'proxima' : 'ok',
      history,
    };
  });
}
