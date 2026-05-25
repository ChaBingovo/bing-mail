import DOMPurify from "dompurify";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

type MessageMeta = {
  id: string;
  status?: "PENDING" | "SUCCESS";
  fromName?: string | null;
  fromAddress?: string | null;
  subject?: string | null;
  snippet?: string | null;
  aiCode?: string | null;
  aiService?: string | null;
  receivedAt?: number;
};

type MessageDetail = {
  id: string;
  status: "PENDING" | "SUCCESS";
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: number;
  parsedAt: number | null;
  hasHtml: boolean;
  aiCode: string | null;
  aiService: string | null;
};

async function apiJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

async function apiText(path: string): Promise<string> {
  const res = await fetch(path);
  if (res.status === 204) return "";
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

type RedDotResponse = {
  address: string;
  since: number;
  newCount: number;
  latestReceivedAt: number | null;
  latestNewReceivedAt: number | null;
};

function formatTime(ts: number | undefined) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function ShadowHtml(props: { html: string }) {
  let host!: HTMLDivElement;
  let root: ShadowRoot | null = null;

  createEffect(() => {
    const value = props.html || "";
    if (!root) root = host.attachShadow({ mode: "open" });
    const safe = DOMPurify.sanitize(value, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "style", "link", "meta"],
      FORBID_ATTR: ["onload", "onclick", "onerror"],
    });
    root.innerHTML = safe;
  });

  return <div ref={host} class="h-full w-full overflow-auto rounded-lg bg-white/5" />;
}

export default function App() {
  const [mailboxAddress, setMailboxAddress] = createSignal("");
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [isVisible, setIsVisible] = createSignal(typeof document !== "undefined" ? !document.hidden : true);
  const [unseenByMailbox, setUnseenByMailbox] = createSignal<Record<string, number>>({});

  const currentUnseen = createMemo(() => {
    const addr = mailboxAddress();
    if (!addr) return 0;
    return unseenByMailbox()[addr] ?? 0;
  });

  const [mailboxes] = createResource(async () => {
    const data = await apiJson<{ mailboxes: string[] }>("/api/mailboxes");
    return data.mailboxes;
  });

  const [messages, { refetch: refetchMessages }] = createResource(
    mailboxAddress,
    async (address) => {
      if (!address) return [];
      const data = await apiJson<{ messages: MessageMeta[] }>(
        `/api/mailboxes/${encodeURIComponent(address)}/messages?limit=100`,
      );
      return data.messages;
    },
  );

  const [detail] = createResource(selectedId, async (id) => {
    if (!id) return null;
    const data = await apiJson<{ message: MessageDetail }>(`/api/messages/${encodeURIComponent(id)}`);
    return data.message;
  });

  const [html] = createResource(selectedId, async (id) => {
    if (!id) return "";
    return apiText(`/api/messages/${encodeURIComponent(id)}/html`);
  });

  onMount(() => {
    const savedMailbox = localStorage.getItem("bingmail.mailbox") || "";
    const savedMsg = localStorage.getItem("bingmail.selected") || "";
    if (savedMailbox) setMailboxAddress(savedMailbox);
    if (savedMsg) setSelectedId(savedMsg);

    const onVis = () => setIsVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  });

  createEffect(() => {
    localStorage.setItem("bingmail.mailbox", mailboxAddress());
  });

  createEffect(() => {
    const v = selectedId() || "";
    localStorage.setItem("bingmail.selected", v);
  });

  function lastSeenKey(address: string) {
    return `bingmail.lastSeen.${address}`;
  }

  function getLastSeen(address: string) {
    return Math.max(Number(localStorage.getItem(lastSeenKey(address)) || "0") || 0, 0);
  }

  function setLastSeen(address: string, ts: number) {
    localStorage.setItem(lastSeenKey(address), String(Math.max(ts || 0, 0)));
  }

  function setUnseen(address: string, count: number) {
    setUnseenByMailbox((m) => ({ ...m, [address]: Math.max(count || 0, 0) }));
  }

  createEffect(() => {
    const addr = mailboxAddress();
    const list = messages() || [];
    if (!addr || !isVisible() || list.length === 0) return;
    const max = list.reduce((acc, m) => Math.max(acc, m.receivedAt || 0), 0);
    if (!max) return;
    if (max > getLastSeen(addr)) setLastSeen(addr, max);
    setUnseen(addr, 0);
  });

  createEffect(() => {
    const addr = mailboxAddress();
    if (!addr) return;

    let stopped = false;
    let ws: WebSocket | null = null;
    let wsReady = false;
    let timer: number | null = null;
    let backoffMs = 0;
    let inflight = false;
    let queued = false;
    let lastRefetchAt = 0;

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${location.host}/api/ws/mailboxes/${encodeURIComponent(addr)}`;

    const baseInterval = () => {
      if (!isVisible()) return 20000;
      if (wsReady) return 30000;
      return 4000;
    };

    const schedule = (delayMs: number) => {
      if (stopped) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void poll("timer");
      }, Math.max(delayMs, 0));
    };

    const poll = async (_reason: "timer" | "ws" | "focus") => {
      if (stopped) return;
      if (inflight) {
        queued = true;
        return;
      }
      inflight = true;

      const since = getLastSeen(addr);
      try {
        const data = await apiJson<RedDotResponse>(
          `/api/mailboxes/${encodeURIComponent(addr)}/red-dot?since=${encodeURIComponent(String(since))}`,
        );
        backoffMs = 0;
        setUnseen(addr, data.newCount);
        if (data.newCount > 0 && isVisible()) {
          const now = Date.now();
          if (now - lastRefetchAt > 800) {
            lastRefetchAt = now;
            refetchMessages();
          }
        }
      } catch {
        backoffMs = Math.min(backoffMs ? backoffMs * 2 : 1500, 30000);
      } finally {
        inflight = false;
        if (queued) {
          queued = false;
          void poll("timer");
          return;
        }
        schedule(baseInterval() + backoffMs);
      }
    };

    const connectWs = () => {
      if (stopped || !isVisible()) return;
      if (ws) return;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        ws = null;
        schedule(baseInterval() + 1500);
        return;
      }

      ws.onopen = () => {
        wsReady = true;
        backoffMs = 0;
        schedule(50);
      };
      ws.onmessage = (evt) => {
        if (typeof evt.data !== "string") return;
        if (evt.data === "pong") return;
        try {
          const msg = JSON.parse(evt.data) as { type?: string };
          if (msg?.type === "hint") schedule(120);
        } catch {}
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {}
      };
      ws.onclose = () => {
        wsReady = false;
        ws = null;
        backoffMs = Math.min(backoffMs ? backoffMs * 2 : 1500, 30000);
        schedule(baseInterval() + backoffMs);
      };
    };

    connectWs();
    schedule(80);

    createEffect(() => {
      const visible = isVisible();
      if (!visible) {
        try {
          ws?.close();
        } catch {}
        ws = null;
        wsReady = false;
        schedule(baseInterval());
        return;
      }
      connectWs();
      schedule(50);
    });

    onCleanup(() => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      try {
        ws?.close();
      } catch {}
      ws = null;
    });
  });

  createEffect(() => {
    const list = mailboxes() || [];
    if (!isVisible() || list.length === 0) return;

    let stopped = false;
    let timer: number | null = null;
    let backoffMs = 0;

    const targets = () => list.slice(0, 10);

    const tick = async () => {
      if (stopped) return;
      try {
        const addrs = targets();
        await Promise.all(
          addrs.map(async (addr) => {
            const since = getLastSeen(addr);
            const data = await apiJson<RedDotResponse>(
              `/api/mailboxes/${encodeURIComponent(addr)}/red-dot?since=${encodeURIComponent(String(since))}`,
            );
            setUnseen(addr, data.newCount);
          }),
        );
        backoffMs = 0;
      } catch {
        backoffMs = Math.min(backoffMs ? backoffMs * 2 : 2000, 30000);
      } finally {
        if (stopped) return;
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(tick, 20000 + backoffMs);
      }
    };

    void tick();

    onCleanup(() => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    });
  });

  return (
    <div class="h-dvh w-full overflow-hidden">
      <div class="grid h-full grid-cols-[260px_420px_1fr] gap-0 border-zinc-800">
        <aside class="h-full border-r border-zinc-800 bg-zinc-950/60 p-4">
          <div class="flex items-baseline justify-between">
            <div class="text-sm font-semibold tracking-wide text-zinc-100">Bingmail</div>
            <div class="flex items-baseline gap-2">
              <Show when={currentUnseen() > 0}>
                <div class="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-200">
                  {currentUnseen()}
                </div>
              </Show>
              <button
                class="rounded-md bg-white/5 px-2 py-1 text-xs text-zinc-200 hover:bg-white/10"
                onClick={() => refetchMessages()}
              >
                刷新
              </button>
            </div>
          </div>

          <div class="mt-4">
            <div class="text-xs font-medium text-zinc-400">收件箱地址</div>
            <input
              value={mailboxAddress()}
              onInput={(e) => setMailboxAddress(e.currentTarget.value.trim().toLowerCase())}
              placeholder="you@example.com"
              class="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
          </div>

          <Show when={(mailboxes() || []).length > 0}>
            <div class="mt-5 text-xs font-medium text-zinc-400">白名单</div>
            <div class="mt-2 space-y-1">
              <For each={mailboxes() || []}>
                {(addr) => (
                  <button
                    class="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/5"
                    classList={{ "bg-white/10": addr === mailboxAddress() }}
                    onClick={() => setMailboxAddress(addr)}
                  >
                    <div class="flex items-baseline justify-between gap-2">
                      <div class="min-w-0 flex-1 truncate">{addr}</div>
                      <Show when={(unseenByMailbox()[addr] ?? 0) > 0}>
                        <div class="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-200">
                          {unseenByMailbox()[addr] ?? 0}
                        </div>
                      </Show>
                    </div>
                  </button>
                )}
              </For>
            </div>
          </Show>

          <div class="mt-6 text-xs text-zinc-500">
            <div>搜索：/api/search?address=...&q=...</div>
          </div>
        </aside>

        <section class="h-full border-r border-zinc-800 bg-zinc-950 p-2">
          <div class="px-2 py-2 text-xs font-medium text-zinc-400">
            <Show when={mailboxAddress()} fallback={"请选择收件箱"}>
              {mailboxAddress()}
            </Show>
          </div>

          <div class="h-[calc(100%-36px)] overflow-auto px-2 pb-4">
            <Show when={messages.state === "ready"} fallback={<div class="text-sm text-zinc-500">加载中…</div>}>
              <For each={messages() || []}>
                {(m) => {
                  const code = m.aiCode;
                  const service = m.aiService;
                  return (
                    <button
                      class="mt-2 w-full rounded-lg border border-white/5 bg-white/0 px-3 py-3 text-left hover:bg-white/5"
                      classList={{ "bg-white/10": selectedId() === m.id }}
                      onClick={() => setSelectedId(m.id)}
                    >
                      <div class="flex items-baseline justify-between gap-2">
                        <div class="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">
                          {m.subject || "(无主题)"}
                        </div>
                        <div class="shrink-0 text-xs text-zinc-500">{formatTime(m.receivedAt)}</div>
                      </div>
                      <div class="mt-1 flex items-baseline justify-between gap-2">
                        <div class="min-w-0 flex-1 truncate text-xs text-zinc-400">
                          {m.fromName || m.fromAddress || ""}
                        </div>
                        <Show when={code}>
                          <div class="shrink-0 flex items-baseline gap-1">
                            <Show when={service}>
                              <span class="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-200">
                                {service}
                              </span>
                            </Show>
                            <span
                              class="rounded-md bg-indigo-500/15 px-2 py-0.5 text-xs font-semibold text-indigo-200"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (code) void navigator.clipboard?.writeText(code);
                              }}
                            >
                              {code}
                            </span>
                          </div>
                        </Show>
                      </div>
                      <Show when={m.snippet}>
                        <div class="mt-2 max-h-10 overflow-hidden text-ellipsis text-xs leading-relaxed text-zinc-500">
                          {m.snippet}
                        </div>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </Show>
          </div>
        </section>

        <main class="h-full bg-zinc-950 p-4">
          <Show when={detail()} fallback={<div class="text-sm text-zinc-500">选择一封邮件查看详情</div>}>
            {(d) => (
              <div class="flex h-full flex-col gap-4">
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <div class="truncate text-base font-semibold text-zinc-100">
                      {d().subject || "(无主题)"}
                    </div>
                    <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                      <div class="text-zinc-400">{d().fromName || d().fromAddress || ""}</div>
                      <div class="text-zinc-600">{formatTime(d().receivedAt)}</div>
                      <Show when={d().aiCode}>
                        <div class="flex items-baseline gap-1">
                          <Show when={d().aiService}>
                            <span class="rounded-md bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-200">
                              {d().aiService}
                            </span>
                          </Show>
                          <span class="rounded-md bg-indigo-500/15 px-2 py-0.5 font-semibold text-indigo-200">
                            {d().aiCode}
                          </span>
                        </div>
                      </Show>
                      <Show when={d().status !== "SUCCESS"}>
                        <span class="rounded-md bg-amber-500/15 px-2 py-0.5 font-medium text-amber-200">
                          解析中
                        </span>
                      </Show>
                    </div>
                  </div>
                </div>

                <Show when={d().status === "SUCCESS"} fallback={<div class="text-sm text-zinc-500">等待解析完成…</div>}>
                  <Show
                    when={d().hasHtml && html()}
                    fallback={
                      <div class="whitespace-pre-wrap rounded-lg bg-white/5 p-4 text-sm leading-relaxed text-zinc-200">
                        {d().snippet || ""}
                      </div>
                    }
                  >
                    <ShadowHtml html={html() || ""} />
                  </Show>
                </Show>
              </div>
            )}
          </Show>
        </main>
      </div>
    </div>
  );
}
