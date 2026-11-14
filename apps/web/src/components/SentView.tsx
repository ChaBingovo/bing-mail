import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import type { ApiClient } from "../services/api";
import type { SentMessage } from "../types";
import { formatTime } from "../utils/format";

type SentFilter = "ALL" | "SENT" | "FAILED";

export function SentView(props: {
  api: ApiClient;
  onResend: (item: SentMessage) => void;
  onNewCompose: () => void;
}) {
  const [filter, setFilter] = createSignal<SentFilter>("ALL");
  const [query, setQuery] = createSignal("");
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [copiedId, setCopiedId] = createSignal("");

  const [sent, { refetch }] = createResource(async () => {
    return props.api.apiJson<{ messages: SentMessage[] }>("/api/user/sent?limit=100");
  });

  const counts = createMemo(() => {
    const items = sent()?.messages || [];
    let okCount = 0;
    let failCount = 0;
    for (const item of items) {
      if (item.status === "SENT") okCount += 1;
      else if (item.status === "FAILED") failCount += 1;
    }
    return { all: items.length, sent: okCount, failed: failCount };
  });

  const filtered = createMemo(() => {
    const items = sent()?.messages || [];
    const f = filter();
    const q = query().trim().toLowerCase();
    return items.filter((item) => {
      if (f !== "ALL" && item.status !== f) return false;
      if (!q) return true;
      const hay = `${item.subject || ""} ${item.toAddress} ${item.fromAddress} ${item.snippet || ""}`.toLowerCase();
      return hay.includes(q);
    });
  });

  const activeItem = createMemo(() => {
    const list = filtered();
    const id = selectedId();
    if (!id) return list[0] || null;
    return list.find((item) => item.id === id) || list[0] || null;
  });

  const copyTo = async (item: SentMessage) => {
    try {
      await navigator.clipboard.writeText(item.toAddress);
      setCopiedId(item.id);
      setTimeout(() => {
        if (copiedId() === item.id) setCopiedId("");
      }, 1500);
    } catch {}
  };

  return (
    <div class="grid h-full grid-cols-[440px_1fr] gap-0">
      <section class="flex h-full flex-col border-r border-white/10 bg-white/0 p-3">
        <div class="flex items-center justify-between gap-2 px-1 py-1">
          <div class="text-sm font-semibold text-zinc-100">已发邮件</div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="spring-colors rounded-xl bg-white/5 px-2.5 py-1 text-xs font-semibold text-zinc-300 hover:bg-white/10"
              onClick={() => void refetch()}
            >
              刷新
            </button>
            <button
              type="button"
              class="spring-colors pressable rounded-xl bg-indigo-500/20 px-2.5 py-1 text-xs font-semibold text-indigo-100 hover:bg-indigo-500/30"
              onClick={props.onNewCompose}
            >
              写邮件
            </button>
          </div>
        </div>

        <div class="mt-2 px-1">
          <input
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="搜索收件人、主题或内容…"
            class="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>

        <div class="mt-2 px-1">
          <div class="inline-flex w-full rounded-xl border border-white/10 bg-white/5 p-0.5 text-xs">
            <button
              type="button"
              class="spring-colors flex-1 rounded-lg px-2 py-1 font-medium text-zinc-400 hover:text-zinc-200"
              classList={{ "bg-white/10 text-zinc-100": filter() === "ALL" }}
              onClick={() => setFilter("ALL")}
            >
              全部 ({counts().all})
            </button>
            <button
              type="button"
              class="spring-colors flex-1 rounded-lg px-2 py-1 font-medium text-zinc-400 hover:text-zinc-200"
              classList={{ "bg-white/10 text-zinc-100": filter() === "SENT" }}
              onClick={() => setFilter("SENT")}
            >
              已发送 ({counts().sent})
            </button>
            <button
              type="button"
              class="spring-colors flex-1 rounded-lg px-2 py-1 font-medium text-zinc-400 hover:text-zinc-200"
              classList={{ "bg-white/10 text-zinc-100": filter() === "FAILED" }}
              onClick={() => setFilter("FAILED")}
            >
              失败 ({counts().failed})
            </button>
          </div>
        </div>

        <div class="mt-2 flex-1 overflow-auto px-1 pb-4">
          <Show when={!sent.loading} fallback={<div class="px-2 py-4 text-sm text-zinc-500">加载中…</div>}>
            <Show
              when={filtered().length > 0}
              fallback={
                <div class="px-2 py-6 text-sm text-zinc-500">
                  {filter() === "ALL" && !query().trim() ? "还没有发送记录。" : "当前筛选下暂无记录。"}
                </div>
              }
            >
              <For each={filtered()}>
                {(item) => {
                  const selected = () => activeItem()?.id === item.id;
                  return (
                    <button
                      type="button"
                      class="pressable spring-colors mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-left hover:bg-white/10"
                      classList={{ "bg-white/10 border-white/20": selected() }}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <div class="flex items-baseline justify-between gap-2">
                        <div class="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">
                          {item.subject || "(无主题)"}
                        </div>
                        <div class="shrink-0 text-xs text-zinc-500">{formatTime(item.sentAt)}</div>
                      </div>
                      <div class="mt-1 flex items-center justify-between gap-2 text-xs text-zinc-400">
                        <span class="truncate">发给 {item.toAddress}</span>
                        <Show
                          when={item.status === "FAILED"}
                          fallback={
                            <span class="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-200">
                              已发送
                            </span>
                          }
                        >
                          <span class="shrink-0 rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-medium text-rose-200">
                            失败
                          </span>
                        </Show>
                      </div>
                      <Show when={item.snippet}>
                        <div class="mt-2 max-h-10 overflow-hidden text-ellipsis text-xs leading-relaxed text-zinc-500">
                          {item.snippet}
                        </div>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </Show>
          </Show>
        </div>
      </section>

      <main class="h-full overflow-auto bg-white/0 p-6">
        <Show
          when={activeItem()}
          fallback={<div class="text-sm text-zinc-500">选择一封已发送邮件查看记录详情</div>}
        >
          {(item) => (
            <div class="mx-auto max-w-3xl space-y-5">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div class="min-w-0">
                  <div class="text-lg font-semibold text-zinc-100">{item().subject || "(无主题)"}</div>
                  <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span>{formatTime(item().sentAt)}</span>
                    <Show
                      when={item().status === "FAILED"}
                      fallback={
                        <span class="rounded-md bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-200">
                          发送成功
                        </span>
                      }
                    >
                      <span class="rounded-md bg-rose-500/15 px-2 py-0.5 font-medium text-rose-200">
                        发送失败
                      </span>
                    </Show>
                  </div>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    class="spring-colors pressable rounded-xl bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-100 hover:bg-indigo-500/30"
                    onClick={() => props.onResend(item())}
                  >
                    {item().status === "FAILED" ? "加载并重发" : "再次编辑"}
                  </button>
                  <button
                    type="button"
                    class="spring-colors pressable rounded-xl bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/10"
                    onClick={() => void copyTo(item())}
                  >
                    {copiedId() === item().id ? "已复制" : "复制收件人"}
                  </button>
                </div>
              </div>

              <div class="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
                <div class="flex gap-2">
                  <span class="w-16 shrink-0 text-zinc-500">发件人</span>
                  <span class="min-w-0 break-all text-zinc-200">{item().fromAddress}</span>
                </div>
                <div class="flex gap-2">
                  <span class="w-16 shrink-0 text-zinc-500">收件人</span>
                  <span class="min-w-0 break-all text-zinc-200">{item().toAddress}</span>
                </div>
              </div>

              <Show when={item().errorReason}>
                <div class="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-xs leading-relaxed text-rose-200">
                  <div class="font-semibold">失败原因</div>
                  <div class="mt-1 break-all">{item().errorReason}</div>
                </div>
              </Show>

              <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div class="text-xs font-medium text-zinc-500">内容摘要</div>
                <div class="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                  {item().snippet || "（无正文摘要）"}
                </div>
              </div>
            </div>
          )}
        </Show>
      </main>
    </div>
  );
}
