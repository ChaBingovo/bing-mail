ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('allow_register', '0');

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY NOT NULL,
  domain TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS domains_domain_uq ON domains (domain);
