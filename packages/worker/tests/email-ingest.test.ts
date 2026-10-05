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

test("an oversized message is rejected before any database or R2 work", async () => {
  const h = createHarness();
  // Cloudflare enforces this upstream too; the handler mirrors it so the reason is
  // explicit and an unstorable message never reaches the bucket.
  h.message.rawSize = 25 * 1024 * 1024 + 1;

  await handleEmail(h.message, h.env, h.ctx);

  expect(h.getRejected()).toBe("Message too large");
  expect(h.ops.length).toBe(0);
  expect(h.events.length).toBe(0);
});

test("a message exactly at the limit is still accepted", async () => {
  const h = createHarness();
  h.message.rawSize = 25 * 1024 * 1024;

  await handleEmail(h.message, h.env, h.ctx);

  expect(h.getRejected()).toBeNull();
  expect(h.ops.some((op) => op.kind === "r2")).toBe(true);
});

test("the queue job is enqueued before the PENDING row is written", async () => {
  const h = createHarness();
  await handleEmail(h.message, h.env, h.ctx);

  expect(h.events.indexOf("queue-send")).toBeGreaterThanOrEqual(0);
  expect(h.events.indexOf("db-insert")).toBeGreaterThanOrEqual(0);
  expect(h.events.indexOf("queue-send")).toBeLessThan(h.events.indexOf("db-insert"));
});

test("a failed enqueue leaves no PENDING row and asks the sender to retry", async () => {
  const h = createHarness({ failSend: true });
  await handleEmail(h.message, h.env, h.ctx);

  const inserted = h.ops.filter((op) => op.kind === "db" && op.sql?.includes("INSERT INTO messages"));
  expect(inserted.length).toBe(0);
  expect(h.getRejected()).toBeTruthy();
});

test("the rejection lands before handleEmail resolves, so the SMTP reply can still carry it", async () => {
  // Regression guard for the original bug: this work used to run inside
  // ctx.waitUntil(), where the 250 reply is already written by the time setReject
  // is called — the sending server would never retry and the mail was lost.
  const h = createHarness({ failSend: true });
  let rejectedWhenResolved: string | null = "sentinel";
  await handleEmail(h.message, h.env, h.ctx).then(() => {
    rejectedWhenResolved = h.getRejected();
  });

  expect(rejectedWhenResolved).toBe("Temporary failure, please retry");
});

test("no work is deferred into waitUntil anymore", async () => {
  const h = createHarness();
  const deferred: Promise<unknown>[] = [];
  h.ctx.waitUntil = (p: Promise<unknown>) => {
    deferred.push(p);
  };

  await handleEmail(h.message, h.env, h.ctx);

  // Everything that must be durable before acknowledging runs inline.
  expect(deferred.length).toBe(0);
  expect(h.events).toEqual(["r2-put", "queue-send", "db-insert"]);
});

test("a successful ingest stores the row and does not reject the message", async () => {
  const h = createHarness();
  await handleEmail(h.message, h.env, h.ctx);

  const inserted = h.ops.filter((op) => op.kind === "db" && op.sql?.includes("INSERT INTO messages"));
  expect(inserted.length).toBe(1);
  expect(h.ops.some((op) => op.kind === "r2")).toBe(true);
  expect(h.getRejected()).toBeNull();
});

test("a storage failure is also rejected synchronously", async () => {
  const h = createHarness();
  h.env.MAIL_BUCKET = {
    async put() {
      throw new Error("r2 unavailable");
    },
  };
  let rejectedWhenResolved: string | null = "sentinel";
  await handleEmail(h.message, h.env, h.ctx).then(() => {
    rejectedWhenResolved = h.getRejected();
  });

  expect(rejectedWhenResolved).toBe("Temporary failure, please retry");
  expect(h.ops.some((op) => op.kind === "queue")).toBe(false);
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