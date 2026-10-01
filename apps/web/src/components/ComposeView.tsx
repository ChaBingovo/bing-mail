import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js";
import type { ApiClient } from "../services/api";
import { formatTime } from "../utils/format";
import { DropdownSelect, type DropdownSelectOption } from "./DropdownSelect";

type SentMessage = {
  id: string;
  fromAddress: string;
  toAddress: string;
  subject: string | null;
  snippet: string | null;
  status: "SENT" | "FAILED";
  errorReason: string | null;
  sentAt: number;
};

export function ComposeView(props: { api: ApiClient; mailbox: string; aliases: string[] }) {
  const [from, setFrom] = createSignal("");
  const [to, setTo] = createSignal("");
  const [subject, setSubject] = createSignal("");
  const [body, setBody] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [ok, setOk] = createSignal("");

  const [sent, { refetch: refetchSent }] = createResource(async () => {
    return props.api.apiJson<{ messages: SentMessage[] }>("/api/user/sent?limit=30");
  });

  // The primary mailbox is the default sender; it may arrive after first render.
  createEffect(() => {
    const primary = (props.mailbox || "").trim().toLowerCase();
    if (primary && !from()) setFrom(primary);
  });

  const fromOptions = createMemo<DropdownSelectOption[]>(() => {
    const primary = (props.mailbox || "").trim().toLowerCase();
    const options: DropdownSelectOption[] = [];
    if (primary) options.push({ value: primary, label: `${primary}（主邮箱）` });
    for (const alias of props.aliases) {
      const address = (alias || "").trim().toLowerCase();
      if (address && address !== primary) options.push({ value: address, label: address });
    }
    return options;
  });

  const send = async () => {
    if (sending()) return;
    setError("");
    setOk("");
    if (!to().trim()) {
      setError("请填写收件人");
      return;
    }
    if (!body().trim()) {
      setError("请填写正文");
      return;
    }
    setSending(true);
    try {
      await props.api.apiJson("/api/user/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: from() || undefined, to: to(), subject: subject(), text: body() }),
      });
      setTo("");
      setSubject("");
      setBody("");
      setOk("已发送");
      void refetchSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  return (
    <div class="h-full overflow-auto bg-white/0 p-6">
      <div class="mx-auto w-full max-w-3xl space-y-6">
        <div>
          <div class="text-lg font-semibold text-zinc-100">写邮件</div>
          <div class="mt-1 text-sm text-zinc-500">发件地址只能是你的主邮箱或已启用的别名。</div>
        </div>

        <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div class="space-y-4">
            <div>
              <div class="text-xs font-medium text-zinc-400">发件人</div>
              <DropdownSelect
                value={from()}
                options={fromOptions()}
                placeholder="未分配邮箱"
                wrapperClass="relative mt-2"
                onChange={(v) => setFrom(v)}
              />
            </div>

            <div>
              <div class="text-xs font-medium text-zinc-400">收件人</div>
              <input
                value={to()}
                onInput={(e) => setTo(e.currentTarget.value)}
                placeholder="someone@example.com（多个用逗号分隔）"
                class="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>

            <div>
              <div class="text-xs font-medium text-zinc-400">主题</div>
              <input
                value={subject()}
                onInput={(e) => setSubject(e.currentTarget.value)}
                placeholder="（可留空）"
                class="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>

            <div>
              <div class="text-xs font-medium text-zinc-400">正文</div>
              <textarea
                value={body()}
                onInput={(e) => setBody(e.currentTarget.value)}
                rows={10}
                placeholder="纯文本正文"
                class="mt-2 w-full resize-y rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>

            <Show when={error()}>
              <div class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {error()}
              </div>
            </Show>
            <Show when={ok()}>
              <div class="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                {ok()}
              </div>
            </Show>

            <button
              disabled={sending()}
              class="spring-colors rounded-xl bg-indigo-500/15 px-4 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-60"
              onClick={send}
            >
              {sending() ? "发送中…" : "发送"}
            </button>
          </div>
        </div>

        <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div class="text-sm font-semibold text-zinc-100">最近发送</div>
          <Show
            when={(sent()?.messages || []).length > 0}
            fallback={<div class="mt-3 text-xs text-zinc-500">还没有发送记录。</div>}
          >
            <div class="mt-3 space-y-2">
              <For each={sent()?.messages || []}>
                {(item) => (
                  <div class="rounded-xl bg-white/5 px-3 py-2">
                    <div class="flex items-baseline justify-between gap-3">
                      <div class="min-w-0 truncate text-sm text-zinc-200">{item.subject || "(无主题)"}</div>
                      <div class="shrink-0 text-xs text-zinc-500">{formatTime(item.sentAt)}</div>
                    </div>
                    <div class="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                      <span class="truncate">发给 {item.toAddress}</span>
                      <Show when={item.status === "FAILED"}>
                        <span class="rounded-md bg-rose-500/15 px-2 py-0.5 font-medium text-rose-200">发送失败</span>
                      </Show>
                    </div>
                    <Show when={item.errorReason}>
                      <div class="mt-1 truncate text-xs text-rose-300/80">{item.errorReason}</div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
