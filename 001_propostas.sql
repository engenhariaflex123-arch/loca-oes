-- Plataforma de Propostas Flex Solar — estrutura do banco.
-- O servidor executa este arquivo ao iniciar. Tudo é idempotente
-- (IF NOT EXISTS), então rodar de novo não apaga nem altera dados,
-- e nenhuma outra tabela do banco é tocada.

CREATE TABLE IF NOT EXISTS flex_propostas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero      TEXT NOT NULL,
  produto     TEXT NOT NULL DEFAULT 'watcher',
  status      TEXT NOT NULL DEFAULT 'Rascunho',   -- situação da proposta
  razao       TEXT NOT NULL,
  fantasia    TEXT,
  cnpj        TEXT,
  data        DATE,
  total       NUMERIC(14,2) NOT NULL DEFAULT 0,
  dados       JSONB NOT NULL,                      -- todos os campos do formulário
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v2: andamento do projeto e situação de pagamento
ALTER TABLE flex_propostas ADD COLUMN IF NOT EXISTS andamento TEXT NOT NULL DEFAULT 'Não iniciado';
ALTER TABLE flex_propostas ADD COLUMN IF NOT EXISTS status_pag TEXT NOT NULL DEFAULT 'Pendente';

CREATE UNIQUE INDEX IF NOT EXISTS flex_propostas_numero_uk ON flex_propostas (numero);
CREATE INDEX IF NOT EXISTS flex_propostas_updated_idx ON flex_propostas (updated_at DESC);
CREATE INDEX IF NOT EXISTS flex_propostas_cnpj_idx ON flex_propostas (cnpj);

-- v2: auditoria. Sem chave estrangeira de propósito: o histórico
-- continua existindo mesmo depois que a proposta é excluída.
CREATE TABLE IF NOT EXISTS flex_auditoria (
  id           BIGSERIAL PRIMARY KEY,
  proposta_id  UUID,
  numero       TEXT,
  cliente      TEXT,
  usuario      TEXT NOT NULL,
  acao         TEXT NOT NULL,          -- criou | editou | status | excluiu
  alteracoes   JSONB NOT NULL DEFAULT '[]',   -- [{campo, de, para}]
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS flex_auditoria_proposta_idx ON flex_auditoria (proposta_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS flex_auditoria_data_idx ON flex_auditoria (criado_em DESC);

-- =====================================================================
-- v5: usuários com perfil, tabela de preços, kits e parâmetros
-- =====================================================================
ALTER TABLE flex_auditoria ADD COLUMN IF NOT EXISTS entidade TEXT NOT NULL DEFAULT 'proposta';
CREATE INDEX IF NOT EXISTS flex_auditoria_entidade_idx ON flex_auditoria (entidade, criado_em DESC);

CREATE TABLE IF NOT EXISTS flex_usuarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL,
  senha_hash    TEXT NOT NULL,
  perfil        TEXT NOT NULL DEFAULT 'comercial',   -- admin | comercial
  ativo         BOOLEAN NOT NULL DEFAULT true,
  ultimo_login  TIMESTAMPTZ,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS flex_usuarios_email_uk ON flex_usuarios (lower(email));

-- Itens de custo: módulos, inversores, componentes elétricos e ferragem
CREATE TABLE IF NOT EXISTS flex_catalogo (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        TEXT NOT NULL,                -- chave usada na importação do Excel
  categoria     TEXT NOT NULL,                -- modulo | inversor | componente | ferragem | bateria | outros
  descricao     TEXT NOT NULL,
  marca         TEXT,
  modelo        TEXT,
  potencia_w    NUMERIC(12,2),                -- módulo (Wp) ou inversor (W)
  unidade       TEXT NOT NULL DEFAULT 'un',
  custo         NUMERIC(14,2) NOT NULL DEFAULT 0,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS flex_catalogo_codigo_uk ON flex_catalogo (codigo);
CREATE INDEX IF NOT EXISTS flex_catalogo_categoria_idx ON flex_catalogo (categoria);

-- Kit de componentes elétricos por potência de inversor
CREATE TABLE IF NOT EXISTS flex_kits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  potencia_kw   NUMERIC(8,2) NOT NULL,
  descricao     TEXT,
  itens         JSONB NOT NULL DEFAULT '[]',  -- [{codigo, qtd}]
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- (o índice único passou a ser potência + ligação; ver a seção v7 abaixo)

-- Parâmetros gerais (mão de obra, km, percentuais)
CREATE TABLE IF NOT EXISTS flex_parametros (
  chave         TEXT PRIMARY KEY,
  valor         JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- v7: ligação do inversor (mono 220 V, tri 220 V, tri 380 V) e kit por
-- potência + ligação
-- =====================================================================
ALTER TABLE flex_catalogo ADD COLUMN IF NOT EXISTS ligacao TEXT;   -- mono220 | tri220 | tri380 (só inversores)
ALTER TABLE flex_kits     ADD COLUMN IF NOT EXISTS ligacao TEXT;
DROP INDEX IF EXISTS flex_kits_potencia_uk;
CREATE UNIQUE INDEX IF NOT EXISTS flex_kits_pot_lig_uk ON flex_kits (potencia_kw, coalesce(ligacao, ''));

-- =====================================================================
-- v8: orçamento solar — estrutura de fixação por tipo de telhado
-- (quantidades por módulo). Os parâmetros solares ficam em
-- flex_parametros com a chave 'solar'.
-- =====================================================================
CREATE TABLE IF NOT EXISTS flex_estruturas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          TEXT NOT NULL,                 -- ex.: Colonial, Fibrocimento, Metálico, Laje, Solo
  descricao     TEXT,
  itens         JSONB NOT NULL DEFAULT '[]',   -- [{codigo, qtd}]  qtd = quantidade POR MÓDULO
  ativo         BOOLEAN NOT NULL DEFAULT true,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS flex_estruturas_nome_uk ON flex_estruturas (lower(nome));

-- =====================================================================
-- v11: datas de venda, pagamento e instalação (para os relatórios)
-- =====================================================================
ALTER TABLE flex_propostas ADD COLUMN IF NOT EXISTS fechada_em   TIMESTAMPTZ;
ALTER TABLE flex_propostas ADD COLUMN IF NOT EXISTS paga_em      TIMESTAMPTZ;
ALTER TABLE flex_propostas ADD COLUMN IF NOT EXISTS instalada_em TIMESTAMPTZ;

-- Propostas antigas: recupera a data pela auditoria (última vez que mudou para a situação)…
UPDATE flex_propostas p SET fechada_em = a.em
  FROM (SELECT proposta_id, max(criado_em) em FROM flex_auditoria
         WHERE alteracoes @> '[{"campo":"status","para":"Fechada"}]' GROUP BY proposta_id) a
 WHERE p.id = a.proposta_id AND p.status IN ('Fechada','Aceita') AND p.fechada_em IS NULL;
UPDATE flex_propostas p SET paga_em = a.em
  FROM (SELECT proposta_id, max(criado_em) em FROM flex_auditoria
         WHERE alteracoes @> '[{"campo":"statusPag","para":"Pago"}]' GROUP BY proposta_id) a
 WHERE p.id = a.proposta_id AND p.status_pag = 'Pago' AND p.paga_em IS NULL;
UPDATE flex_propostas p SET instalada_em = a.em
  FROM (SELECT proposta_id, max(criado_em) em FROM flex_auditoria
         WHERE alteracoes @> '[{"campo":"andamento","para":"Instalado"}]' OR alteracoes @> '[{"campo":"andamento","para":"Em operação"}]'
         GROUP BY proposta_id) a
 WHERE p.id = a.proposta_id AND p.andamento IN ('Instalado','Em operação') AND p.instalada_em IS NULL;
-- …e, sem registro na auditoria, usa a última alteração da proposta
UPDATE flex_propostas SET fechada_em   = updated_at WHERE status IN ('Fechada','Aceita') AND fechada_em IS NULL;
UPDATE flex_propostas SET paga_em      = updated_at WHERE status_pag = 'Pago' AND paga_em IS NULL;
UPDATE flex_propostas SET instalada_em = updated_at WHERE andamento IN ('Instalado','Em operação') AND instalada_em IS NULL;
CREATE INDEX IF NOT EXISTS flex_propostas_fechada_idx ON flex_propostas (fechada_em);

-- =====================================================================
-- v13: composição de custo de cada proposta (só o administrador lê)
-- =====================================================================
-- Cada cálculo do orçamento solar fica registrado aqui; ao salvar a
-- proposta, a composição do cálculo usado é copiada para ela.
CREATE TABLE IF NOT EXISTS flex_calculos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario    TEXT,
  custos     JSONB NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE flex_propostas ADD COLUMN IF NOT EXISTS composicao JSONB;
-- cálculos antigos que não viraram proposta não servem para nada
DELETE FROM flex_calculos WHERE criado_em < now() - interval '60 days';

-- =====================================================================
-- v16: ESTOQUE (entrada, reserva, saída) e ORDEM DE SERVIÇO
-- =====================================================================
ALTER TABLE flex_catalogo ADD COLUMN IF NOT EXISTS estoque BOOLEAN NOT NULL DEFAULT false;
-- Na primeira vez: controla módulos, inversores e cabos solares
UPDATE flex_catalogo SET estoque = true
 WHERE NOT EXISTS (SELECT 1 FROM flex_parametros WHERE chave = 'estoque_inicializado')
   AND (categoria IN ('modulo','inversor') OR (upper(descricao) LIKE '%CABO%' AND upper(descricao) LIKE '%SOLAR%'));
INSERT INTO flex_parametros (chave, valor) VALUES ('estoque_inicializado', 'true') ON CONFLICT (chave) DO NOTHING;

-- Movimentos físicos: entrada (+), saída (−) e ajuste de inventário (±)
CREATE TABLE IF NOT EXISTS flex_estoque_mov (
  id          BIGSERIAL PRIMARY KEY,
  codigo      TEXT NOT NULL,
  tipo        TEXT NOT NULL,                 -- entrada | saida | ajuste
  qtd         NUMERIC(14,3) NOT NULL,        -- entrada/saída: positivo; ajuste: com sinal
  proposta_id UUID,
  os_id       UUID,
  documento   TEXT,                          -- nota fiscal
  fornecedor  TEXT,
  observacao  TEXT,
  usuario     TEXT NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS flex_estoque_mov_codigo_idx ON flex_estoque_mov (codigo, criado_em DESC);
CREATE INDEX IF NOT EXISTS flex_estoque_mov_data_idx ON flex_estoque_mov (criado_em DESC);

-- Reservas por proposta vendida
CREATE TABLE IF NOT EXISTS flex_reservas (
  id            BIGSERIAL PRIMARY KEY,
  proposta_id   UUID NOT NULL,
  codigo        TEXT NOT NULL,
  qtd           NUMERIC(14,3) NOT NULL,       -- quantidade reservada
  baixado       NUMERIC(14,3) NOT NULL DEFAULT 0,  -- quanto já saiu do estoque
  ativa         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proposta_id, codigo)
);

-- Ordem de serviço
CREATE SEQUENCE IF NOT EXISTS flex_os_seq;
CREATE TABLE IF NOT EXISTS flex_os (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero        TEXT NOT NULL UNIQUE,
  proposta_id   UUID NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'aberta',  -- aberta | concluida | cancelada
  etapas        JSONB NOT NULL,                  -- [{key, nome, status, inicio, fim, por}]
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluida_em  TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS flex_os_eventos (
  id         BIGSERIAL PRIMARY KEY,
  os_id      UUID NOT NULL,
  etapa      TEXT,
  tipo       TEXT NOT NULL,     -- sistema | etapa | nota | estoque | situacao
  texto      TEXT NOT NULL,
  usuario    TEXT NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS flex_os_eventos_os_idx ON flex_os_eventos (os_id, criado_em);

-- =====================================================================
-- v17: leitura por código (celular) e rastreio de número de série
-- =====================================================================
ALTER TABLE flex_catalogo ADD COLUMN IF NOT EXISTS rastrear BOOLEAN NOT NULL DEFAULT false;
UPDATE flex_catalogo SET rastrear = true
 WHERE NOT EXISTS (SELECT 1 FROM flex_parametros WHERE chave = 'rastreio_inicializado') AND categoria IN ('modulo','inversor');
INSERT INTO flex_parametros (chave, valor) VALUES ('rastreio_inicializado', 'true') ON CONFLICT (chave) DO NOTHING;

-- Cada unidade rastreada (módulo, inversor…) pelo número de série
CREATE TABLE IF NOT EXISTS flex_series (
  serie        TEXT PRIMARY KEY,
  codigo       TEXT NOT NULL,                 -- item da tabela de preços
  status       TEXT NOT NULL DEFAULT 'estoque',  -- estoque | saiu
  documento    TEXT,                          -- NF de entrada
  fornecedor   TEXT,
  entrada_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  entrada_por  TEXT NOT NULL,
  os_id        UUID,
  proposta_id  UUID,
  saida_em     TIMESTAMPTZ,
  saida_por    TEXT
);
CREATE INDEX IF NOT EXISTS flex_series_codigo_idx ON flex_series (codigo, status);
CREATE INDEX IF NOT EXISTS flex_series_os_idx ON flex_series (os_id);

-- Códigos de barras de fábrica (EAN, código do modelo) associados a um item
CREATE TABLE IF NOT EXISTS flex_codigos_barras (
  barras     TEXT PRIMARY KEY,
  codigo     TEXT NOT NULL,
  criado_por TEXT,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- v20: setores responsáveis pelas etapas da O.S. e equipes de campo
-- =====================================================================
ALTER TABLE flex_usuarios ADD COLUMN IF NOT EXISTS equipe TEXT;   -- cor da equipe de campo

-- =====================================================================
-- v23: remessas (cada entrada de carga recebe um código REM-AAAA-NNNN)
-- =====================================================================
CREATE SEQUENCE IF NOT EXISTS flex_remessa_seq;
CREATE TABLE IF NOT EXISTS flex_remessas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      TEXT NOT NULL UNIQUE,
  documento   TEXT,               -- nota fiscal
  fornecedor  TEXT,
  observacao  TEXT,
  recebida_em TIMESTAMPTZ NOT NULL DEFAULT now(),   -- data real da chegada
  usuario     TEXT NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()    -- quando foi lançada na plataforma
);
ALTER TABLE flex_estoque_mov ADD COLUMN IF NOT EXISTS remessa_id UUID;
ALTER TABLE flex_series      ADD COLUMN IF NOT EXISTS remessa_id UUID;
CREATE INDEX IF NOT EXISTS flex_estoque_mov_remessa_idx ON flex_estoque_mov (remessa_id);
