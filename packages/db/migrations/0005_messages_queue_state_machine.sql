PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS messages_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON UPDATE CASCADE ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  attempt INTEGER NOT NULL DEFAULT 0,
  error_reason TEXT,
  from_address TEXT,
  from_name TEXT,
  subject TEXT,
  snippet TEXT,
  ai_code TEXT,
  ai_service TEXT,
  received_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  r2_raw_key TEXT NOT NULL,
  text_plain TEXT,
  html_inline TEXT,
  html_r2_key TEXT,
  parsed_at INTEGER
);

INSERT INTO messages_v2 (
  id,
  mailbox_id,
  status,
  attempt,
  error_reason,
  from_address,
  from_name,
  subject,
  snippet,
  ai_code,
  ai_service,
  received_at,
  r2_raw_key,
  text_plain,
  html_inline,
  html_r2_key,
  parsed_at
)
SELECT
  id,
  mailbox_id,
  status,
  0 AS attempt,
  NULL AS error_reason,
  from_address,
  from_name,
  subject,
  snippet,
  ai_code,
  ai_service,
  received_at,
  r2_raw_key,
  text_plain,
  html_inline,
  html_r2_key,
  parsed_at
FROM messages;

DROP INDEX IF EXISTS messages_mailbox_id_received_at_idx;
DROP TABLE messages;
ALTER TABLE messages_v2 RENAME TO messages;

CREATE INDEX IF NOT EXISTS messages_mailbox_id_received_at_idx ON messages (mailbox_id, received_at);

PRAGMA foreign_keys=on;
