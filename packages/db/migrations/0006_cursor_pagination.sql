CREATE INDEX IF NOT EXISTS messages_mailbox_id_received_at_id_idx ON messages (mailbox_id, received_at, id);
