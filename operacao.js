/* =====================================================================
   Plataforma de Propostas Flex Solar — Ordens de Serviço e Estoque
   ===================================================================== */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const app = () => window.FlexApp;
  const esc = s => app().esc(s);
  const api = (p, o) => app().api(p, o);
  const toast = m => app().toast(m);
  const modal = o => window.FlexAdmin.modal(o);
  const eu = () => app().usuario || {};
  const podeEstoque = () => ["admin", "almoxarife"].includes(eu().perfil);
  const qtd = v => Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const brl2 = v => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dh = v => v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const lerNum = v => { if (typeof v === "number") return v; let s = String(v ?? "").trim(); if (!s) return 0; if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); const x = parseFloat(s); return Number.isFinite(x) ? x : 0; };
  const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const STATUS_OS = { aberta: ["Aberta", "blue"], concluida: ["Concluída", "green"], cancelada: ["Cancelada", "red"] };
  const STATUS_ET = { pendente: ["Pendente", "gray"], andamento: ["Em andamento", "amber"], concluida: ["Concluída", "green"], dispensada: ["Dispensada", "gray"] };
  const feita = e => e.status === "concluida" || e.status === "dispensada";
  const dataCurta = v => new Date(v).toLocaleDateString("pt-BR");
  // texto do prazo da etapa da vez
  function textoPrazo(p, setor, equipe, comQuem = true) {
    if (!p || !p.dias) return "";
    const quem = setor === "campo" ? (equipe ? "Equipe " + equipe : "Equipe de campo") : (SETOR_ROT[setor] || setor || "");
    if (p.atrasada) return `<span class="tag" data-tone="red">atrasada há ${p.atrasoDias} dia${p.atrasoDias > 1 ? "s" : ""}${comQuem && quem ? " · " + esc(quem) : ""}</span>`;
    return `<span class="tag" data-tone="${p.restamDias <= 1 ? "amber" : "gray"}">prazo ${dataCurta(p.venceEm)}${p.restamDias <= 1 ? (p.restamDias === 0 ? " · vence hoje" : " · vence amanhã") : ""}</span>`;
  }
  const SETOR_ROT = { comercial: "Comercial", almoxarife: "Logística", engenharia: "Engenharia", comprador: "Comprador", campo: "Equipe de campo" };
  const COR_EQ = { Azul: "#2563EB", Verde: "#16A34A", Amarela: "#EAB308", Vermelha: "#DC2626", Laranja: "#F97316", Roxa: "#7C3AED", Branca: "#E5E7EB", Preta: "#111827" };
  const EQUIPES = Object.keys(COR_EQ);
  const bolinha = c => `<span class="eq-dot" style="background:${COR_EQ[c] || "#999"}"></span>`;
  const SETOR_DE = { orcamento: "comercial", visita: "almoxarife", fechamento: "comercial", pagamento: "engenharia", documentos: "engenharia", levantamento: "almoxarife",
    projeto: "engenharia", equipamentos: "comprador", ferragem: "almoxarife", componentes: "comprador", agend_instalacao: "almoxarife", instalacao: "campo",
    agend_comissionamento: "almoxarife", comissionamento: "campo", relatorio: "engenharia", baixa: "engenharia" };
  const AGENDA = { agend_instalacao: "instalacao", agend_comissionamento: "comissionamento" };
  const SOL_DE = { equipamentos: "equipamentos", componentes: "componentes", ferragem: "ferragem" };   // etapa -> solicitação
  function podeEtapa(e) {
    const u = eu(), st = e.setor || SETOR_DE[e.key];
    if (u.perfil === "admin") return true;
    if (st === "campo") return u.perfil === "almoxarife" || (u.perfil === "campo" && !!e.equipe && u.equipe === e.equipe);
    return u.perfil === st;
  }
  const TIPO_EV = { solicitacao: "Solicitação", sistema: "Sistema", etapa: "Etapa", nota: "Observação", estoque: "Material", situacao: "Situação" };

  /* =====================================================================
     ORDENS DE SERVIÇO
     ===================================================================== */
  let listaOS = [], filtroOS = "aberta", buscaOS = "", osAberta = null;

  async function abrirOS(id) {
    if (id) return detalheOS(id);
    osAberta = null;
    const box = $("#osBox");
    box.innerHTML = `<div class="bar"><h1>Ordens de serviço</h1>
        <input class="audit-search" id="osBusca" type="search" placeholder="Pesquisar O.S., proposta ou cliente" value="${esc(buscaOS)}"></div>
      <div class="chips" id="osFiltro" style="margin-bottom:14px">${[["aberta", "Abertas"], ["atrasada", "Atrasadas"], ["concluida", "Concluídas"], ["cancelada", "Canceladas"], ["", "Todas"]]
        .map(([k, r]) => `<button class="chip" data-f="${k}" aria-pressed="${k === filtroOS}">${r}</button>`).join("")}</div>
      <div id="osFila"></div>
      <div class="card list-wrap" id="osLista"><div class="empty"><p>Carregando…</p></div></div>`;
    $("#osBusca").oninput = e => { buscaOS = e.target.value; desenharListaOS(); };
    box.querySelectorAll("#osFiltro .chip").forEach(c => c.onclick = () => { filtroOS = c.dataset.f; box.querySelectorAll("#osFiltro .chip").forEach(x => x.setAttribute("aria-pressed", x === c)); desenharListaOS(); });
    let fila = [];
    try { [listaOS, fila] = await Promise.all([api("/api/os"), eu().perfil === "admin" ? [] : api("/api/os/pendencias")]); }
    catch (e) { $("#osLista").innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
    desenharFila(fila); marcarVistas(fila);
    desenharListaOS();
  }
  function desenharFila(fila) {
    const el = $("#osFila"); if (!el) return;
    if (eu().perfil === "admin") { el.innerHTML = ""; return; }
    el.innerHTML = `<section class="fila card card-pad"><h2 class="os-h">Aguardando você <span class="tag" data-tone="${fila.length ? "amber" : "green"}">${fila.length}</span>${fila.some(x => x.prazo && x.prazo.atrasada) ? ` <span class="tag" data-tone="red">${fila.filter(x => x.prazo && x.prazo.atrasada).length} atrasada(s)</span>` : ""}</h2>
      ${fila.length ? `<div class="fila-lista">${fila.map(x => `<button class="fila-item" type="button" data-os="${esc(x.osId)}">
          <span class="fila-n">${esc(x.numero)}</span><strong>${esc(x.etapaNome)}</strong>
          <span class="status-msg">${esc(x.cliente)}${x.endereco ? " · " + esc(x.endereco) : ""}</span>
          <small class="status-msg">${x.agendadaPara ? `${x.equipe ? bolinha(x.equipe) + " Equipe " + esc(x.equipe) + " · " : ""}agendada para ${dh(x.agendadaPara)}` : `na sua vez desde ${dh(x.desde)}`}</small>
          ${textoPrazo(x.prazo, null, null, false)}</button>`).join("")}</div>`
        : `<p class="status-msg" style="margin:0">Nenhuma etapa esperando por você agora.</p>`}</section>`;
    el.querySelectorAll("[data-os]").forEach(b => b.onclick = () => detalheOS(b.dataset.os));
  }
  /* ---------- avisos: novas etapas na vez do usuário ---------- */
  let avisoTimer = null;
  const chaveVistas = () => "flexsolar-vistas-" + (eu().id || "");
  const lerVistas = () => { try { return new Set(JSON.parse(localStorage.getItem(chaveVistas()) || "[]")); } catch (e) { return new Set(); } };
  function marcarVistas(fila) { try { localStorage.setItem(chaveVistas(), JSON.stringify(fila.map(x => x.osId + ":" + x.etapa))); } catch (e) {} atualizarBadge(fila.length); }
  function atualizarBadge(n) { const t = $("#tabOS"); if (t) t.innerHTML = `O.S.${n ? ` <span class="badge">${n}</span>` : ""}`; }
  async function verificarAvisos() {
    if (!app() || !app().usuario || eu().perfil === "admin") return;
    let fila; try { fila = await api("/api/os/pendencias"); } catch (e) { return; }
    const vistas = lerVistas(), novas = fila.filter(x => !vistas.has(x.osId + ":" + x.etapa));
    atualizarBadge(fila.length);
    if (novas.length) {
      const x = novas[0];
      toast(novas.length === 1 ? `Nova etapa para você: ${x.etapaNome} — ${x.numero} (${x.cliente})` : `${novas.length} novas etapas aguardando você na aba O.S.`);
      if (!$("#view-os").hidden && !osAberta) { desenharFila(fila); }
      try { if (navigator.vibrate) navigator.vibrate(120); } catch (e) {}
    }
    if (!$("#view-os").hidden && !osAberta) marcarVistas(fila);
  }
  function iniciarAvisos() { clearInterval(avisoTimer); verificarAvisos(); avisoTimer = setInterval(verificarAvisos, 60000); }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) verificarAvisos(); });
  function desenharListaOS() {
    const t = norm(buscaOS).split(/\s+/).filter(Boolean);
    const itens = listaOS.filter(o => (!filtroOS || (filtroOS === "atrasada" ? o.prazo && o.prazo.atrasada : o.status === filtroOS)) && t.every(x => norm([o.numero, o.propostaNumero, o.cliente].join(" ")).includes(x)));
    const el = $("#osLista");
    if (!listaOS.length) { el.innerHTML = `<div class="empty"><strong>Nenhuma O.S. ainda</strong><p>A O.S. é aberta automaticamente quando uma proposta solar passa para "Fechada".</p></div>`; return; }
    if (!itens.length) { el.innerHTML = `<div class="empty"><p>Nenhuma O.S. com esse filtro.</p></div>`; return; }
    el.innerHTML = `<table class="adm"><thead><tr><th>O.S.</th><th>Cliente</th><th>Proposta</th><th>Etapa atual</th><th>Progresso</th><th>Situação</th><th>Atualizada</th><th></th></tr></thead><tbody>${
      itens.map(o => { const [rs, ts] = STATUS_OS[o.status] || [o.status, "gray"];
        return `<tr><td><strong>${esc(o.numero)}</strong></td><td>${esc(o.cliente)}</td><td>${esc(o.propostaNumero)}</td>
          <td>${o.etapaAtual ? `${esc(o.etapaAtual)} <span class="tag" data-tone="${STATUS_ET[o.etapaAtualStatus][1]}">${STATUS_ET[o.etapaAtualStatus][0]}</span><br><small class="status-msg">${o.equipeAtual ? bolinha(o.equipeAtual) + " Equipe " + esc(o.equipeAtual) : esc(SETOR_ROT[o.etapaAtualSetor] || "")}</small> ${o.status === "aberta" ? textoPrazo(o.prazo, o.etapaAtualSetor, o.equipeAtual, false) : ""}` : "—"}</td>
          <td><div class="prog" title="${o.concluidas} de ${o.totalEtapas} etapas"><span style="width:${Math.round(o.concluidas / o.totalEtapas * 100)}%"></span></div><small class="status-msg">${o.concluidas}/${o.totalEtapas}</small></td>
          <td><span class="tag" data-tone="${ts}">${rs}</span></td><td class="status-msg" style="white-space:nowrap">${dh(o.atualizadoEm)}</td>
          <td><button class="btn link" data-os="${esc(o.id)}">Abrir</button></td></tr>`; }).join("")}</tbody></table>`;
    el.querySelectorAll("[data-os]").forEach(b => b.onclick = () => detalheOS(b.dataset.os));
  }

  async function detalheOS(id, dados) {
    const box = $("#osBox");
    if (!dados) { box.innerHTML = `<div class="empty"><p>Carregando…</p></div>`; try { dados = await api("/api/os/" + id); } catch (e) { box.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; } }
    osAberta = dados;
    const o = dados, [rs, ts] = STATUS_OS[o.status] || [o.status, "gray"], admin = eu().perfil === "admin", ativa = o.status !== "cancelada";
    const falta = o.material.some(m => m.ativa && m.pendente > 0 && m.fisico < m.pendente);
    box.innerHTML = `
      <div class="bar"><button class="btn sec" id="osVoltar" type="button">← Ordens de serviço</button><h1 style="margin-left:6px">${esc(o.numero)}</h1>
        <span class="tag" data-tone="${ts}" style="font-size:.9rem">${rs}</span><span class="grow"></span>
        <button class="btn sec" id="osPdf" type="button">Baixar PDF</button></div>
      <div class="os-doc">
      <div class="os-cab card card-pad">
        <div><span>Cliente</span><strong>${esc(o.cliente)}</strong><small>${esc([o.contato, o.telefone].filter(Boolean).join(" · "))}</small></div>
        <div><span>Proposta</span><strong><button class="btn link" id="osProp" style="padding:0;font-size:inherit">${esc(o.propostaNumero)}</button></strong><small>${brl2(o.total)}</small></div>
        <div><span>Local</span><strong style="font-weight:600">${esc(o.endereco || "—")}</strong></div>
        <div><span>Andamento · Pagamento</span><strong style="font-weight:600">${esc(o.andamento)} · ${esc(o.statusPag)}</strong><small>Aberta em ${dh(o.criadoEm)}</small></div>
        <div class="os-qr" id="osQR" title="QR desta O.S.: o almoxarife lê na saída de material"></div>
      </div>
      <div class="os-grid">
        <section class="card card-pad">
          <h2 class="os-h">Etapas <small class="status-msg">${o.concluidas} de ${o.totalEtapas} concluídas</small></h2>
          <ol class="etapas">${o.etapas.map((e, i) => { const [r, t] = STATUS_ET[e.status], st = e.setor || SETOR_DE[e.key], pode = podeEtapa(e);
            const vez = ativa && !feita(e) && o.etapas.findIndex(x => !feita(x)) === i;
            const visitaCom = e.key === "visita" && ativa && ["admin", "comercial"].includes(eu().perfil);
            return `<li class="et ${e.status} ${vez && pode ? "minha" : ""} ${vez && o.prazo && o.prazo.atrasada ? "atrasada" : ""}"><span class="et-n">${e.status === "concluida" ? "✓" : e.status === "dispensada" ? "–" : i + 1}</span><div class="et-c">
              <div class="et-l"><strong>${esc(e.nome)}</strong> <span class="tag" data-tone="${t}">${r}</span>${vez && pode ? ' <span class="tag" data-tone="amber">sua vez</span>' : ""}</div>
              <small class="status-msg">${st === "campo" ? (e.equipe ? `${bolinha(e.equipe)} Equipe ${esc(e.equipe)}` : "Equipe de campo (definida no agendamento)") : esc(SETOR_ROT[st] || st)}${e.agendadaPara ? ` · agendada para <strong>${dh(e.agendadaPara)}</strong>` : ""}</small>
              ${e.inicio || e.fim ? `<small class="status-msg" style="display:block">${e.status === "dispensada" ? "" : e.inicio ? "Início " + dh(e.inicio) : ""}${e.fim ? (e.status === "dispensada" ? "Dispensada em " : " · Fim ") + dh(e.fim) : ""}${e.por ? " · " + esc(e.por) : ""}</small>` : ""}
              ${vez && o.prazo && o.prazo.dias ? `<div style="margin-top:3px">${textoPrazo(o.prazo, st, e.equipe)} <small class="status-msg">${o.prazo.dias} dia(s) de prazo${e.agendadaPara ? " a partir da data agendada" : ""}</small></div>` : ""}
              ${visitaCom && e.status === "pendente" ? `<div class="et-b"><button class="btn link" data-et="visita" data-ac="dispensar">Dispensar visita</button></div>` : ""}
              ${visitaCom && e.status === "dispensada" ? `<div class="et-b"><button class="btn link" data-et="visita" data-ac="solicitar">Solicitar visita técnica</button></div>` : ""}
              ${SOL_DE[e.key] && e.status !== "dispensada" ? `<div class="et-b"><button class="btn link" data-sol="${SOL_DE[e.key]}">📄 ${e.key === "ferragem" ? "Requisição de ferragem" : "Solicitação de compra"} (PDF)</button></div>` : ""}
              ${ativa && pode && e.status !== "dispensada" ? `<div class="et-b">${e.status === "pendente" ? `<button class="btn link" data-et="${e.key}" data-ac="iniciar">Iniciar</button>` : ""}
                ${e.status !== "concluida" ? `<button class="btn link" data-et="${e.key}" data-ac="concluir">${AGENDA[e.key] ? "Agendar e concluir" : "Concluir"}</button>` : ""}
                ${e.status === "concluida" && admin ? `<button class="btn link" data-et="${e.key}" data-ac="reabrir">Reabrir</button>` : ""}</div>` : ""}
            </div></li>`; }).join("")}</ol>
        </section>
        <div>
          <section class="card card-pad">
            <h2 class="os-h">Material reservado ${falta ? '<span class="tag" data-tone="red">falta em estoque</span>' : ""}</h2>
            ${o.material.length ? `<div class="list-wrap"><table class="adm" style="min-width:0"><thead><tr><th>Item</th><th class="n">Reservado</th><th class="n">Já saiu</th><th class="n">Pendente</th><th class="n">Em estoque</th></tr></thead><tbody>${
              o.material.map(m => `<tr class="${m.ativa ? "" : "inativo"}"><td>${esc(m.descricao || m.codigo)}<br><small class="status-msg">${esc(m.codigo)}</small></td>
                <td class="n">${qtd(m.reservado)} ${esc(m.unidade || "")}</td><td class="n">${qtd(m.baixado)}</td>
                <td class="n"><strong>${qtd(m.pendente)}</strong></td><td class="n">${m.ativa && m.pendente > 0 && m.fisico < m.pendente ? `<span class="tag" data-tone="red">${qtd(m.fisico)}</span>` : qtd(m.fisico)}</td></tr>`).join("")}</tbody></table></div>`
              : `<p class="status-msg">Nenhum item controlado em estoque nesta proposta.</p>`}
            ${podeEstoque() && ativa && o.material.some(m => m.pendente > 0) ? `<div class="toolbar" style="margin:12px 0 0"><button class="btn" id="osSaidaLeit" type="button">Saída por leitura</button><button class="btn sec" id="osSaida" type="button">Saída manual</button></div>` : ""}
            ${(o.series || []).length ? `<h3 style="margin:16px 0 6px;font-size:.95rem">Números de série entregues (${o.series.length})</h3>
              <div class="chips-serie">${o.series.map(x => `<span class="serie" title="${esc(x.descricao || x.codigo)} · ${dh(x.saida_em)}">${esc(x.serie)} <small>${esc(x.codigo)}</small></span>`).join("")}</div>` : ""}
          </section>
          <section class="card card-pad" style="margin-top:16px">
            <h2 class="os-h">Histórico</h2>
            <div class="nota-nova">
              <select id="osNotaEtapa" aria-label="Etapa da observação"><option value="">Geral</option>${o.etapas.map(e => `<option value="${e.key}">${esc(e.nome)}</option>`).join("")}</select>
              <input id="osNota" placeholder="Escreva uma observação e aperte Enter" maxlength="2000"><button class="btn sec" id="osNotaBtn" type="button">Adicionar</button>
            </div>
            <ol class="timeline">${[...o.eventos].reverse().map(e => `<li class="ev ${e.tipo}"><div class="ev-h"><strong>${dh(e.criado_em)}</strong> · ${esc(e.usuario)}
                <span class="tag" data-tone="gray">${TIPO_EV[e.tipo] || e.tipo}${e.etapa ? " · " + esc((o.etapas.find(x => x.key === e.etapa) || {}).nome || "") : ""}</span></div>
                <div class="ev-t">${esc(e.texto)}</div></li>`).join("")}</ol>
          </section>
        </div>
      </div></div>`;
    $("#osVoltar").onclick = () => abrirOS();
    $("#osProp").onclick = () => app().abrirProposta(o.propostaId);
    $("#osPdf").onclick = () => imprimir("print-os", `OS_${o.numero}_${o.cliente}`);
    box.querySelectorAll("[data-et]").forEach(b => b.onclick = () => acaoEtapa(o, b.dataset.et, b.dataset.ac));
    box.querySelectorAll("[data-sol]").forEach(b => b.onclick = () => solicitacao(o, b.dataset.sol));
    const nota = async () => {
      const t = $("#osNota").value.trim(); if (!t) return;
      try { const d = await api(`/api/os/${o.id}/notas`, { method: "POST", body: JSON.stringify({ texto: t, etapa: $("#osNotaEtapa").value }) }); toast("Observação registrada"); detalheOS(o.id, d); }
      catch (e) { alert(e.message); }
    };
    $("#osNotaBtn").onclick = nota;
    $("#osNota").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); nota(); } };
    if ($("#osSaida")) $("#osSaida").onclick = () => saida(o);
    if ($("#osSaidaLeit")) $("#osSaidaLeit").onclick = () => saidaLeitura(o);
    qrOS($("#osQR"), o.id);
  }
  function acaoEtapa(o, key, acao) {
    if (acao === "dispensar" || acao === "solicitar") {
      if (!confirm(acao === "dispensar" ? "Dispensar a visita técnica desta O.S.?" : "Solicitar visita técnica? A etapa volta para a logística.")) return;
      api(`/api/os/${o.id}/etapas/${key}`, { method: "POST", body: JSON.stringify({ acao }) })
        .then(r => { toast(acao === "dispensar" ? "Visita dispensada" : "Visita solicitada"); detalheOS(o.id, r); }).catch(e => alert(e.message));
      return;
    }
    const e = o.etapas.find(x => x.key === key);
    const titulo = { iniciar: "Iniciar", concluir: "Concluir", reabrir: "Reabrir" }[acao] + ` — ${e.nome}`;
    modal({
      titulo,
      corpo: `${acao === "concluir" && AGENDA[key] ? `<div class="fields">
            <div class="f s3"><label for="etData">Data e hora</label><input id="etData" type="datetime-local"></div>
            <div class="f s3"><label for="etEquipe">Equipe de campo</label><select id="etEquipe"><option value="">Escolha a cor…</option>${EQUIPES.map(c => `<option>${c}</option>`).join("")}</select></div></div>
          <p class="status-msg">Só a equipe escolhida (ou a logística) poderá dar baixa em "${esc((o.etapas.find(x => x.key === AGENDA[key]) || {}).nome || "")}".</p>` : ""}
        <div class="fields"><div class="f"><label for="etNota">Observação (opcional)</label><textarea id="etNota" rows="3" placeholder="Ex.: documentos recebidos por e-mail"></textarea></div></div>
        ${acao === "concluir" && ["instalacao", "comissionamento"].includes(key) ? `<p class="status-msg">Ao concluir, o andamento da proposta muda para "${key === "instalacao" ? "Instalado" : "Em operação"}".</p>` : ""}`,
      aoAbrir: d => d.querySelector("#etNota").focus(),
      botoes: [{ rotulo: "Cancelar", sec: true }, { rotulo: titulo.split(" — ")[0], acao: async d => {
        const corpo = { acao, nota: d.querySelector("#etNota").value };
        if (acao === "concluir" && AGENDA[key]) {
          const dt = d.querySelector("#etData").value, eq = d.querySelector("#etEquipe").value;
          if (!dt) throw new Error("Informe a data e a hora."); if (!eq) throw new Error("Escolha a equipe.");
          corpo.agenda = { data: new Date(dt).toISOString(), equipe: eq };
        }
        const r = await api(`/api/os/${o.id}/etapas/${key}`, { method: "POST", body: JSON.stringify(corpo) });
        toast(`Etapa ${acao === "iniciar" ? "iniciada" : acao === "concluir" ? "concluída" : "reaberta"}`); detalheOS(o.id, r); verificarAvisos();
      } }]
    });
  }

  /* ---------- remessas ---------- */
  async function remessas() {
    let lista; try { lista = await api("/api/estoque/remessas"); } catch (e) { alert(e.message); return; }
    modal({
      titulo: "Remessas recebidas", largo: true,
      corpo: `<input class="adm-search" id="remBusca" type="search" placeholder="Pesquisar código, NF ou fornecedor" style="width:100%;margin-bottom:10px"><div id="remLista"></div>`,
      aoAbrir: d => {
        const des = () => {
          const t = norm(d.querySelector("#remBusca").value).split(/\s+/).filter(Boolean);
          const it = lista.filter(r => t.every(x => norm([r.codigo, r.documento, r.fornecedor].join(" ")).includes(x)));
          d.querySelector("#remLista").innerHTML = it.length ? `<div class="list-wrap"><table class="adm" style="min-width:0"><thead><tr><th>Remessa</th><th>Chegada</th><th>NF · Fornecedor</th><th class="n">Itens</th><th class="n">Unidades</th><th></th></tr></thead><tbody>${
            it.map(r => `<tr><td><strong>${esc(r.codigo)}</strong></td><td style="white-space:nowrap">${dh(r.recebida_em)}${Math.abs(new Date(r.criado_em) - new Date(r.recebida_em)) > 3600000 ? `<br><small class="status-msg">lançada em ${dh(r.criado_em)}</small>` : ""}</td>
              <td>${esc([r.documento ? "NF " + r.documento : "", r.fornecedor].filter(Boolean).join(" · ") || "—")}</td><td class="n">${r.itens}</td><td class="n">${qtd(r.unidades)}${r.series ? `<br><small class="status-msg">${r.series} com série</small>` : ""}</td>
              <td><button class="btn link" data-rem="${esc(r.id)}">Abrir</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="status-msg">Nenhuma remessa.</p>`;
          d.querySelectorAll("[data-rem]").forEach(b => b.onclick = () => remessa(b.dataset.rem));
        };
        d.querySelector("#remBusca").oninput = des; des();
      },
      botoes: [{ rotulo: "Fechar", sec: true }]
    });
  }
  function htmlRemessa(r) {
    return `<div class="sol-doc">
      <div class="sol-cab"><img src="flex-solar.jpg" alt="Flex Solar"><div><h2>Comprovante de recebimento de remessa</h2><p class="sol-num">${esc(r.codigo)}</p></div></div>
      <table class="sol-info"><tbody>
        <tr><th>Nota fiscal</th><td>${esc(r.documento || "—")}</td><th>Fornecedor</th><td>${esc(r.fornecedor || "—")}</td></tr>
        <tr><th>Chegada</th><td>${dh(r.recebida_em)}</td><th>Registrada por</th><td>${esc(r.usuario)} · ${dh(r.criado_em)}</td></tr>
        ${r.observacao ? `<tr><th>Observação</th><td colspan="3">${esc(r.observacao)}</td></tr>` : ""}
      </tbody></table>
      <table class="sol-itens"><thead><tr><th>Item</th><th class="n">Quantidade</th><th class="n">Com série</th><th class="n">Sem série</th></tr></thead><tbody>${
        r.itens.map(i => `<tr><td><strong>${esc(i.codigo)}</strong><br>${esc(i.descricao || "")}</td><td class="n">${qtd(i.qtd)} ${esc(i.unidade || "")}</td>
          <td class="n">${i.rastrear ? i.com_serie : "—"}</td><td class="n">${i.rastrear ? i.semSerie : "—"}</td></tr>`).join("")}</tbody></table>
      ${r.series.length ? `<h3 style="font-size:12px;margin:12px 0 4px">Números de série (${r.series.length})</h3>
        <p style="font-family:ui-monospace,Consolas,monospace;font-size:10.5px;line-height:1.6;margin:0">${r.series.map(x => esc(x.serie) + (x.os_numero ? ` <small>(${esc(x.os_numero)})</small>` : "")).join(" · ")}</p>` : ""}
      <div class="sol-ass"><div>Recebido por<br><strong>${esc(r.usuario)}</strong></div><div>Conferido por<br>&nbsp;</div><div>Data<br>&nbsp;</div></div>
    </div>`;
  }
  async function remessa(id) {
    let r; try { r = await api("/api/estoque/remessas/" + id); } catch (e) { alert(e.message); return; }
    modal({
      titulo: "Remessa " + r.codigo, largo: true,
      corpo: `<div class="sol-prev">${htmlRemessa(r)}</div>`,
      botoes: [{ rotulo: "Fechar", sec: true }, { rotulo: "Baixar PDF", acao: async () => {
        $("#solBox").innerHTML = htmlRemessa(r); setTimeout(() => imprimir("print-sol", `${r.codigo}_${r.fornecedor || ""}`), 150);
      } }]
    });
  }

  /* ---------- solicitação de compra / requisição de ferragem ---------- */
  function htmlSolicitacao(r, paraImprimir) {
    const ferr = r.tipo === "ferragem", comprarRot = ferr ? "A requisitar" : "A comprar";
    const tot = r.itens.reduce((s, i) => s + (i.custoTotal || 0), 0);
    const linhas = r.itens.map(i => `<tr class="${i.comprar > 0 ? "" : "ok"}"><td><strong>${esc(i.codigo)}</strong><br>${esc(i.descricao)}</td>
        <td class="n">${qtd(i.necessario)} ${esc(i.unidade)}${i.jaSaiu ? `<br><small>já saiu ${qtd(i.jaSaiu)}</small>` : ""}</td>
        <td class="n">${i.controlado ? qtd(i.emEstoque) : '<small>não controlado</small>'}</td>
        <td class="n"><strong>${qtd(i.comprar)} ${esc(i.unidade)}</strong></td>
        ${r.verCusto ? `<td class="n">${brl2(i.custoUnit)}</td><td class="n">${brl2(i.custoTotal)}</td>` : ""}</tr>`).join("");
    return `<div class="sol-doc">
      <div class="sol-cab"><img src="flex-solar.jpg" alt="Flex Solar"><div><h2>${esc(r.titulo)}</h2><p class="sol-num">Nº ${esc(r.numeroDoc)}</p></div></div>
      <table class="sol-info"><tbody>
        <tr><th>Ordem de serviço</th><td>${esc(r.osNumero)}</td><th>Proposta</th><td>${esc(r.propostaNumero)}</td></tr>
        <tr><th>Cliente</th><td colspan="3">${esc(r.razao || r.cliente)}</td></tr>
        <tr><th>Local da obra</th><td colspan="3">${esc(r.endereco || "—")}</td></tr>
        <tr><th>Contato</th><td>${esc([r.contato, r.telefone].filter(Boolean).join(" · ") || "—")}</td><th>Emitida em</th><td>${dh(r.geradoEm)} · ${esc(r.geradoPor)}</td></tr>
      </tbody></table>
      ${r.aviso ? `<div class="aviso" style="margin:10px 0">${esc(r.aviso)}</div>` : ""}
      ${r.itens.length ? `<table class="sol-itens"><thead><tr><th>Item</th><th class="n">Necessário</th><th class="n">Em estoque (reservado p/ esta O.S.)</th><th class="n">${comprarRot}</th>
          ${r.verCusto ? '<th class="n">Custo un. (ref.)</th><th class="n">Total (ref.)</th>' : ""}</tr></thead><tbody>${linhas}
          ${r.verCusto ? `<tr class="tot"><td colspan="5">Total estimado</td><td class="n">${brl2(tot)}</td></tr>` : ""}</tbody></table>`
        : `<p>Nenhum item desta categoria nesta obra.</p>`}
      <p class="sol-obs">Itens controlados em estoque (módulos, inversores, cabos): ${ferr ? "requisitar" : "comprar"} só o que falta, já descontando o que está em estoque para esta O.S. (quando duas obras disputam o mesmo item, a O.S. mais antiga tem prioridade). Demais itens: quantidade total da obra.</p>
      <div class="sol-ass"><div>Solicitado por<br><strong>${esc(r.geradoPor)}</strong></div><div>Aprovado por<br>&nbsp;</div><div>Data<br>&nbsp;</div></div>
    </div>`;
  }
  async function solicitacao(o, tipo) {
    let r; try { r = await api(`/api/os/${o.id}/solicitacoes`, { method: "POST", body: JSON.stringify({ tipo }) }); } catch (e) { alert(e.message); return; }
    const nada = !r.itens.some(i => i.comprar > 0);
    modal({
      titulo: r.titulo, largo: true,
      corpo: `${r.ultima ? `<p class="status-msg" style="margin-top:0">Última emissão: ${dh(r.ultima.em)} por ${esc(r.ultima.por)}.</p>` : ""}
        ${nada && r.itens.length ? `<div class="aviso ok">Nada a ${tipo === "ferragem" ? "requisitar" : "comprar"}: tudo está disponível em estoque para esta O.S.</div>` : ""}
        <div class="sol-prev">${htmlSolicitacao(r)}</div>`,
      botoes: [{ rotulo: "Fechar", sec: true }, { rotulo: "Baixar PDF", acao: async () => {
        const reg = await api(`/api/os/${o.id}/solicitacoes`, { method: "POST", body: JSON.stringify({ tipo, registrar: true }) });
        $("#solBox").innerHTML = htmlSolicitacao(reg, true);
        setTimeout(() => imprimir("print-sol", `${reg.numeroDoc.replace(/ · /g, "_")}_${reg.cliente}`), 150);
        if (osAberta && osAberta.id === o.id) setTimeout(() => detalheOS(o.id), 600);
      } }]
    });
  }

  /* =====================================================================
     ESTOQUE
     ===================================================================== */
  let saldo = [], filtroEst = "", buscaEst = "";
  const CAT_EST = { "": "Todos", modulo: "Módulos", inversor: "Inversores", componente: "Cabos e componentes", falta: "Em falta" };

  async function abrirEstoque() {
    const box = $("#estBox"), admin = eu().perfil === "admin";
    box.innerHTML = `<div class="bar"><h1>Estoque</h1><span class="grow"></span>
        ${podeEstoque() ? `<button class="btn" id="estEntLeit" type="button">Entrada por leitura</button><button class="btn" id="estSaiLeit" type="button">Saída por leitura</button>
          <button class="btn sec" id="estEntrada" type="button">Entrada manual</button><button class="btn sec" id="estSaida" type="button">Saída manual</button>
          <button class="btn sec" id="estEtq" type="button">Etiquetas QR</button>` : ""}
        <button class="btn sec" id="estRem" type="button">Remessas</button>
        <button class="btn sec" id="estSerie" type="button">Rastrear série</button>
        ${admin ? `<button class="btn sec" id="estAjuste" type="button">Ajuste de inventário</button>` : ""}</div>
      <div class="toolbar"><div class="chips" id="estFiltro">${Object.entries(CAT_EST).map(([k, r]) => `<button class="chip" data-c="${k}" aria-pressed="${k === filtroEst}">${r}</button>`).join("")}</div>
        <span class="grow"></span><input class="adm-search" id="estBusca" type="search" placeholder="Pesquisar código ou descrição" value="${esc(buscaEst)}"></div>
      <div class="card list-wrap" id="estTabela"><div class="empty"><p>Carregando…</p></div></div>
      <h2 style="font-size:1.05rem;margin:24px 0 10px">Últimas movimentações <span class="status-msg" id="movFiltro"></span></h2>
      <div class="card list-wrap" id="estMov"></div>`;
    if ($("#estEntrada")) $("#estEntrada").onclick = entrada;
    if ($("#estEntLeit")) $("#estEntLeit").onclick = entradaLeitura;
    if ($("#estSaiLeit")) $("#estSaiLeit").onclick = () => saidaLeitura(null);
    if ($("#estEtq")) $("#estEtq").onclick = etiquetas;
    $("#estSerie").onclick = rastrearSerie;
    $("#estRem").onclick = remessas;
    if ($("#estSaida")) $("#estSaida").onclick = () => saida(null);
    if ($("#estAjuste")) $("#estAjuste").onclick = ajuste;
    box.querySelectorAll("#estFiltro .chip").forEach(c => c.onclick = () => { filtroEst = c.dataset.c; box.querySelectorAll("#estFiltro .chip").forEach(x => x.setAttribute("aria-pressed", x === c)); tabelaEstoque(); });
    $("#estBusca").oninput = e => { buscaEst = e.target.value; tabelaEstoque(); };
    try { saldo = await api("/api/estoque"); } catch (e) { $("#estTabela").innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
    tabelaEstoque(); movimentos();
  }
  function tabelaEstoque() {
    const admin = eu().perfil === "admin", t = norm(buscaEst).split(/\s+/).filter(Boolean);
    const itens = saldo.filter(i => (filtroEst === "falta" ? i.disponivel < 0 : !filtroEst || i.categoria === filtroEst || (filtroEst === "componente" && !["modulo", "inversor"].includes(i.categoria)))
      && t.every(x => norm(i.codigo + " " + i.descricao).includes(x)));
    const el = $("#estTabela");
    if (!itens.length) { el.innerHTML = `<div class="empty"><p>${saldo.length ? "Nenhum item com esse filtro." : "Nenhum item controlado. Marque \"Controlar estoque\" nos itens da Tabela de preços."}</p></div>`; return; }
    const valor = itens.reduce((s, i) => s + (i.custo || 0) * Math.max(0, i.fisico), 0);
    el.innerHTML = `<table class="adm"><thead><tr><th>Código</th><th>Descrição</th><th class="n">Físico</th><th class="n">Reservado</th><th class="n">Disponível</th>${admin ? '<th class="n">Valor em estoque</th>' : ""}<th></th></tr></thead><tbody>${
      itens.map(i => `<tr><td><strong>${esc(i.codigo)}</strong></td><td>${esc(i.descricao)}</td>
        <td class="n">${qtd(i.fisico)} ${esc(i.unidade)}${i.rastrear ? `<br><small class="status-msg" title="unidades com número de série registrado">${i.series} com série</small>` : ""}</td><td class="n">${qtd(i.reservado)}</td>
        <td class="n">${i.disponivel < 0 ? `<span class="tag" data-tone="red">faltam ${qtd(-i.disponivel)}</span>` : `<strong>${qtd(i.disponivel)}</strong>`}</td>
        ${admin ? `<td class="n">${brl2((i.custo || 0) * Math.max(0, i.fisico))}</td>` : ""}
        <td><button class="btn link" data-mov="${esc(i.codigo)}">Movimentos</button></td></tr>`).join("")}
      ${admin ? `<tr class="rel-tot"><td colspan="5">Valor total em estoque (${itens.length} itens)</td><td class="n">${brl2(valor)}</td><td></td></tr>` : ""}</tbody></table>`;
    el.querySelectorAll("[data-mov]").forEach(b => b.onclick = () => movimentos(b.dataset.mov));
  }
  async function movimentos(codigo) {
    const el = $("#estMov");
    $("#movFiltro").innerHTML = codigo ? `· ${esc(codigo)} <button class="btn link" id="movTodos">ver todas</button>` : "";
    if (codigo) { $("#movTodos").onclick = () => movimentos(); el.scrollIntoView({ behavior: "smooth", block: "start" }); }
    let ms; try { ms = await api("/api/estoque/movimentos?limite=150" + (codigo ? "&codigo=" + encodeURIComponent(codigo) : "")); } catch (e) { el.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
    const TIP = { entrada: ["Entrada", "green"], saida: ["Saída", "amber"], ajuste: ["Ajuste", "gray"] };
    el.innerHTML = ms.length ? `<table class="adm"><thead><tr><th>Quando</th><th>Tipo</th><th>Item</th><th class="n">Qtd.</th><th>Referência</th><th>Por</th></tr></thead><tbody>${
      ms.map(m => `<tr><td class="status-msg" style="white-space:nowrap">${dh(m.criado_em)}</td><td><span class="tag" data-tone="${TIP[m.tipo][1]}">${TIP[m.tipo][0]}</span></td>
        <td>${esc(m.descricao || m.codigo)}<br><small class="status-msg">${esc(m.codigo)}</small></td>
        <td class="n">${m.tipo === "saida" ? "−" : m.qtd > 0 ? "+" : ""}${qtd(m.tipo === "saida" ? m.qtd : m.qtd)} ${esc(m.unidade || "")}</td>
        <td>${esc([m.remessa, m.documento ? "NF " + m.documento : "", m.fornecedor, m.os_numero, m.cliente, m.observacao].filter(Boolean).join(" · ")) || "—"}</td><td>${esc(m.usuario)}</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty"><p>Nenhuma movimentação ainda.</p></div>`;
  }

  /* ---------- editor de linhas (item + quantidade) ---------- */
  function linhasItens(el, linhas, opcoes) {
    const des = () => {
      el.innerHTML = linhas.map((l, n) => `<div class="kit-row mov-row" data-n="${n}">
          <select data-f="codigo">${opcoes.map(o => `<option value="${esc(o.codigo)}" ${o.codigo === l.codigo ? "selected" : ""}>${esc(o.codigo)} — ${esc(o.descricao)}</option>`).join("")}</select>
          <input data-f="qtd" inputmode="decimal" value="${l.qtd === "" ? "" : esc(String(l.qtd).replace(".", ","))}" placeholder="Qtd.">
          <span class="n status-msg">${esc((opcoes.find(o => o.codigo === l.codigo) || {}).info || "")}</span>
          <button class="x" type="button" data-rm="${n}" aria-label="Remover">×</button></div>`).join("") || `<p class="status-msg">Nenhum item.</p>`;
      el.querySelectorAll(".mov-row").forEach(r => {
        const n = +r.dataset.n;
        r.querySelector('[data-f="codigo"]').onchange = e => { linhas[n].codigo = e.target.value; des(); };
        r.querySelector('[data-f="qtd"]').onchange = e => { linhas[n].qtd = e.target.value; };
        r.querySelector("[data-rm]").onclick = () => { linhas.splice(n, 1); des(); };
      });
    };
    des();
    return {
      add() { const livre = opcoes.find(o => !linhas.some(l => l.codigo === o.codigo)) || opcoes[0]; if (livre) { linhas.push({ codigo: livre.codigo, qtd: "" }); des(); setTimeout(() => { const b = el.querySelectorAll(".ss-btn"); if (b.length) b[b.length - 1].click(); }, 0); } },
      ler() { el.querySelectorAll('[data-f="qtd"]').forEach((i, n) => { linhas[n].qtd = i.value; }); return linhas.map(l => ({ codigo: l.codigo, qtd: lerNum(l.qtd) })); },
      reset(novas) { linhas.length = 0; linhas.push(...novas); des(); },
    };
  }
  async function opcoesEstoque() {
    if (!saldo.length) saldo = await api("/api/estoque");
    return saldo.filter(i => i.controlado || i.fisico).map(i => ({ codigo: i.codigo, descricao: i.descricao, info: `físico ${qtd(i.fisico)} · disp. ${qtd(i.disponivel)}` }));
  }

  async function entrada() {
    let opcoes; try { opcoes = await opcoesEstoque(); } catch (e) { alert(e.message); return; }
    const linhas = [{ codigo: opcoes[0]?.codigo, qtd: "" }]; let ed;
    modal({
      titulo: "Entrada de remessa", largo: true,
      corpo: `<div class="fields">
          <div class="f s2"><label for="enNF">Nota fiscal</label><input id="enNF" placeholder="Nº da NF"></div>
          <div class="f s4"><label for="enForn">Fornecedor</label><input id="enForn"></div>
          <div class="f s3"><label for="enData">Data real de chegada <span class="status-msg">(só se for lançamento atrasado)</span></label><input id="enData" type="datetime-local"></div>
          <div class="f s3"><label for="enObs">Observação (opcional)</label><input id="enObs"></div></div>
        <h3 style="margin:16px 0 8px;font-size:1rem">Itens recebidos</h3><div id="enItens"></div>
        <button class="btn sec" id="enAdd" type="button" style="margin-top:4px">+ Adicionar item</button>`,
      aoAbrir: d => { ed = linhasItens(d.querySelector("#enItens"), linhas, opcoes); d.querySelector("#enAdd").onclick = () => ed.add(); setTimeout(() => d.querySelector("#enItens .ss-btn")?.click(), 0); },
      botoes: [{ rotulo: "Cancelar", sec: true }, { rotulo: "Dar entrada", acao: async d => {
        const r = await api("/api/estoque/entrada", { method: "POST", body: JSON.stringify({ itens: ed.ler(), documento: d.querySelector("#enNF").value, fornecedor: d.querySelector("#enForn").value, observacao: d.querySelector("#enObs").value, data: (d.querySelector("#enData").value ? new Date(d.querySelector("#enData").value).toISOString() : "") }) });
        saldo = r.saldo; toast(`Remessa ${r.remessa.codigo} registrada`); if (!$("#view-estoque").hidden) { tabelaEstoque(); movimentos(); }
      } }]
    });
  }

  async function saida(os) {
    let opcoes, abertas;
    try { [opcoes, abertas] = await Promise.all([opcoesEstoque(), api("/api/os")]); } catch (e) { alert(e.message); return; }
    abertas = abertas.filter(x => x.status === "aberta");
    const linhas = []; let ed;
    const carregarOS = async (d, id) => {
      if (!id) { ed.reset([]); return; }
      const det = os && os.id === id ? os : await api("/api/os/" + id);
      const pend = det.material.filter(m => m.ativa && m.pendente > 0);
      // já sugere só o que existe fisicamente; o que não tem em estoque fica avisado
      ed.reset(pend.filter(m => m.fisico > 0).map(m => ({ codigo: m.codigo, qtd: Math.min(m.pendente, m.fisico) })));
      const sem = pend.filter(m => m.fisico < m.pendente);
      d.querySelector(".msg").textContent = !pend.length ? "Esta O.S. não tem material pendente de saída."
        : sem.length ? `Sem estoque suficiente para: ${sem.map(m => `${m.codigo} (falta ${qtd(m.pendente - Math.max(0, m.fisico))})`).join(", ")}. A saída fica parcial.` : "";
    };
    modal({
      titulo: "Saída de material", largo: true,
      corpo: `<div class="fields">
          <div class="f"><label for="saOS">Ordem de serviço</label><select id="saOS"><option value="">Sem O.S. (saída avulsa: informe o motivo)</option>${
            abertas.map(x => `<option value="${esc(x.id)}" ${os && os.id === x.id ? "selected" : ""}>${esc(x.numero)} — ${esc(x.cliente)} (${esc(x.propostaNumero)})</option>`).join("")}</select></div>
          <div class="f s3"><label for="saData">Data real da saída <span class="status-msg">(só se for lançamento atrasado)</span></label><input id="saData" type="datetime-local"></div>
          <div class="f s3"><label for="saObs">Observação</label><input id="saObs" placeholder="Ex.: retirado pela equipe de instalação"></div></div>
        <h3 style="margin:16px 0 8px;font-size:1rem">Itens que estão saindo</h3>
        <p class="status-msg" style="margin:0 0 8px">Ao escolher a O.S., os itens pendentes dela entram já preenchidos. Ajuste as quantidades se sair só uma parte.</p>
        <div id="saItens"></div><button class="btn sec" id="saAdd" type="button" style="margin-top:4px">+ Adicionar item</button>`,
      aoAbrir: d => {
        ed = linhasItens(d.querySelector("#saItens"), linhas, opcoes);
        d.querySelector("#saAdd").onclick = () => ed.add();
        d.querySelector("#saOS").onchange = e => carregarOS(d, e.target.value);
        if (os) carregarOS(d, os.id);
      },
      botoes: [{ rotulo: "Cancelar", sec: true }, { rotulo: "Dar saída", acao: async d => {
        const osId = d.querySelector("#saOS").value;
        saldo = (await api("/api/estoque/saida", { method: "POST", body: JSON.stringify({ osId, itens: ed.ler(), observacao: d.querySelector("#saObs").value, data: (d.querySelector("#saData").value ? new Date(d.querySelector("#saData").value).toISOString() : "") }) })).saldo;
        toast("Saída registrada");
        if (!$("#view-estoque").hidden) { tabelaEstoque(); movimentos(); }
        if (!$("#view-os").hidden && osAberta) detalheOS(osAberta.id);
      } }]
    });
  }

  async function ajuste() {
    let opcoes; try { opcoes = await opcoesEstoque(); } catch (e) { alert(e.message); return; }
    modal({
      titulo: "Ajuste de inventário",
      corpo: `<p class="status-msg" style="margin-top:0">Use quando a contagem física não bater com o saldo. Informe quanto existe de verdade; a plataforma lança a diferença.</p>
        <div class="fields"><div class="f"><label for="ajItem">Item</label><select id="ajItem">${opcoes.map(o => `<option value="${esc(o.codigo)}">${esc(o.codigo)} — ${esc(o.descricao)} (${esc(o.info)})</option>`).join("")}</select></div>
          <div class="f s2"><label for="ajQtd">Quantidade contada</label><input id="ajQtd" inputmode="decimal"></div>
          <div class="f s4"><label for="ajObs">Motivo</label><input id="ajObs" placeholder="Ex.: inventário mensal"></div></div>`,
      botoes: [{ rotulo: "Cancelar", sec: true }, { rotulo: "Ajustar", acao: async d => {
        saldo = (await api("/api/estoque/ajuste", { method: "POST", body: JSON.stringify({ codigo: d.querySelector("#ajItem").value, contado: lerNum(d.querySelector("#ajQtd").value), observacao: d.querySelector("#ajObs").value }) })).saldo;
        toast("Inventário ajustado"); tabelaEstoque(); movimentos();
      } }]
    });
  }

  /* =====================================================================
     LEITURA PELA CÂMERA DO CELULAR
     Usa o leitor nativo do navegador (BarcodeDetector, no Chrome do Android)
     e, se não houver, a biblioteca ZXing. Também aceita digitação manual
     ou leitor Bluetooth (que "digita" o código e aperta Enter).
     ===================================================================== */
  const QUER = ["qr_code", "code_128", "code_39", "code_93", "ean_13", "ean_8", "upc_a", "upc_e", "data_matrix", "itf", "codabar", "pdf417"];
  let zxPronto = null, qrPronto = null;
  const carregarScript = (src, glob) => new Promise((ok, no) => {
    if (window[glob]) return ok(window[glob]);
    const s = document.createElement("script"); s.src = src; s.onload = () => ok(window[glob]); s.onerror = () => no(new Error("Não foi possível carregar a biblioteca. Verifique a internet."));
    document.head.appendChild(s);
  });
  const carregarZX = () => zxPronto || (zxPronto = carregarScript("https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js", "ZXing"));
  const carregarQR = () => qrPronto || (qrPronto = carregarScript("https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js", "QRCode"));
  let audio = null;
  function bip(ok = true) {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = ok ? 1250 : 330; g.gain.value = 0.08; o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.08 : 0.25)); } catch (e) {}
    try { navigator.vibrate && navigator.vibrate(ok ? 60 : [80, 60, 80]); } catch (e) {}
  }
  function criarLeitor(el, aoLer) {
    el.innerHTML = `<div class="leitor"><video muted playsinline></video><div class="mira"></div><div class="leitor-msg">Toque em "Ligar câmera"</div></div>
      <div class="leitor-bar"><button class="btn" type="button" data-l="cam">Ligar câmera</button>
        <input type="text" data-l="manual" placeholder="Ou digite o código / use leitor Bluetooth e aperte Enter" autocomplete="off" autocapitalize="off" spellcheck="false"></div>`;
    const video = el.querySelector("video"), msg = el.querySelector(".leitor-msg"), btn = el.querySelector('[data-l="cam"]'), manual = el.querySelector('[data-l="manual"]');
    let stream = null, timer = null, det = null, zx = null, ligado = false, ult = { t: "", em: 0 };
    const emitir = txt => {
      const t = String(txt || "").trim(); if (!t) return;
      const agora = Date.now(); if (t === ult.t && agora - ult.em < 2500) return;   // mesma caixa ainda na frente da câmera
      ult = { t, em: agora }; aoLer(t);
    };
    manual.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const v = manual.value; manual.value = ""; ult = { t: "", em: 0 }; emitir(v); } });
    async function ligar() {
      if (!window.isSecureContext) throw new Error("A câmera só funciona em endereço https.");
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador não libera a câmera. Use o Chrome no celular.");
      msg.textContent = "Abrindo a câmera…";
      if ("BarcodeDetector" in window) {
        const sup = await window.BarcodeDetector.getSupportedFormats().catch(() => []);
        det = new window.BarcodeDetector({ formats: QUER.filter(f => sup.includes(f)) });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        video.srcObject = stream; await video.play();
        const passo = async () => {
          if (!ligado) return;
          try { if (video.readyState >= 2) { const r = await det.detect(video); if (r && r.length) emitir(r[0].rawValue); } } catch (e) {}
          timer = setTimeout(passo, 180);
        };
        ligado = true; passo();
      } else {
        const Z = await carregarZX();
        zx = new Z.BrowserMultiFormatReader();
        ligado = true;
        await zx.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video, (r) => { if (r) emitir(r.getText()); });
      }
      msg.textContent = "Aponte para o código"; btn.textContent = "Desligar câmera"; el.querySelector(".leitor").classList.add("on");
    }
    function desligar() {
      ligado = false; clearTimeout(timer);
      try { stream && stream.getTracks().forEach(t => t.stop()); } catch (e) {}
      try { zx && zx.reset(); } catch (e) {}
      stream = null; zx = null; video.srcObject = null;
      btn.textContent = "Ligar câmera"; msg.textContent = "Câmera desligada"; el.querySelector(".leitor").classList.remove("on");
    }
    btn.onclick = async () => { if (ligado) return desligar(); try { await ligar(); } catch (e) { desligar(); msg.textContent = e.name === "NotAllowedError" ? "Permita o uso da câmera no navegador." : (e.message || "Não foi possível abrir a câmera."); } };
    return { desligar, ligar: () => btn.click(), focoManual: () => manual.focus() };
  }
  const sinal = (el, texto, tipo = "ok") => { el.className = "leitura-sinal " + tipo; el.textContent = texto; bip(tipo !== "erro"); };

  /* ---------- ENTRADA POR LEITURA ---------- */
  async function entradaLeitura() {
    let dados; try { dados = await api("/api/estoque/leitura"); } catch (e) { alert(e.message); return; }
    const itens = new Map(dados.itens.map(i => [i.codigo, i]));
    const mapa = new Map(dados.codigos.map(c => [c.barras, c.codigo]));
    const lista = new Map();   // codigo -> {qtd, series:[]}
    let atualCod = "", leitor, pendente = null;
    const qtdLinha = (cod, l) => (itens.get(cod) || {}).rastrear ? l.series.length + (l.semSerie || 0) : l.qtd;
    const total = () => [...lista].reduce((s, [cod, l]) => s + qtdLinha(cod, l), 0);
    modal({
      titulo: "Entrada por leitura", largo: true, classe: "leitura",
      corpo: `<div class="fields">
          <div class="f s2"><label for="lnNF">Nota fiscal</label><input id="lnNF"></div>
          <div class="f s4"><label for="lnForn">Fornecedor</label><input id="lnForn"></div>
          <div class="f"><label for="lnData">Data real de chegada <span class="status-msg">(só se for lançamento atrasado)</span></label><input id="lnData" type="datetime-local"></div></div>
        <div id="lnLeitor" style="margin-top:10px"></div>
        <div class="leitura-sinal" id="lnSinal">Leia o código do produto (ou escolha o item abaixo) e depois os números de série.</div>
        <div id="lnDesc"></div>
        <div class="fields" style="margin-top:8px">
          <div class="f s4"><label for="lnItem">Item sendo lido</label><select id="lnItem"><option value="">Escolha ou leia o código do produto…</option>${dados.itens.map(i => `<option value="${esc(i.codigo)}">${esc(i.codigo)} — ${esc(i.descricao)}${i.rastrear ? " · série" : ""}</option>`).join("")}</select></div>
          <div class="f s2" id="lnQtdBox"><label for="lnQtd">Quantidade por leitura</label><input id="lnQtd" inputmode="decimal" value="1"></div>
          <div class="f s2" id="lnSemBox" hidden><label>&nbsp;</label><button class="btn sec" type="button" id="lnSem">+ Unidades sem série</button></div></div>
        <h3 style="margin:14px 0 6px;font-size:1rem">Lido até agora <span class="status-msg" id="lnTot"></span></h3>
        <div id="lnLista"></div>`,
      aoAbrir: d => {
        leitor = criarLeitor(d.querySelector("#lnLeitor"), tratar);
        const sel = d.querySelector("#lnItem");
        sel.onchange = () => { atualCod = sel.value; ajustarItem(); };
        d.querySelector("#lnSem").onclick = () => {
          const it = itens.get(atualCod); if (!it) return;
          const n = Math.round(lerNum(prompt(`Quantas unidades de ${it.descricao} entram SEM número de série?\n(ex.: já saíram para obras antes do registro)`, "0")));
          if (!(n > 0)) return;
          const l = lista.get(atualCod) || { qtd: 0, series: [], semSerie: 0 }; l.semSerie = (l.semSerie || 0) + n; lista.set(atualCod, l); desenhar();
          sinal(d.querySelector("#lnSinal"), `+${n} sem série · ${it.descricao}`, "info");
        };
        function ajustarItem() {
          const it = itens.get(atualCod);
          d.querySelector("#lnQtdBox").hidden = !it || it.rastrear;
          d.querySelector("#lnSemBox").hidden = !it || !it.rastrear;
          if (it) sinal(d.querySelector("#lnSinal"), it.rastrear ? `${it.descricao}: agora leia o número de série de cada unidade.` : `${it.descricao}: cada leitura soma a quantidade ao lado.`, "info");
        }
        function desenhar() {
          d.querySelector("#lnTot").textContent = `${lista.size} item(ns), ${total().toLocaleString("pt-BR")} unidade(s)`;
          d.querySelector("#lnLista").innerHTML = lista.size ? [...lista].map(([cod, l]) => { const it = itens.get(cod);
            return `<div class="lido"><div class="lido-h"><strong>${esc(it.descricao)}</strong> <small class="status-msg">${esc(cod)}</small>
                ${it.rastrear ? `<span class="tag" data-tone="blue">${l.series.length} com série</span> <span class="status-msg">+</span> <input class="lido-q" data-sem="${esc(cod)}" inputmode="numeric" value="${l.semSerie || 0}" title="unidades sem série (já saíram ou sem etiqueta)"> <small class="status-msg">sem série</small>` : `<input class="lido-q" data-q="${esc(cod)}" inputmode="decimal" value="${String(l.qtd).replace(".", ",")}"> ${esc(it.unidade)}`}
                <button class="x" type="button" data-del="${esc(cod)}" aria-label="Remover item">×</button></div>
              ${it.rastrear ? `<div class="chips-serie">${l.series.map(sx => `<span class="serie">${esc(sx)}<button type="button" data-rs="${esc(cod)}" data-s="${esc(sx)}" aria-label="Remover ${esc(sx)}">×</button></span>`).join("")}</div>` : ""}</div>`; }).join("")
            : `<p class="status-msg">Nada lido ainda.</p>`;
          d.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { lista.delete(b.dataset.del); desenhar(); });
          d.querySelectorAll("[data-rs]").forEach(b => b.onclick = () => { const l = lista.get(b.dataset.rs); l.series = l.series.filter(x => x !== b.dataset.s); if (!l.series.length && !l.semSerie) lista.delete(b.dataset.rs); desenhar(); });
          d.querySelectorAll("[data-sem]").forEach(i => i.onchange = () => { const l = lista.get(i.dataset.sem); l.semSerie = Math.max(0, Math.round(lerNum(i.value))); desenhar(); });
          d.querySelectorAll("[data-q]").forEach(i => i.onchange = () => { lista.get(i.dataset.q).qtd = lerNum(i.value); });
          d.querySelector(".modal-foot .btn:not(.sec)").textContent = `Dar entrada (${total().toLocaleString("pt-BR")})`;
        }
        function tratar(t) {
          const s = d.querySelector("#lnSinal"); d.querySelector("#lnDesc").innerHTML = "";
          if (t.startsWith("FLEX:OS:")) return sinal(s, "Esse é o QR de uma O.S. Na entrada, leia os produtos.", "erro");
          const cod = t.startsWith("FLEX:ITEM:") ? t.slice(10) : mapa.get(t);
          if (cod) {
            const it = itens.get(cod);
            if (!it) return sinal(s, `O código ${cod} não é de um item controlado em estoque.`, "erro");
            atualCod = cod; sel.value = cod; ajustarItem();
            if (!it.rastrear) { const l = lista.get(cod) || { qtd: 0, series: [] }; l.qtd += lerNum(d.querySelector("#lnQtd").value) || 1; lista.set(cod, l); sinal(s, `+${d.querySelector("#lnQtd").value || 1} ${it.unidade} · ${it.descricao}`); }
            return desenhar();
          }
          const it = itens.get(atualCod);
          if (it && it.rastrear) {
            const l = lista.get(atualCod) || { qtd: 0, series: [] };
            if ([...lista.values()].some(x => x.series.includes(t))) return sinal(s, `Série ${t} já foi lida.`, "erro");
            l.series.push(t); lista.set(atualCod, l); desenhar(); sinal(s, `Série ${t} · ${it.descricao} (${l.series.length})`);
            api("/api/estoque/serie/" + encodeURIComponent(t)).then(r => {   // já existe? retira e avisa
              l.series = l.series.filter(x => x !== t); if (!l.series.length) lista.delete(atualCod); desenhar();
              sinal(s, `Série ${t} já está registrada (${r.descricao}, ${r.status === "estoque" ? "em estoque" : "já saiu"}). Não foi incluída.`, "erro");
            }).catch(() => {});
            return;
          }
          // código desconhecido: pergunta o que é
          pendente = t; bip(false);
          s.className = "leitura-sinal aviso"; s.textContent = `Código desconhecido: ${t}`;
          d.querySelector("#lnDesc").innerHTML = `<div class="aviso" style="margin-top:8px">É o código de fábrica de qual item? A plataforma vai reconhecê-lo nas próximas leituras.
            <div class="toolbar" style="margin:8px 0 0"><select id="lnAssoc">${dados.itens.map(i => `<option value="${esc(i.codigo)}" ${i.codigo === atualCod ? "selected" : ""}>${esc(i.codigo)} — ${esc(i.descricao)}</option>`).join("")}</select>
            <button class="btn sec" id="lnAssocBtn" type="button">Associar</button></div></div>`;
          d.querySelector("#lnAssocBtn").onclick = async () => {
            const c = d.querySelector("#lnAssoc").value;
            try { await api("/api/estoque/codigos", { method: "POST", body: JSON.stringify({ barras: pendente, codigo: c }) }); mapa.set(pendente, c); const p = pendente; pendente = null; tratar(p); }
            catch (e) { sinal(s, e.message, "erro"); }
          };
        }
      },
      aoFechar: () => leitor && leitor.desligar(),
      botoes: [{ rotulo: "Cancelar", sec: true }, { rotulo: "Dar entrada (0)", acao: async d => {
        if (!lista.size) throw new Error("Nada foi lido ainda.");
        const its = [...lista].map(([codigo, l]) => ({ codigo, qtd: qtdLinha(codigo, l) })).filter(i => i.qtd > 0);
        const series = [...lista].flatMap(([codigo, l]) => l.series.map(serie => ({ codigo, serie })));
        const r = await api("/api/estoque/entrada", { method: "POST", body: JSON.stringify({ itens: its, series, documento: d.querySelector("#lnNF").value, fornecedor: d.querySelector("#lnForn").value, data: (d.querySelector("#lnData").value ? new Date(d.querySelector("#lnData").value).toISOString() : "") }) });
        saldo = r.saldo; leitor.desligar(); toast(`Remessa ${r.remessa.codigo} registrada`); if (!$("#view-estoque").hidden) { tabelaEstoque(); movimentos(); }
      } }]
    });
  }

  /* ---------- SAÍDA POR LEITURA ---------- */
  async function saidaLeitura(osInicial) {
    let dados, abertas;
    try { [dados, abertas] = await Promise.all([api("/api/estoque/leitura"), api("/api/os")]); } catch (e) { alert(e.message); return; }
    abertas = abertas.filter(x => x.status === "aberta");
    const itens = new Map(dados.itens.map(i => [i.codigo, i])), mapa = new Map(dados.codigos.map(c => [c.barras, c.codigo]));
    let os = null, leitor;
    const lidos = new Map();   // codigo -> {qtd, series:[]}
    modal({
      titulo: "Saída por leitura", largo: true, classe: "leitura",
      corpo: `<div class="fields"><div class="f"><label for="lsOS">Ordem de serviço</label><select id="lsOS"><option value="">Leia o QR da O.S. ou escolha…</option>${
          abertas.map(x => `<option value="${esc(x.id)}">${esc(x.numero)} — ${esc(x.cliente)}</option>`).join("")}<option value="__AVULSA__">Sem O.S. (saída avulsa)</option></select></div></div>
        <div id="lsLeitor" style="margin-top:10px"></div>
        <div class="leitura-sinal" id="lsSinal">Leia o QR da O.S. e depois os números de série das unidades.</div>
        <div class="fields" id="lsObsBox" style="margin-top:8px"><div class="f"><label for="lsObs">Observação</label><input id="lsObs" placeholder="Obrigatória na saída avulsa"></div></div>
        <h3 style="margin:14px 0 6px;font-size:1rem">Material <span class="status-msg" id="lsTot"></span></h3><div id="lsLista"></div>`,
      aoAbrir: d => {
        leitor = criarLeitor(d.querySelector("#lsLeitor"), tratar);
        const sel = d.querySelector("#lsOS"), s = () => d.querySelector("#lsSinal");
        sel.onchange = () => escolherOS(sel.value);
        async function escolherOS(id) {
          lidos.clear(); os = null;
          if (id && id !== "__AVULSA__") {
            try { os = await api("/api/os/" + id); } catch (e) { return sinal(s(), e.message, "erro"); }
            for (const m of os.material.filter(m => m.ativa && m.pendente > 0)) {
              const it = itens.get(m.codigo);
              lidos.set(m.codigo, { qtd: it && it.rastrear ? 0 : Math.min(m.pendente, Math.max(0, m.fisico)), series: [], pendente: m.pendente, fisico: m.fisico });
            }
            sel.value = id; sinal(s(), `${os.numero} — ${os.cliente}. Leia os números de série.`, "info");
          }
          desenhar();
        }
        function desenhar() {
          const linhas = [...lidos];
          d.querySelector("#lsTot").textContent = os ? os.numero : sel.value === "__AVULSA__" ? "saída avulsa" : "";
          d.querySelector("#lsLista").innerHTML = linhas.length ? linhas.map(([cod, l]) => { const it = itens.get(cod) || { descricao: cod, unidade: "", rastrear: false };
            const feito = it.rastrear ? l.series.length : l.qtd, ok = l.pendente != null && feito >= l.pendente - 1e-9;
            return `<div class="lido ${ok ? "ok" : ""}"><div class="lido-h"><strong>${esc(it.descricao)}</strong> <small class="status-msg">${esc(cod)}</small>
                ${it.rastrear ? `<span class="tag" data-tone="${ok ? "green" : "amber"}">${feito}${l.pendente != null ? " de " + qtd(l.pendente) : ""} lidas</span>`
                  : `<input class="lido-q" data-q="${esc(cod)}" inputmode="decimal" value="${String(l.qtd).replace(".", ",")}"> ${esc(it.unidade)}${l.pendente != null ? ` <small class="status-msg">pendente ${qtd(l.pendente)} · estoque ${qtd(l.fisico)}</small>` : ""}`}
                <button class="x" type="button" data-del="${esc(cod)}" aria-label="Remover">×</button></div>
              ${it.rastrear && l.series.length ? `<div class="chips-serie">${l.series.map(sx => `<span class="serie">${esc(sx)}<button type="button" data-rs="${esc(cod)}" data-s="${esc(sx)}">×</button></span>`).join("")}</div>` : ""}</div>`; }).join("")
            : `<p class="status-msg">${os ? "Esta O.S. não tem material pendente." : "Escolha a O.S. para ver o material."}</p>`;
          d.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { lidos.delete(b.dataset.del); desenhar(); });
          d.querySelectorAll("[data-rs]").forEach(b => b.onclick = () => { const l = lidos.get(b.dataset.rs); l.series = l.series.filter(x => x !== b.dataset.s); desenhar(); });
          d.querySelectorAll("[data-q]").forEach(i => i.onchange = () => { lidos.get(i.dataset.q).qtd = lerNum(i.value); });
        }
        async function tratar(t) {
          if (t.startsWith("FLEX:OS:")) { const id = t.slice(8); if (!abertas.some(x => x.id === id)) return sinal(s(), "Esta O.S. não está aberta.", "erro"); return escolherOS(id); }
          if (!os && sel.value !== "__AVULSA__") return sinal(s(), "Primeiro leia o QR da O.S. (ou escolha na lista).", "erro");
          const cod = t.startsWith("FLEX:ITEM:") ? t.slice(10) : mapa.get(t);
          if (cod) {
            const it = itens.get(cod);
            if (!it) return sinal(s(), `${cod} não é controlado em estoque.`, "erro");
            if (it.rastrear) return sinal(s(), `${it.descricao}: leia o número de série de cada unidade, não o código do produto.`, "aviso");
            if (os && !lidos.has(cod)) return sinal(s(), `${it.descricao} não está reservado para esta O.S.`, "erro");
            const l = lidos.get(cod) || { qtd: 0, series: [] }; l.qtd += 1; lidos.set(cod, l); desenhar(); return sinal(s(), `+1 ${it.unidade} · ${it.descricao}`);
          }
          // número de série
          if ([...lidos.values()].some(l => l.series.includes(t))) return sinal(s(), `Série ${t} já foi lida.`, "erro");
          let r; try { r = await api("/api/estoque/serie/" + encodeURIComponent(t)); } catch (e) { return sinal(s(), `Série ${t} sem entrada registrada no estoque.`, "erro"); }
          if (r.status !== "estoque") return sinal(s(), `Série ${t} já saiu${r.osNumero ? " na " + r.osNumero + " (" + (r.cliente || "") + ")" : ""}.`, "erro");
          const l = lidos.get(r.codigo);
          if (os && !l) return sinal(s(), `${r.descricao} (série ${t}) não é desta O.S.`, "erro");
          const linha = l || { qtd: 0, series: [] };
          if (linha.pendente != null && linha.series.length >= linha.pendente) return sinal(s(), `Já foram lidas todas as ${qtd(linha.pendente)} unidades de ${r.descricao} desta O.S.`, "erro");
          linha.series.push(t); lidos.set(r.codigo, linha); desenhar(); sinal(s(), `Série ${t} · ${r.descricao}`);
        }
        if (osInicial) escolherOS(osInicial.id); else desenhar();
      },
      aoFechar: () => leitor && leitor.desligar(),
      botoes: [{ rotulo: "Cancelar", sec: true }, { rotulo: "Dar saída", acao: async d => {
        const avulsa = d.querySelector("#lsOS").value === "__AVULSA__";
        if (!os && !avulsa) throw new Error("Escolha a O.S. (ou saída avulsa).");
        const its = [...lidos].map(([codigo, l]) => ({ codigo, qtd: (itens.get(codigo) || {}).rastrear ? l.series.length : l.qtd })).filter(i => i.qtd > 0);
        if (!its.length) throw new Error("Nada foi lido.");
        const series = [...lidos.values()].flatMap(l => l.series);
        saldo = (await api("/api/estoque/saida", { method: "POST", body: JSON.stringify({ osId: os ? os.id : "", itens: its, series: series.map(serie => ({ serie })), observacao: d.querySelector("#lsObs").value }) })).saldo;
        leitor.desligar(); toast("Saída registrada");
        if (!$("#view-estoque").hidden) { tabelaEstoque(); movimentos(); }
        if (!$("#view-os").hidden && osAberta) detalheOS(osAberta.id);
      } }]
    });
  }

  /* ---------- RASTREAR UM NÚMERO DE SÉRIE ---------- */
  function rastrearSerie() {
    let leitor;
    modal({
      titulo: "Rastrear número de série",
      corpo: `<div id="rsLeitor"></div><div id="rsRes" style="margin-top:12px"><p class="status-msg">Leia a etiqueta da peça ou digite o número de série.</p></div>`,
      aoAbrir: d => {
        leitor = criarLeitor(d.querySelector("#rsLeitor"), async t => {
          const box = d.querySelector("#rsRes");
          try {
            const r = await api("/api/estoque/serie/" + encodeURIComponent(t)); bip(true);
            box.innerHTML = `<div class="card card-pad"><h3 style="margin:0 0 6px">${esc(r.serie)}</h3><p style="margin:0 0 8px">${esc(r.descricao)} <small class="status-msg">${esc(r.codigo)}</small></p>
              <table class="adm" style="min-width:0"><tbody>
                <tr><td>Situação</td><td>${r.status === "estoque" ? '<span class="tag" data-tone="green">Em estoque</span>' : '<span class="tag" data-tone="amber">Saiu do estoque</span>'}</td></tr>
                <tr><td>Entrada</td><td>${r.remessa ? `<strong>${esc(r.remessa)}</strong> · ` : ""}${dh(r.entradaEm)} · ${esc(r.entradaPor)}${r.documento ? " · NF " + esc(r.documento) : ""}${r.fornecedor ? " · " + esc(r.fornecedor) : ""}</td></tr>
                ${r.saidaEm ? `<tr><td>Saída</td><td>${dh(r.saidaEm)} · ${esc(r.saidaPor || "")}</td></tr>` : ""}
                ${r.osNumero ? `<tr><td>Cliente</td><td><strong>${esc(r.cliente || "")}</strong><br>${esc(r.endereco || "")}<br>${esc(r.osNumero)} · proposta ${esc(r.propostaNumero || "")}</td></tr>` : ""}
              </tbody></table></div>`;
          } catch (e) { bip(false); box.innerHTML = `<div class="aviso erro">${esc(e.message)}</div>`; }
        });
        leitor.focoManual();
      },
      aoFechar: () => leitor && leitor.desligar(),
      botoes: [{ rotulo: "Fechar", sec: true }]
    });
  }

  /* ---------- ETIQUETAS QR ---------- */
  async function etiquetas() {
    let dados; try { dados = await api("/api/estoque/leitura"); } catch (e) { alert(e.message); return; }
    const linhas = [{ codigo: (dados.itens.find(i => !i.rastrear) || dados.itens[0] || {}).codigo, qtd: 1 }]; let ed;
    const opcoes = dados.itens.map(i => ({ codigo: i.codigo, descricao: i.descricao, info: i.rastrear ? "tem série de fábrica" : "" }));
    modal({
      titulo: "Imprimir etiquetas QR", largo: true,
      corpo: `<p class="status-msg" style="margin-top:0">Para itens sem código de fábrica (cabos, conectores…). Cada etiqueta identifica o produto. Folha A4 com 3 × 8 etiquetas de 70 × 37 mm (padrão de folha adesiva). Em "Qtd.", informe quantas etiquetas imprimir.</p>
        <div id="etItens"></div><button class="btn sec" id="etAdd" type="button" style="margin-top:4px">+ Adicionar item</button>`,
      aoAbrir: d => { ed = linhasItens(d.querySelector("#etItens"), linhas, opcoes); d.querySelector("#etAdd").onclick = () => ed.add(); },
      botoes: [{ rotulo: "Cancelar", sec: true }, { rotulo: "Gerar e imprimir", acao: async () => {
        const its = ed.ler().filter(i => i.qtd > 0); if (!its.length) throw new Error("Informe a quantidade de etiquetas.");
        const QR = await carregarQR();
        const box = $("#etqBox"); box.innerHTML = "";
        for (const i of its) {
          const it = dados.itens.find(x => x.codigo === i.codigo) || { descricao: i.codigo };
          for (let n = 0; n < Math.min(500, Math.round(i.qtd)); n++) {
            const e = document.createElement("div"); e.className = "etq";
            e.innerHTML = `<div class="etq-qr"></div><div class="etq-t"><strong>${esc(i.codigo)}</strong><span>${esc(it.descricao)}</span><small>Flex Solar</small></div>`;
            new QR(e.querySelector(".etq-qr"), { text: "FLEX:ITEM:" + i.codigo, width: 110, height: 110, correctLevel: QR.CorrectLevel.M });
            box.appendChild(e);
          }
        }
        setTimeout(() => imprimir("print-etq", "Etiquetas_QR_Flex_Solar"), 300);
      } }]
    });
  }

  /* ---------- QR da O.S. ---------- */
  async function qrOS(el, id) {
    try { const QR = await carregarQR(); el.innerHTML = ""; new QR(el, { text: "FLEX:OS:" + id, width: 92, height: 92, correctLevel: QR.CorrectLevel.M }); } catch (e) {}
  }

  function imprimir(classe, nome) {
    const titulo = document.title; document.title = nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "_");
    document.body.classList.add(classe);
    const fim = () => { document.body.classList.remove(classe); document.title = titulo; window.removeEventListener("afterprint", fim); };
    window.addEventListener("afterprint", fim);
    try { window.print(); } catch (e) { fim(); }
  }

  window.FlexOp = { abrirOS, abrirEstoque, iniciarAvisos, pararAvisos: () => clearInterval(avisoTimer) };
  if ($("#view-os") && !$("#view-os").hidden) abrirOS();
  if ($("#view-estoque") && !$("#view-estoque").hidden) abrirEstoque();
})();
