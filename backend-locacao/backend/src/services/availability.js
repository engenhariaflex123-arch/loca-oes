// Disponibilidade de estoque por produto em um período.
// Uma locação ocupa a unidade de start_date até end_date + turnaround_days
// (dias de higienização/vistoria depois que ela volta).

export async function getAvailability(db, start, end, excludeRentalId = null){
  const { rows } = await db.query(
    `SELECT pt.id, pt.name, pt.category,
       (SELECT count(*)::int FROM assets a
         WHERE a.product_type_id = pt.id
           AND a.status NOT IN ('baixado', 'extraviado', 'manutencao')) AS total,
       COALESCE((SELECT sum(ri.quantity)::int
         FROM rental_items ri
         JOIN rentals r ON r.id = ri.rental_id
        WHERE ri.product_type_id = pt.id
          AND r.status IN ('confirmado', 'em_andamento')
          AND ($3::text IS NULL OR r.id <> $3::text)
          AND r.start_date <= ($2::date + COALESCE(pt.turnaround_days, 0))
          AND (r.end_date + COALESCE(pt.turnaround_days, 0)) >= $1::date), 0) AS reserved
     FROM product_types pt
     WHERE pt.active
     ORDER BY pt.category, pt.name`,
    [start, end, excludeRentalId]
  );
  return rows.map(r => ({
    productTypeId: r.id,
    name: r.name,
    category: r.category,
    total: r.total,
    reserved: r.reserved,
    available: r.total - r.reserved,
  }));
}

// Retorna a lista de produtos que faltariam; lista vazia = dá para atender.
export async function findShortages(db, start, end, items, excludeRentalId = null){
  const availability = await getAvailability(db, start, end, excludeRentalId);
  const byId = Object.fromEntries(availability.map(a => [a.productTypeId, a]));
  const requested = {};
  for(const it of items){
    requested[it.productTypeId] = (requested[it.productTypeId] || 0) + Number(it.quantity);
  }
  return Object.entries(requested)
    .filter(([id, qty]) => !byId[id] || byId[id].available < qty)
    .map(([id, qty]) => ({
      productTypeId: id,
      name: byId[id]?.name || 'Produto inativo ou inexistente',
      requested: qty,
      available: Math.max(byId[id]?.available ?? 0, 0),
    }));
}

// Trava para duas confirmações simultâneas não reservarem a mesma unidade.
export async function lockAvailability(db){
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('rental_availability'))`);
}
