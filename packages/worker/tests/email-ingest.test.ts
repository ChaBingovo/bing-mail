import { expect, test } from "bun:test";
import { handleEmail } from "../src/handlers/email";

type Op = { kind: "db" | "queue" | "r2"; sql?: string };

function createHarness(opts: { failSend?: boolean } = {}) {
  const ops: Op[] = [];
  const events: string[] = [];
  let rejected: string | null = null;

  const db = {
    prepare(sql: string) {
      const stmt = {
        bind() {
          return stmt;
        },
        async first<T>() {
          if (sql.includes("FROM mailboxes WHERE address")) {
            return { id: "mb1", user_id: "u1" } as unknown as T;
          }
          if (sql.includes("FROM blocked_senders")) return null as unknown as T;
          throw new Error(`unexpected sql: ${sql}`);
        },
        async run() {
          ops.push({ kind: "db", sql });
          events.push("db-insert");
          return { success: true, meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };

  const env = {
    DB: db,
    MAIL_BUCKET: {
      async put() {
        ops.push({ kind: "r2" });
        events.push("r2-put");
      },
    },
    PARSE_QUEUE: {
      async send() {
        ops.push({ kind: "queue" });
        events.push("queue-send");
        if (opts.failSend) throw new Error("queue unavailable");
      },
    },
  } as any;

  const message = {
    to: "me@example.test",
    from: "sender@example.com",
    raw: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("Subject: hi\r\n\r\nbody"));
        controller.close();
      },
    }),
    setReject(reason: string) {
      rejected = reason;
    },
  } as any;

  const ctx = { waitUntil: (p: Promise<unknown>) => void p } as any;
  return { env, message, ctx, ops, events, getRejected: () => rejected };
}

test("the queue job is enqueued before the PENDING row is written", async () => {
  const h = createHarness();
  await handleEmail(h.message, h.env, h.ctx);
  // waitUntil runs the ingest task
  await new Promise((r) => setTimeout(r, 10));

  expect(h.events.indexOf("queue-send")).toBeGreaterThanOrEqual(0);
  expect(h.events.indexOf("db-insert")).toBeGreaterThanOrEqual(0);
  expect(h.events.indexOf("queue-send")).toBeLessThan(h.events.indexOf("db-insert"));
});

test("a failed enqueue leaves no PENDING row and asks the sender to retry", async () => {
  const h = createHarness({ failSend: true });
  await handleEmail(h.message, h.env, h.ctx);
  await new Promise((r) => setTimeout(r, 10));

  const inserted = h.ops.filter((op) => op.kind === "db" && op.sql?.includes("INSERT INTO messages"));
  expect(inserted.length).toBe(0);
  expect(h.getRejected()).toBeTruthy();
});

test("a successful ingest stores the row and does not reject the message", async () => {
  const h = createHarness();
  await handleEmail(h.message, h.env, h.ctx);
  await new Promise((r) => setTimeout(r, 10));

  const inserted = h.ops.filter((op) => op.kind === "db" && op.sql?.includes("INSERT INTO messages"));
  expect(inserted.length).toBe(1);
  expect(h.ops.some((op) => op.kind === "r2")).toBe(true);
  expect(h.getRejected()).toBeNull();
});

test("an unknown recipient is rejected before any work happens", async () => {
  const h = createHarness();
  h.env.DB = {
    prepare(sql: string) {
      const stmt = {
        bind: () => stmt,
        first: async () => null,
        run: async () => ({ success: true, meta: {} }),
      };
      return stmt;
    },
  } as any;
  await handleEmail(h.message, h.env, h.ctx);
  expect(h.getRejected()).toBeTruthy();
  expect(h.events.length).toBe(0);
});