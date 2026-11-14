-- Record the inbound envelope recipient (`to_address`) on each message so users
-- can filter their inbox by primary address or specific alias, while keeping
-- "all inboxes" as the default view.
ALTER TABLE messages ADD COLUMN to_address TEXT;

CREATE INDEX IF NOT EXISTS messages_mailbox_to_received_idx
  ON messages (mailbox_id, to_address, received_at, id);
