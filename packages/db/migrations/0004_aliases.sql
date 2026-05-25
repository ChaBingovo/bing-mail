CREATE TABLE IF NOT EXISTS mailbox_aliases (
  id TEXT PRIMARY KEY NOT NULL,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON UPDATE CASCADE ON DELETE CASCADE,
  address TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS mailbox_aliases_address_uq ON mailbox_aliases (address);
CREATE INDEX IF NOT EXISTS mailbox_aliases_mailbox_id_idx ON mailbox_aliases (mailbox_id);

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('max_aliases', '3');

UPDATE mailboxes
SET is_active = 0
WHERE user_id IS NOT NULL
  AND is_active = 1
  AND created_at < (
    SELECT MAX(created_at)
    FROM mailboxes m2
    WHERE m2.user_id = mailboxes.user_id AND m2.is_active = 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS mailboxes_user_id_active_uq ON mailboxes(user_id)
WHERE user_id IS NOT NULL AND is_active = 1;
