-- Server-side read state and attachment metadata.
--
-- `last_read_at` lives on the mailbox (not in a new table) so the existing
-- requireMailboxAccess / getMailboxAuth queries keep working unchanged. The
-- browser-local `bingmail.lastSeen.*` value is only a one-time migration source.
ALTER TABLE mailboxes ADD COLUMN last_read_at INTEGER;

-- Attachments are stored in R2 (like the raw mail) and described here. `content_id`
-- carries the RFC 2392 `cid:` used by inline images so the reader can rewrite
-- `src="cid:..."` to a same-origin endpoint.
CREATE TABLE IF NOT EXISTS message_attachments (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL REFERENCES messages(id) ON UPDATE CASCADE ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  content_id TEXT,
  is_inline INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS message_attachments_message_id_idx ON message_attachments (message_id);
