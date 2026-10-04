// PDF da ordem de serviço: dados do pedido, etapas, visitas, unidades, histórico completo e comprovantes.
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { pool } from '../db.js';
import { rentalTimeline } from './history.js';
import { kindLabel, teamName } from './events.js';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const FONT = join(ASSETS, 'fonts', 'DejaVuSans.ttf');
const FONT_B = join(ASSETS, 'fonts', 'DejaVuSans-Bold.ttf');
const LOGO = join(ASSETS, 'logo.png');

const BLUE = '#1f5ca3', GRAY = '#666666', LIGHT = '#e5e5e5', TEXT = '#171717';
const TZ = { timeZone: 'America/Sao_Paulo' };
const dt = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { ...TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const hm = (iso) => iso ? new Date(iso).toLocaleTimeString('pt-BR', { ...TZ, hour: '2-digit', minute: '2-digit' }) : '';
const day = (iso) => new Date(iso).toLocaleDateString('pt-BR', { ...TZ, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
const dmy = (d) => d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}/${String(d).slice(0, 4)}` : '—';
const brl = (n) => n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS = { orcamento: 'Orçamento', confirmado: 'Confirmada', em_andamento: 'Em andamento', encerrado: 'Encerrada', cancelado: 'Cancelada' };
const APPT = { pendente: 'Pendente', em_rota: 'A caminho', concluido: 'Concluída', nao_realizado: 'Não realizada', cancelado: 'Cancelada' };
const SOURCE = { escritorio: 'Escritório', equipe: 'Equipe', rastreador: 'Rastreador' };
const imgBuf = (dataUrl) => {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(dataUrl || ''));
  return m ? Buffer.from(m[2], 'base64') : null;
};

async function loadData(rentalId){
  const { rows: [r] } = await pool.query(
    `SELECT r.*, c.name AS client_name, c.phone AS client_phone, c.address AS client_address,
            s.name AS site_name, s.address AS site_address, s.contact_name, s.contact_phone, s.access_notes
       FROM rentals r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN sites s ON s.id = r.site_id
      WHERE r.id=$1`, [rentalId]);
  if(!r) return null;
  const { rows: items } = await pool.query(
    `SELECT pt.name, ri.quantity, ri.unit_price FROM rental_items ri JOIN product_types pt ON pt.id = ri.product_type_id
      WHERE ri.rental_id=$1 ORDER BY pt.category, pt.name`, [rentalId]);
  const { rows: appts } = await pool.query(
    `SELECT a.*, (SELECT MAX(x.created_at) FROM execution_records x WHERE x.appointment_id = a.id) AS done_at
       FROM appointments a WHERE a.rental_id=$1 ORDER BY a.date, a.route_order NULLS LAST, a.created_at`, [rentalId]);
  const { rows: units } = await pool.query(
    `SELECT a.code, pt.name AS product, ra.delivered_at, ra.returned_at, ra.return_condition
       FROM rental_assets ra JOIN assets a ON a.id = ra.asset_id JOIN product_types pt ON pt.id = a.product_type_id
      WHERE ra.rental_id=$1 ORDER BY a.code`, [rentalId]);
  const { rows: proofs } = await pool.query(
    `SELECT x.*, a.kind, a.date FROM execution_records x JOIN appointments a ON a.id = x.appointment_id
      WHERE a.rental_id=$1 ORDER BY x.created_at`, [rentalId]);
  const timeline = await rentalTimeline(rentalId);
  return { r, items, appts, units, proofs, timeline };
}

export async function buildOsPdf(rentalId, res, generatedBy){
  const data = await loadData(rentalId);
  if(!data) return false;
  const { r, items, appts, units, proofs, timeline } = data;

  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 50, left: 42, right: 42 }, bufferPages: true,
    info: { Title: `Ordem de serviço ${r.os_code}`, Author: 'Flex Locações' } });
  doc.registerFont('r', existsSync(FONT) ? FONT : 'Helvetica');
  doc.registerFont('b', existsSync(FONT_B) ? FONT_B : 'Helvetica-Bold');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${r.os_code || 'ordem-de-servico'}.pdf"`);
  doc.pipe(res);

  const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const need = (h) => { if(doc.y + h > bottom()) doc.addPage(); };
  const section = (title) => {
    need(40);
    doc.moveDown(0.8);
    doc.font('b').fontSize(11).fillColor(BLUE).text(title.toUpperCase(), L, doc.y, { characterSpacing: 0.5 });
    doc.moveTo(L, doc.y + 2).lineTo(L + W, doc.y + 2).lineWidth(0.8).strokeColor(BLUE).stroke();
    doc.moveDown(0.5).fillColor(TEXT);
  };
  const field = (label, value, x, w) => {
    const y = doc.y;
    doc.font('r').fontSize(7.5).fillColor(GRAY).text(label.toUpperCase(), x, y, { width: w });
    doc.font('r').fontSize(9.5).fillColor(TEXT).text(value || '—', x, doc.y + 1, { width: w });
    return doc.y;
  };
  const row2 = (pairs) => {
    need(36);
    const y0 = doc.y, colW = (W - 16) / pairs.length;
    let maxY = y0;
    pairs.forEach(([label, value], i) => { doc.y = y0; maxY = Math.max(maxY, field(label, value, L + i * (colW + 16), colW)); });
    doc.y = maxY + 6;
  };
  const table = (cols, rows) => {
    const head = () => {
      need(22);
      const y = doc.y;
      doc.rect(L, y, W, 16).fill('#f2f5fa');
      let x = L + 4;
      cols.forEach(c => { doc.font('b').fontSize(8).fillColor(GRAY).text(c.label, x, y + 4, { width: c.w - 8, align: c.align || 'left' }); x += c.w; });
      doc.y = y + 18;
    };
    head();
    rows.forEach(cells => {
      doc.font('r').fontSize(8.5);
      const h = Math.max(...cells.map((t, i) => doc.heightOfString(String(t ?? ''), { width: cols[i].w - 8 }))) + 6;
      if(doc.y + h > bottom()){ doc.addPage(); head(); }
      const y = doc.y;
      let x = L + 4;
      cells.forEach((t, i) => { doc.fillColor(cols[i].color?.(t) || TEXT).text(String(t ?? ''), x, y + 3, { width: cols[i].w - 8, align: cols[i].align || 'left' }); x += cols[i].w; });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.4).strokeColor(LIGHT).stroke();
      doc.y = y + h;
    });
  };

  // ----- Cabeçalho -----
  if(existsSync(LOGO)) doc.image(LOGO, L, 36, { height: 42 });
  doc.font('r').fontSize(8).fillColor(GRAY).text('ORDEM DE SERVIÇO', L, 40, { width: W, align: 'right', characterSpacing: 1 });
  doc.font('b').fontSize(20).fillColor(TEXT).text(r.os_code || '—', L, 52, { width: W, align: 'right' });
  doc.font('r').fontSize(9).fillColor(BLUE).text(STATUS[r.status] || r.status, L, 76, { width: W, align: 'right' });
  doc.y = 96;
  doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(1.2).strokeColor(BLUE).stroke();
  doc.y += 10;

  // ----- Pedido -----
  section('Pedido');
  row2([['Cliente', r.client_name], ['Telefone', r.client_phone], ['Situação', STATUS[r.status] || r.status]]);
  row2([['Local de instalação', r.site_name ? `${r.site_name}\n${r.site_address || ''}` : (r.client_address || 'Endereço do cliente')],
        ['Responsável no local', [r.contact_name, r.contact_phone].filter(Boolean).join(' · ') || null]]);
  if(r.access_notes) row2([['Acesso', r.access_notes]]);
  row2([['Entrega / montagem', `${dmy(r.start_date)}${r.start_time ? ` às ${r.start_time}` : ''}`],
        ['Retirada / desmontagem', r.end_date ? `${dmy(r.end_date)}${r.end_time ? ` às ${r.end_time}` : ''}` : 'Prazo indeterminado (até o cliente pedir)'],
        ['Criada em', dt(r.created_at)]]);
  if(r.notes) row2([['Observações', r.notes]]);

  section('Itens');
  const monthly = r.billing === 'mensal';
  table([{ label: 'Produto', w: W * 0.55 }, { label: 'Qtd.', w: W * 0.12, align: 'right' }, { label: monthly ? 'Mensal por unidade' : 'Diária', w: W * 0.33, align: 'right' }],
    items.map(i => [i.name, i.quantity, brl(i.unit_price)]));
  need(20); doc.moveDown(0.3);
  doc.font('b').fontSize(10).fillColor(TEXT).text(monthly ? `Locação mensal: ${brl(r.total_value)} por mês` : `Valor total: ${brl(r.total_value)}`, L, doc.y, { width: W, align: 'right' });

  // ----- Etapas -----
  section('Etapas');
  table([{ label: 'Etapa', w: W * 0.4 }, { label: 'Quando', w: W * 0.6 }],
    timeline.stages.map(s => [`${s.label}${s.progress ? ` (${s.progress})` : ''}`, s.at ? dt(s.at) : (s.partial ? 'Em parte' : 'Pendente')]));

  // ----- Visitas -----
  if(appts.length){
    section('Visitas');
    table([{ label: 'Dia', w: W * 0.12 }, { label: 'Visita', w: W * 0.16 }, { label: 'Equipe', w: W * 0.17 }, { label: 'Horário', w: W * 0.13 },
           { label: 'Chegada', w: W * 0.13 }, { label: 'Conclusão', w: W * 0.13 }, { label: 'Situação', w: W * 0.16,
             color: t => t === 'Não realizada' ? '#b91c1c' : t === 'Concluída' ? '#047857' : TEXT }],
      appts.map(a => [dmy(a.date).slice(0, 5), kindLabel(a.kind), a.team_id ? teamName(a.team_id).replace('Equipe ', '') : 'Sem equipe',
        a.time_window || '—', a.arrived_at ? hm(a.arrived_at) : '—', a.done_at ? hm(a.done_at) : '—', APPT[a.status] || a.status]));
  }

  // ----- Unidades -----
  if(units.length){
    section('Unidades');
    table([{ label: 'Código', w: W * 0.16 }, { label: 'Produto', w: W * 0.3 }, { label: 'Entregue', w: W * 0.2 }, { label: 'Devolvida', w: W * 0.2 },
           { label: 'Estado', w: W * 0.14, color: t => ['danificado', 'extraviado'].includes(t) ? '#b91c1c' : TEXT }],
      units.map(u => [u.code, u.product, dt(u.delivered_at), u.returned_at ? dt(u.returned_at) : 'No local', u.returned_at ? (u.return_condition || 'ok') : '—']));
  }

  // ----- Histórico -----
  section('Histórico completo');
  let lastDay = '';
  timeline.items.forEach(it => {
    const d = day(it.at);
    const body = [it.message, ...(it.details || []).map(x => `• ${x}`), it.notes ? `"${it.notes}"` : null].filter(Boolean).join('\n');
    doc.font('r').fontSize(8.5);
    const h = doc.heightOfString(body, { width: W - 60 }) + 16 + (d !== lastDay ? 16 : 0);
    need(h);
    if(d !== lastDay){
      doc.font('b').fontSize(8.5).fillColor(GRAY).text(d.charAt(0).toUpperCase() + d.slice(1), L, doc.y + 2);
      doc.moveDown(0.3); lastDay = d;
    }
    const y = doc.y;
    doc.font('b').fontSize(8.5).fillColor(it.severity === 'alerta' ? '#b45309' : TEXT).text(hm(it.at), L, y, { width: 40 });
    doc.font('r').fontSize(8.5).fillColor(it.severity === 'alerta' ? '#b45309' : TEXT).text(body, L + 46, y, { width: W - 60 });
    doc.font('r').fontSize(7.5).fillColor(GRAY).text(`${SOURCE[it.source] || ''}${it.actor ? ` · ${it.actor}` : ''}`, L + 46, doc.y + 1, { width: W - 60 });
    doc.y += 5;
  });

  // ----- Comprovantes (assinaturas e fotos) -----
  const withProof = proofs.filter(p => p.signature || p.signed_by || (Array.isArray(p.photos) && p.photos.length));
  if(withProof.length){
    section('Comprovantes');
    for(const p of withProof){
      const photos = (Array.isArray(p.photos) ? p.photos : []).map(imgBuf).filter(Boolean).slice(0, 6);
      const sig = imgBuf(p.signature);
      need(30 + (sig ? 60 : 0) + (photos.length ? (photos.length > 4 ? 220 : 110) : 0));
      doc.font('b').fontSize(9).fillColor(TEXT).text(`${kindLabel(p.kind)} de ${dmy(p.date).slice(0, 5)} · ${teamName(p.team_id)} · ${dt(p.created_at)}`, L, doc.y);
      if(p.signed_by) doc.font('r').fontSize(8.5).fillColor(GRAY).text(`Recebido por: ${p.signed_by}`);
      if(p.checkin_lat != null) doc.font('r').fontSize(8).fillColor(GRAY).text(`Localização: ${Number(p.checkin_lat).toFixed(5)}, ${Number(p.checkin_lon).toFixed(5)}`);
      doc.moveDown(0.3);
      if(sig){
        try{ doc.image(sig, L, doc.y, { fit: [160, 55] }); doc.y += 58; }catch(e){}
      }
      if(photos.length){
        const size = 100, gap = 8;
        let x = L, y = doc.y;
        photos.forEach((ph) => {
          if(x + size > L + W){ x = L; y += size + gap; }
          try{ doc.image(ph, x, y, { fit: [size, size] }); }catch(e){}
          x += size + gap;
        });
        doc.y = y + size + gap;
      }
      doc.moveDown(0.6);
    }
  }

  // ----- Rodapé -----
  const range = doc.bufferedPageRange();
  const stamp = `Gerado em ${dt(new Date().toISOString())}${generatedBy ? ` por ${generatedBy}` : ''} · Flex Locações`;
  for(let i = range.start; i < range.start + range.count; i++){
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // escrever no rodapé sem o pdfkit criar página nova
    const y = doc.page.height - 32;
    doc.font('r').fontSize(7).fillColor(GRAY);
    doc.text(`${r.os_code} · ${stamp}`, L, y, { width: W * 0.75, lineBreak: false });
    doc.text(`Página ${i + 1} de ${range.count}`, L + W * 0.75, y, { width: W * 0.25, align: 'right', lineBreak: false });
  }
  doc.end();
  return true;
}
