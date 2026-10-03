// Gera uma folha A4 de etiquetas (QR code + código escrito) e abre a impressão.
// O QR guarda só o código da unidade (ex.: "BQ-012"), que é o que o leitor do app de campo espera.
import QRCode from 'qrcode';

export const LABEL_SIZES = {
  padrao: { label: 'Padrão: QR de 4 cm, 15 por folha', cols: 3, rows: 5, qr: 40, code: 16, name: 8 },
  grande: { label: 'Grande: QR de 6,5 cm, 6 por folha', cols: 2, rows: 3, qr: 65, code: 26, name: 11 },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// units: [{ code, productName }]
export async function printLabels(units, sizeKey = 'padrao'){
  const size = LABEL_SIZES[sizeKey] || LABEL_SIZES.padrao;
  // Abre a janela já no clique (navegadores bloqueiam janelas abertas depois de uma espera)
  const win = window.open('', '_blank');
  if(!win) throw new Error('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente de novo.');
  win.document.write('<p style="font-family:sans-serif;padding:24px">Gerando etiquetas…</p>');

  // Nível "Q" de correção: o QR continua legível com até ~25% de sujeira ou risco
  const qrs = await Promise.all(units.map(u => QRCode.toDataURL(u.code, { errorCorrectionLevel: 'Q', margin: 1, width: 600 })));
  const perPage = size.cols * size.rows;
  const cellW = (210 - 10) / size.cols, cellH = (297 - 10) / size.rows; // mm, margem de 5 mm
  const cells = units.map((u, i) => `
    <div class="cell">
      <img src="${qrs[i]}" alt="">
      <div class="code">${esc(u.code)}</div>
      <div class="name">${esc(u.productName || '')}</div>
      <div class="brand">FLEX LOCAÇÕES</div>
    </div>`);
  const pages = [];
  for(let i = 0; i < cells.length; i += perPage) pages.push(`<section class="page">${cells.slice(i, i + perPage).join('')}</section>`);

  win.document.open();
  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas (${units.length})</title>
<style>
  @page { size: A4; margin: 5mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .page { width: 200mm; height: 287mm; display: grid; grid-template-columns: repeat(${size.cols}, ${cellW}mm);
          grid-template-rows: repeat(${size.rows}, ${cellH}mm); page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .cell { border: 0.2mm dashed #999; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2mm; overflow: hidden; }
  .cell img { width: ${size.qr}mm; height: ${size.qr}mm; image-rendering: pixelated; }
  .code { font-size: ${size.code}pt; font-weight: 700; letter-spacing: 0.5pt; margin-top: 1.5mm; font-family: "Courier New", monospace; }
  .name { font-size: ${size.name}pt; margin-top: 0.5mm; text-align: center; }
  .brand { font-size: ${Math.max(6, size.name - 2)}pt; color: #555; letter-spacing: 1pt; margin-top: 0.5mm; }
  .hint { font-size: 11pt; padding: 8mm; }
  @media print { .hint { display: none; } }
</style></head><body>
<p class="hint">${units.length} etiqueta(s). Na impressão, use papel A4, escala 100% (sem "ajustar à página") e margens padrão. As linhas tracejadas são guias de corte.</p>
${pages.join('')}
<script>
  Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })))
    .then(() => setTimeout(() => window.print(), 200));
</script>
</body></html>`);
  win.document.close();
}
