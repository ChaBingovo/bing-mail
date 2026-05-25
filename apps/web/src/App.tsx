import DOMPurify from "dompurify";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onMount,
} from "solid-js";

type MessageMeta = {
  id: string;
  status?: "PENDING" | "SUCCESS";
  fromName?: string | null;
  fromAddress?: string | null;
  subject?: string | null;
  snippet?: string | null;
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

function formatTime(ts: number | undefined) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function extractCode(text: string | null | undefined) {
  if (!text) return null;
  const m = text.match(/\b\d{4,8}\b/);
  return m ? m[0] : null;
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

  const activeCode = createMemo(() => extractCode(detail()?.snippet || detail()?.subject));

  onMount(() => {
    const savedMailbox = localStorage.getItem("bingmail.mailbox") || "";
    const savedMsg = localStorage.getItem("bingmail.selected") || "";
    if (savedMailbox) setMailboxAddress(savedMailbox);
    if (savedMsg) setSelectedId(savedMsg);
  });

  createEffect(() => {
    localStorage.setItem("bingmail.mailbox", mailboxAddress());
  });

  createEffect(() => {
    const v = selectedId() || "";
    localStorage.setItem("bingmail.selected", v);
  });

  return (
    <div class="h-dvh w-full overflow-hidden">
      <div class="grid h-full grid-cols-[260px_420px_1fr] gap-0 border-zinc-800">
        <aside class="h-full border-r border-zinc-800 bg-zinc-950/60 p-4">
          <div class="flex items-baseline justify-between">
            <div class="text-sm font-semibold tracking-wide text-zinc-100">Bingmail</div>
            <button
              class="rounded-md bg-white/5 px-2 py-1 text-xs text-zinc-200 hover:bg-white/10"
              onClick={() => refetchMessages()}
            >
              刷新
            </button>
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
                    class="w-full truncate rounded-md px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/5"
                    classList={{ "bg-white/10": addr === mailboxAddress() }}
                    onClick={() => setMailboxAddress(addr)}
                  >
                    {addr}
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
                  const code = extractCode(m.snippet || m.subject);
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
                          <span class="shrink-0 rounded-md bg-indigo-500/15 px-2 py-0.5 text-xs font-semibold text-indigo-200">
                            {code}
                          </span>
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
                      <Show when={activeCode()}>
                        <span class="rounded-md bg-indigo-500/15 px-2 py-0.5 font-semibold text-indigo-200">
                          {activeCode()}
                        </span>
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
