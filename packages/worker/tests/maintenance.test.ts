import { expect, test } from "bun:test";
import { cleanupExpiredMail, handleScheduled } from "../src/handlers/maintenance";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

type Row = { id: string; r2_raw_key: string | null; html_r2_key: string | null };

function createEnv(
  opts: {
    setting?: string | null;
    envRetention?: string;
    rows?: Row[];
    sentChanges?: number;
    failDelete?: boolean;
    failBatch?: boolean;
  } = {},
) {
  const deletes: string[][] = [];
  const batches: string[][] = [];
  const allCalls: { sql: string; bindings: unknown[] }[] = [];

  const db = {
    prepare(sql: string) {
      const stmt = {
        _bindings: [] as unknown[],
        sql,
        bind(...args: unknown[]) {
          stmt._bindings = args;
          return stmt;
        },
        async first<T>() {
          if (sql.includes("FROM app_settings")) {
            return (opts.setting === undefined || opts.setting === null
              ? null
              : { value: opts.setting }) as unknown as T;
          }
          return null as unknown as T;
        },
        async all<T>() {
          allCalls.push({ sql, bindings: stmt._bindings });
          if (sql.includes("FROM messages WHERE received_at")) {
            return { results: (opts.rows ?? []) as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: { changes: opts.sentChanges ?? 0 } };
        },
      };
      return stmt;
    },
    async batch(statements: { sql: string }[]) {
      if (opts.failBatch) throw new Error("d1 batch failed");
      batches.push(statements.map((s) => s.sql));
      return [];
    },
  };

  const env = {
    DB: db,
    MAIL_BUCKET: {
      async delete(keys: string | string[]) {
        if (opts.failDelete) throw new Error("r2 unavailable");
        deletes.push(Array.isArray(keys) ? keys : [keys]);
      },
    },
    ...(opts.envRetention === undefined ? {} : { MAIL_RETENTION_DAYS: opts.envRetention }),
  } as any;

  return { env, deletes, batches, allCalls };
}

test("a retention of 0 keeps everything and touches nothing", async () => {
  const { env, deletes, batches } = createEnv({ setting: "0", rows: [{ id: "m1", r2_raw_key: "raw/m1", html_r2_key: null }] });
  const result = await cleanupExpiredMail(env, NOW);
  expect(result.retentionDays).toBe(0);
  expect(result).toEqual({ retentionDays: 0, messages: 0, sentMessages: 0, r2Objects: 0 });
  expect(deletes.length).toBe(0);
  expect(batches.length).toBe(0);
});

test("expired mail is removed with its R2 objects, FTS rows and sent history", async () => {
  const rows: Row[] = [
    { id: "m1", r2_raw_key: "raw/m1.eml", html_r2_key: "archive/html/m1.html" },
    { id: "m2", r2_raw_key: "raw/m2.eml", html_r2_key: null },
  ];
  const { env, deletes, batches } = createEnv({ setting: "30", rows, sentChanges: 2 });

  const result = await cleanupExpiredMail(env, NOW);

  expect(result.retentionDays).toBe(30);
  expect(result.messages).toBe(2);
  expect(result.r2Objects).toBe(3);
  expect(result.sentMessages).toBe(2);
  // One R2 delete call carrying only the keys that exist.
  expect(deletes).toEqual([["raw/m1.eml", "archive/html/m1.html", "raw/m2.eml"]]);
  expect(batches.length).toBe(1);
  expect(batches[0].length).toBe(4);
  expect(batches[0][0]).toContain("DELETE FROM messages_fts");
  expect(batches[0][1]).toContain("DELETE FROM messages");
});

test("the cutoff is derived from the retention window and the batch is bounded", async () => {
  const { env, allCalls } = createEnv({ setting: "7", rows: [] });
  await cleanupExpiredMail(env, NOW);
  const select = allCalls.find((call) => call.sql.includes("FROM messages WHERE received_at"));
  expect(select?.bindings[0]).toBe(NOW - 7 * DAY);
  expect(select?.bindings[1]).toBe(200);
});

test("an R2 failure keeps the rows so the next run retries", async () => {
  const rows: Row[] = [{ id: "m1", r2_raw_key: "raw/m1.eml", html_r2_key: null }];
  const { env, batches } = createEnv({ setting: "30", rows, failDelete: true });
  const result = await cleanupExpiredMail(env, NOW);
  expect(result.messages).toBe(0);
  expect(result.r2Objects).toBe(0);
  expect(batches.length).toBe(0);
});

test("MAIL_RETENTION_DAYS is used when no database setting exists", async () => {
  const { env } = createEnv({ setting: null, envRetention: "7", rows: [] });
  const result = await cleanupExpiredMail(env, NOW);
  expect(result.retentionDays).toBe(7);
});

test("a missing or unparsable setting falls back to the default window", async () => {
  const missing = createEnv({ rows: [] });
  expect((await cleanupExpiredMail(missing.env, NOW)).retentionDays).toBe(90);

  const junk = createEnv({ setting: "not-a-number", rows: [] });
  expect((await cleanupExpiredMail(junk.env, NOW)).retentionDays).toBe(90);
});

test("the scheduled entry point reports its result", async () => {
  const { env } = createEnv({ setting: "30", rows: [] });
  const result = await handleScheduled(env);
  expect(result?.retentionDays).toBe(30);
});

test("a failing sweep is swallowed so the scheduled event cannot fail", async () => {
  const rows: Row[] = [{ id: "m1", r2_raw_key: "raw/m1.eml", html_r2_key: null }];
  const { env } = createEnv({ setting: "30", rows, failBatch: true });
  expect(await handleScheduled(env)).toBeNull();
});
