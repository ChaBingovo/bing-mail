import type { Ai } from "@cloudflare/workers-types";

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
  HTML_INLINE_LIMIT: string;
  PARSE_QUEUE_MAX_ATTEMPTS?: string;
  JWT_SECRET: string;
  JWT_SECRET_CURRENT?: string;
  JWT_SECRET_PREVIOUS?: string;
  TURNSTILE_MODE?: string;
  TURNSTILE_SECRET?: string;
  WS_MAX_CONNECTIONS?: string;
  LOGIN_FAIL_LIMIT?: string;
  LOGIN_FAIL_WINDOW_MS?: string;
};
