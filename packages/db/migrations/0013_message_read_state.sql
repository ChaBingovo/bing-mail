ALTER TABLE messages ADD COLUMN read_at INTEGER;
CREATE INDEX IF NOT EXISTS messages_mailbox_read_idx ON messages (mailbox_id, read_at);

UPDATE messages
SET read_at = received_at
WHERE read_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM mailboxes m
    WHERE m.id = messages.mailbox_id
      AND m.last_read_at IS NOT NULL
      AND messages.received_at <= m.last_read_at
  );
