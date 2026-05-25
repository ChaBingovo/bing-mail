CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  api_token TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_api_token_uq ON users (api_token);

CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  address TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS mailboxes_address_uq ON mailboxes (address);
CREATE INDEX IF NOT EXISTS mailboxes_user_id_idx ON mailboxes (user_id);

CREATE TABLE IF NOT EXISTS blocked_senders (
  id TEXT PRIMARY KEY NOT NULL,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON UPDATE CASCADE ON DELETE CASCADE,
  sender TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS blocked_senders_mailbox_sender_uq ON blocked_senders (mailbox_id, sender);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON UPDATE CASCADE ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SUCCESS')),
  from_address TEXT,
  from_name TEXT,
  subject TEXT,
  snippet TEXT,
  received_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  r2_raw_key TEXT NOT NULL,
  text_plain TEXT,
  html_inline TEXT,
  html_r2_key TEXT,
  parsed_at INTEGER
);

CREATE INDEX IF NOT EXISTS messages_mailbox_id_received_at_idx ON messages (mailbox_id, received_at);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5 (
  message_id UNINDEXED,
  subject,
  body_text
);

