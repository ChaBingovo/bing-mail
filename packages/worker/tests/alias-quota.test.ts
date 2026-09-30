import { expect, test } from "bun:test";
import { signJwt } from "../src/auth";
import { handleUserRoutes } from "../src/handlers/fetch.routes.user";
import { getMaxAliases } from "../src/handlers/fetch.shared";

const JWT_SECRET = "test-secret";

function createDb(maxAliases: string | null) {
  const inserts: string[] = [];
  return {
    inserts,
    prepare(sql: string) {
      const stmt = {
        bind: () => stmt,
        async first<T>() {
          if (sql.includes("FROM app_settings")) {
            return (maxAliases === null ? null : { value: maxAliases }) as unknown as T;
          }
          if (sql.includes("FROM mailboxes WHERE user_id")) {
            return { id: "mb1", address: "me@example.test" } as unknown as T;
          }
          if (sql.includes("FROM mailboxes WHERE address")) return null as unknown as T;
          if (sql.includes("FROM mailbox_aliases WHERE address")) return null as unknown as T;
          if (sql.includes("COUNT(1) AS c")) return { c: 0 } as unknown as T;
          if (sql.includes("FROM domains")) return { ok: 1 } as unknown as T;
          throw new Error(`unexpected sql: ${sql}`);
        },
        async run() {
          inserts.push(sql);
          return { success: true, meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
}

async function addAlias(maxAliases: string | null) {
  const db = createDb(maxAliases);
  const token = await signJwt({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 }, JWT_SECRET);
  const req = new Request("https://mail.example.test/api/user/aliases", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `bingmail_session=${encodeURIComponent(token)}`,
    },
    body: JSON.stringify({ local: "shopping", domain: "example.test" }),
  });
  const env = { JWT_SECRET, DB: db } as any;
  const res = await handleUserRoutes(req, env, new URL(req.url), "/api/user/aliases");
  return { res, db };
}

test("max_aliases = 0 disables new aliases instead of silently allowing 3", async () => {
  const { res, db } = await addAlias("0");
  expect(res?.status).toBe(409);
  expect(((await res!.json()) as { error: string }).error).toBe("max_aliases_reached");
  expect(db.inserts.some((sql) => sql.includes("INSERT INTO mailbox_aliases"))).toBe(false);
});

test("a positive quota still allows alias creation", async () => {
  const { res } = await addAlias("3");
  expect(res?.status).toBe(201);
});

test("an unset or unparsable quota falls back to the documented default of 3", async () => {
  const env = { DB: createDb(null) } as any;
  expect(await getMaxAliases(env)).toBe(3); // unset

  const bad = { DB: createDb("lots") } as any;
  expect(await getMaxAliases(bad)).toBe(3);

  const zero = { DB: createDb("0") } as any;
  expect(await getMaxAliases(zero)).toBe(0);
});