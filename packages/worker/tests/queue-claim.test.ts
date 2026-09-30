import { expect, test } from "bun:test";
import { handleQueue } from "../src/handlers/queue";

/**
 * The ingest path enqueues the job BEFORE writing the PENDING row, so the consumer
 * can observe "claim affects 0 rows and the row does not exist yet". That must
 * retry; acking there would silently drop the mail.
 */
function createDb(opts: { claimChanges: number; rowExists: boolean }) {
  return {
    prepare(sql: string) {
      const stmt = {
        bind() {
          return stmt;
        },
        async run() {
          if (sql.includes("UPDATE messages SET attempt = attempt + 1")) {
            return { success: true, meta: { changes: opts.claimChanges } };
          }
          return { success: true, meta: { changes: 0 } };
        },
        async first<T>() {
          if (sql.includes("SELECT 1 AS ok FROM messages")) {
            return (opts.rowExists ? { ok: 1 } : null) as unknown as T;
          }
          throw new Error(`unexpected sql: ${sql}`);
        },
      };
      return stmt;
    },
  };
}

function createBatch() {
  const state = { ack: 0, retry: 0 };
  const batch = {
    messages: [
      {
        body: { messageId: "m1" },
        ack: () => {
          state.ack += 1;
        },
        retry: () => {
          state.retry += 1;
        },
      },
    ],
  } as any;
  return { batch, state };
}

test("claim miss with a missing row retries instead of acking", async () => {
  const { batch, state } = createBatch();
  const env = { DB: createDb({ claimChanges: 0, rowExists: false }), PARSE_QUEUE_MAX_ATTEMPTS: "5" } as any;
  await handleQueue(batch, env, {} as any);
  expect(state.retry).toBe(1);
  expect(state.ack).toBe(0);
});

test("claim miss on an already processed row is acked quietly", async () => {
  const { batch, state } = createBatch();
  const env = { DB: createDb({ claimChanges: 0, rowExists: true }), PARSE_QUEUE_MAX_ATTEMPTS: "5" } as any;
  await handleQueue(batch, env, {} as any);
  expect(state.ack).toBe(1);
  expect(state.retry).toBe(0);
});