import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const usersUsernameIdx = uniqueIndex("users_username_uq").on(users.username);

export const mailboxes = sqliteTable(
  "mailboxes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    address: text("address").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("mailboxes_address_uq").on(t.address),
    index("mailboxes_user_id_idx").on(t.userId),
  ],
);

export const blockedSenders = sqliteTable(
  "blocked_senders",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade", onUpdate: "cascade" }),
    sender: text("sender").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("blocked_senders_mailbox_sender_uq").on(t.mailboxId, t.sender)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade", onUpdate: "cascade" }),
    status: text("status", { enum: ["PENDING", "SUCCESS"] }).notNull(),
    fromAddress: text("from_address"),
    fromName: text("from_name"),
    subject: text("subject"),
    snippet: text("snippet"),
    aiCode: text("ai_code"),
    aiService: text("ai_service"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    r2RawKey: text("r2_raw_key").notNull(),
    textPlain: text("text_plain"),
    htmlInline: text("html_inline"),
    htmlR2Key: text("html_r2_key"),
    parsedAt: integer("parsed_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("messages_mailbox_id_received_at_idx").on(t.mailboxId, t.receivedAt)],
);
