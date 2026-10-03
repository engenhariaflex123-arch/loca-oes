import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { signTeamToken, teamAuthMiddleware, authMiddleware } from '../auth.js';
import { logAudit } from '../audit.js';
import { uid, today, HttpError, withTransaction } from '../utils.js';

const router = Router();

// O que acontece com as unidades em cada tipo de visita
const MOVEMENT_BY_KIND = {
  entrega: 'saida', montagem: 'saida',
  retirada: 'retorno', desmontagem: 'retorno',
  limpeza: 'limpeza', manutencao: 'manutencao', vistoria: 'vistoria',
};
const END_KINDS = ['retirada', 'desmontagem'];

// --- Login da equipe (usado pelo app de campo) ---
router.post('/login', async (req, res) => {
  const { teamId, password } = req.body;
  if(!teamId || !password) return res.status(400).json({ error: 'Selecione a equipe e digite a senha.' });
  const { rows } = await pool.query('SELECT * FROM team_credentials WHERE team_id=$1', [teamId]);
  const row = rows[0];
  if(!row) return res.status(401).json({ error: 'Essa equipe ainda não tem senha configurada. Peça para um administrador configurar na aba Equipes.' });
  const valid = await bcrypt.compare(password, row.password_hash);
  if(!valid) return res.status(401).json({ error: 'Senha incorreta.' });
  const token = signTeamToken(teamId);
  res.json({ token, teamId });
});

// --- Admin define/atualiza a senha de uma equipe ---
router.put('/password/:teamId', authMiddleware, async (req, res) => {
  if(req.user.role !== 'admin') return res.status(403).json({ error: 'Somente administradores podem definir a senha da equipe.' });
  const { teamId } = req.params;
  const { password } = req.body;
  if(!password || password.length < 4) return res.status(400).json({ error: 'A senha precisa ter pelo menos 4 caracteres.' });
  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO team_credentials (team_id, password_hash, updated_at) VALUES ($1,$2, now())
     ON CONFLICT (team_id) DO UPDATE SET password_hash = $2, updated_at = now()`,
    [teamId, passwordHash]
  );
  await logAudit(req.user, 'update', 'team_member', `Senha da equipe ${teamId}`);
  res.json({ teamId, ok: true });
});

// --- Paradas (O.S.) da equipe logada, para uma data ---
router.get('/appointments', teamAuthMiddleware, async (req, res) => {
  const date = req.query.date || today();
  const { rows } = await pool.query(
    `SELECT a.*,
            c.name AS client_name, c.address AS client_address, c.phone AS client_phone,
            c.lat AS client_lat, c.lon AS client_lon,
            s.name AS site_name, s.address AS site_address, s.lat AS site_lat, s.lon AS site_lon,
            s.contact_name AS site_contact_name, s.contact_phone AS site_contact_phone,
            s.access_notes AS site_access_notes,
            r.start_date AS rental_start, r.end_date AS rental_end
       FROM appointments a
       LEFT JOIN clients c ON c.id = a.client_id
       LEFT JOIN rentals r ON r.id = a.rental_id
       LEFT JOIN sites s ON s.id = COALESCE(a.site_id, r.site_id)
      WHERE a.team_id = $1 AND a.date = $2 AND COALESCE(a.status, 'pendente') <> 'cancelado'
      ORDER BY a.route_order ASC NULLS LAST, a.created_at ASC`,
    [req.team.teamId, date]
  );

  const taskTypesRes = await pool.query('SELECT id, name FROM task_types');
  const taskNameById = {};
  taskTypesRes.rows.forEach(t => { taskNameById[t.id] = t.name; });

  // Unidades que estão no local (para a equipe saber o que recolher/limpar)
  const rentalIds = [...new Set(rows.map(r => r.rental_id).filter(Boolean))];
  const atSite = {};
  if(rentalIds.length){
    const q = await pool.query(
      `SELECT ra.rental_id, a.id, a.code, pt.id AS product_type_id, pt.name AS product_name
         FROM rental_assets ra
         JOIN assets a ON a.id = ra.asset_id
         JOIN product_types pt ON pt.id = a.product_type_id
        WHERE ra.rental_id = ANY($1) AND ra.returned_at IS NULL
        ORDER BY a.code`,
      [rentalIds]
    );
    q.rows.forEach(x => (atSite[x.rental_id] ||= []).push({
      id: x.id, code: x.code, productTypeId: x.product_type_id, productName: x.product_name,
    }));
  }

  res.json(rows.map(r => {
    const rawTasks = Array.isArray(r.task_ids) ? r.task_ids : [];
    const tasks = rawTasks.map(t => {
      const taskId = typeof t === 'string' ? t : t.taskId;
      const quantity = typeof t === 'string' ? 1 : (t.quantity || 1);
      return { taskId, quantity, name: taskNameById[taskId] || 'Tarefa removida' };
    });
    // Mostra só as unidades dos produtos desta O.S. (retirada vê banheiros, desmontagem vê tendas)
    const itemTypes = new Set((r.items || []).map(i => i.productTypeId));
    const assetsAtSite = (atSite[r.rental_id] || []).filter(a => !itemTypes.size || itemTypes.has(a.productTypeId));
    return {
      id: r.id,
      date: r.date,
      status: r.status || 'pendente',
      kind: r.kind || 'entrega',
      timeWindow: r.time_window,
      routeOrder: r.route_order,
      tasks,
      items: r.items || [],
      notes: r.notes,
      client: {
        id: r.client_id, name: r.client_name, address: r.client_address,
        phone: r.client_phone, lat: r.client_lat, lon: r.client_lon,
      },
      site: r.site_name ? {
        name: r.site_name, address: r.site_address, lat: r.site_lat, lon: r.site_lon,
        contactName: r.site_contact_name, contactPhone: r.site_contact_phone, accessNotes: r.site_access_notes,
      } : null,
      // Endereço para onde a equipe deve ir (local do evento, ou o do cliente se não houver)
      location: {
        address: r.site_address || r.client_address,
        lat: r.site_lat ?? r.client_lat,
        lon: r.site_lon ?? r.client_lon,
      },
      rental: r.rental_id ? {
        id: r.rental_id, startDate: r.rental_start, endDate: r.rental_end,
        assetsAtSite,
      } : null,
    };
  }));
});

// --- Concluir uma O.S.
// Body: { executedTasks, notes, photos, signature, signedBy, lat, lon,
//         assets: [{ code: "BQ-001", condition: "ok"|"sujo"|"danificado"|"extraviado", notes }] }
router.post('/appointments/:id/complete', teamAuthMiddleware, async (req, res) => {
  const { id } = req.params;
  const { executedTasks, notes, photos, assets, signature, signedBy, lat, lon } = req.body;
  const teamId = req.team.teamId;

  const result = await withTransaction(async db => {
    const { rows: [appt] } = await db.query(
      'SELECT * FROM appointments WHERE id=$1 AND team_id=$2 FOR UPDATE', [id, teamId]
    );
    if(!appt) throw new HttpError(404, 'Agendamento não encontrado para essa equipe.');
    if(appt.status === 'concluido') throw new HttpError(409, 'Essa O.S. já foi concluída.');

    const recordId = uid();
    await db.query(
      `INSERT INTO execution_records
         (id, appointment_id, team_id, executed_tasks, notes, photos, signature, signed_by, checkin_lat, checkin_lon)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [recordId, id, teamId, JSON.stringify(executedTasks || []), notes || null, JSON.stringify(photos || []),
       signature || null, signedBy || null, lat ?? null, lon ?? null]
    );

    const warnings = [];
    const movement = MOVEMENT_BY_KIND[appt.kind] || null;

    if(movement && Array.isArray(assets) && assets.length){
      let rentalTypes = null;
      if(appt.rental_id){
        const t = await db.query('SELECT product_type_id FROM rental_items WHERE rental_id=$1', [appt.rental_id]);
        rentalTypes = new Set(t.rows.map(x => x.product_type_id));
      }

      for(const item of assets){
        const code = String(item.code || '').trim().toUpperCase();
        if(!code) continue;
        const { rows: [asset] } = await db.query('SELECT * FROM assets WHERE upper(code)=$1 FOR UPDATE', [code]);
        if(!asset){ warnings.push(`${code}: não encontrado no cadastro.`); continue; }
        const condition = item.condition || 'ok';

        if(movement === 'saida'){
          if(rentalTypes && !rentalTypes.has(asset.product_type_id)) warnings.push(`${code}: esse produto não faz parte da locação.`);
          if(asset.status !== 'disponivel') warnings.push(`${code}: constava como "${asset.status}" no sistema.`);
          await db.query(`UPDATE assets SET status='locado' WHERE id=$1`, [asset.id]);
          if(appt.rental_id){
            await db.query(
              `INSERT INTO rental_assets (rental_id, asset_id, delivered_at) VALUES ($1,$2,now())
               ON CONFLICT (rental_id, asset_id) DO UPDATE SET delivered_at=now(), returned_at=NULL, return_condition=NULL`,
              [appt.rental_id, asset.id]
            );
          }
        }else if(movement === 'retorno'){
          if(appt.rental_id){
            const u = await db.query(
              `UPDATE rental_assets SET returned_at=now(), return_condition=$3
                WHERE rental_id=$1 AND asset_id=$2 AND returned_at IS NULL`,
              [appt.rental_id, asset.id, condition]
            );
            if(!u.rowCount) warnings.push(`${code}: não constava como entregue nessa locação.`);
          }
          // Tudo que volta passa pela higienização antes de ficar disponível
          const newStatus = condition === 'danificado' ? 'manutencao'
                          : condition === 'extraviado' ? 'extraviado'
                          : 'higienizacao';
          await db.query('UPDATE assets SET status=$1 WHERE id=$2', [newStatus, asset.id]);
        }

        await db.query(
          `INSERT INTO asset_movements (id, asset_id, rental_id, appointment_id, movement, condition, notes, team_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [uid(), asset.id, appt.rental_id, id, movement, condition, item.notes || null, teamId]
        );
      }
    }

    await db.query(`UPDATE appointments SET status='concluido' WHERE id=$1`, [id]);

    // Atualiza o andamento da locação
    let rentalStatus = null;
    if(appt.rental_id && movement === 'saida'){
      const u = await db.query(
        `UPDATE rentals SET status='em_andamento' WHERE id=$1 AND status='confirmado' RETURNING status`, [appt.rental_id]
      );
      if(u.rowCount) rentalStatus = 'em_andamento';
    }
    if(appt.rental_id && movement === 'retorno'){
      const { rows: [p] } = await db.query(
        `SELECT count(*)::int AS n FROM appointments WHERE rental_id=$1 AND kind = ANY($2) AND status='pendente'`,
        [appt.rental_id, END_KINDS]
      );
      if(p.n === 0){
        // Última retirada feita: limpezas futuras não fazem mais sentido.
        // As atrasadas ficam como pendência para o escritório ver.
        await db.query(
          `DELETE FROM appointments WHERE rental_id=$1 AND status='pendente' AND kind='limpeza' AND date >= $2`,
          [appt.rental_id, appt.date]
        );
        const { rows: [o] } = await db.query(
          `SELECT count(*)::int AS n FROM rental_assets WHERE rental_id=$1 AND returned_at IS NULL`, [appt.rental_id]
        );
        if(o.n === 0){
          await db.query(`UPDATE rentals SET status='encerrado' WHERE id=$1`, [appt.rental_id]);
          rentalStatus = 'encerrado';
        }else{
          warnings.push(`${o.n} unidade(s) ainda constam no local. O escritório precisa conferir antes de encerrar a locação.`);
        }
      }
    }

    return { recordId, warnings, rentalStatus };
  });

  await logAudit({ name: `Equipe ${teamId}`, role: 'team' }, 'update', 'appointment', `O.S. concluída — ${id}`,
    result.warnings.length ? { warnings: result.warnings } : null);
  res.status(201).json({ ok: true, ...result });
});

// --- Não foi possível realizar (cliente ausente, acesso bloqueado, chuva...)
router.post('/appointments/:id/fail', teamAuthMiddleware, async (req, res) => {
  const { reason } = req.body;
  if(!reason) throw new HttpError(400, 'Informe o motivo.');
  const r = await pool.query(
    `UPDATE appointments SET status='nao_realizado', notes=concat_ws(E'\n', notes, $3::text)
      WHERE id=$1 AND team_id=$2 AND COALESCE(status, 'pendente') IN ('pendente', 'em_rota')`,
    [req.params.id, req.team.teamId, `Não realizado: ${reason}`]
  );
  if(!r.rowCount) throw new HttpError(404, 'O.S. não encontrada ou já finalizada.');
  await logAudit({ name: `Equipe ${req.team.teamId}`, role: 'team' }, 'update', 'appointment',
    `O.S. não realizada — ${req.params.id}`, { reason });
  res.json({ ok: true });
});

// --- Marcar que a equipe saiu para essa parada
router.post('/appointments/:id/start', teamAuthMiddleware, async (req, res) => {
  const r = await pool.query(
    `UPDATE appointments SET status='em_rota' WHERE id=$1 AND team_id=$2 AND COALESCE(status, 'pendente')='pendente'`,
    [req.params.id, req.team.teamId]
  );
  if(!r.rowCount) throw new HttpError(404, 'O.S. não encontrada ou já iniciada.');
  res.json({ ok: true });
});

// --- Consultar unidade pelo código (para validar enquanto a equipe digita/escaneia)
router.get('/assets/:code', teamAuthMiddleware, async (req, res) => {
  const { rows: [a] } = await pool.query(
    `SELECT a.id, a.code, a.status, pt.name AS product_name, pt.id AS product_type_id
       FROM assets a JOIN product_types pt ON pt.id = a.product_type_id
      WHERE upper(a.code) = upper($1)`,
    [req.params.code.trim()]
  );
  if(!a) throw new HttpError(404, 'Unidade não encontrada.');
  res.json({ id: a.id, code: a.code, status: a.status, productName: a.product_name, productTypeId: a.product_type_id });
});

export default router;
