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
  HTML_INLINE_LIMIT: string;
  PARSE_QUEUE_MAX_ATTEMPTS?: string;
  JWT_SECRET: string;
};
