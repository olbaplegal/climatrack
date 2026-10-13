-- =====================================================
-- CLIMATRACK - MODELO DE DADOS (PostgreSQL / Supabase)
-- Executado automaticamente pelo back-end na inicialização.
-- =====================================================

-- Clientes da plataforma SaaS (multi-tenant: cada usuário vê só os seus dispositivos)
CREATE TABLE IF NOT EXISTS usuarios (
  id               SERIAL PRIMARY KEY,
  nome             TEXT        NOT NULL,
  email            TEXT        NOT NULL UNIQUE,
  senha_hash       TEXT        NOT NULL,
  telegram_chat_id TEXT,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dispositivos de borda (ESP32). O id é o DEVICE_ID gravado no firmware.
CREATE TABLE IF NOT EXISTS dispositivos (
  id               TEXT PRIMARY KEY,
  usuario_id       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  nome             TEXT,
  local            TEXT,
  temp_max         REAL        NOT NULL DEFAULT 30,
  temp_min         REAL        NOT NULL DEFAULT 10,
  umid_max         REAL        NOT NULL DEFAULT 80,
  umid_min         REAL        NOT NULL DEFAULT 30,
  status           TEXT        NOT NULL DEFAULT 'desconhecido',
  status_info      JSONB,
  ultimo_status_em TIMESTAMPTZ,
  ultimo_dado_em   TIMESTAMPTZ,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Telemetria (série temporal)
CREATE TABLE IF NOT EXISTS leituras (
  id             BIGSERIAL PRIMARY KEY,
  dispositivo_id TEXT        NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
  data_hora      TIMESTAMPTZ NOT NULL,
  temperatura    REAL        NOT NULL,
  umidade        REAL        NOT NULL,
  indice_calor   REAL,
  rssi           INTEGER,
  motivo         TEXT,
  recebido_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leituras_disp_data ON leituras (dispositivo_id, data_hora DESC);

-- Histórico de alertas gerados pelas regras da nuvem
CREATE TABLE IF NOT EXISTS alertas (
  id               BIGSERIAL PRIMARY KEY,
  dispositivo_id   TEXT        NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
  tipo             TEXT        NOT NULL,   -- temp_alta, temp_baixa, umid_alta, umid_baixa, offline...
  estado           TEXT        NOT NULL,   -- 'disparado' ou 'normalizado'
  valor            REAL,
  mensagem         TEXT        NOT NULL,
  enviado_telegram BOOLEAN     NOT NULL DEFAULT false,
  latencia_ms      INTEGER,                -- tempo entre a leitura no ESP32 e o envio do alerta (métrica de SLA)
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alertas_disp_data ON alertas (dispositivo_id, criado_em DESC);

-- Auditoria dos comandos enviados da nuvem para a borda
CREATE TABLE IF NOT EXISTS comandos (
  id             BIGSERIAL PRIMARY KEY,
  dispositivo_id TEXT        NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
  usuario_id     INTEGER     REFERENCES usuarios(id) ON DELETE SET NULL,
  origem         TEXT        NOT NULL,     -- 'usuario', 'regra' ou 'telegram'
  payload        JSONB       NOT NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Segurança (Supabase): o Supabase expõe automaticamente as tabelas do schema "public"
-- numa API REST pública. Ativar RLS sem nenhuma policy bloqueia todo acesso por essa API.
-- O back-end não é afetado: ele conecta como dono das tabelas, que ignora o RLS.
ALTER TABLE usuarios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispositivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE leituras     ENABLE ROW LEVEL SECURITY;
ALTER TABLE alertas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE comandos     ENABLE ROW LEVEL SECURITY;
