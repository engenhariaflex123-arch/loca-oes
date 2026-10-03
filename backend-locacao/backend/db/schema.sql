CREATE TABLE IF NOT EXISTS clients (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT NOT NULL,
  phone       TEXT,
  lat         DOUBLE PRECISION,
  lon         DOUBLE PRECISION,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_types (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE task_types ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER DEFAULT 60;

CREATE TABLE IF NOT EXISTS appointments (
  id          TEXT PRIMARY KEY,
  date        DATE NOT NULL,
  client_id   TEXT REFERENCES clients(id) ON DELETE SET NULL,
  team_id     TEXT NOT NULL,
  task_ids    JSONB DEFAULT '[]',
  notes       TEXT,
  status      TEXT DEFAULT 'pendente', -- pendente | concluido
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pendente';

CREATE TABLE IF NOT EXISTS team_members (
  team_id     TEXT NOT NULL,
  name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_credentials (
  team_id       TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS execution_records (
  id             TEXT PRIMARY KEY,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE CASCADE,
  team_id        TEXT NOT NULL,
  executed_tasks JSONB DEFAULT '[]', -- [{taskId, quantity}]
  notes          TEXT,
  photos         JSONB DEFAULT '[]', -- [base64 strings]
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL, -- 'gerente' | 'admin'
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_name    TEXT,
  user_role    TEXT,
  action       TEXT NOT NULL,   -- create | update | delete | login | register
  entity       TEXT NOT NULL,   -- client | task_type | appointment | team_member | settings | auth
  entity_label TEXT,
  details      JSONB,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_appointment ON execution_records(appointment_id);

-- =====================================================================
-- LOCAÇÃO DE TENDAS E BANHEIROS QUÍMICOS
-- Tudo abaixo é idempotente: pode rodar a cada inicialização do servidor.
-- =====================================================================

-- Locais de instalação (evento/obra). Quase nunca é o endereço do cliente.
CREATE TABLE IF NOT EXISTS sites (
  id             TEXT PRIMARY KEY,
  client_id      TEXT REFERENCES clients(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  address        TEXT NOT NULL,
  lat            DOUBLE PRECISION,
  lon            DOUBLE PRECISION,
  contact_name   TEXT,
  contact_phone  TEXT,
  access_notes   TEXT,             -- portão, horário, acesso p/ caminhão de sucção
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Catálogo: "Tenda 10x10", "Banheiro PNE", "Pia portátil"...
CREATE TABLE IF NOT EXISTS product_types (
  id                      TEXT PRIMARY KEY,
  category                TEXT NOT NULL,   -- tenda | banheiro | acessorio
  name                    TEXT NOT NULL,
  daily_price             NUMERIC(10,2),   -- valor da diária por unidade
  setup_minutes           INTEGER DEFAULT 30,
  teardown_minutes        INTEGER DEFAULT 30,
  cleaning_interval_days  INTEGER,         -- banheiros: limpar a cada N dias (NULL = não limpa)
  turnaround_days         INTEGER DEFAULT 1, -- dias parado após voltar (lavagem/vistoria)
  active                  BOOLEAN DEFAULT true,
  created_at              TIMESTAMPTZ DEFAULT now()
);

-- Unidades físicas, cada uma com seu nº de patrimônio
CREATE TABLE IF NOT EXISTS assets (
  id               TEXT PRIMARY KEY,
  product_type_id  TEXT NOT NULL REFERENCES product_types(id),
  code             TEXT UNIQUE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'disponivel',
                   -- disponivel | locado | higienizacao | manutencao | extraviado | baixado
  notes            TEXT,
  acquired_at      DATE,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Locação (contrato/pedido)
CREATE TABLE IF NOT EXISTS rentals (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id),
  site_id       TEXT REFERENCES sites(id) ON DELETE SET NULL,
  start_date    DATE NOT NULL,     -- entrega/montagem
  end_date      DATE NOT NULL,     -- retirada/desmontagem
  status        TEXT NOT NULL DEFAULT 'orcamento',
                -- orcamento | confirmado | em_andamento | encerrado | cancelado
  team_id       TEXT,              -- equipe padrão das O.S. geradas
  total_value   NUMERIC(12,2),
  notes         TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS rental_items (
  id               TEXT PRIMARY KEY,
  rental_id        TEXT NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  product_type_id  TEXT NOT NULL REFERENCES product_types(id),
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price       NUMERIC(10,2)
);

-- Quais unidades físicas estão (ou estiveram) em cada locação
CREATE TABLE IF NOT EXISTS rental_assets (
  rental_id         TEXT NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  asset_id          TEXT NOT NULL REFERENCES assets(id),
  delivered_at      TIMESTAMPTZ,
  returned_at       TIMESTAMPTZ,
  return_condition  TEXT,          -- ok | sujo | danificado | extraviado
  PRIMARY KEY (rental_id, asset_id)
);

-- Appointments viram ordens de serviço ligadas à locação
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS rental_id TEXT REFERENCES rentals(id) ON DELETE CASCADE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS site_id TEXT REFERENCES sites(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'entrega';
  -- entrega | montagem | limpeza | retirada | desmontagem | manutencao | vistoria
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS time_window TEXT;       -- "08:00-10:00"
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS route_order INTEGER;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'; -- [{productTypeId, name, quantity}]
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN DEFAULT false;
-- status: pendente | em_rota | concluido | nao_realizado | cancelado

-- Histórico de cada unidade
CREATE TABLE IF NOT EXISTS asset_movements (
  id              TEXT PRIMARY KEY,
  asset_id        TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  rental_id       TEXT REFERENCES rentals(id) ON DELETE SET NULL,
  appointment_id  TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  movement        TEXT NOT NULL,   -- saida | retorno | limpeza | manutencao | vistoria | ajuste
  condition       TEXT,
  notes           TEXT,
  team_id         TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Comprovação no campo
ALTER TABLE execution_records ADD COLUMN IF NOT EXISTS signature   TEXT;  -- imagem da assinatura
ALTER TABLE execution_records ADD COLUMN IF NOT EXISTS signed_by   TEXT;
ALTER TABLE execution_records ADD COLUMN IF NOT EXISTS checkin_lat DOUBLE PRECISION;
ALTER TABLE execution_records ADD COLUMN IF NOT EXISTS checkin_lon DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_sites_client          ON sites(client_id);
CREATE INDEX IF NOT EXISTS idx_rentals_dates         ON rentals(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_rentals_client        ON rentals(client_id);
CREATE INDEX IF NOT EXISTS idx_rental_items_rental   ON rental_items(rental_id);
CREATE INDEX IF NOT EXISTS idx_assets_type_status    ON assets(product_type_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_rental   ON appointments(rental_id);
CREATE INDEX IF NOT EXISTS idx_appointments_team_day ON appointments(team_id, date);
CREATE INDEX IF NOT EXISTS idx_movements_asset       ON asset_movements(asset_id, created_at DESC);

-- =====================================================================
-- FROTA (rastreadores no IOP GPS)
-- =====================================================================
CREATE TABLE IF NOT EXISTS vehicles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,          -- "Caminhão sucção 1", "Saveiro"
  plate       TEXT,                   -- placa
  imei        TEXT UNIQUE NOT NULL,   -- IMEI do rastreador (o mesmo cadastrado no IOP GPS)
  team_id     TEXT,                   -- equipe que usa o veículo normalmente
  active      BOOLEAN DEFAULT true,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicles_team ON vehicles(team_id);

-- =====================================================================
-- PAPÉIS, O.S. E ACOMPANHAMENTO EM TEMPO REAL
-- =====================================================================
-- users.role agora aceita: admin | gerente | comercial

-- Visitas podem nascer sem equipe: o comercial agenda, o gerente distribui
ALTER TABLE appointments ALTER COLUMN team_id DROP NOT NULL;
-- Acompanhamento pelo rastreador
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS arrived_at  TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS departed_at TIMESTAMPTZ;

-- Código da ordem de serviço (OS-2026-0001) que acompanha a locação em todas as etapas
CREATE SEQUENCE IF NOT EXISTS rental_os_seq;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS os_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rentals_os_code ON rentals(os_code);
UPDATE rentals SET os_code = 'OS-' || to_char(created_at, 'YYYY') || '-' || lpad(nextval('rental_os_seq')::text, 4, '0')
 WHERE os_code IS NULL;
-- Horário combinado com o cliente para a entrega e para a retirada ("08:30")
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS start_time TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS end_time TEXT;

-- Mensagens automáticas: chegou, concluiu, iniciou, fora de rota, atraso...
CREATE TABLE IF NOT EXISTS fleet_events (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,  -- chegada | saida_sem_concluir | inicio | conclusao | nao_realizada | fora_de_rota | atraso
  severity        TEXT NOT NULL DEFAULT 'info',  -- info | sucesso | alerta
  team_id         TEXT,
  vehicle_id      TEXT,
  appointment_id  TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  message         TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fleet_events_created ON fleet_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_events_appt ON fleet_events(appointment_id, type);

-- =====================================================================
-- HISTÓRICO DA O.S. (ações do escritório; o campo vem de fleet_events,
-- execution_records e asset_movements, juntados na consulta)
-- =====================================================================
CREATE TABLE IF NOT EXISTS rental_history (
  id              TEXT PRIMARY KEY,
  rental_id       TEXT NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  appointment_id  TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  type            TEXT NOT NULL,  -- criada | editada | confirmada | cancelada | encerrada | distribuida | remarcada
  message         TEXT NOT NULL,
  actor_name      TEXT,
  actor_role      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rental_history_rental ON rental_history(rental_id, created_at);

-- Contador da O.S. por ano: transacional (sem buracos após reinício do banco) e nunca reaproveita número
CREATE TABLE IF NOT EXISTS os_counter (
  year  INTEGER PRIMARY KEY,
  last  INTEGER NOT NULL
);
INSERT INTO os_counter (year, last)
SELECT substring(os_code from 4 for 4)::int, MAX(substring(os_code from 9)::int)
  FROM rentals WHERE os_code ~ '^OS-\d{4}-\d+$'
 GROUP BY 1
ON CONFLICT (year) DO UPDATE SET last = GREATEST(os_counter.last, EXCLUDED.last);

-- =====================================================================
-- CONTADOR DE USO: revisão preventiva por produto (opcional)
-- =====================================================================
ALTER TABLE product_types ADD COLUMN IF NOT EXISTS service_every_uses INTEGER; -- revisar a cada N locações
ALTER TABLE product_types ADD COLUMN IF NOT EXISTS service_every_days INTEGER; -- ou a cada N dias locada
