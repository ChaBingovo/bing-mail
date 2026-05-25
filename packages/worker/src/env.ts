export type ParseQueueMessage = {
  messageId: string;
};

export type Env = {
  DB: D1Database;
  MAIL_BUCKET: R2Bucket;
  PARSE_QUEUE: Queue<ParseQueueMessage>;
  HTML_INLINE_LIMIT: string;
};

