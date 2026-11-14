import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
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
    lastReadAt: integer("last_read_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("mailboxes_address_uq").on(t.address),
    index("mailboxes_user_id_idx").on(t.userId),
  ],
);

export const mailboxAliases = sqliteTable(
  "mailbox_aliases",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade", onUpdate: "cascade" }),
    address: text("address").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("mailbox_aliases_address_uq").on(t.address), index("mailbox_aliases_mailbox_id_idx").on(t.mailboxId)],
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const domains = sqliteTable(
  "domains",
  {
    id: text("id").primaryKey(),
    domain: text("domain").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("domains_domain_uq").on(t.domain)],
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
    status: text("status", { enum: ["PENDING", "SUCCESS", "FAILED"] }).notNull(),
    attempt: integer("attempt").notNull().default(0),
    errorReason: text("error_reason"),
    fromAddress: text("from_address"),
    fromName: text("from_name"),
    toAddress: text("to_address"),
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
    lockId: text("lock_id"),
    lockedAt: integer("locked_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("messages_mailbox_id_received_at_idx").on(t.mailboxId, t.receivedAt),
    index("messages_mailbox_id_received_at_id_idx").on(t.mailboxId, t.receivedAt, t.id),
    index("messages_mailbox_to_received_idx").on(t.mailboxId, t.toAddress, t.receivedAt, t.id),
  ],
);

/** Outbound mail sent through the `send_email` binding (see migration 0009). */
export const sentMessages = sqliteTable(
  "sent_messages",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade", onUpdate: "cascade" }),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject"),
    snippet: text("snippet"),
    status: text("status", { enum: ["SENT", "FAILED"] }).notNull(),
    errorReason: text("error_reason"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("sent_messages_mailbox_sent_at_idx").on(t.mailboxId, t.sentAt)],
);

/**
 * Attachment metadata (see migration 0010). The bytes live in R2 under `r2Key`;
 * `contentId` carries the RFC 2392 `cid:` for inline images.
 */
export const messageAttachments = sqliteTable(
  "message_attachments",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade", onUpdate: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    r2Key: text("r2_key").notNull(),
    contentId: text("content_id"),
    isInline: integer("is_inline", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("message_attachments_message_id_idx").on(t.messageId)],
);
