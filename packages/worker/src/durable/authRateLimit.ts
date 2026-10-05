type CounterState = {
  count: number;
  resetAt: number;
};

function toInt(raw: unknown, fallback: number) {
  const n = Number(typeof raw === "string" ? raw.trim() : raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i <= 0) return fallback;
  return i;
}

export class AuthRateLimitDO {
  private state: DurableObjectState;
  private limit: number;
  private windowMs: number;

  constructor(state: DurableObjectState, env: Record<string, unknown>) {
    this.state = state;
    this.limit = toInt(env.LOGIN_FAIL_LIMIT, 5);
    this.windowMs = toInt(env.LOGIN_FAIL_WINDOW_MS, 10 * 60 * 1000);
  }

  /**
   * Per-request overrides let one DO class serve both login throttling (its
   * constructor defaults, keyed per user/IP) and the outbound send quota (a longer
   * window under a `send:` key). Invalid values fall back to the constructor.
   */
  private config(url: URL) {
    const windowMs = toInt(url.searchParams.get("windowMs"), this.windowMs);
    const limit = toInt(url.searchParams.get("limit"), this.limit);
    return { windowMs, limit };
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    const { windowMs, limit } = this.config(url);

    if (url.pathname === "/check") {
      const { state } = await this.state.storage.transaction(async (tx) => {
        const now = Date.now();
        const current = (await tx.get<CounterState>("c")) || { count: 0, resetAt: 0 };
        if (current.resetAt <= now) {
          const next = { count: 0, resetAt: now + windowMs };
          await tx.put("c", next);
          return { state: next };
        }
        return { state: current };
      });
      const limited = state.count >= limit;
      return Response.json({ limited, count: state.count, limit, resetAt: state.resetAt });
    }

    if (url.pathname === "/fail") {
      const { state } = await this.state.storage.transaction(async (tx) => {
        const now = Date.now();
        const current = (await tx.get<CounterState>("c")) || { count: 0, resetAt: 0 };
        const base = current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
        const next = { count: base.count + 1, resetAt: base.resetAt };
        await tx.put("c", next);
        return { state: next };
      });
      const limited = state.count >= limit;
      return Response.json({ limited, count: state.count, limit, resetAt: state.resetAt });
    }

    if (url.pathname === "/reset") {
      await this.state.storage.put("c", { count: 0, resetAt: Date.now() + windowMs } satisfies CounterState);
      return Response.json({ ok: true });
    }

    return new Response("not found", { status: 404 });
  }
}
