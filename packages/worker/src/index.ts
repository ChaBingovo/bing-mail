import type { Env, ParseQueueMessage } from "./env";
import type { MessageBatch } from "@cloudflare/workers-types";
import { handleEmail } from "./handlers/email";
import { handleFetch } from "./handlers/fetch";
import { handleQueue } from "./handlers/queue";
export { MailEventsDO } from "./durable/mailEvents";
export { AuthRateLimitDO } from "./durable/authRateLimit";
import { json } from "./http";
import { logError } from "./log";

export default {
  fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const requestId = crypto.randomUUID();
    const headers = new Headers(request.headers);
    headers.set("x-request-id", requestId);
    const tracedRequest = new Request(request, { headers });
    return handleFetch(tracedRequest, env)
      .then((res) => {
        const headers = new Headers(res.headers);
        headers.set("x-request-id", requestId);
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logError({ event: "fetch_unhandled_error", requestId, error: message });
        return json({ error: "internal_error", requestId }, { status: 500, headers: { "x-request-id": requestId } });
      });
  },
  email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    return handleEmail(message, env, ctx);
  },
  queue(batch: MessageBatch<ParseQueueMessage>, env: Env, ctx: ExecutionContext) {
    return handleQueue(batch, env, ctx);
  },
};
