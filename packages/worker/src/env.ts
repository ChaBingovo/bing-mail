import type { Ai, SendEmail } from "@cloudflare/workers-types";

export type ParseQueueMessage = {
  messageId: string;
};

export type Env = {
  AI: Ai;
  ASSETS: Fetcher;
  DB: D1Database;
  MAIL_BUCKET: R2Bucket;
  PARSE_QUEUE: Queue<ParseQueueMessage>;
  MAIL_EVENTS: DurableObjectNamespace;
  AUTH_RATE: DurableObjectNamespace;
  /** Outbound mail binding (`[[send_email]]` in wrangler.toml). Absent in bare local dev. */
  EMAIL?: SendEmail;
  HTML_INLINE_LIMIT: string;
  PARSE_QUEUE_MAX_ATTEMPTS?: string;
  PARSE_QUEUE_LOCK_TTL_MS?: string;
  JWT_SECRET: string;
  TURNSTILE_MODE?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  WS_MAX_CONNECTIONS?: string;
  LOGIN_FAIL_LIMIT?: string;
  LOGIN_FAIL_WINDOW_MS?: string;
  /** Days to keep inbound raw mail / sent history; 0 disables cleanup. */
  MAIL_RETENTION_DAYS?: string;
};
