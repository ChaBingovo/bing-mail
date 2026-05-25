PRAGMA foreign_keys=OFF;

ALTER TABLE users RENAME TO legacy_users;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX users_username_uq ON users (username);

CREATE TABLE mailboxes_new (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  address TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT INTO mailboxes_new (id, user_id, address, is_active, created_at)
SELECT id, NULL, address, is_active, created_at FROM mailboxes;

DROP TABLE mailboxes;
ALTER TABLE mailboxes_new RENAME TO mailboxes;

CREATE UNIQUE INDEX mailboxes_address_uq ON mailboxes (address);
CREATE INDEX mailboxes_user_id_idx ON mailboxes (user_id);

DROP TABLE legacy_users;

PRAGMA foreign_keys=ON;
