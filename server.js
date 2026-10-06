import express from "express";
import cors from "cors";
import pg from "pg";
import jwt from "jsonwebtoken";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { scrypt as _scrypt, randomBytes, timingSafeEqual } from "node:crypto";

const {
  DATABASE_URL,
  PGSSL = "false",
  APP_PASSWORD,          // agora serve só para criar o primeiro administrador
  JWT_SECRET,
  CORS_ORIGIN = "",
  PORT = 3000,
} = process.env;

for (const [k, v] of Object.entries({ DATABASE_URL, APP_PASSWORD, JWT_SECRET })) {
  if (!v) { console.error(`Variável de ambiente ausente: ${k}`); process.exit(1); }
}

// Datas (DATE) chegam como texto "AAAA-MM-DD", sem conversão de fuso horário
pg.types.setTypeParser(1082, v => v);
// NUMERIC chega como número
pg.types.setTypeParser(1700, v => (v === null ? null : Number(v)));

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

const app = express();
app.use(express.json({ limit: "5mb" }));

const origens = CORS_ORIGIN.split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || origens.length === 0 || origens.includes(origin)),
}));

/* =====================================================================
   Utilidades
   ===================================================================== */
const OPCOES = {
  status:    ["Rascunho", "Enviada", "Em negociação", "Fechada", "Recusada", "Cancelada"],
  andamento: ["Não iniciado", "Aguardando pagamento", "Aguardando material", "Montagem", "Instalação", "Instalado", "Em operação", "Cancelado"],
  statusPag: ["Pendente", "Parcial", "Pago", "Em atraso", "Estornado"],
};
// nome da coluna no banco para cada campo (o campo "pagamento" já é a condição de pagamento, texto livre)
const COLUNA = { status: "status", andamento: "andamento", statusPag: "status_pag" };
const LEGADO = { Aceita: "Fechada" };

const num = v => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v ?? "").replace(/R\$|\s/gi, "").trim();
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");          // 1.234,56
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");      // 10.000
  const x = parseFloat(s); return Number.isFinite(x) ? x : 0;
};
const numOuNull = v => (v === "" || v == null ? null : Number.isFinite(num(v)) ? num(v) : null);
const totalDe = d => (d.produto === "solar" ? num(d.precoTotal) : num(d.vEquip) + num(d.vInst));
const dataOuNull = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const curto = v => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return s.length > 300 ? s.slice(0, 300) + "…" : s; };
const nomeCliente = d => d.fantasia || d.razao || "";
const erro = (status, message) => Object.assign(new Error(message), { status });
const naoEncontrado = (o = "Registro") => erro(404, `${o} não encontrado.`);

function diferencas(antes = {}, depois = {}, ignorar = []) {
  const out = [];
  for (const k of new Set([...Object.keys(antes), ...Object.keys(depois)])) {
    if (k.startsWith("_") || ignorar.includes(k)) continue;
    const a = antes[k], b = depois[k];
    if (curto(a) === curto(b)) continue;
    if (k === "logo") out.push({ campo: k, de: a ? "(imagem)" : "", para: b ? "(nova imagem)" : "(removido)" });
    else out.push({ campo: k, de: curto(a), para: curto(b) });
  }
  return out;
}
async function auditar(db, { entidade = "proposta", propostaId = null, numero, cliente, usuario, acao, alteracoes = [] }) {
  await db.query(
    `insert into flex_auditoria (entidade, proposta_id, numero, cliente, usuario, acao, alteracoes)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [entidade, propostaId, numero, cliente, usuario, acao, JSON.stringify(alteracoes)]);
}
async function transacao(fn) {
  const db = await pool.connect();
  try { await db.query("begin"); const r = await fn(db); await db.query("commit"); return r; }
  catch (e) { await db.query("rollback").catch(() => {}); throw e; }
  finally { db.release(); }
}
function falha(res, e) {
  if (e.code === "23505") {
    const msg = /usuarios/.test(e.constraint || "") ? "Já existe um usuário com esse e-mail."
      : /catalogo/.test(e.constraint || "") ? "Já existe um item com esse código."
      : /estruturas/.test(e.constraint || "") ? "Já existe uma estrutura com esse nome."
      : /kits/.test(e.constraint || "") ? "Já existe um kit para essa potência e ligação."
      : "Já existe uma proposta com esse número.";
    return res.status(409).json({ erro: msg });
  }
  if (e.status) return res.status(e.status).json({ erro: e.message });
  console.error(e);
  res.status(500).json({ erro: "Erro no servidor. Tente novamente." });
}
const rota = fn => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { falha(res, e); } };

/* =====================================================================
   Senhas
   ===================================================================== */
const scrypt = (s, salt) => new Promise((ok, no) => _scrypt(s, salt, 64, (e, k) => (e ? no(e) : ok(k))));
async function hashSenha(senha) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${(await scrypt(senha, salt)).toString("hex")}`;
}
async function confereSenha(senha, armazenada) {
  const [tipo, salt, hash] = String(armazenada || "").split("$");
  if (tipo !== "scrypt" || !salt || !hash) return false;
  const calc = await scrypt(String(senha), Buffer.from(salt, "hex"));
  const ref = Buffer.from(hash, "hex");
  return ref.length === calc.length && timingSafeEqual(calc, ref);
}
function validaSenha(s) {
  if (String(s || "").length < 8) throw erro(400, "A senha precisa ter pelo menos 8 caracteres.");
}
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ""));

// Proteção simples contra tentativa de senha: 8 erros em 15 min bloqueiam o e-mail por 15 min
const tentativas = new Map();
function bloqueado(chave) {
  const t = tentativas.get(chave);
  return t && t.n >= 8 && Date.now() - t.desde < 15 * 60 * 1000;
}
function registraFalha(chave) {
  const t = tentativas.get(chave);
  if (!t || Date.now() - t.desde > 15 * 60 * 1000) tentativas.set(chave, { n: 1, desde: Date.now() });
  else t.n++;
}

/* =====================================================================
   Site (servido pelo próprio Railway)
   ===================================================================== */
const SITE = {
  "/": "index.html",
  "/index.html": "index.html",
  "/admin.js": "admin.js",
  "/operacao.js": "operacao.js",
  "/manifest.webmanifest": "manifest.webmanifest",
  "/sw.js": "sw.js",
  "/icone-192.png": "icone-192.png",
  "/icone-512.png": "icone-512.png",
  "/icone-maskable-512.png": "icone-maskable-512.png",
  "/apple-touch-icon.png": "apple-touch-icon.png",
  "/favicon.png": "favicon.png",
  "/config.js": "config.js",
  "/flex-solar.jpg": "flex-solar.jpg",
  "/exemplo-divinissimo.jpg": "exemplo-divinissimo.jpg",
  "/solar-topo.jpg": "solar-topo.jpg",
  "/solar-intro.jpg": "solar-intro.jpg",
  "/solar-ciclo.jpg": "solar-ciclo.jpg",
};
for (const [caminho, arquivo] of Object.entries(SITE)) {
  app.get(caminho, (_req, res) => {
    if (!/\.(jpg|png)$/.test(arquivo)) res.set("Cache-Control", "no-cache");
    if (arquivo.endsWith(".webmanifest")) res.type("application/manifest+json");
    res.sendFile(fileURLToPath(new URL("./" + arquivo, import.meta.url)));
  });
}

/* =====================================================================
   Rotas públicas: saúde, primeiro acesso e login
   ===================================================================== */
app.get("/health", async (_req, res) => {
  try { await pool.query("select 1"); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.get("/api/setup", rota(async (_req, res) => {
  const { rows } = await pool.query("select count(*)::int n from flex_usuarios");
  res.json({ precisaAdmin: rows[0].n === 0 });
}));

// Cria o primeiro administrador. Só funciona enquanto não existe nenhum usuário,
// e exige a senha antiga da equipe (variável APP_PASSWORD) como autorização.
app.post("/api/setup", rota(async (req, res) => {
  const { chave, nome, email, senha } = req.body || {};
  if (bloqueado("setup")) throw erro(429, "Muitas tentativas. Aguarde 15 minutos.");
  if (chave !== APP_PASSWORD) { registraFalha("setup"); throw erro(401, "Senha da equipe incorreta."); }
  if (!String(nome || "").trim()) throw erro(400, "Informe seu nome.");
  if (!emailOk(email)) throw erro(400, "E-mail inválido.");
  validaSenha(senha);
  const usuario = await transacao(async db => {
    await db.query("lock table flex_usuarios in exclusive mode");
    const { rows } = await db.query("select count(*)::int n from flex_usuarios");
    if (rows[0].n > 0) throw erro(409, "O administrador já foi criado. Entre com seu e-mail e senha.");
    const r = await db.query(
      `insert into flex_usuarios (nome, email, senha_hash, perfil, ultimo_login) values ($1,$2,$3,'admin', now()) returning id, nome, email, perfil`,
      [nome.trim(), email.trim().toLowerCase(), await hashSenha(senha)]);
    await auditar(db, { entidade: "usuario", numero: r.rows[0].email, cliente: r.rows[0].nome, usuario: r.rows[0].nome, acao: "criou",
      alteracoes: [{ campo: "perfil", de: "", para: "admin" }] });
    return r.rows[0];
  });
  res.status(201).json(emitirToken(usuario));
}));

function emitirToken(u) {
  return { token: jwt.sign({ sub: u.id }, JWT_SECRET, { expiresIn: "12h" }), usuario: { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, equipe: u.equipe || null } };
}

app.post("/api/login", rota(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const senha = String(req.body?.senha || "");
  if (bloqueado(email)) throw erro(429, "Muitas tentativas. Aguarde 15 minutos.");
  const { rows } = await pool.query("select id, nome, email, perfil, equipe, ativo, senha_hash from flex_usuarios where lower(email) = $1", [email]);
  const u = rows[0];
  if (!u || !(await confereSenha(senha, u.senha_hash))) { registraFalha(email); throw erro(401, "E-mail ou senha incorretos."); }
  if (!u.ativo) throw erro(403, "Usuário desativado. Fale com o administrador.");
  tentativas.delete(email);
  await pool.query("update flex_usuarios set ultimo_login = now() where id = $1", [u.id]);
  res.json(emitirToken(u));
}));

/* =====================================================================
   Autenticação: daqui para baixo exige login
   ===================================================================== */
app.use("/api", rota(async (req, res, next) => {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  let id;
  try { id = jwt.verify(token, JWT_SECRET).sub; } catch { throw erro(401, "Sessão expirada. Entre novamente."); }
  if (!UUID.test(String(id))) throw erro(401, "Sessão expirada. Entre novamente.");
  // perfil e situação são lidos do banco a cada pedido: desativar ou trocar o perfil vale na hora
  const { rows } = await pool.query("select id, nome, email, perfil, equipe, ativo from flex_usuarios where id = $1", [id]);
  if (!rows.length || !rows[0].ativo) throw erro(401, "Sessão expirada. Entre novamente.");
  req.user = rows[0];
  req.usuario = rows[0].nome;
  next();
}));
const soAdmin = (req, _res, next) => (req.user.perfil === "admin" ? next() : next(erro(403, "Acesso restrito ao administrador.")));
app.use("/api/admin", (req, res, next) => soAdmin(req, res, e => (e ? falha(res, e) : next())));

app.get("/api/me", (req, res) => res.json({ id: req.user.id, nome: req.user.nome, email: req.user.email, perfil: req.user.perfil, equipe: req.user.equipe || null }));

app.put("/api/me/senha", rota(async (req, res) => {
  const { atual, nova } = req.body || {};
  const { rows } = await pool.query("select senha_hash from flex_usuarios where id = $1", [req.user.id]);
  if (!(await confereSenha(atual, rows[0].senha_hash))) throw erro(400, "A senha atual não confere.");
  validaSenha(nova);
  await pool.query("update flex_usuarios set senha_hash = $2 where id = $1", [req.user.id, await hashSenha(nova)]);
  res.json({ ok: true });
}));

/* =====================================================================
   Propostas
   ===================================================================== */
function limparProposta(body) {
  const d = {};
  for (const [k, v] of Object.entries(body || {})) if (!k.startsWith("_")) d[k] = v;
  delete d.id; delete d.updatedAt; delete d.createdAt;
  // a composição de custo nunca fica gravada na proposta (o comercial não pode vê-la)
  if (d.calc && typeof d.calc === "object") { d.calc = { ...d.calc }; delete d.calc.custos; }
  for (const campo of Object.keys(OPCOES)) {
    if (LEGADO[d[campo]]) d[campo] = LEGADO[d[campo]];
    if (!OPCOES[campo].includes(d[campo])) d[campo] = OPCOES[campo][0];
  }
  return d;
}
function validarProposta(d) {
  const faltando = [];
  if (!String(d.razao || "").trim()) faltando.push("razão social");
  if (!String(d.numero || "").trim()) faltando.push("nº da proposta");
  if (faltando.length) throw erro(400, `Preencha: ${faltando.join(" e ")}`);
}
const paraLista = r => ({
  id: r.id, numero: r.numero, produto: r.produto,
  status: LEGADO[r.status] || r.status, andamento: r.andamento, statusPag: r.status_pag,
  razao: r.razao, fantasia: r.fantasia, cnpj: r.cnpj,
  data: r.data || null, total: Number(r.total), updatedAt: r.updated_at, temComposicao: !!r.tem_composicao,
});

app.get("/api/propostas", rota(async (_req, res) => {
  const { rows } = await pool.query(
    `select id, numero, produto, status, andamento, status_pag, razao, fantasia, cnpj, data, total, updated_at, (composicao is not null) as tem_composicao
       from flex_propostas order by updated_at desc limit 1000`);
  res.json(rows.map(paraLista));
}));

app.get("/api/propostas/:id", rota(async (req, res) => {
  if (!UUID.test(req.params.id)) throw naoEncontrado("Proposta");
  const { rows } = await pool.query(
    "select id, dados, status, andamento, status_pag, updated_at from flex_propostas where id = $1", [req.params.id]);
  if (!rows.length) throw naoEncontrado("Proposta");
  const r = rows[0];
  res.json({ ...r.dados, status: LEGADO[r.status] || r.status, andamento: r.andamento, statusPag: r.status_pag, id: r.id, updatedAt: r.updated_at });
}));

const podeProposta = (req) => { if (!["admin", "comercial"].includes(req.user.perfil)) throw erro(403, "Só o comercial ou o administrador alteram propostas."); };
app.post("/api/propostas", rota(async (req, res) => {
  podeProposta(req);
  const d = limparProposta(req.body); validarProposta(d);
  const r = await transacao(async db => {
    const { rows } = await db.query(
      `insert into flex_propostas (numero, produto, status, andamento, status_pag, razao, fantasia, cnpj, data, total, dados)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id, updated_at`,
      [d.numero.trim(), d.produto || "watcher", d.status, d.andamento, d.statusPag, d.razao.trim(),
       d.fantasia || null, d.cnpj || null, dataOuNull(d.data), totalDe(d), d]);
    await atualizarMarcos(db, rows[0].id);
    await gravarComposicao(db, rows[0].id, d);
    await sincronizarOperacao(db, rows[0].id, req.usuario);
    await auditar(db, { propostaId: rows[0].id, numero: d.numero, cliente: nomeCliente(d), usuario: req.usuario, acao: "criou" });
    return rows[0];
  });
  res.status(201).json({ id: r.id, updatedAt: r.updated_at });
}));

app.put("/api/propostas/:id", rota(async (req, res) => {
  podeProposta(req);
  if (!UUID.test(req.params.id)) throw naoEncontrado("Proposta");
  const d = limparProposta(req.body); validarProposta(d);
  const r = await transacao(async db => {
    const antes = await db.query("select dados from flex_propostas where id = $1 for update", [req.params.id]);
    if (!antes.rows.length) throw naoEncontrado("Proposta");
    const { rows } = await db.query(
      `update flex_propostas set numero=$2, produto=$3, status=$4, andamento=$5, status_pag=$6, razao=$7,
              fantasia=$8, cnpj=$9, data=$10, total=$11, dados=$12, updated_at=now()
        where id=$1 returning id, updated_at`,
      [req.params.id, d.numero.trim(), d.produto || "watcher", d.status, d.andamento, d.statusPag, d.razao.trim(),
       d.fantasia || null, d.cnpj || null, dataOuNull(d.data), totalDe(d), d]);
    await atualizarMarcos(db, req.params.id);
    await gravarComposicao(db, req.params.id, d);
    await sincronizarOperacao(db, req.params.id, req.usuario);
    if (!!antes.rows[0].dados.visitaTecnica !== !!d.visitaTecnica) await ajustarVisita(db, req.params.id, !!d.visitaTecnica, req.usuario);
    const alt = diferencas(antes.rows[0].dados, d, ["calc"]);
    await eventoSituacaoOS(db, req.params.id, alt, req.usuario);
    if (alt.length) await auditar(db, { propostaId: req.params.id, numero: d.numero, cliente: nomeCliente(d), usuario: req.usuario, acao: "editou", alteracoes: alt });
    return rows[0];
  });
  res.json({ id: r.id, updatedAt: r.updated_at });
}));

// Mudança rápida pela lista: situação, andamento ou pagamento
app.patch("/api/propostas/:id", rota(async (req, res) => {
  podeProposta(req);
  if (!UUID.test(req.params.id)) throw naoEncontrado("Proposta");
  const campo = Object.keys(OPCOES).find(k => k in (req.body || {}));
  const valor = campo && req.body[campo];
  if (!campo || !OPCOES[campo].includes(valor)) throw erro(400, "Opção inválida.");
  const r = await transacao(async db => {
    const antes = await db.query(`select numero, razao, fantasia, ${COLUNA[campo]} as valor from flex_propostas where id = $1 for update`, [req.params.id]);
    if (!antes.rows.length) throw naoEncontrado("Proposta");
    const a = antes.rows[0];
    const { rows } = await db.query(
      `update flex_propostas set ${COLUNA[campo]}=$2, dados = dados || jsonb_build_object($3::text, $2::text), updated_at=now()
        where id=$1 returning id, updated_at`, [req.params.id, valor, campo]);
    await atualizarMarcos(db, req.params.id);
    await sincronizarOperacao(db, req.params.id, req.usuario);
    if ((LEGADO[a.valor] || a.valor) !== valor) await eventoSituacaoOS(db, req.params.id, [{ campo, de: a.valor, para: valor }], req.usuario);
    if ((LEGADO[a.valor] || a.valor) !== valor)
      await auditar(db, { propostaId: req.params.id, numero: a.numero, cliente: a.fantasia || a.razao, usuario: req.usuario,
                          acao: "status", alteracoes: [{ campo, de: a.valor, para: valor }] });
    return rows[0];
  });
  res.json({ id: r.id, updatedAt: r.updated_at });
}));

app.delete("/api/propostas/:id", rota(async (req, res) => {
  podeProposta(req);
  if (!UUID.test(req.params.id)) throw naoEncontrado("Proposta");
  await transacao(async db => {
    const { rows } = await db.query("delete from flex_propostas where id = $1 returning numero, razao, fantasia", [req.params.id]);
    if (!rows.length) throw naoEncontrado("Proposta");
    await db.query("update flex_reservas set ativa = false where proposta_id = $1", [req.params.id]);
    const osDel = (await db.query("update flex_os set status = 'cancelada' where proposta_id = $1 and status <> 'cancelada' returning id", [req.params.id])).rows[0];
    if (osDel) await eventoOS(db, osDel.id, { texto: `O.S. cancelada: a proposta ${rows[0].numero} foi excluída.`, usuario: req.usuario });
    await auditar(db, { propostaId: req.params.id, numero: rows[0].numero, cliente: rows[0].fantasia || rows[0].razao, usuario: req.usuario, acao: "excluiu" });
  });
  res.status(204).end();
}));

/* =====================================================================
   Auditoria (o comercial vê só as propostas; o administrador vê tudo)
   ===================================================================== */
app.get("/api/auditoria", rota(async (req, res) => {
  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 300, 1), 1000);
  const proposta = UUID.test(req.query.proposta || "") ? req.query.proposta : null;
  const admin = req.user.perfil === "admin";
  const entidade = admin ? (req.query.entidade || null) : "proposta";
  const { rows } = await pool.query(
    `select id, entidade, proposta_id, numero, cliente, usuario, acao, alteracoes, criado_em
       from flex_auditoria
      where ($1::uuid is null or proposta_id = $1)
        and ($2::text is null or entidade = $2)
      order by criado_em desc, id desc limit $3`, [proposta, entidade, limite]);
  res.json(rows.map(r => ({ id: Number(r.id), entidade: r.entidade, propostaId: r.proposta_id, numero: r.numero, cliente: r.cliente,
    usuario: r.usuario, acao: r.acao, alteracoes: r.alteracoes, em: r.criado_em })));
}));

/* =====================================================================
   ADMINISTRAÇÃO — composição de custo de uma proposta
   ===================================================================== */
app.get("/api/admin/propostas/:id/composicao", rota(async (req, res) => {
  if (!UUID.test(req.params.id)) throw naoEncontrado("Proposta");
  const { rows } = await pool.query("select id, numero, produto, razao, fantasia, total, composicao from flex_propostas where id = $1", [req.params.id]);
  if (!rows.length) throw naoEncontrado("Proposta");
  const r = rows[0];
  res.json({ id: r.id, numero: r.numero, produto: r.produto, cliente: r.fantasia || r.razao, total: Number(r.total), composicao: r.composicao });
}));

/* =====================================================================
   ADMINISTRAÇÃO — prazos das etapas da O.S.
   ===================================================================== */
app.get("/api/admin/os-prazos", rota(async (_req, res) => {
  const prazos = await lerPrazos();
  res.json(ETAPAS_OS.map(([key, nome, setor]) => ({ key, nome, setor, dias: prazos[key] || 0 })));
}));
app.put("/api/admin/os-prazos", rota(async (req, res) => {
  const b = req.body || {}, novo = {};
  for (const [key] of ETAPAS_OS) {
    const v = b[key] === "" || b[key] == null ? 0 : num(b[key]);
    if (v < 0 || v > 365 || !Number.isInteger(v)) throw erro(400, "Os prazos precisam ser números inteiros de dias, entre 0 e 365.");
    novo[key] = v;
  }
  await transacao(async db => {
    const antes = await lerPrazos(db);
    await db.query(`insert into flex_parametros (chave, valor) values ('os_prazos', $1) on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`, [JSON.stringify(novo)]);
    const alt = ETAPAS_OS.filter(([k]) => Number(antes[k] || 0) !== novo[k]).map(([k, nome]) => ({ campo: nome, de: String(antes[k] || 0) + " dias", para: novo[k] + " dias" }));
    if (alt.length) await auditar(db, { entidade: "parametros", numero: "Prazos das O.S.", usuario: req.usuario, acao: "editou", alteracoes: alt });
  });
  res.json(novo);
}));

/* =====================================================================
   ADMINISTRAÇÃO — usuários
   ===================================================================== */
const PERFIS = ["admin", "comercial", "almoxarife", "engenharia", "comprador", "campo"];

app.get("/api/admin/usuarios", rota(async (_req, res) => {
  const { rows } = await pool.query(
    "select id, nome, email, perfil, equipe, ativo, ultimo_login, criado_em from flex_usuarios order by ativo desc, nome");
  res.json(rows);
}));

app.post("/api/admin/usuarios", rota(async (req, res) => {
  const { nome, email, senha, perfil = "comercial" } = req.body || {};
  const equipe = perfil === "campo" ? (EQUIPES.includes(req.body?.equipe) ? req.body.equipe : null) : null;
  if (perfil === "campo" && !equipe) throw erro(400, "Escolha a equipe (cor) do usuário de campo.");
  if (!String(nome || "").trim()) throw erro(400, "Informe o nome.");
  if (!emailOk(email)) throw erro(400, "E-mail inválido.");
  if (!PERFIS.includes(perfil)) throw erro(400, "Perfil inválido.");
  validaSenha(senha);
  const u = await transacao(async db => {
    const { rows } = await db.query(
      `insert into flex_usuarios (nome, email, senha_hash, perfil, equipe) values ($1,$2,$3,$4,$5) returning id, nome, email, perfil, equipe, ativo`,
      [nome.trim(), email.trim().toLowerCase(), await hashSenha(senha), perfil, equipe]);
    await auditar(db, { entidade: "usuario", numero: rows[0].email, cliente: rows[0].nome, usuario: req.usuario, acao: "criou",
      alteracoes: [{ campo: "perfil", de: "", para: perfil }] });
    return rows[0];
  });
  res.status(201).json(u);
}));

app.put("/api/admin/usuarios/:id", rota(async (req, res) => {
  if (!UUID.test(req.params.id)) throw naoEncontrado("Usuário");
  const b = req.body || {};
  const u = await transacao(async db => {
    const antes = (await db.query("select id, nome, email, perfil, equipe, ativo from flex_usuarios where id = $1 for update", [req.params.id])).rows[0];
    if (!antes) throw naoEncontrado("Usuário");
    const depois = {
      nome: b.nome !== undefined ? String(b.nome).trim() : antes.nome,
      email: b.email !== undefined ? String(b.email).trim().toLowerCase() : antes.email,
      perfil: b.perfil !== undefined ? b.perfil : antes.perfil,
      ativo: b.ativo !== undefined ? !!b.ativo : antes.ativo,
      equipe: b.equipe !== undefined ? (EQUIPES.includes(b.equipe) ? b.equipe : null) : antes.equipe,
    };
    if (depois.perfil !== "campo") depois.equipe = null;
    if (depois.perfil === "campo" && !depois.equipe) throw erro(400, "Escolha a equipe (cor) do usuário de campo.");
    if (!depois.nome) throw erro(400, "Informe o nome.");
    if (!emailOk(depois.email)) throw erro(400, "E-mail inválido.");
    if (!PERFIS.includes(depois.perfil)) throw erro(400, "Perfil inválido.");
    if (antes.id === req.user.id && (depois.perfil !== "admin" || !depois.ativo))
      throw erro(400, "Você não pode tirar o seu próprio acesso de administrador.");
    await db.query("update flex_usuarios set nome=$2, email=$3, perfil=$4, ativo=$5, equipe=$6 where id=$1",
      [antes.id, depois.nome, depois.email, depois.perfil, depois.ativo, depois.equipe]);
    const alt = diferencas(antes, depois, ["id"]);
    if (b.senha) {
      validaSenha(b.senha);
      await db.query("update flex_usuarios set senha_hash=$2 where id=$1", [antes.id, await hashSenha(b.senha)]);
      alt.push({ campo: "senha", de: "", para: "(redefinida)" });
    }
    if (alt.length) await auditar(db, { entidade: "usuario", numero: depois.email, cliente: depois.nome, usuario: req.usuario, acao: "editou", alteracoes: alt });
    return { id: antes.id, ...depois };
  });
  res.json(u);
}));

/* =====================================================================
   ADMINISTRAÇÃO — tabela de preços (catálogo)
   ===================================================================== */
const CATEGORIAS = { modulo: "Módulo", inversor: "Inversor", componente: "Componente elétrico", ferragem: "Ferragem", bateria: "Bateria", outros: "Outros" };
function categoriaDe(v) {
  const s = String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (CATEGORIAS[s]) return s;
  if (s.startsWith("mod") || s.startsWith("placa") || s.startsWith("painel")) return "modulo";
  if (s.startsWith("inv")) return "inversor";
  if (s.startsWith("comp") || s.includes("eletric") || s.startsWith("cabo") || s.startsWith("conector")) return "componente";
  if (s.startsWith("bat")) return "bateria";
  if (s.startsWith("outr") || s.startsWith("carregador")) return "outros";
  if (s.startsWith("ferr") || s.startsWith("estru")) return "ferragem";
  return null;
}
const LIGACOES = { mono220: "Monofásico 220 V", tri220: "Trifásico 220 V", tri380: "Trifásico 380 V" };
// Lê a ligação de um texto ("Trifásico 380 V", "tri380", "MONO"…)
function ligacaoDe(v) {
  const s = String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  if (LIGACOES[s]) return s;
  const tri = /tri/.test(s), mono = /mono/.test(s);
  if (mono && !tri) return "mono220";
  if (tri && /380/.test(s)) return "tri380";
  if (tri && /220/.test(s)) return "tri220";
  return undefined; // texto não reconhecido
}
// Para inversores sem ligação informada: deduz pela descrição (e, se preciso, pelo código)
function deduzLigacao(descricao, codigo) {
  const d = String(descricao || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const c = String(codigo || "").toUpperCase();
  const mono = /MONOFASICO|\bMONO\b/.test(d) || /-MO-/.test(c);
  const tri = /TRIFASICO/.test(d) || (!mono && /-TR-/.test(c));
  if (mono && !tri) return "mono220";
  if (tri) {
    if (/\b380\s?V\b/.test(d)) return "tri380";
    if (/\b220\s?V\b/.test(d)) return "tri220";
    if (/-380V-/.test(c)) return "tri380";
    if (/-220V-/.test(c)) return "tri220";
  }
  return null;
}
const simNao = v => (v === undefined || v === null || v === "" ? true
  : typeof v === "boolean" ? v : !/^(n|nao|não|false|0|inativo)$/i.test(String(v).trim()));

function normalizarItem(b) {
  const item = {
    codigo: String(b.codigo ?? "").trim().toUpperCase(),
    categoria: categoriaDe(b.categoria),
    descricao: String(b.descricao ?? "").trim(),
    marca: String(b.marca ?? "").trim() || null,
    modelo: String(b.modelo ?? "").trim() || null,
    potencia_w: numOuNull(b.potencia_w),
    unidade: String(b.unidade ?? "").trim() || "un",
    custo: num(b.custo),
    ativo: simNao(b.ativo),
    ligacao: null,
  };
  const estoqueAuto = item.categoria === "modulo" || item.categoria === "inversor" || (/CABO/i.test(item.descricao) && /SOLAR/i.test(item.descricao));
  item._estoque = b.estoque === undefined || b.estoque === null || b.estoque === "" ? estoqueAuto : simNao(b.estoque);
  item._rastrear = b.rastrear === undefined || b.rastrear === null || b.rastrear === "" ? ["modulo", "inversor"].includes(item.categoria) : simNao(b.rastrear);
  const erros = [];
  if (item.categoria === "inversor") {
    const l = ligacaoDe(b.ligacao);
    if (l === undefined) erros.push(`ligação inválida ("${b.ligacao}"); use Monofásico 220 V, Trifásico 220 V ou Trifásico 380 V`);
    else item.ligacao = l || deduzLigacao(item.descricao, item.codigo);
  }
  if (!item.codigo) erros.push("código vazio");
  if (!item.categoria) erros.push(`categoria inválida ("${b.categoria ?? ""}")`);
  if (!item.descricao) erros.push("descrição vazia");
  if (item.custo < 0) erros.push("custo negativo");
  if (["modulo", "inversor"].includes(item.categoria) && !(item.potencia_w > 0)) erros.push("potência obrigatória para módulo e inversor");
  return { item, erros };
}
const CAMPOS_ITEM = ["codigo", "categoria", "descricao", "marca", "modelo", "potencia_w", "unidade", "custo", "ativo", "ligacao"];
const MARCAS_SQL = CAMPOS_ITEM.map((_, i) => `$${i + 1}`).join(",");
const soCampos = r => Object.fromEntries(CAMPOS_ITEM.map(k => [k, r[k] ?? null]));

app.get("/api/admin/catalogo", rota(async (_req, res) => {
  const { rows } = await pool.query(
    `select id, ${CAMPOS_ITEM.join(", ")}, estoque, rastrear, atualizado_em from flex_catalogo order by categoria, potencia_w nulls last, descricao`);
  res.json(rows);
}));

app.post("/api/admin/catalogo", rota(async (req, res) => {
  const { item, erros } = normalizarItem(req.body);
  if (erros.length) throw erro(400, "Corrija: " + erros.join(", ") + ".");
  const r = await transacao(async db => {
    const { rows } = await db.query(
      `insert into flex_catalogo (${CAMPOS_ITEM.join(", ")}, estoque, rastrear) values (${MARCAS_SQL}, $${CAMPOS_ITEM.length + 1}, $${CAMPOS_ITEM.length + 2}) returning id`,
      [...CAMPOS_ITEM.map(k => item[k]), item._estoque, item._rastrear]);
    await auditar(db, { entidade: "preco", numero: item.codigo, cliente: item.descricao, usuario: req.usuario, acao: "criou",
      alteracoes: [{ campo: "custo", de: "", para: String(item.custo) }] });
    return rows[0];
  });
  res.status(201).json({ id: r.id, ...item });
}));

app.put("/api/admin/catalogo/:id", rota(async (req, res) => {
  if (!UUID.test(req.params.id)) throw naoEncontrado("Item");
  const { item, erros } = normalizarItem(req.body);
  if (erros.length) throw erro(400, "Corrija: " + erros.join(", ") + ".");
  await transacao(async db => {
    const antes = (await db.query(`select ${CAMPOS_ITEM.join(", ")} from flex_catalogo where id = $1 for update`, [req.params.id])).rows[0];
    if (!antes) throw naoEncontrado("Item");
    await db.query(
      `update flex_catalogo set ${CAMPOS_ITEM.map((k, i) => `${k}=$${i + 2}`).join(", ")}, atualizado_em=now() where id=$1`,
      [req.params.id, ...CAMPOS_ITEM.map(k => item[k])]);
    if (req.body && req.body.estoque !== undefined) {
      const ant = (await db.query("select estoque from flex_catalogo where id = $1", [req.params.id])).rows[0];
      await db.query("update flex_catalogo set estoque = $2 where id = $1", [req.params.id, item._estoque]);
      if (ant && ant.estoque !== item._estoque) await auditar(db, { entidade: "preco", numero: item.codigo, cliente: item.descricao, usuario: req.usuario, acao: "editou",
        alteracoes: [{ campo: "estoque", de: ant.estoque ? "Sim" : "Não", para: item._estoque ? "Sim" : "Não" }] });
    }
    if (req.body && req.body.rastrear !== undefined)
      await db.query("update flex_catalogo set rastrear = $2 where id = $1", [req.params.id, item._rastrear]);
    if (antes.codigo !== item.codigo)  // mantém os kits apontando para o código novo
    {
      const troca = `(select coalesce(jsonb_agg(case when e->>'codigo' = $1 then jsonb_set(e, '{codigo}', to_jsonb($2::text)) else e end), '[]') from jsonb_array_elements(itens) e)`;
      await db.query(`update flex_kits set itens = ${troca}`, [antes.codigo, item.codigo]);
      await db.query(`update flex_estruturas set itens = ${troca}`, [antes.codigo, item.codigo]);
      await db.query("update flex_estoque_mov set codigo = $2 where codigo = $1", [antes.codigo, item.codigo]);
      await db.query("update flex_reservas set codigo = $2 where codigo = $1", [antes.codigo, item.codigo]);
      await db.query("update flex_series set codigo = $2 where codigo = $1", [antes.codigo, item.codigo]);
      await db.query("update flex_codigos_barras set codigo = $2 where codigo = $1", [antes.codigo, item.codigo]);
      await db.query(`update flex_parametros set valor = jsonb_set(valor, '{itensPorModulo}', (select coalesce(jsonb_agg(case when e->>'codigo' = $1 then jsonb_set(e, '{codigo}', to_jsonb($2::text)) else e end), '[]') from jsonb_array_elements(valor->'itensPorModulo') e)) where chave = 'solar' and valor ? 'itensPorModulo'`, [antes.codigo, item.codigo]);
    }
    const alt = diferencas(soCampos(antes), item);
    if (alt.length) await auditar(db, { entidade: "preco", numero: item.codigo, cliente: item.descricao, usuario: req.usuario, acao: "editou", alteracoes: alt });
  });
  res.json({ id: req.params.id, ...item });
}));

app.delete("/api/admin/catalogo/:id", rota(async (req, res) => {
  if (!UUID.test(req.params.id)) throw naoEncontrado("Item");
  await transacao(async db => {
    const it = (await db.query("select codigo, descricao from flex_catalogo where id = $1", [req.params.id])).rows[0];
    if (!it) throw naoEncontrado("Item");
    const usado = await db.query("select potencia_kw, ligacao from flex_kits where itens @> $1::jsonb", [JSON.stringify([{ codigo: it.codigo }])]);
    const mov = await db.query("select 1 from flex_estoque_mov where codigo = $1 union all select 1 from flex_reservas where codigo = $1 limit 1", [it.codigo]);
    if (mov.rows.length) throw erro(409, "Este item tem movimentação de estoque ou reserva. Desative o item em vez de excluir.");
    const emEstr = await db.query("select nome from flex_estruturas where itens @> $1::jsonb", [JSON.stringify([{ codigo: it.codigo }])]);
    if (emEstr.rows.length) throw erro(409, `Este item está nas estruturas: ${emEstr.rows.map(r => r.nome).join(", ")}. Retire das estruturas ou desative o item em vez de excluir.`);
    const sol = (await db.query("select valor from flex_parametros where chave = 'solar'")).rows[0]?.valor;
    if ((sol?.itensPorModulo || []).some(i => i.codigo === it.codigo)) throw erro(409, "Este item está em \"Itens por módulo\" do Dimensionamento solar. Retire de lá ou desative o item.");
    if (usado.rows.length)
      throw erro(409, `Este item está nos kits: ${usado.rows.map(r => nomeKit(r).replace("Kit ", "")).join("; ")}. Retire dos kits ou desative o item em vez de excluir.`);
    await db.query("delete from flex_catalogo where id = $1", [req.params.id]);
    await auditar(db, { entidade: "preco", numero: it.codigo, cliente: it.descricao, usuario: req.usuario, acao: "excluiu" });
  });
  res.status(204).end();
}));

// Importação de planilha: o navegador lê o Excel e envia as linhas.
// aplicar=false devolve só a prévia; aplicar=true grava (tudo ou nada).
app.post("/api/admin/catalogo/importar", rota(async (req, res) => {
  const linhas = Array.isArray(req.body?.itens) ? req.body.itens : [];
  const aplicar = !!req.body?.aplicar;
  if (!linhas.length) throw erro(400, "A planilha não tem linhas com dados.");
  if (linhas.length > 5000) throw erro(400, "Planilha grande demais (máximo de 5.000 linhas).");

  const existentes = new Map((await pool.query(`select id, ${CAMPOS_ITEM.join(", ")} from flex_catalogo`)).rows.map(r => [r.codigo, r]));
  const vistos = new Set();
  const resultado = { novos: [], alterados: [], iguais: 0, erros: [] };
  const validos = [];
  for (const l of linhas) {
    const { item, erros } = normalizarItem(l);
    if (item.codigo && vistos.has(item.codigo)) erros.push("código repetido na planilha");
    if (erros.length) { resultado.erros.push({ linha: l.linha, codigo: item.codigo, erros }); continue; }
    vistos.add(item.codigo);
    const antes = existentes.get(item.codigo);
    if (!antes) { resultado.novos.push({ codigo: item.codigo, descricao: item.descricao, custo: item.custo }); validos.push({ item }); continue; }
    const alt = diferencas(soCampos(antes), item);
    if (!alt.length) { resultado.iguais++; continue; }
    resultado.alterados.push({ codigo: item.codigo, descricao: item.descricao, alteracoes: alt });
    validos.push({ item, id: antes.id, alt });
  }
  if (!aplicar || resultado.erros.length) return res.json({ ...resultado, aplicado: false });

  await transacao(async db => {
    for (const { item, id, alt } of validos) {
      if (id) {
        await db.query(`update flex_catalogo set ${CAMPOS_ITEM.map((k, i) => `${k}=$${i + 2}`).join(", ")}, atualizado_em=now() where id=$1`,
          [id, ...CAMPOS_ITEM.map(k => item[k])]);
        await auditar(db, { entidade: "preco", numero: item.codigo, cliente: item.descricao, usuario: req.usuario, acao: "importou", alteracoes: alt });
      } else {
        await db.query(`insert into flex_catalogo (${CAMPOS_ITEM.join(", ")}, estoque, rastrear) values (${MARCAS_SQL}, $${CAMPOS_ITEM.length + 1}, $${CAMPOS_ITEM.length + 2})`, [...CAMPOS_ITEM.map(k => item[k]), item._estoque, item._rastrear]);
        await auditar(db, { entidade: "preco", numero: item.codigo, cliente: item.descricao, usuario: req.usuario, acao: "importou",
          alteracoes: [{ campo: "custo", de: "", para: String(item.custo) }] });
      }
    }
  });
  res.json({ ...resultado, aplicado: true });
}));

/* =====================================================================
   ADMINISTRAÇÃO — kits por potência de inversor
   ===================================================================== */
async function validarKit(db, b) {
  const potencia_kw = num(b.potencia_kw);
  if (!(potencia_kw > 0)) throw erro(400, "Informe a potência do inversor (kW).");
  const itens = (Array.isArray(b.itens) ? b.itens : [])
    .map(i => ({ codigo: String(i.codigo || "").trim().toUpperCase(), qtd: num(i.qtd) }))
    .filter(i => i.codigo);
  if (!itens.length) throw erro(400, "Adicione pelo menos um componente ao kit.");
  if (itens.some(i => !(i.qtd > 0))) throw erro(400, "Todas as quantidades precisam ser maiores que zero.");
  const cods = itens.map(i => i.codigo);
  if (new Set(cods).size !== cods.length) throw erro(400, "O mesmo componente aparece duas vezes no kit.");
  const { rows } = await db.query("select codigo from flex_catalogo where codigo = any($1) and categoria = 'componente'", [cods]);
  const ok = new Set(rows.map(r => r.codigo));
  const faltam = cods.filter(c => !ok.has(c));
  if (faltam.length) throw erro(400, `Não são componentes elétricos da tabela de preços: ${faltam.join(", ")}.`);
  const ligacao = ligacaoDe(b.ligacao);
  if (!ligacao) throw erro(400, "Escolha a ligação do kit: Monofásico 220 V, Trifásico 220 V ou Trifásico 380 V.");
  return { potencia_kw, ligacao, descricao: String(b.descricao || "").trim() || null, itens };
}
const nomeKit = k => `Kit ${String(k.potencia_kw).replace(".", ",")} kW · ${LIGACOES[k.ligacao] || "sem ligação"}`;

app.get("/api/admin/kits", rota(async (_req, res) => {
  const { rows } = await pool.query("select id, potencia_kw, ligacao, descricao, itens, atualizado_em from flex_kits order by potencia_kw, ligacao nulls first");
  res.json(rows);
}));

app.post("/api/admin/kits", rota(async (req, res) => {
  const r = await transacao(async db => {
    const k = await validarKit(db, req.body);
    const { rows } = await db.query("insert into flex_kits (potencia_kw, ligacao, descricao, itens) values ($1,$2,$3,$4) returning id",
      [k.potencia_kw, k.ligacao, k.descricao, JSON.stringify(k.itens)]);
    await auditar(db, { entidade: "kit", numero: nomeKit(k), cliente: k.descricao, usuario: req.usuario, acao: "criou",
      alteracoes: [{ campo: "itens", de: "", para: k.itens.map(i => `${i.qtd}× ${i.codigo}`).join(", ") }] });
    return { id: rows[0].id, ...k };
  });
  res.status(201).json(r);
}));

app.put("/api/admin/kits/:id", rota(async (req, res) => {
  if (!UUID.test(req.params.id)) throw naoEncontrado("Kit");
  const r = await transacao(async db => {
    const antes = (await db.query("select potencia_kw, ligacao, descricao, itens from flex_kits where id = $1 for update", [req.params.id])).rows[0];
    if (!antes) throw naoEncontrado("Kit");
    const k = await validarKit(db, req.body);
    await db.query("update flex_kits set potencia_kw=$2, ligacao=$3, descricao=$4, itens=$5, atualizado_em=now() where id=$1",
      [req.params.id, k.potencia_kw, k.ligacao, k.descricao, JSON.stringify(k.itens)]);
    const fmt = it => it.map(i => `${i.qtd}× ${i.codigo}`).join(", ");
    const alt = diferencas({ ...antes, itens: fmt(antes.itens) }, { ...k, itens: fmt(k.itens) });
    if (alt.length) await auditar(db, { entidade: "kit", numero: nomeKit(k), cliente: k.descricao, usuario: req.usuario, acao: "editou", alteracoes: alt });
    return { id: req.params.id, ...k };
  });
  res.json(r);
}));

app.delete("/api/admin/kits/:id", rota(async (req, res) => {
  if (!UUID.test(req.params.id)) throw naoEncontrado("Kit");
  await transacao(async db => {
    const { rows } = await db.query("delete from flex_kits where id = $1 returning potencia_kw, ligacao, descricao", [req.params.id]);
    if (!rows.length) throw naoEncontrado("Kit");
    await auditar(db, { entidade: "kit", numero: nomeKit(rows[0]), cliente: rows[0].descricao, usuario: req.usuario, acao: "excluiu" });
  });
  res.status(204).end();
}));

/* =====================================================================
   ADMINISTRAÇÃO — parâmetros de precificação
   ===================================================================== */
const PARAM_PADRAO = {
  maoObraPlaca: 0,      // R$ por placa instalada
  custoKm: 0,           // R$ por km rodado
  pctManutencao: 0, pctAdm: 0, pctImposto: 0, pctMargem: 0, pctComercial: 0,
  pctMargemMin: null,   // margem mínima que o vendedor pode negociar (vazio = igual à margem inicial)
  metodo: "dentro",     // dentro: custo ÷ (1 − Σ%) · fora: custo × (1 + Σ%)
};
const PCTS = ["pctManutencao", "pctAdm", "pctImposto", "pctMargem", "pctComercial"];

app.get("/api/admin/parametros", rota(async (_req, res) => {
  const { rows } = await pool.query("select valor, atualizado_em from flex_parametros where chave = 'precificacao'");
  res.json({ ...PARAM_PADRAO, ...(rows[0]?.valor || {}), atualizadoEm: rows[0]?.atualizado_em || null });
}));

app.put("/api/admin/parametros", rota(async (req, res) => {
  const b = req.body || {};
  const p = {
    maoObraPlaca: num(b.maoObraPlaca), custoKm: num(b.custoKm),
    ...Object.fromEntries(PCTS.map(k => [k, num(b[k])])),
    metodo: ["fora", "misto"].includes(b.metodo) ? b.metodo : "dentro",
  };
  p.pctMargemMin = b.pctMargemMin === "" || b.pctMargemMin == null ? p.pctMargem : num(b.pctMargemMin);
  if (p.pctMargemMin < 0) throw erro(400, "A margem mínima não pode ser negativa.");
  if (p.pctMargemMin > p.pctMargem) throw erro(400, "A margem mínima não pode ser maior que a margem inicial.");
  if ([p.maoObraPlaca, p.custoKm, ...PCTS.map(k => p[k])].some(v => v < 0)) throw erro(400, "Os valores não podem ser negativos.");
  const soma = PCTS.reduce((s, k) => s + p[k], 0);
  if (p.metodo === "dentro" && soma >= 100) throw erro(400, `No cálculo por dentro a soma dos percentuais precisa ser menor que 100% (está em ${soma}%).`);
  if (p.metodo === "misto" && p.pctImposto + p.pctComercial >= 100) throw erro(400, "Na fórmula Flex, imposto + comercial precisam somar menos de 100%.");
  await transacao(async db => {
    const antes = (await db.query("select valor from flex_parametros where chave = 'precificacao' for update")).rows[0]?.valor || PARAM_PADRAO;
    await db.query(
      `insert into flex_parametros (chave, valor) values ('precificacao', $1)
       on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`, [JSON.stringify(p)]);
    const alt = diferencas({ ...PARAM_PADRAO, ...antes }, p);
    if (alt.length) await auditar(db, { entidade: "parametros", numero: "Precificação", usuario: req.usuario, acao: "editou", alteracoes: alt });
  });
  res.json(p);
}));

/* =====================================================================
   ESTOQUE E ORDEM DE SERVIÇO
   ===================================================================== */
// [chave, nome, setor responsável]
const ETAPAS_OS = [
  ["orcamento", "Orçamento", "comercial"],
  ["visita", "Visita técnica para conhecer o local", "almoxarife"],
  ["fechamento", "Fechamento da Proposta", "comercial"],
  ["pagamento", "Reconhecimento de pagamentos", "engenharia"],
  ["documentos", "Requisição de documentos", "engenharia"],
  ["levantamento", "Levantamento de dados", "almoxarife"],
  ["projeto", "Execução de projetos", "engenharia"],
  ["equipamentos", "Compra de equipamentos", "comprador"],
  ["ferragem", "Requisição de Ferragem", "almoxarife"],
  ["componentes", "Compra de Componentes", "comprador"],
  ["agend_instalacao", "Agendamento de Instalação", "almoxarife"],
  ["instalacao", "Instalação da Usina", "campo"],
  ["agend_comissionamento", "Agendamento de Comissionamento", "almoxarife"],
  ["comissionamento", "Comissionamento", "campo"],
  ["relatorio", "Geração e envio de relatório", "engenharia"],
  ["baixa", "Baixa na O.S. e liberação para cobrança", "engenharia"],
];
const SETOR_DE = Object.fromEntries(ETAPAS_OS.map(([k, , st]) => [k, st]));
const AGENDA = { agend_instalacao: "instalacao", agend_comissionamento: "comissionamento" };
const EQUIPES = ["Azul", "Verde", "Amarela", "Vermelha", "Laranja", "Roxa", "Branca", "Preta"];
function podeEtapa(user, e) {
  if (user.perfil === "admin") return true;
  const setor = SETOR_DE[e.key];
  if (setor === "campo") return user.perfil === "almoxarife" || (user.perfil === "campo" && !!e.equipe && user.equipe === e.equipe);
  return user.perfil === setor;
}
const etapaNova = ([key, nome]) => ({ key, nome, status: "pendente", inicio: null, fim: null, por: null });
const feita = e => e.status === "concluida" || e.status === "dispensada";
// Prazo (dias corridos) de cada etapa, configurável pelo administrador. 0 = sem prazo.
const PRAZOS_PADRAO = { orcamento: 0, visita: 3, fechamento: 0, pagamento: 3, documentos: 5, levantamento: 5, projeto: 10, equipamentos: 10, ferragem: 5,
  componentes: 10, agend_instalacao: 3, instalacao: 1, agend_comissionamento: 3, comissionamento: 1, relatorio: 5, baixa: 3 };
async function lerPrazos(db = pool) {
  const r = (await db.query("select valor from flex_parametros where chave = 'os_prazos'")).rows[0];
  return { ...PRAZOS_PADRAO, ...(r ? r.valor : {}) };
}
const DIA = 86400000;
// situação de prazo da etapa da vez: início da contagem, vencimento e atraso
function prazoDaEtapa(etapas, i, prazos, criadoEm) {
  const e = etapas[i];
  if (!e || feita(e)) return null;
  const dias = Number(prazos[e.key] || 0);
  if (!(dias > 0)) return { dias: 0 };
  const base = e.agendadaPara ? new Date(e.agendadaPara) : new Date((i > 0 && [...etapas.slice(0, i)].reverse().find(x => x.fim)?.fim) || criadoEm);
  const vence = new Date(base.getTime() + dias * DIA);
  const atrasada = Date.now() > vence.getTime();
  return { dias, desde: base.toISOString(), venceEm: vence.toISOString(), atrasada,
    atrasoDias: atrasada ? Math.ceil((Date.now() - vence.getTime()) / DIA) : 0,
    restamDias: atrasada ? 0 : Math.ceil((vence.getTime() - Date.now()) / DIA) };
}
// etapas que atualizam o andamento da proposta ao serem concluídas
const ETAPA_ANDAMENTO = { instalacao: "Instalado", comissionamento: "Em operação" };
const podeEstoque = u => ["admin", "almoxarife"].includes(u.perfil);
const fmtQ = q => Number(q).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
async function eventoOS(db, osId, { etapa = null, tipo = "sistema", texto, usuario }) {
  await db.query("insert into flex_os_eventos (os_id, etapa, tipo, texto, usuario) values ($1,$2,$3,$4,$5)", [osId, etapa, tipo, texto, usuario]);
  await db.query("update flex_os set atualizado_em = now() where id = $1", [osId]);
}
// Material da proposta que é controlado em estoque (a partir do cálculo salvo)
async function materialDaProposta(db, dados) {
  const c = dados && dados.calc;
  if (!c) return new Map();
  const bom = new Map();
  const add = (cod, q) => { if (cod && q > 0) bom.set(cod, (bom.get(cod) || 0) + Number(q)); };
  if (c.modulo) add(c.modulo.codigo, c.nModulos);
  if (c.inversor) add(c.inversor.codigo, c.inversor.qtd);
  for (const i of c.itens || []) add(i.codigo, i.qtd);
  if (!bom.size) return bom;
  const { rows } = await db.query("select codigo from flex_catalogo where estoque and codigo = any($1)", [[...bom.keys()]]);
  const ctrl = new Set(rows.map(r => r.codigo));
  return new Map([...bom].filter(([k]) => ctrl.has(k)));
}
// Mantém O.S. e reservas coerentes com a situação da proposta (pode ser chamada várias vezes)
async function sincronizarOperacao(db, propostaId, usuario) {
  const p = (await db.query("select id, numero, produto, status, dados, fechada_em from flex_propostas where id = $1", [propostaId])).rows[0];
  if (!p) return;
  const vendida = ["Fechada", "Aceita"].includes(p.status);
  let os = (await db.query("select id, numero, status from flex_os where proposta_id = $1", [propostaId])).rows[0];
  if (vendida && p.produto === "solar") {
    if (!os) {
      const etapas = ETAPAS_OS.map(etapaNova);
      const orig = (await db.query("select a.usuario, p.created_at from flex_propostas p left join flex_auditoria a on a.proposta_id = p.id and a.acao = 'criou' where p.id = $1 order by a.criado_em limit 1", [propostaId])).rows[0] || {};
      const iOrc = etapas.findIndex(e => e.key === "orcamento"), iFec = etapas.findIndex(e => e.key === "fechamento"), iVis = etapas.findIndex(e => e.key === "visita");
      if (!(p.dados && p.dados.visitaTecnica)) etapas[iVis] = { ...etapas[iVis], status: "dispensada", fim: p.fechada_em || new Date(), por: "Comercial (visita não solicitada)" };
      etapas[iOrc] = { ...etapas[iOrc], status: "concluida", inicio: orig.created_at || new Date(), fim: orig.created_at || new Date(), por: orig.usuario || usuario };
      etapas[iFec] = { ...etapas[iFec], status: "concluida", inicio: p.fechada_em || new Date(), fim: p.fechada_em || new Date(), por: usuario };
      const r = await db.query(
        `insert into flex_os (numero, proposta_id, etapas) values ('OS-' || to_char(now(),'YYYY') || '-' || lpad(nextval('flex_os_seq')::text, 4, '0'), $1, $2) returning id, numero, status`,
        [propostaId, JSON.stringify(etapas)]);
      os = r.rows[0];
      await eventoOS(db, os.id, { etapa: "fechamento", texto: `O.S. aberta automaticamente: proposta ${p.numero} fechada.`, usuario });
    } else if (os.status === "cancelada") {
      await db.query("update flex_os set status = 'aberta', concluida_em = null where id = $1", [os.id]);
      await eventoOS(db, os.id, { texto: `O.S. reaberta: a proposta voltou para "Fechada".`, usuario });
    }
    // reservas: ajusta ao material atual da proposta
    const bom = await materialDaProposta(db, p.dados);
    const antes = new Map((await db.query("select codigo, qtd, baixado, ativa from flex_reservas where proposta_id = $1", [propostaId])).rows.map(r => [r.codigo, r]));
    const mud = [];
    for (const [cod, q] of bom) {
      const a = antes.get(cod);
      if (!a || !a.ativa || Number(a.qtd) !== q) mud.push(`${fmtQ(q)} × ${cod}`);
      await db.query(`insert into flex_reservas (proposta_id, codigo, qtd) values ($1,$2,$3)
                      on conflict (proposta_id, codigo) do update set qtd = excluded.qtd, ativa = true, atualizado_em = now()`, [propostaId, cod, q]);
    }
    for (const [cod, a] of antes) if (!bom.has(cod) && a.ativa && Number(a.qtd) !== Number(a.baixado)) {
      await db.query("update flex_reservas set qtd = baixado, atualizado_em = now() where proposta_id = $1 and codigo = $2", [propostaId, cod]);
      mud.push(`${cod} retirado`);
    }
    if (mud.length && os) await eventoOS(db, os.id, { tipo: "estoque", texto: `Material reservado: ${mud.join("; ")}.`, usuario });
  } else {
    const ativas = await db.query("update flex_reservas set ativa = false, atualizado_em = now() where proposta_id = $1 and ativa returning codigo", [propostaId]);
    if (os && os.status !== "cancelada") {
      await db.query("update flex_os set status = 'cancelada' where id = $1", [os.id]);
      await eventoOS(db, os.id, { texto: `O.S. cancelada: a proposta passou para "${p.status}".${ativas.rowCount ? " Reservas de material liberadas." : ""}`, usuario });
    }
  }
}
async function ajustarVisita(db, propostaId, quer, usuario) {
  const os = (await db.query("select id, etapas from flex_os where proposta_id = $1 and status = 'aberta' for update", [propostaId])).rows[0];
  if (!os) return;
  const e = os.etapas.find(x => x.key === "visita");
  if (!e) return;
  if (quer && e.status === "dispensada") Object.assign(e, { status: "pendente", inicio: null, fim: null, por: null });
  else if (!quer && e.status === "pendente") Object.assign(e, { status: "dispensada", fim: new Date().toISOString(), por: usuario });
  else return;
  await db.query("update flex_os set etapas = $2 where id = $1", [os.id, JSON.stringify(os.etapas)]);
  await eventoOS(db, os.id, { etapa: "visita", tipo: "etapa", texto: quer ? "Visita técnica solicitada pelo comercial." : "Visita técnica dispensada pelo comercial.", usuario });
}
async function eventoSituacaoOS(db, propostaId, alteracoes, usuario) {
  const os = (await db.query("select id from flex_os where proposta_id = $1", [propostaId])).rows[0];
  if (!os) return;
  const ROT = { andamento: "Andamento do projeto", statusPag: "Situação do pagamento" };
  for (const a of alteracoes.filter(a => ROT[a.campo]))
    await eventoOS(db, os.id, { tipo: "situacao", texto: `${ROT[a.campo]}: ${a.de || "—"} → ${a.para}.`, usuario });
}

/* ---------- O.S. ---------- */
const resumoOS = (r, prazos = PRAZOS_PADRAO) => {
  const et = r.etapas || [];
  const iAtual = et.findIndex(e => !feita(e));
  const atual = iAtual >= 0 ? et[iAtual] : null;
  const prazo = r.status === "aberta" && iAtual >= 0 ? prazoDaEtapa(et, iAtual, prazos, r.criado_em) : null;
  const equipeAtual = atual && SETOR_DE[atual.key] === "campo" ? atual.equipe || null : null;
  return { id: r.id, numero: r.numero, status: r.status, propostaId: r.proposta_id, propostaNumero: r.proposta_numero, cliente: r.fantasia || r.razao,
    produto: r.produto, total: Number(r.total || 0), concluidas: et.filter(feita).length, totalEtapas: et.length, prazo,
    etapaAtual: atual ? atual.nome : null, etapaAtualStatus: atual ? atual.status : null, etapaAtualSetor: atual ? SETOR_DE[atual.key] : null, equipeAtual, criadoEm: r.criado_em, atualizadoEm: r.atualizado_em, concluidaEm: r.concluida_em };
};
app.get("/api/os", rota(async (_req, res) => {
  const { rows } = await pool.query(
    `select o.*, p.numero as proposta_numero, p.razao, p.fantasia, p.produto, p.total
       from flex_os o join flex_propostas p on p.id = o.proposta_id order by o.atualizado_em desc limit 1000`);
  const prazos = await lerPrazos();
  res.json(rows.map(r => resumoOS(r, prazos)));
}));
async function detalheOS(id) {
  const r = (await pool.query(
    `select o.*, p.numero as proposta_numero, p.razao, p.fantasia, p.produto, p.total, p.andamento, p.status_pag, p.dados->>'endereco' as endereco,
            p.dados->>'telefone' as telefone, p.dados->>'contato' as contato
       from flex_os o join flex_propostas p on p.id = o.proposta_id where o.id = $1`, [id])).rows[0];
  if (!r) throw naoEncontrado("O.S.");
  const eventos = (await pool.query("select id, etapa, tipo, texto, usuario, criado_em from flex_os_eventos where os_id = $1 order by criado_em, id", [id])).rows;
  const material = (await pool.query(
    `select r.codigo, r.qtd, r.baixado, r.ativa, c.descricao, c.unidade, coalesce(s.fisico, 0) as fisico
       from flex_reservas r left join flex_catalogo c using (codigo)
       left join (select codigo, sum(case when tipo = 'saida' then -qtd else qtd end) fisico from flex_estoque_mov group by codigo) s using (codigo)
      where r.proposta_id = $1 order by c.categoria, r.codigo`, [r.proposta_id])).rows;
  const series = (await pool.query("select s.serie, s.codigo, c.descricao, s.saida_em from flex_series s left join flex_catalogo c using (codigo) where s.os_id = $1 order by s.codigo, s.serie", [id])).rows;
  const prazos = await lerPrazos();
  return { ...resumoOS(r, prazos), prazos, etapas: r.etapas.map(e => ({ ...e, setor: SETOR_DE[e.key] || null })), series, andamento: r.andamento, statusPag: r.status_pag, endereco: r.endereco, telefone: r.telefone, contato: r.contato,
    eventos: eventos.map(e => ({ ...e, id: Number(e.id) })),
    material: material.map(m => ({ codigo: m.codigo, descricao: m.descricao, unidade: m.unidade, reservado: Number(m.qtd), baixado: Number(m.baixado),
      pendente: Math.max(0, Number(m.qtd) - Number(m.baixado)), ativa: m.ativa, fisico: Number(m.fisico) })) };
}
// Etapas que estão na vez do usuário (a anterior já foi concluída)
app.get("/api/os/pendencias", rota(async (req, res) => {
  if (req.user.perfil === "admin") return res.json([]);
  const { rows } = await pool.query(
    `select o.id, o.numero, o.etapas, o.criado_em, p.numero as proposta_numero, coalesce(p.fantasia, p.razao) as cliente, p.dados->>'endereco' as endereco
       from flex_os o join flex_propostas p on p.id = o.proposta_id where o.status = 'aberta' order by o.criado_em`);
  const out = [], prazos = await lerPrazos();
  for (const r of rows) {
    const i = r.etapas.findIndex(e => !feita(e));
    if (i < 0) continue;
    const e = r.etapas[i];
    if (!podeEtapa(req.user, e) || (req.user.perfil === "almoxarife" && SETOR_DE[e.key] === "campo")) continue;
    out.push({ osId: r.id, numero: r.numero, cliente: r.cliente, endereco: r.endereco, propostaNumero: r.proposta_numero, etapa: e.key, etapaNome: e.nome,
      status: e.status, desde: (i > 0 && r.etapas[i - 1].fim) || r.criado_em, agendadaPara: e.agendadaPara || null, equipe: e.equipe || null,
      prazo: prazoDaEtapa(r.etapas, i, prazos, r.criado_em) });
  }
  res.json(out);
}));
app.get("/api/os/:id", rota(async (req, res) => {
  if (!UUID.test(req.params.id)) throw naoEncontrado("O.S.");
  res.json(await detalheOS(req.params.id));
}));
app.post("/api/os/:id/etapas/:key", rota(async (req, res) => {
  if (!UUID.test(req.params.id)) throw naoEncontrado("O.S.");
  const acao = req.body?.acao, nota = String(req.body?.nota || "").trim();
  if (!["iniciar", "concluir", "reabrir", "dispensar", "solicitar"].includes(acao)) throw erro(400, "Ação inválida.");
  if (["dispensar", "solicitar"].includes(acao) && (req.params.key !== "visita" || !["admin", "comercial"].includes(req.user.perfil)))
    throw erro(403, "Só o comercial solicita ou dispensa a visita técnica.");
  if (acao === "reabrir" && req.user.perfil !== "admin") throw erro(403, "Só o administrador pode reabrir uma etapa concluída.");
  await transacao(async db => {
    const os = (await db.query("select id, status, etapas, proposta_id from flex_os where id = $1 for update", [req.params.id])).rows[0];
    if (!os) throw naoEncontrado("O.S.");
    if (os.status === "cancelada") throw erro(400, "Esta O.S. está cancelada.");
    const et = os.etapas, i = et.findIndex(e => e.key === req.params.key);
    if (i < 0) throw naoEncontrado("Etapa");
    const e = et[i], agora = new Date().toISOString();
    if (acao === "dispensar" || acao === "solicitar") {
      if (acao === "dispensar" && e.status !== "pendente") throw erro(400, "A visita já começou ou já foi feita; não dá para dispensar.");
      if (acao === "solicitar" && e.status !== "dispensada") throw erro(400, "A visita já está solicitada.");
      Object.assign(e, acao === "dispensar" ? { status: "dispensada", fim: agora, por: req.usuario } : { status: "pendente", inicio: null, fim: null, por: null });
      await db.query("update flex_os set etapas = $2 where id = $1", [os.id, JSON.stringify(et)]);
      await db.query("update flex_propostas set dados = dados || jsonb_build_object('visitaTecnica', $2::boolean) where id = $1", [os.proposta_id, acao === "solicitar"]);
      await eventoOS(db, os.id, { etapa: "visita", tipo: "etapa", texto: acao === "solicitar" ? "Visita técnica solicitada pelo comercial." : "Visita técnica dispensada pelo comercial.", usuario: req.usuario });
      return;
    }
    if (e.status === "dispensada") throw erro(400, "Esta etapa foi dispensada.");
    if (!podeEtapa(req.user, e)) {
      const st = SETOR_DE[e.key];
      throw erro(403, st === "campo" ? (e.equipe ? `Esta etapa é da Equipe ${e.equipe}.` : "Esta etapa ainda não tem equipe agendada. A logística define a equipe no agendamento.")
        : `Esta etapa é responsabilidade do setor ${({ comercial: "Comercial", almoxarife: "Logística", engenharia: "Engenharia", comprador: "Comprador" })[st] || st}.`);
    }
    let agendaTxt = "";
    if (acao === "concluir" && AGENDA[e.key]) {
      const ag = req.body?.agenda || {};
      const data = new Date(ag.data);
      if (!ag.data || isNaN(data)) throw erro(400, "Informe a data e a hora do agendamento.");
      if (!EQUIPES.includes(ag.equipe)) throw erro(400, "Escolha a equipe de campo (cor).");
      e.agenda = { data: data.toISOString(), equipe: ag.equipe };
      const alvo = et.find(x => x.key === AGENDA[e.key]);
      if (alvo) { alvo.equipe = ag.equipe; alvo.agendadaPara = data.toISOString(); }
      agendaTxt = ` Agendado: ${alvo ? alvo.nome : "serviço"} em ${data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })} · Equipe ${ag.equipe}.`;
    }
    if (acao === "iniciar") { if (e.status !== "pendente") throw erro(400, "Esta etapa já foi iniciada."); Object.assign(e, { status: "andamento", inicio: agora, por: req.usuario }); }
    if (acao === "concluir") { if (e.status === "concluida") throw erro(400, "Esta etapa já está concluída."); Object.assign(e, { status: "concluida", inicio: e.inicio || agora, fim: agora, por: req.usuario }); }
    if (acao === "reabrir") { if (e.status !== "concluida") throw erro(400, "Só dá para reabrir uma etapa concluída."); Object.assign(e, { status: "andamento", fim: null, por: req.usuario }); }
    const todas = et.every(feita);
    await db.query("update flex_os set etapas = $2, status = $3, concluida_em = $4 where id = $1",
      [os.id, JSON.stringify(et), todas ? "concluida" : "aberta", todas ? agora : null]);
    const verbo = { iniciar: "iniciada", concluir: "concluída", reabrir: "reaberta" }[acao];
    await eventoOS(db, os.id, { etapa: e.key, tipo: "etapa", texto: `Etapa "${e.nome}" ${verbo}.${agendaTxt}${nota ? " Obs.: " + nota : ""}`, usuario: req.usuario });
    if (acao === "concluir" && ETAPA_ANDAMENTO[e.key]) {
      const novo = ETAPA_ANDAMENTO[e.key];
      const ant = (await db.query("select andamento, numero, razao, fantasia from flex_propostas where id = $1", [os.proposta_id])).rows[0];
      if (ant && ant.andamento !== novo) {
        await db.query("update flex_propostas set andamento = $2, dados = dados || jsonb_build_object('andamento', $2::text), updated_at = now() where id = $1", [os.proposta_id, novo]);
        await atualizarMarcos(db, os.proposta_id);
        await auditar(db, { propostaId: os.proposta_id, numero: ant.numero, cliente: ant.fantasia || ant.razao, usuario: req.usuario, acao: "status",
          alteracoes: [{ campo: "andamento", de: ant.andamento, para: novo }] });
        await eventoOS(db, os.id, { tipo: "situacao", texto: `Andamento do projeto: ${ant.andamento} → ${novo} (automático).`, usuario: req.usuario });
      }
    }
    if (todas) await eventoOS(db, os.id, { texto: "Todas as etapas concluídas. O.S. encerrada.", usuario: req.usuario });
  });
  res.json(await detalheOS(req.params.id));
}));
app.post("/api/os/:id/notas", rota(async (req, res) => {
  if (!UUID.test(req.params.id)) throw naoEncontrado("O.S.");
  const texto = String(req.body?.texto || "").trim().slice(0, 2000);
  if (!texto) throw erro(400, "Escreva a observação.");
  const etapa = ETAPAS_OS.some(([k]) => k === req.body?.etapa) ? req.body.etapa : null;
  await transacao(async db => {
    const os = (await db.query("select id from flex_os where id = $1", [req.params.id])).rows[0];
    if (!os) throw naoEncontrado("O.S.");
    await eventoOS(db, os.id, { etapa, tipo: "nota", texto, usuario: req.usuario });
  });
  res.json(await detalheOS(req.params.id));
}));

/* ---------- Solicitações de compra / requisição a partir da O.S. ---------- */
const SOLICITACOES = {
  equipamentos: { titulo: "Solicitação de compra de equipamentos", sufixo: "EQUIPAMENTOS", categorias: ["modulo", "inversor", "bateria", "outros"], etapa: "equipamentos" },
  componentes:  { titulo: "Solicitação de compra de componentes elétricos", sufixo: "COMPONENTES", categorias: ["componente"], etapa: "componentes" },
  ferragem:     { titulo: "Requisição de ferragem", sufixo: "FERRAGEM", categorias: ["ferragem"], etapa: "ferragem" },
};
// Distribui o estoque físico entre as reservas, por ordem de abertura da O.S. (a mais antiga primeiro)
async function alocacaoEstoque(db, codigos) {
  if (!codigos.length) return { aloc: new Map(), fis: new Map() };
  const fis = new Map((await db.query(
    "select codigo, sum(case when tipo = 'saida' then -qtd else qtd end) f from flex_estoque_mov where codigo = any($1) group by codigo", [codigos])).rows.map(r => [r.codigo, Math.max(0, Number(r.f))]));
  const { rows } = await db.query(
    `select r.proposta_id, r.codigo, (r.qtd - r.baixado) as pendente from flex_reservas r join flex_os o on o.proposta_id = r.proposta_id
      where r.ativa and r.qtd > r.baixado and o.status = 'aberta' and r.codigo = any($1) order by r.codigo, o.criado_em, o.numero`, [codigos]);
  const resto = new Map(fis), aloc = new Map();   // "proposta|codigo" -> quanto do estoque cobre
  for (const r of rows) {
    const livre = resto.get(r.codigo) || 0, p = Number(r.pendente), usa = Math.min(livre, p);
    resto.set(r.codigo, livre - usa); aloc.set(r.proposta_id + "|" + r.codigo, usa);
  }
  return { aloc, fis };
}
app.post("/api/os/:id/solicitacoes", rota(async (req, res) => {
  if (!UUID.test(req.params.id)) throw naoEncontrado("O.S.");
  const tipo = req.body?.tipo, cfg = SOLICITACOES[tipo];
  if (!cfg) throw erro(400, "Tipo de solicitação inválido.");
  const verCusto = ["admin", "comprador"].includes(req.user.perfil);
  const o = (await pool.query(
    `select o.id, o.numero, o.status, o.proposta_id, p.numero as proposta_numero, coalesce(p.fantasia, p.razao) as cliente, p.razao,
            p.dados->>'endereco' as endereco, p.dados->>'contato' as contato, p.dados->>'telefone' as telefone, p.dados->'calc' as calc, p.composicao
       from flex_os o join flex_propostas p on p.id = o.proposta_id where o.id = $1`, [req.params.id])).rows[0];
  if (!o) throw naoEncontrado("O.S.");
  // lista de materiais: composição completa (quando existe) ou o cálculo salvo na proposta
  let linhas = [], origem = "composicao", aviso = null;
  if (o.composicao && Array.isArray(o.composicao.linhas)) linhas = o.composicao.linhas.map(l => ({ codigo: l.codigo, qtd: Number(l.qtd) }));
  else {
    origem = "calculo";
    const c = o.calc || {};
    if (c.modulo) linhas.push({ codigo: c.modulo.codigo, qtd: c.nModulos });
    if (c.inversor) linhas.push({ codigo: c.inversor.codigo, qtd: c.inversor.qtd });
    for (const i of c.itens || []) linhas.push({ codigo: i.codigo, qtd: Number(i.qtd) });
    if (tipo === "ferragem") aviso = "Esta proposta foi calculada antes do registro completo de materiais, então a ferragem não está disponível. Abra a proposta, clique em Calcular sistema e salve.";
  }
  const cods = [...new Set(linhas.map(l => l.codigo))];
  const cat = new Map((await pool.query("select codigo, descricao, unidade, categoria, custo, estoque from flex_catalogo where codigo = any($1)", [cods])).rows.map(r => [r.codigo, r]));
  const res_ = new Map((await pool.query("select codigo, qtd, baixado from flex_reservas where proposta_id = $1 and ativa", [o.proposta_id])).rows.map(r => [r.codigo, r]));
  const { aloc } = await alocacaoEstoque(pool, cods.filter(c => cat.get(c)?.estoque));
  const itens = [];
  for (const l of linhas) {
    const c = cat.get(l.codigo);
    if (!c || !cfg.categorias.includes(c.categoria)) continue;
    let necessario = l.qtd, emEstoque = null, jaSaiu = 0;
    if (c.estoque && res_.get(l.codigo)) {
      const r = res_.get(l.codigo); jaSaiu = Number(r.baixado);
      necessario = Math.max(0, Number(r.qtd) - jaSaiu);
      emEstoque = aloc.get(o.proposta_id + "|" + l.codigo) || 0;
    }
    const comprar = emEstoque == null ? necessario : Math.max(0, necessario - emEstoque);
    itens.push({ codigo: l.codigo, descricao: c.descricao, unidade: c.unidade, categoria: c.categoria, total: l.qtd, jaSaiu, necessario,
      controlado: !!c.estoque && emEstoque != null, emEstoque, comprar, ...(verCusto ? { custoUnit: Number(c.custo), custoTotal: Number(c.custo) * comprar } : {}) });
  }
  const numeroDoc = `${o.numero} · ${cfg.sufixo}`;
  const ult = (await pool.query(
    "select criado_em, usuario from flex_os_eventos where os_id = $1 and tipo = 'solicitacao' and etapa = $2 order by criado_em desc limit 1", [o.id, cfg.etapa])).rows[0];
  if (req.body?.registrar) {
    const qtdItens = itens.filter(i => i.comprar > 0).length;
    await transacao(db => eventoOS(db, o.id, { etapa: cfg.etapa, tipo: "solicitacao",
      texto: `${cfg.titulo} gerada (${numeroDoc}): ${qtdItens ? qtdItens + " item(ns) a " + (tipo === "ferragem" ? "requisitar" : "comprar") : "nada a comprar, tudo disponível em estoque"}.`, usuario: req.usuario }));
  }
  res.json({ tipo, titulo: cfg.titulo, numeroDoc, osNumero: o.numero, propostaNumero: o.proposta_numero, cliente: o.cliente, razao: o.razao, endereco: o.endereco,
    contato: o.contato, telefone: o.telefone, origem, aviso, itens, verCusto, geradoEm: new Date().toISOString(), geradoPor: req.usuario,
    ultima: ult ? { em: ult.criado_em, por: ult.usuario } : null });
}));

/* ---------- Estoque ---------- */
async function saldos(db, admin) {
  const { rows } = await db.query(
    `select c.codigo, c.descricao, c.categoria, c.unidade, c.custo, c.potencia_w, c.estoque, c.ativo, c.rastrear,
            coalesce(m.fisico, 0) as fisico, coalesce(r.reservado, 0) as reservado,
            (select count(*) from flex_series s where s.codigo = c.codigo and s.status = 'estoque') as series
       from flex_catalogo c
       left join (select codigo, sum(case when tipo = 'saida' then -qtd else qtd end) fisico from flex_estoque_mov group by codigo) m using (codigo)
       left join (select codigo, sum(qtd - baixado) reservado from flex_reservas where ativa group by codigo) r using (codigo)
      where c.estoque or coalesce(m.fisico, 0) <> 0 or coalesce(r.reservado, 0) <> 0
      order by c.categoria, c.potencia_w nulls last, c.descricao`);
  return rows.map(r => ({ codigo: r.codigo, descricao: r.descricao, categoria: r.categoria, unidade: r.unidade, potencia_w: r.potencia_w, controlado: r.estoque, ativo: r.ativo,
    rastrear: r.rastrear, series: Number(r.series),
    fisico: Number(r.fisico), reservado: Number(r.reservado), disponivel: Number(r.fisico) - Number(r.reservado), ...(admin ? { custo: Number(r.custo) } : {}) }));
}
app.get("/api/estoque", rota(async (req, res) => { res.json(await saldos(pool, req.user.perfil === "admin")); }));
app.get("/api/estoque/movimentos", rota(async (req, res) => {
  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 200, 1), 1000);
  const codigo = req.query.codigo ? String(req.query.codigo).toUpperCase() : null;
  const { rows } = await pool.query(
    `select m.id, m.codigo, c.descricao, c.unidade, m.tipo, m.qtd, m.documento, m.fornecedor, m.observacao, m.usuario, m.criado_em,
            o.numero as os_numero, p.numero as proposta_numero, coalesce(p.fantasia, p.razao) as cliente, rm.codigo as remessa
       from flex_estoque_mov m left join flex_catalogo c using (codigo) left join flex_remessas rm on rm.id = m.remessa_id
       left join flex_os o on o.id = m.os_id left join flex_propostas p on p.id = m.proposta_id
      where ($1::text is null or m.codigo = $1) order by m.criado_em desc, m.id desc limit $2`, [codigo, limite]);
  res.json(rows.map(r => ({ ...r, id: Number(r.id), qtd: Number(r.qtd) })));
}));
function lerItensMov(lista) {
  const itens = (Array.isArray(lista) ? lista : []).map(i => ({ codigo: String(i.codigo || "").trim().toUpperCase(), qtd: num(i.qtd) })).filter(i => i.codigo);
  if (!itens.length) throw erro(400, "Inclua pelo menos um item.");
  if (itens.some(i => !(i.qtd > 0))) throw erro(400, "As quantidades precisam ser maiores que zero.");
  const cods = itens.map(i => i.codigo);
  if (new Set(cods).size !== cods.length) throw erro(400, "O mesmo item aparece duas vezes. Some as quantidades em uma linha só.");
  return itens;
}
async function conferirCodigos(db, itens) {
  const { rows } = await db.query("select codigo from flex_catalogo where codigo = any($1)", [itens.map(i => i.codigo)]);
  const ok = new Set(rows.map(r => r.codigo)), faltam = itens.filter(i => !ok.has(i.codigo)).map(i => i.codigo);
  if (faltam.length) throw erro(400, `Itens que não existem na tabela de preços: ${faltam.join(", ")}.`);
}
// Data real do movimento (lançamento atrasado): não pode ser futura nem ter mais de 1 ano
function lerDataMov(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) throw erro(400, "Data inválida.");
  if (d.getTime() > Date.now() + 5 * 60000) throw erro(400, "A data não pode ser futura.");
  if (d.getTime() < Date.now() - 366 * 86400000) throw erro(400, "A data não pode ter mais de um ano.");
  return d.toISOString();
}
function lerSeries(lista, itens) {
  const series = (Array.isArray(lista) ? lista : []).map(x => ({ serie: String(x.serie || "").trim(), codigo: String(x.codigo || "").trim().toUpperCase() })).filter(x => x.serie);
  if (series.some(x => x.serie.length > 80)) throw erro(400, "Número de série longo demais (máximo de 80 caracteres).");
  const dup = series.map(x => x.serie).filter((x, i, a) => a.indexOf(x) !== i);
  if (dup.length) throw erro(400, `Número de série lido duas vezes: ${[...new Set(dup)].join(", ")}.`);
  for (const i of itens) {
    const n = series.filter(x => x.codigo === i.codigo).length;
    if (n > i.qtd + 1e-9) throw erro(400, `${i.codigo}: ${n} números de série para uma entrada de ${fmtQ(i.qtd)}.`);
  }
  const semItem = series.filter(x => !itens.some(i => i.codigo === x.codigo));
  if (semItem.length) throw erro(400, `Números de série de itens que não estão na entrada: ${semItem.map(x => x.serie).join(", ")}.`);
  return series;
}
// Dados para a leitura pelo celular: itens controlados e códigos de fábrica já associados
app.get("/api/estoque/leitura", rota(async (_req, res) => {
  const itens = (await pool.query("select codigo, descricao, unidade, categoria, rastrear from flex_catalogo where estoque and ativo order by categoria, descricao")).rows;
  const codigos = (await pool.query("select barras, codigo from flex_codigos_barras")).rows;
  res.json({ itens, codigos });
}));
app.post("/api/estoque/codigos", rota(async (req, res) => {
  if (!podeEstoque(req.user)) throw erro(403, "Só o almoxarife ou o administrador associa códigos.");
  const barras = String(req.body?.barras || "").trim(), codigo = String(req.body?.codigo || "").trim().toUpperCase();
  if (!barras || barras.length > 120) throw erro(400, "Código lido inválido.");
  await transacao(async db => {
    await conferirCodigos(db, [{ codigo }]);
    await db.query(`insert into flex_codigos_barras (barras, codigo, criado_por) values ($1,$2,$3)
                    on conflict (barras) do update set codigo = excluded.codigo, criado_por = excluded.criado_por, criado_em = now()`, [barras, codigo, req.usuario]);
    await auditar(db, { entidade: "estoque", numero: "Código de fábrica", cliente: barras, usuario: req.usuario, acao: "editou", alteracoes: [{ campo: barras, de: "", para: codigo }] });
  });
  res.json({ barras, codigo });
}));
// Remessas recebidas
app.get("/api/estoque/remessas", rota(async (_req, res) => {
  const { rows } = await pool.query(
    `select r.id, r.codigo, r.documento, r.fornecedor, r.observacao, r.recebida_em, r.usuario, r.criado_em,
            count(distinct m.codigo)::int as itens, coalesce(sum(m.qtd), 0) as unidades,
            (select count(*) from flex_series s where s.remessa_id = r.id)::int as series
       from flex_remessas r left join flex_estoque_mov m on m.remessa_id = r.id and m.tipo = 'entrada'
      group by r.id order by r.recebida_em desc, r.codigo desc limit 500`);
  res.json(rows.map(r => ({ ...r, unidades: Number(r.unidades) })));
}));
app.get("/api/estoque/remessas/:id", rota(async (req, res) => {
  if (!UUID.test(req.params.id)) throw naoEncontrado("Remessa");
  const r = (await pool.query("select * from flex_remessas where id = $1", [req.params.id])).rows[0];
  if (!r) throw naoEncontrado("Remessa");
  const itens = (await pool.query(
    `select m.codigo, c.descricao, c.unidade, c.rastrear, sum(m.qtd) as qtd,
            (select count(*) from flex_series s where s.remessa_id = $1 and s.codigo = m.codigo)::int as com_serie
       from flex_estoque_mov m left join flex_catalogo c using (codigo)
      where m.remessa_id = $1 and m.tipo = 'entrada' group by m.codigo, c.descricao, c.unidade, c.rastrear order by c.descricao`, [r.id])).rows;
  const series = (await pool.query(
    `select s.serie, s.codigo, s.status, o.numero as os_numero from flex_series s left join flex_os o on o.id = s.os_id
      where s.remessa_id = $1 order by s.codigo, s.serie`, [r.id])).rows;
  res.json({ ...r, itens: itens.map(i => ({ ...i, qtd: Number(i.qtd), semSerie: i.rastrear ? Math.max(0, Number(i.qtd) - i.com_serie) : null })), series });
}));
// Rastreio de uma unidade pelo número de série
app.get("/api/estoque/serie/:serie", rota(async (req, res) => {
  const r = (await pool.query(
    `select s.*, c.descricao, c.categoria, o.numero as os_numero, o.id as os, p.numero as proposta_numero, coalesce(p.fantasia, p.razao) as cliente, p.dados->>'endereco' as endereco, rm.codigo as remessa
       from flex_series s left join flex_catalogo c using (codigo) left join flex_os o on o.id = s.os_id left join flex_propostas p on p.id = s.proposta_id left join flex_remessas rm on rm.id = s.remessa_id
      where s.serie = $1`, [String(req.params.serie).trim()])).rows[0];
  if (!r) throw erro(404, "Número de série não encontrado.");
  res.json({ serie: r.serie, codigo: r.codigo, descricao: r.descricao, categoria: r.categoria, status: r.status, documento: r.documento, fornecedor: r.fornecedor,
    entradaEm: r.entrada_em, entradaPor: r.entrada_por, saidaEm: r.saida_em, saidaPor: r.saida_por, osId: r.os, osNumero: r.os_numero,
    propostaNumero: r.proposta_numero, cliente: r.cliente, endereco: r.endereco, remessa: r.remessa });
}));
app.post("/api/estoque/entrada", rota(async (req, res) => {
  if (!podeEstoque(req.user)) throw erro(403, "Só o almoxarife ou o administrador lança movimentos de estoque.");
  const itens = lerItensMov(req.body?.itens);
  const documento = String(req.body?.documento || "").trim() || null, fornecedor = String(req.body?.fornecedor || "").trim() || null, observacao = String(req.body?.observacao || "").trim() || null;
  const series = lerSeries(req.body?.series, itens);
  const dataMov = lerDataMov(req.body?.data);
  let remessa;
  await transacao(async db => {
    await conferirCodigos(db, itens);
    remessa = (await db.query(
      `insert into flex_remessas (codigo, documento, fornecedor, observacao, recebida_em, usuario)
       values ('REM-' || to_char(coalesce($4::timestamptz, now()), 'YYYY') || '-' || lpad(nextval('flex_remessa_seq')::text, 4, '0'), $1, $2, $3, coalesce($4::timestamptz, now()), $5)
       returning id, codigo, recebida_em`, [documento, fornecedor, observacao, dataMov, req.usuario])).rows[0];
    if (series.length) {
      const ja = (await db.query("select serie, codigo, status from flex_series where serie = any($1)", [series.map(x => x.serie)])).rows;
      if (ja.length) throw erro(409, `Número(s) de série já registrado(s): ${ja.map(x => `${x.serie} (${x.codigo}, ${x.status === "estoque" ? "em estoque" : "já saiu"})`).join("; ")}.`);
      for (const x of series)
        await db.query("insert into flex_series (serie, codigo, documento, fornecedor, entrada_por, entrada_em, remessa_id) values ($1,$2,$3,$4,$5,$6,$7)",
          [x.serie, x.codigo, documento, fornecedor, req.usuario, remessa.recebida_em, remessa.id]);
    }
    for (const i of itens)
      await db.query("insert into flex_estoque_mov (codigo, tipo, qtd, documento, fornecedor, observacao, usuario, remessa_id, criado_em) values ($1,'entrada',$2,$3,$4,$5,$6,$7,$8)",
        [i.codigo, i.qtd, documento, fornecedor, observacao, req.usuario, remessa.id, remessa.recebida_em]);
    await auditar(db, { entidade: "estoque", numero: remessa.codigo + (documento ? " · NF " + documento : ""), cliente: [fornecedor, dataMov ? "chegada em " + new Date(dataMov).toLocaleDateString("pt-BR") : ""].filter(Boolean).join(" · ") || null, usuario: req.usuario, acao: "entrada",
      alteracoes: itens.map(i => ({ campo: i.codigo, de: "", para: "+" + fmtQ(i.qtd) + (series.some(x => x.codigo === i.codigo) ? ` (${series.filter(x => x.codigo === i.codigo).length} séries)` : "") })) });
  });
  res.status(201).json({ saldo: await saldos(pool, req.user.perfil === "admin"), remessa: { id: remessa.id, codigo: remessa.codigo } });
}));
app.post("/api/estoque/saida", rota(async (req, res) => {
  if (!podeEstoque(req.user)) throw erro(403, "Só o almoxarife ou o administrador lança movimentos de estoque.");
  const itens = lerItensMov(req.body?.itens);
  const osId = UUID.test(String(req.body?.osId || "")) ? req.body.osId : null;
  const observacao = String(req.body?.observacao || "").trim() || null;
  if (!osId && !observacao) throw erro(400, "Saída sem O.S.: escreva o motivo na observação.");
  const dataMov = lerDataMov(req.body?.data);
  await transacao(async db => {
    await conferirCodigos(db, itens);
    await db.query("lock table flex_estoque_mov in share row exclusive mode");
    const fis = new Map((await db.query(
      "select codigo, sum(case when tipo = 'saida' then -qtd else qtd end) f from flex_estoque_mov where codigo = any($1) group by codigo", [itens.map(i => i.codigo)])).rows.map(r => [r.codigo, Number(r.f)]));
    const falta = itens.filter(i => (fis.get(i.codigo) || 0) + 1e-9 < i.qtd);
    if (falta.length) throw erro(400, `Estoque físico insuficiente: ${falta.map(i => `${i.codigo} (há ${fmtQ(fis.get(i.codigo) || 0)}, saída de ${fmtQ(i.qtd)})`).join("; ")}.`);
    let os = null;
    if (osId) {
      os = (await db.query("select id, numero, proposta_id, status from flex_os where id = $1", [osId])).rows[0];
      if (!os) throw naoEncontrado("O.S.");
    }
    const series = (Array.isArray(req.body?.series) ? req.body.series : []).map(x => String(x.serie ?? x).trim()).filter(Boolean);
    if (new Set(series).size !== series.length) throw erro(400, "Um número de série foi lido duas vezes.");
    if (series.length) {
      const reg = new Map((await db.query("select serie, codigo, status from flex_series where serie = any($1) for update", [series])).rows.map(r => [r.serie, r]));
      const desconhecidas = series.filter(x => !reg.has(x)), fora = series.filter(x => reg.get(x)?.status === "saiu");
      if (desconhecidas.length) throw erro(400, `Número(s) de série sem entrada registrada: ${desconhecidas.join(", ")}.`);
      if (fora.length) throw erro(400, `Número(s) de série que já saíram do estoque: ${fora.join(", ")}.`);
      const porItem = {};
      for (const x of series) porItem[reg.get(x).codigo] = (porItem[reg.get(x).codigo] || 0) + 1;
      for (const [cod, n] of Object.entries(porItem)) {
        const it = itens.find(i => i.codigo === cod);
        if (!it) throw erro(400, `Número de série de ${cod}, mas esse item não está na saída.`);
        if (n > it.qtd + 1e-9) throw erro(400, `${cod}: ${n} números de série para uma saída de ${fmtQ(it.qtd)}.`);
      }
      await db.query("update flex_series set status = 'saiu', os_id = $2, proposta_id = $3, saida_em = now(), saida_por = $4 where serie = any($1)",
        [series, os ? os.id : null, os ? os.proposta_id : null, req.usuario]);
    }
    for (const i of itens) {
      await db.query("insert into flex_estoque_mov (codigo, tipo, qtd, proposta_id, os_id, observacao, usuario, criado_em) values ($1,'saida',$2,$3,$4,$5,$6,coalesce($7::timestamptz, now()))",
        [i.codigo, i.qtd, os ? os.proposta_id : null, os ? os.id : null, observacao, req.usuario, dataMov]);
      if (os) await db.query("update flex_reservas set baixado = least(qtd, baixado + $3), atualizado_em = now() where proposta_id = $1 and codigo = $2", [os.proposta_id, i.codigo, i.qtd]);
    }
    if (os) await eventoOS(db, os.id, { tipo: "estoque", texto: `Saída de material${dataMov ? ` (lançamento atrasado; saída real em ${new Date(dataMov).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })})` : ""}: ${itens.map(i => `${fmtQ(i.qtd)} × ${i.codigo}`).join("; ")}.${series.length ? ` Números de série: ${series.join(", ")}.` : ""}${observacao ? " Obs.: " + observacao : ""}`, usuario: req.usuario });
    await auditar(db, { entidade: "estoque", numero: os ? "Saída " + os.numero : "Saída avulsa", cliente: observacao, usuario: req.usuario, acao: "saida",
      alteracoes: itens.map(i => ({ campo: i.codigo, de: "", para: "−" + fmtQ(i.qtd) })) });
  });
  res.status(201).json({ saldo: await saldos(pool, req.user.perfil === "admin") });
}));
app.post("/api/estoque/ajuste", rota(async (req, res) => {
  if (req.user.perfil !== "admin") throw erro(403, "Só o administrador faz ajuste de inventário.");
  const codigo = String(req.body?.codigo || "").trim().toUpperCase(), contado = num(req.body?.contado);
  const observacao = String(req.body?.observacao || "").trim();
  if (!codigo) throw erro(400, "Escolha o item.");
  if (contado < 0) throw erro(400, "A quantidade contada não pode ser negativa.");
  if (!observacao) throw erro(400, "Escreva o motivo do ajuste.");
  await transacao(async db => {
    await conferirCodigos(db, [{ codigo }]);
    const atual = Number((await db.query("select coalesce(sum(case when tipo = 'saida' then -qtd else qtd end), 0) f from flex_estoque_mov where codigo = $1", [codigo])).rows[0].f);
    const dif = contado - atual;
    if (Math.abs(dif) < 1e-9) throw erro(400, "O saldo já está igual à quantidade contada.");
    await db.query("insert into flex_estoque_mov (codigo, tipo, qtd, observacao, usuario) values ($1,'ajuste',$2,$3,$4)", [codigo, dif, observacao, req.usuario]);
    await auditar(db, { entidade: "estoque", numero: "Ajuste de inventário", cliente: observacao, usuario: req.usuario, acao: "ajuste",
      alteracoes: [{ campo: codigo, de: fmtQ(atual), para: fmtQ(contado) }] });
  });
  res.status(201).json({ saldo: await saldos(pool, true) });
}));

/* =====================================================================
   RELATÓRIOS
   ===================================================================== */
// Mantém as datas de venda, pagamento e instalação coerentes com a situação atual
// Copia para a proposta a composição do cálculo usado (o comercial nunca a recebe)
async function gravarComposicao(db, id, d) {
  const cid = d && d.calc && d.calc.calcId;
  if (d.produto !== "solar" || !UUID.test(String(cid || ""))) return;
  await db.query("update flex_propostas set composicao = c.custos from flex_calculos c where flex_propostas.id = $1 and c.id = $2", [id, cid]);
}
async function atualizarMarcos(db, id) {
  await db.query(`update flex_propostas set
      fechada_em   = case when status in ('Fechada','Aceita') then coalesce(fechada_em, now()) else null end,
      paga_em      = case when status_pag = 'Pago' then coalesce(paga_em, now()) else null end,
      instalada_em = case when andamento in ('Instalado','Em operação') then coalesce(instalada_em, now()) else null end
    where id = $1`, [id]);
}
const RELATORIOS = {
  vendidos:  { onde: "p.status in ('Fechada','Aceita')", data: "coalesce(p.fechada_em::date, p.data)" },
  pagos:     { onde: "p.status_pag = 'Pago'", data: "coalesce(p.paga_em::date, p.data)" },
  areceber:  { onde: "p.status in ('Fechada','Aceita') and p.status_pag not in ('Pago','Estornado')", data: "coalesce(p.fechada_em::date, p.data)" },
  ainstalar: { onde: "p.status in ('Fechada','Aceita') and p.andamento not in ('Instalado','Em operação','Cancelado')", data: "coalesce(p.fechada_em::date, p.data)" },
};
app.get("/api/relatorios/estoque", rota(async (req, res) => {
  const tipo = req.query.tipo;
  if (!["estoque", "comprar"].includes(tipo)) throw erro(400, "Tipo inválido.");
  const admin = req.user.perfil === "admin";
  let itens = await saldos(pool, admin);
  itens = tipo === "estoque" ? itens.filter(i => i.fisico > 0 || i.reservado > 0) : itens.filter(i => i.disponivel < -1e-9).map(i => ({ ...i, comprar: -i.disponivel }));
  if (tipo === "comprar" && itens.length) {
    const { rows } = await pool.query(
      `select r.codigo, string_agg(p.numero, ', ' order by p.numero) props from flex_reservas r join flex_propostas p on p.id = r.proposta_id
        where r.ativa and r.qtd > r.baixado and r.codigo = any($1) group by r.codigo`, [itens.map(i => i.codigo)]);
    const m = new Map(rows.map(r => [r.codigo, r.props]));
    itens = itens.map(i => ({ ...i, propostas: m.get(i.codigo) || "" }));
  }
  res.json(itens);
}));
app.get("/api/relatorios", rota(async (req, res) => {
  const r = RELATORIOS[req.query.tipo];
  if (!r) throw erro(400, "Tipo de relatório inválido.");
  const de = dataOuNull(req.query.de), ate = dataOuNull(req.query.ate);
  const produto = ["watcher", "solar"].includes(req.query.produto) ? req.query.produto : null;
  const { rows } = await pool.query(
    `select p.id, p.numero, p.produto, p.razao, p.fantasia, p.data, p.total, p.status, p.andamento, p.status_pag,
            p.fechada_em, p.paga_em, p.instalada_em, ${r.data} as data_ref,
            nullif(p.dados->'calc'->>'kwp','')::numeric as kwp,
            (select a.usuario from flex_auditoria a where a.proposta_id = p.id and a.acao = 'criou' order by a.criado_em limit 1) as vendedor
       from flex_propostas p
      where ${r.onde}
        and ($1::date is null or ${r.data} >= $1)
        and ($2::date is null or ${r.data} <= $2)
        and ($3::text is null or p.produto = $3)
      order by ${r.data} desc, p.numero`, [de, ate, produto]);
  res.json(rows.map(x => ({
    id: x.id, numero: x.numero, produto: x.produto, cliente: x.fantasia || x.razao, data: x.data, dataRef: x.data_ref,
    total: Number(x.total), status: LEGADO[x.status] || x.status, andamento: x.andamento, statusPag: x.status_pag,
    fechadaEm: x.fechada_em, pagaEm: x.paga_em, instaladaEm: x.instalada_em, kwp: x.kwp, vendedor: x.vendedor,
  })));
}));

/* =====================================================================
   ORÇAMENTO SOLAR
   ===================================================================== */
const SOLAR_PADRAO = {
  hsp: 5.38,                 // irradiação média (kWh/m².dia)
  fonteIrradiacao: "SWERA",
  cidadeIrradiacao: "Divinópolis",
  pr: 80,                    // performance ratio (%)
  sobredim: 1.3,             // máximo de kWp de módulos por kW de inversor
  areaModulo: 2.33,          // m² por módulo (área estimada do sistema)
  pesoModulo: 35,            // kg por módulo, com estrutura (peso estimado)
  tarifa: 1.1,               // tarifa padrão (R$/kWh) sugerida ao vendedor
  arredondamento: 10,        // arredonda o preço final para cima, em múltiplos deste valor
  itensPorModulo: [],        // [{codigo, qtd}] itens que acompanham cada módulo (cabo CC, RSD…)
  prazoEntrega: 120, validade: 15, garantiaModulo: 10, garantiaInversor: 60, garantiaInstalacao: 12,
};
async function lerParametros(db = pool) {
  const { rows } = await db.query("select chave, valor from flex_parametros where chave in ('precificacao','solar')");
  const m = Object.fromEntries(rows.map(r => [r.chave, r.valor]));
  return { prec: { ...PARAM_PADRAO, ...(m.precificacao || {}) }, sol: { ...SOLAR_PADRAO, ...(m.solar || {}) } };
}
// Três métodos:
//  dentro: preço = custo ÷ (1 − Σ todos os %)                       → cada % é fatia do preço
//  fora:   preço = custo × (1 + Σ todos os %)                       → cada % incide sobre o custo
//  misto (fórmula Flex): preço = custo × (1 + manutenção + adm + margem) ÷ (1 − imposto − comercial)
const PCT_SOBRE_PRECO_MISTO = ["pctImposto", "pctComercial"];
function aplicaPercentuais(custo, prec) {
  const p = k => num(prec[k]) / 100;
  const soma = PCTS.reduce((s, k) => s + num(prec[k]), 0);
  let preco; const base = {};
  if (prec.metodo === "fora") {
    preco = custo * (1 + soma / 100); PCTS.forEach(k => (base[k] = "custo"));
  } else if (prec.metodo === "misto") {
    const sobreCusto = PCTS.filter(k => !PCT_SOBRE_PRECO_MISTO.includes(k)).reduce((s, k) => s + p(k), 0);
    const sobrePreco = PCT_SOBRE_PRECO_MISTO.reduce((s, k) => s + p(k), 0);
    if (sobrePreco >= 1) throw erro(400, "Imposto + comercial somam 100% ou mais. Ajuste em Administração → Parâmetros.");
    preco = (custo * (1 + sobreCusto)) / (1 - sobrePreco);
    PCTS.forEach(k => (base[k] = PCT_SOBRE_PRECO_MISTO.includes(k) ? "preco" : "custo"));
  } else {
    if (soma >= 100) throw erro(400, "Os percentuais de precificação somam 100% ou mais. Ajuste em Administração → Parâmetros.");
    preco = custo / (1 - soma / 100); PCTS.forEach(k => (base[k] = "preco"));
  }
  const valores = Object.fromEntries(PCTS.map(k => [k, (base[k] === "preco" ? preco : custo) * p(k)]));
  return { preco, soma, valores, base };
}
async function validarListaItens(db, lista, categorias, rotulo) {
  const itens = (Array.isArray(lista) ? lista : [])
    .map(i => ({ codigo: String(i.codigo || "").trim().toUpperCase(), qtd: num(i.qtd) }))
    .filter(i => i.codigo);
  if (itens.some(i => !(i.qtd > 0))) throw erro(400, `${rotulo}: todas as quantidades precisam ser maiores que zero.`);
  const cods = itens.map(i => i.codigo);
  if (new Set(cods).size !== cods.length) throw erro(400, `${rotulo}: o mesmo item aparece duas vezes.`);
  if (cods.length) {
    const { rows } = await db.query("select codigo from flex_catalogo where codigo = any($1) and categoria = any($2)", [cods, categorias]);
    const ok = new Set(rows.map(r => r.codigo));
    const faltam = cods.filter(c => !ok.has(c));
    if (faltam.length) throw erro(400, `${rotulo}: itens que não existem na tabela de preços (ou de categoria errada): ${faltam.join(", ")}.`);
  }
  return itens;
}
const fmtItens = it => (it || []).map(i => `${i.qtd}× ${i.codigo}`).join(", ");

/* ---------- administração: estruturas por tipo de telhado ---------- */
app.get("/api/admin/estruturas", rota(async (_req, res) => {
  const { rows } = await pool.query("select id, nome, descricao, itens, ativo, atualizado_em from flex_estruturas order by nome");
  res.json(rows);
}));
async function validarEstrutura(db, b) {
  const nome = String(b.nome || "").trim();
  if (!nome) throw erro(400, "Informe o tipo de telhado (ex.: Colonial).");
  const itens = await validarListaItens(db, b.itens, ["ferragem", "componente"], "Estrutura");
  if (!itens.length) throw erro(400, "Adicione pelo menos um item à estrutura.");
  return { nome, descricao: String(b.descricao || "").trim() || null, itens, ativo: b.ativo === undefined ? true : !!b.ativo };
}
app.post("/api/admin/estruturas", rota(async (req, res) => {
  const r = await transacao(async db => {
    const e = await validarEstrutura(db, req.body);
    const { rows } = await db.query("insert into flex_estruturas (nome, descricao, itens, ativo) values ($1,$2,$3,$4) returning id",
      [e.nome, e.descricao, JSON.stringify(e.itens), e.ativo]);
    await auditar(db, { entidade: "estrutura", numero: e.nome, cliente: e.descricao, usuario: req.usuario, acao: "criou",
      alteracoes: [{ campo: "itens", de: "", para: fmtItens(e.itens) }] });
    return { id: rows[0].id, ...e };
  });
  res.status(201).json(r);
}));
app.put("/api/admin/estruturas/:id", rota(async (req, res) => {
  if (!UUID.test(req.params.id)) throw naoEncontrado("Estrutura");
  const r = await transacao(async db => {
    const antes = (await db.query("select nome, descricao, itens, ativo from flex_estruturas where id = $1 for update", [req.params.id])).rows[0];
    if (!antes) throw naoEncontrado("Estrutura");
    const e = await validarEstrutura(db, req.body);
    await db.query("update flex_estruturas set nome=$2, descricao=$3, itens=$4, ativo=$5, atualizado_em=now() where id=$1",
      [req.params.id, e.nome, e.descricao, JSON.stringify(e.itens), e.ativo]);
    const alt = diferencas({ ...antes, itens: fmtItens(antes.itens) }, { ...e, itens: fmtItens(e.itens) });
    if (alt.length) await auditar(db, { entidade: "estrutura", numero: e.nome, cliente: e.descricao, usuario: req.usuario, acao: "editou", alteracoes: alt });
    return { id: req.params.id, ...e };
  });
  res.json(r);
}));
app.delete("/api/admin/estruturas/:id", rota(async (req, res) => {
  if (!UUID.test(req.params.id)) throw naoEncontrado("Estrutura");
  await transacao(async db => {
    const { rows } = await db.query("delete from flex_estruturas where id = $1 returning nome, descricao", [req.params.id]);
    if (!rows.length) throw naoEncontrado("Estrutura");
    await auditar(db, { entidade: "estrutura", numero: rows[0].nome, cliente: rows[0].descricao, usuario: req.usuario, acao: "excluiu" });
  });
  res.status(204).end();
}));

/* ---------- administração: parâmetros solares ---------- */
app.get("/api/admin/solar", rota(async (_req, res) => {
  const { rows } = await pool.query("select valor, atualizado_em from flex_parametros where chave = 'solar'");
  res.json({ ...SOLAR_PADRAO, ...(rows[0]?.valor || {}), atualizadoEm: rows[0]?.atualizado_em || null });
}));
app.put("/api/admin/solar", rota(async (req, res) => {
  const b = req.body || {};
  const r = await transacao(async db => {
    const p = {
      hsp: num(b.hsp), fonteIrradiacao: String(b.fonteIrradiacao || "").trim(), cidadeIrradiacao: String(b.cidadeIrradiacao || "").trim(),
      pr: num(b.pr), sobredim: num(b.sobredim), areaModulo: num(b.areaModulo), pesoModulo: num(b.pesoModulo),
      tarifa: num(b.tarifa), arredondamento: num(b.arredondamento),
      itensPorModulo: await validarListaItens(db, b.itensPorModulo, ["componente", "ferragem"], "Itens por módulo"),
      prazoEntrega: num(b.prazoEntrega), validade: num(b.validade),
      garantiaModulo: num(b.garantiaModulo), garantiaInversor: num(b.garantiaInversor), garantiaInstalacao: num(b.garantiaInstalacao),
    };
    if (!(p.hsp > 0 && p.hsp < 10)) throw erro(400, "Irradiação (HSP) deve estar entre 0 e 10 kWh/m².dia.");
    if (!(p.pr > 0 && p.pr <= 100)) throw erro(400, "Performance ratio deve estar entre 1% e 100%.");
    if (!(p.sobredim >= 1 && p.sobredim <= 2)) throw erro(400, "O sobredimensionamento deve ficar entre 1,0 e 2,0.");
    const antes = (await db.query("select valor from flex_parametros where chave = 'solar' for update")).rows[0]?.valor || SOLAR_PADRAO;
    await db.query(`insert into flex_parametros (chave, valor) values ('solar', $1)
                    on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`, [JSON.stringify(p)]);
    const alt = diferencas({ ...SOLAR_PADRAO, ...antes, itensPorModulo: fmtItens(antes.itensPorModulo) }, { ...p, itensPorModulo: fmtItens(p.itensPorModulo) });
    if (alt.length) await auditar(db, { entidade: "parametros", numero: "Dimensionamento solar", usuario: req.usuario, acao: "editou", alteracoes: alt });
    return p;
  });
  res.json(r);
}));

/* ---------- comercial: opções e cálculo (sem expor custos) ---------- */
app.get("/api/solar/opcoes", rota(async (_req, res) => {
  const { sol } = await lerParametros();
  const mods = (await pool.query(
    "select codigo, descricao, marca, modelo, potencia_w from flex_catalogo where categoria='modulo' and ativo and potencia_w > 0 order by potencia_w, descricao")).rows;
  const tel = (await pool.query("select nome, descricao from flex_estruturas where ativo order by nome")).rows;
  res.json({
    modulos: mods, telhados: tel, ligacoes: LIGACOES,
    padroes: { hsp: sol.hsp, pr: sol.pr, tarifa: sol.tarifa, cidadeIrradiacao: sol.cidadeIrradiacao, fonteIrradiacao: sol.fonteIrradiacao,
      prazoEntrega: sol.prazoEntrega, validade: sol.validade, garantiaModulo: sol.garantiaModulo, garantiaInversor: sol.garantiaInversor, garantiaInstalacao: sol.garantiaInstalacao },
  });
}));

const tecnologiaModulo = d => {
  const s = String(d || "").toUpperCase();
  const t = [/BIFACIAL/.test(s) && "Bifacial", /N-?TYPE/.test(s) ? "N-Type" : /P-?TYPE/.test(s) ? "P-Type" : null, /MONO/.test(s) && "Monocristalino", /POLI|POLY/.test(s) && "Policristalino"].filter(Boolean);
  return t.join(" ") || "Monocristalino";
};

app.post("/api/solar/calcular", rota(async (req, res) => {
  const b = req.body || {};
  const { prec, sol } = await lerParametros();
  const consumo = num(b.consumo), tarifa = num(b.tarifa) || sol.tarifa, km = Math.max(0, num(b.km));
  const ligacao = ligacaoDe(b.ligacao);
  if (!(consumo > 0)) throw erro(400, "Informe o consumo médio mensal (kWh).");
  if (!ligacao) throw erro(400, "Escolha a ligação: Monofásico 220 V, Trifásico 220 V ou Trifásico 380 V.");

  const cat = new Map((await pool.query("select codigo, categoria, descricao, marca, modelo, potencia_w, unidade, custo, ativo, ligacao from flex_catalogo")).rows.map(r => [r.codigo, r]));
  // "Não incluir": ampliação (só módulos) ou troca de inversor (só inversor)
  const NENHUM = "__NENHUM__";
  const semModulo = b.modulo === NENHUM, semInversor = b.inversor === NENHUM;
  if (semModulo && semInversor) throw erro(400, "A proposta precisa ter módulos, inversor ou os dois.");
  let mod = null;
  if (!semModulo) {
    mod = cat.get(String(b.modulo || "").toUpperCase());
    if (!mod || mod.categoria !== "modulo" || !mod.ativo || !(mod.potencia_w > 0)) throw erro(400, "Escolha um módulo ativo da tabela de preços (ou \"Não incluir módulos\").");
  }
  let est = null;
  if (!semModulo) {
    est = (await pool.query("select nome, itens from flex_estruturas where ativo and lower(nome) = lower($1)", [String(b.telhado || "")])).rows[0];
    if (!est) throw erro(400, "Escolha o tipo de telhado. Se a lista estiver vazia, o administrador precisa cadastrar as estruturas.");
  }

  // 1) módulos
  const hsp = sol.hsp, pr = sol.pr / 100;
  const kwpNecessario = consumo / (hsp * pr * 30);
  const nMod = semModulo ? 0 : Math.max(1, Math.round(num(b.qtdModulos)) || Math.ceil((kwpNecessario * 1000) / mod.potencia_w));
  const kwp = semModulo ? 0 : (nMod * mod.potencia_w) / 1000;
  const kwpRef = semModulo ? kwpNecessario : kwp;   // sem módulos, o inversor é dimensionado pelo consumo

  // 2) inversor: só entram inversores ativos da ligação escolhida que tenham kit
  const kits = (await pool.query("select potencia_kw, ligacao, itens from flex_kits where ligacao = $1", [ligacao])).rows;
  const kitDe = kw => kits.find(k => Number(k.potencia_kw) === kw);
  const custoKit = k => k.itens.reduce((s, it) => s + (cat.get(it.codigo)?.custo || 0) * it.qtd, 0);
  const candidatos = [...cat.values()].filter(i => i.categoria === "inversor" && i.ativo && i.ligacao === ligacao && i.potencia_w > 0 && kitDe(i.potencia_w / 1000))
    .map(i => {
      const kw = i.potencia_w / 1000, qtd = Math.max(1, Math.ceil(kwpRef / (kw * sol.sobredim) - 1e-9));
      return { i, kw, qtd, custo: (i.custo + custoKit(kitDe(kw))) * qtd };
    });
  if (!candidatos.length && !semInversor) throw erro(400, `Não há inversor ${LIGACOES[ligacao]} com kit cadastrado. O administrador precisa montar os kits.`);
  let escolha = null;
  if (semInversor) {
    escolha = null;
  } else if (b.inversor) {
    escolha = candidatos.find(c => c.i.codigo === String(b.inversor).toUpperCase());
    if (!escolha) throw erro(400, "O inversor escolhido não está disponível para essa ligação (ou não tem kit). Escolha outro.");
  } else {
    const unico = candidatos.filter(c => c.qtd === 1);
    const base = unico.length ? unico : candidatos.filter(c => c.qtd === Math.min(...candidatos.map(x => x.qtd)));
    escolha = base.sort((a, z) => a.custo - z.custo || a.kw - z.kw)[0];
  }

  // 3) lista de materiais
  const bom = new Map();   // codigo -> qtd
  const soma = (cod, q) => bom.set(cod, (bom.get(cod) || 0) + q);
  if (mod) soma(mod.codigo, nMod);
  if (escolha) {
    soma(escolha.i.codigo, escolha.qtd);
    for (const it of kitDe(escolha.kw).itens) soma(it.codigo, it.qtd * escolha.qtd);
  }
  if (nMod > 0) {
    for (const it of est.itens) soma(it.codigo, Math.ceil(it.qtd * nMod - 1e-9));
    for (const it of sol.itensPorModulo || []) soma(it.codigo, Math.ceil(it.qtd * nMod - 1e-9));
  }
  const faltando = [...bom.keys()].filter(c => !cat.has(c));
  if (faltando.length) throw erro(400, `Itens dos kits/estruturas que não existem mais na tabela de preços: ${faltando.join(", ")}.`);

  // 4) custos e preço
  const linhas = [...bom].map(([codigo, qtd]) => { const c = cat.get(codigo); return { codigo, qtd, categoria: c.categoria, descricao: c.descricao, unidade: c.unidade, custoUnit: c.custo, custo: c.custo * qtd }; });
  const porCat = k => linhas.filter(l => l.categoria === k).reduce((s, l) => s + l.custo, 0);
  const maoObra = nMod * num(prec.maoObraPlaca), deslocamento = km * num(prec.custoKm);
  const material = linhas.reduce((s, l) => s + l.custo, 0);
  const custoDireto = material + maoObra + deslocamento;
  // Negociação: a margem vai da inicial (0) até a mínima autorizada (1)
  const margemPadrao = num(prec.pctMargem);
  const margemMinima = Math.min(prec.pctMargemMin == null || prec.pctMargemMin === "" ? margemPadrao : num(prec.pctMargemMin), margemPadrao);
  const negociacao = Math.min(1, Math.max(0, num(b.negociacao)));
  const margemUsada = margemPadrao - negociacao * (margemPadrao - margemMinima);
  const arred = num(sol.arredondamento);
  const arredonda = v => (arred > 0 ? Math.ceil(v / arred - 1e-9) * arred : Math.round(v * 100) / 100);
  const { preco: precoBruto, soma: somaPct, valores: valoresPct, base: basePct } = aplicaPercentuais(custoDireto, { ...prec, pctMargem: margemUsada });
  const preco = arredonda(precoBruto);
  const precoTabela = arredonda(aplicaPercentuais(custoDireto, { ...prec, pctMargem: margemPadrao }).preco);
  const precoMinimo = arredonda(aplicaPercentuais(custoDireto, { ...prec, pctMargem: margemMinima }).preco);

  // 5) números da proposta
  const geracaoMensal = kwp * hsp * pr * 30;
  const resultado = {
    consumo, tarifa, ligacao, telhado: est ? est.nome : null, km, hsp, pr: sol.pr, kwpNecessario,
    fonteIrradiacao: sol.fonteIrradiacao, cidadeIrradiacao: sol.cidadeIrradiacao,
    modulo: mod ? { codigo: mod.codigo, descricao: mod.descricao, marca: mod.marca, modelo: mod.modelo, potencia_w: mod.potencia_w, tecnologia: tecnologiaModulo(mod.descricao) } : null,
    nModulos: nMod, kwp,
    inversor: escolha ? { codigo: escolha.i.codigo, descricao: escolha.i.descricao, marca: escolha.i.marca, modelo: escolha.i.modelo, kw: escolha.kw, qtd: escolha.qtd, automatico: !b.inversor } : null,
    inversores: candidatos.sort((a, z) => a.kw - z.kw || a.i.codigo.localeCompare(z.i.codigo)).map(c => ({ codigo: c.i.codigo, descricao: c.i.descricao, kw: c.kw, qtd: c.qtd })),
    geracaoMensal, geracaoAnual: geracaoMensal * 12, cobertura: geracaoMensal / consumo,
    preco, payback: geracaoMensal > 0 && tarifa > 0 ? preco / (geracaoMensal * tarifa) : null,
    precoTabela, precoMinimo, negociacao, temNegociacao: margemMinima < margemPadrao,
    desconto: precoTabela - preco, descontoPct: precoTabela ? (precoTabela - preco) / precoTabela : 0,
    area: nMod * sol.areaModulo, peso: nMod * sol.pesoModulo,
    itens: linhas.filter(l => ["componente", "bateria", "outros"].includes(l.categoria)).map(l => ({ codigo: l.codigo, qtd: l.qtd, unidade: l.unidade, descricao: l.descricao })),
    calculadoEm: new Date().toISOString(),
  };
  const custos = {
    modulos: porCat("modulo"), inversores: porCat("inversor"), componentes: porCat("componente") + porCat("bateria") + porCat("outros"),
    estrutura: porCat("ferragem"), maoObra, deslocamento, custoDireto, somaPct, metodo: prec.metodo, precoBruto, preco,
    arredondamento: preco - precoBruto,
    margemPadrao, margemMinima, margemUsada, negociacao, precoTabela, precoMinimo,
    percentuais: Object.fromEntries(PCTS.map(k => [k, k === "pctMargem" ? margemUsada : num(prec[k])])), valores: valoresPct, base: basePct,
    parametros: { maoObraPlaca: num(prec.maoObraPlaca), custoKm: num(prec.custoKm), km, nModulos: nMod },
    linhas, calculadoEm: resultado.calculadoEm,
  };
  const reg = await pool.query("insert into flex_calculos (usuario, custos) values ($1, $2) returning id", [req.usuario, JSON.stringify(custos)]);
  resultado.calcId = reg.rows[0].id;
  if (req.user.perfil === "admin") resultado.custos = custos;
  res.json(resultado);
}));

/* =====================================================================
   Início
   ===================================================================== */
const sql = await readFile(new URL("./001_propostas.sql", import.meta.url), "utf8");
await pool.query(sql);
// Inversores cadastrados antes da v7: preenche a ligação a partir da descrição
{
  const { rows } = await pool.query("select id, codigo, descricao from flex_catalogo where categoria = 'inversor' and ligacao is null");
  let n = 0;
  for (const r of rows) {
    const l = deduzLigacao(r.descricao, r.codigo);
    if (l) { await pool.query("update flex_catalogo set ligacao = $2 where id = $1", [r.id, l]); n++; }
  }
  if (n) console.log(`Ligação preenchida automaticamente em ${n} inversor(es).`);
}
// O.S. criadas antes da v20 (10 etapas): passa para as etapas novas, mantendo o que já foi feito
{
  const { rows } = await pool.query("select o.id, o.etapas, o.status, p.created_at from flex_os o join flex_propostas p on p.id = o.proposta_id");
  let n = 0;
  for (const r of rows) {
    if (r.etapas.some(e => e.key === "baixa")) continue;
    const antigas = new Map(r.etapas.map(e => [e.key, e]));
    const novas = ETAPAS_OS.map(([key, nome]) => {
      const a = antigas.get(key);
      if (a) return { ...a, key, nome };
      if (key === "orcamento") return { key, nome, status: "concluida", inicio: r.created_at, fim: r.created_at, por: "Sistema" };
      return etapaNova([key, nome]);
    });
    await pool.query("update flex_os set etapas = $2, status = case when status = 'concluida' then 'aberta' else status end, concluida_em = null where id = $1", [r.id, JSON.stringify(novas)]);
    n++;
  }
  if (n) console.log(`${n} O.S. atualizada(s) para as etapas novas.`);
}
// Vendas solares já fechadas antes da v16: abre a O.S. e reserva o material
{
  const { rows } = await pool.query(
    `select p.id from flex_propostas p where p.produto = 'solar' and p.status in ('Fechada','Aceita')
        and not exists (select 1 from flex_os o where o.proposta_id = p.id)`);
  for (const r of rows) await transacao(db => sincronizarOperacao(db, r.id, "Sistema"));
  if (rows.length) console.log(`O.S. aberta para ${rows.length} venda(s) já fechada(s).`);
}
app.listen(PORT, () => console.log(`API de propostas rodando na porta ${PORT}`));
