import { expect, test } from "bun:test";
import { SWEEP_SQL, handleQueue } from "../src/handlers/queue";

type Run = { sql: string; args: unknown[] };

/** Records every UPDATE so the assertions can inspect the guard conditions. */
function createDb(opts: { sweepChanges?: number } = {}) {
  const runs: Run[] = [];
  return {
    runs,
    prepare(sql: string) {
      const stmt = {
        bound: [] as unknown[],
        bind(...args: unknown[]) {
          stmt.bound = args;
          return stmt;
        },
        async run() {
          runs.push({ sql, args: stmt.bound });
          if (sql.includes("status='FAILED'")) {
            return { success: true, meta: { changes: opts.sweepChanges ?? 0 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
        async first() {
          return null;
        },
      };
      return stmt;
    },
  };
}

function createBatch() {
  const state = { ack: 0, retry: 0 };
  return {
    state,
    batch: {
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
    } as any,
  };
}

const ENV = { PARSE_QUEUE_MAX_ATTEMPTS: "5", PARSE_QUEUE_LOCK_TTL_MS: "60000" } as const;

test("the sweep only targets abandoned or retry-exhausted PENDING rows", () => {
  expect(SWEEP_SQL).toContain("status='PENDING'");
  // lock expired long ago → the consumer that held it is gone
  expect(SWEEP_SQL).toContain("lock_id IS NOT NULL AND locked_at < ?1");
  // retry budget exhausted → the claim guard refuses these forever
  expect(SWEEP_SQL).toContain("attempt >= ?2 AND received_at < ?3");
  // rows are cleared so a future retry can claim them again
  expect(SWEEP_SQL).toContain("lock_id=NULL");
  expect(SWEEP_SQL).toContain("parsed_at=NULL");
  // an in-flight parse must never be touched: the condition is strict <
  expect(SWEEP_SQL).not.toContain("locked_at <=");
});

test("each batch sweeps before processing, with the TTL-derived cutoffs", async () => {
  const db = createDb();
  const { batch } = createBatch();
  const before = Date.now();
  await handleQueue(batch, { ...ENV, DB: db } as any, {} as any);
  const after = Date.now();

  const sweep = db.runs.find((r) => r.sql === SWEEP_SQL);
  expect(sweep).toBeTruthy();
  expect(sweep!.args.length).toBe(3);

  const [lockCutoff, maxAttempts, attemptCutoff] = sweep!.args as [number, number, number];
  expect(maxAttempts).toBe(5);
  // TTL is 60s: a lock older than that counts as abandoned (~= now - 60s)
  expect(lockCutoff).toBeGreaterThanOrEqual(before - 60_000 - 50);
  expect(lockCutoff).toBeLessThanOrEqual(after - 60_000 + 50);
  // the retry-exhausted branch is deliberately more conservative: an even older cutoff
  expect(attemptCutoff).toBeLessThan(lockCutoff);
  expect(attemptCutoff).toBeGreaterThanOrEqual(before - 360_000 - 50);
  expect(attemptCutoff).toBeLessThanOrEqual(after - 360_000 + 50);
});

test("a failing sweep is swallowed so real parsing still runs", async () => {
  const db = {
    prepare() {
      return {
        bind() {
          return this;
        },
        async run() {
          throw new Error("d1 unavailable");
        },
        async first() {
          return null;
        },
      };
    },
  };
  const { batch, state } = createBatch();
  await handleQueue(batch, { ...ENV, DB: db } as any, {} as any);
  // the claim then reports "row not ready" → retry, which proves the batch ran
  expect(state.retry).toBe(1);
});

test("a sweep that reaps rows still lets the batch proceed", async () => {
  const db = createDb({ sweepChanges: 3 });
  const { batch, state } = createBatch();
  await handleQueue(batch, { ...ENV, DB: db } as any, {} as any);
  expect(state.retry).toBe(1);
  expect(state.ack).toBe(0);
});