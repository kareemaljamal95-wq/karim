-- AI CEO platform schema. Every table is created idempotently so the file
-- doubles as the migration for a fresh install.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','operator','analyst','viewer')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Integration credentials are stored encrypted (AES-256-GCM) and never
-- returned to the client. `status` is derived from whether a secret exists.
CREATE TABLE IF NOT EXISTS integrations (
  key           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,
  description   TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 0,
  credentials   TEXT,              -- encrypted JSON blob
  config        TEXT NOT NULL DEFAULT '{}',
  last_checked_at TEXT,
  last_error    TEXT,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  key              TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL,
  description      TEXT NOT NULL,
  system_prompt    TEXT NOT NULL,
  tools            TEXT NOT NULL DEFAULT '[]',
  allowed_actions  TEXT NOT NULL DEFAULT '[]',
  requires_approval INTEGER NOT NULL DEFAULT 0,
  max_actions      INTEGER NOT NULL DEFAULT 25,
  retry_limit      INTEGER NOT NULL DEFAULT 2,
  output_format    TEXT NOT NULL DEFAULT 'json',
  enabled          INTEGER NOT NULL DEFAULT 1,
  is_core          INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflows (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  definition  TEXT NOT NULL,        -- JSON: { nodes: [...], edges: [...] }
  enabled     INTEGER NOT NULL DEFAULT 1,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id           TEXT PRIMARY KEY,
  workflow_id  TEXT REFERENCES workflows(id) ON DELETE SET NULL,
  goal         TEXT NOT NULL,
  status       TEXT NOT NULL,
  input        TEXT NOT NULL DEFAULT '{}',
  context      TEXT NOT NULL DEFAULT '{}',
  plan         TEXT NOT NULL DEFAULT '[]',
  error        TEXT,
  demo         INTEGER NOT NULL DEFAULT 0,
  started_by   TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT
);

CREATE TABLE IF NOT EXISTS run_steps (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  node_id     TEXT NOT NULL,
  label       TEXT NOT NULL,
  agent_key   TEXT,
  kind        TEXT NOT NULL,       -- agent | tool | condition | approval | action
  status      TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  input       TEXT NOT NULL DEFAULT '{}',
  output      TEXT,
  validation  TEXT,                -- JSON self-verification report
  error       TEXT,
  started_at  TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_steps_run ON run_steps(run_id, seq);

CREATE TABLE IF NOT EXISTS research_runs (
  id          TEXT PRIMARY KEY,
  run_id      TEXT REFERENCES runs(id) ON DELETE SET NULL,
  country     TEXT NOT NULL,
  city        TEXT NOT NULL,
  area        TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL,
  source      TEXT NOT NULL,        -- google_places | demo
  demo        INTEGER NOT NULL DEFAULT 1,
  discovered  INTEGER NOT NULL DEFAULT 0,
  imported    INTEGER NOT NULL DEFAULT 0,
  duplicates  INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id                  TEXT PRIMARY KEY,
  business_name       TEXT NOT NULL,
  category            TEXT NOT NULL,
  country             TEXT NOT NULL DEFAULT '',
  city                TEXT NOT NULL DEFAULT '',
  area                TEXT NOT NULL DEFAULT '',
  address             TEXT,
  phone               TEXT,
  email               TEXT,
  website             TEXT,
  maps_url            TEXT,
  social_links        TEXT NOT NULL DEFAULT '{}',
  rating              REAL,
  review_count        INTEGER,
  opening_hours       TEXT,
  opportunity_score   INTEGER,
  lead_score          INTEGER,
  lead_grade          TEXT,
  recommended_service TEXT,
  reason              TEXT,
  problem             TEXT,
  estimated_value     INTEGER,
  confidence          REAL,
  signals             TEXT NOT NULL DEFAULT '[]',
  score_breakdown     TEXT NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'NEW',
  last_contact_at     TEXT,
  next_action         TEXT,
  notes               TEXT NOT NULL DEFAULT '',
  source              TEXT NOT NULL DEFAULT 'demo',
  is_demo             INTEGER NOT NULL DEFAULT 1,
  dedupe_key          TEXT NOT NULL,
  research_run_id     TEXT REFERENCES research_runs(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_dedupe ON leads(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_grade ON leads(lead_grade);
CREATE INDEX IF NOT EXISTS idx_leads_city ON leads(city);

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL,
  subject       TEXT,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'APPROVAL_REQUIRED',
  variant       TEXT NOT NULL DEFAULT 'primary',
  quality       TEXT NOT NULL DEFAULT '{}',
  generated_by  TEXT NOT NULL DEFAULT 'outreach_agent',
  edited_by     TEXT,
  approved_by   TEXT,
  approved_at   TEXT,
  rejected_reason TEXT,
  sent_at       TEXT,
  is_demo       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);

CREATE TABLE IF NOT EXISTS approvals (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  lead_id      TEXT REFERENCES leads(id) ON DELETE CASCADE,
  run_id       TEXT REFERENCES runs(id) ON DELETE SET NULL,
  step_id      TEXT REFERENCES run_steps(id) ON DELETE SET NULL,
  payload      TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'PENDING',
  requested_by TEXT NOT NULL DEFAULT 'orchestrator',
  decided_by   TEXT,
  decided_at   TEXT,
  decision_note TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);

CREATE TABLE IF NOT EXISTS conversations (
  id             TEXT PRIMARY KEY,
  lead_id        TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  message_id     TEXT REFERENCES messages(id) ON DELETE SET NULL,
  direction      TEXT NOT NULL,       -- inbound | outbound
  channel        TEXT NOT NULL,
  body           TEXT NOT NULL,
  intent         TEXT,
  sentiment      TEXT,
  buying_signals TEXT NOT NULL DEFAULT '[]',
  objections     TEXT NOT NULL DEFAULT '[]',
  requirements   TEXT NOT NULL DEFAULT '[]',
  requires_human INTEGER NOT NULL DEFAULT 0,
  suggested_reply TEXT,
  analysis       TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_lead ON conversations(lead_id);

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  service       TEXT NOT NULL,
  requirements  TEXT NOT NULL DEFAULT '[]',
  missing_info  TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'HUMAN_REVIEW_REQUIRED',
  estimated_value INTEGER,
  source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_lead ON projects(lead_id);

CREATE TABLE IF NOT EXISTS activity_logs (
  id          TEXT PRIMARY KEY,
  ts          TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'info',
  actor_type  TEXT NOT NULL DEFAULT 'system',   -- user | agent | system
  actor       TEXT NOT NULL DEFAULT 'system',
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  run_id      TEXT,
  message     TEXT NOT NULL,
  meta        TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON activity_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_logs_run ON activity_logs(run_id);
