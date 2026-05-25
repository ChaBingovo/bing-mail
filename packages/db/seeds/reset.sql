PRAGMA foreign_keys=OFF;

DROP TABLE IF EXISTS messages_fts;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS blocked_senders;
DROP TABLE IF EXISTS mailboxes;
DROP TABLE IF EXISTS domains;
DROP TABLE IF EXISTS app_settings;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS __bingmail_migrations;

PRAGMA foreign_keys=ON;
