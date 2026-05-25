import type { Env, ParseQueueMessage } from "./env";
import type { MessageBatch } from "@cloudflare/workers-types";
import { handleEmail } from "./handlers/email";
import { handleFetch } from "./handlers/fetch";
import { handleQueue } from "./handlers/queue";

export default {
  fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    return handleFetch(request, env);
  },
  email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    return handleEmail(message, env, ctx);
  },
  queue(batch: MessageBatch<ParseQueueMessage>, env: Env, ctx: ExecutionContext) {
    return handleQueue(batch, env, ctx);
  },
};
