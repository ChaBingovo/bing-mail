import { expect, test } from "bun:test";
import { handleQueue } from "../src/handlers/queue";

/**
 * The ingest path enqueues the job BEFORE writing the PENDING row, so the consumer
 * can observe "claim affects 0 rows and the row does not exist yet". That must
 * retry; acking there would silently drop the mail.
 */
function createDb(opts: {
  claimChanges: number;
  rowExists: boolean;
  /** Simulates another consumer currently holding the row's lock. */
  lockHeld?: boolean;
  /** Whether the retry-cycle reset matches (i.e. the row is claimable again). */
  requeueChanges?: number;
}) {
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
          // Only these two statements are allowed to report changes; anything else
          // (e.g. the FAILED write) must be a no-op or the assertions go blind.
          if (sql.includes("SET attempt = 1, status='PENDING'")) {
            return { success: true, meta: { changes: opts.requeueChanges ?? 0 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
        async first<T>() {
          if (sql.includes("SELECT status, attempt, lock_id FROM messages")) {
            return (opts.rowExists
              ? { status: "PENDING", attempt: 1, lock_id: opts.lockHeld ? "other-worker" : null }
              : null) as unknown as T;
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

test("claim miss on a locked row is skipped quietly", async () => {
  // Another worker holds the lock: it is still parsing and will ack or retry this
  // row itself. Duplicating the work here would only waste an AI call, and the
  // TTL reaper covers the case where the holder dies silently.
  const { batch, state } = createBatch();
  const env = {
    DB: createDb({ claimChanges: 0, rowExists: true, lockHeld: true }),
    PARSE_QUEUE_MAX_ATTEMPTS: "5",
  } as any;
  await handleQueue(batch, env, {} as any);
  expect(state.ack).toBe(1);
  expect(state.retry).toBe(0);
});

test("claim miss on an idle exhausted row starts a new cycle", async () => {
  const { batch, state } = createBatch();
  const sent: unknown[] = [];
  const env = {
    DB: createDb({ claimChanges: 0, rowExists: true, requeueChanges: 1 }),
    PARSE_QUEUE_MAX_ATTEMPTS: "5",
    PARSE_QUEUE: { send: async (body: unknown) => void sent.push(body) },
  } as any;
  await handleQueue(batch, env, {} as any);
  expect(sent).toEqual([{ messageId: "m1" }]);
  expect(state.ack).toBe(1);
  expect(state.retry).toBe(0);
});

test("the re-enqueue attempt budget is bounded by a hard ceiling", async () => {
  // Guards against a poison message looping forever: 5 attempts per cycle × 6.
  const { batch } = createBatch();
  const requeueWrites: unknown[][] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        const stmt = {
          bound: [] as unknown[],
          bind(...args: unknown[]) {
            stmt.bound = args;
            return stmt;
          },
          async run() {
            if (sql.includes("SET attempt = 1, status='PENDING'")) {
              requeueWrites.push(stmt.bound);
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          },
          async first<T>() {
            return { status: "PENDING", attempt: 5, lock_id: null } as unknown as T;
          },
        };
        return stmt;
      },
    },
    PARSE_QUEUE_MAX_ATTEMPTS: "5",
    PARSE_QUEUE: { send: async () => undefined },
  } as any;

  await handleQueue(batch, env, {} as any);
  expect(requeueWrites.length).toBe(1);
  const [id, minAttempts, ceiling] = requeueWrites[0] as [string, number, number];
  expect(id).toBe("m1");
  expect(minAttempts).toBe(5);
  expect(ceiling).toBe(30);
});

test("a failed re-enqueue restores the counter so the reaper still sees it", async () => {
  const { batch, state } = createBatch();
  const writes: unknown[][] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        const stmt = {
          bound: [] as unknown[],
          bind(...args: unknown[]) {
            stmt.bound = args;
            return stmt;
          },
          async run() {
            if (sql.includes("SET attempt = 1, status='PENDING'")) {
              return { success: true, meta: { changes: 1 } };
            }
            if (sql.includes("SET attempt = ?2")) {
              writes.push(stmt.bound);
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          },
          async first<T>() {
            return { status: "PENDING", attempt: 5, lock_id: null } as unknown as T;
          },
        };
        return stmt;
      },
    },
    PARSE_QUEUE_MAX_ATTEMPTS: "5",
    PARSE_QUEUE: {
      send: async () => {
        throw new Error("queue send failed");
      },
    },
  } as any;

  await handleQueue(batch, env, {} as any);
  // the reset is rolled back to the ceiling so the TTL sweep can reclaim the row
  expect(writes.length).toBe(1);
  expect(writes[0][1]).toBe(30);
  expect(state.retry).toBe(0);
});

test("a row past the hard ceiling is FAILED instead of requeued forever", async () => {
  const { batch, state } = createBatch();
  const failedWrites: unknown[][] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        const stmt = {
          bound: [] as unknown[],
          bind(...args: unknown[]) {
            stmt.bound = args;
            return stmt;
          },
          async run() {
            if (sql.includes("status='FAILED'")) failedWrites.push(stmt.bound);
            return { success: true, meta: { changes: 0 } };
          },
          async first<T>() {
            // attempt is at the ceiling: 5 per cycle × 6 cycles
            return { status: "PENDING", attempt: 30, lock_id: null } as unknown as T;
          },
        };
        return stmt;
      },
    },
    PARSE_QUEUE_MAX_ATTEMPTS: "5",
    PARSE_QUEUE: {
      send: async () => {
        throw new Error("must not requeue a message past the ceiling");
      },
    },
  } as any;

  await handleQueue(batch, env, {} as any);
  // The sweep also writes FAILED rows, so match on this specific reason.
  const exhaustedWrites = failedWrites.filter((args) => String(args[1]).includes("retry exhausted"));
  expect(exhaustedWrites.length).toBe(1);
  expect(exhaustedWrites[0][0]).toBe("m1");
  expect(state.ack).toBe(1);
  expect(state.retry).toBe(0);
});