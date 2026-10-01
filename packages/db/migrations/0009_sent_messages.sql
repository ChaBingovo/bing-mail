-- Outbound mail sent through the Cloudflare `send_email` binding.
--
-- Kept separate from `messages` (which models the inbound parse pipeline and
-- requires a non-null R2 raw object), so adding sending needs neither a rebuild
-- of that table nor a nullable `r2_raw_key`.
CREATE TABLE IF NOT EXISTS sent_messages (
  id TEXT PRIMARY KEY NOT NULL,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON UPDATE CASCADE ON DELETE CASCADE,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  subject TEXT,
  snippet TEXT,
  status TEXT NOT NULL CHECK (status IN ('SENT', 'FAILED')),
  error_reason TEXT,
  sent_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS sent_messages_mailbox_sent_at_idx ON sent_messages (mailbox_id, sent_at);
