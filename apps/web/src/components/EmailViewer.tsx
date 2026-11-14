import { For, Show, createMemo, createSignal } from "solid-js";
import type { MessageDetail } from "../types";
import { formatTime } from "../utils/format";
import { looksLikeMarkdown, markdownToEmailHtml } from "../utils/markdownEmail";
import { rewriteCidSources } from "../utils/emailHtml";
import { ShadowHtml } from "./ShadowHtml";
import { AiCodeCard } from "./AiCodeCard";

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EmailViewer(props: {
  detail: MessageDetail | null;
  html: string;
  text: string;
  onReply?: (detail: MessageDetail) => void;
  onForward?: (detail: MessageDetail) => void;
  onToggleRead?: (id: string, read: boolean) => Promise<void> | void;
  onRetry?: (id: string) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
  onBack?: () => void;
}) {
  const [retrying, setRetrying] = createSignal(false);
  const [retryError, setRetryError] = createSignal("");
  const [deleting, setDeleting] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal("");

  const attachments = createMemo(() => props.detail?.attachments || []);
  // Inline images are served from this origin, so rewriting cid: references does not
  // leak the reader's IP the way a remote <img> would.
  const viewerHtml = createMemo(() => rewriteCidSources(props.html || "", attachments()));

  const retry = async (id: string) => {
    if (retrying() || !props.onRetry) return;
    setRetrying(true);
    setRetryError("");
    try {
      await props.onRetry(id);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "重试失败");
    } finally {
      setRetrying(false);
    }
  };

  const remove = async (id: string) => {
    if (deleting() || !props.onDelete) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await props.onDelete(id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main class="h-full min-w-0 overflow-y-auto overflow-x-hidden bg-white/0 p-3 sm:p-5">
      <Show when={props.detail} fallback={<div class="text-sm text-zinc-500">选择一封邮件查看详情</div>}>
        {(d) => (
          <div class="flex min-h-full min-w-0 flex-col gap-4">
            <Show when={props.onBack}>
              <div class="md:hidden">
                <button
                  type="button"
                  class="spring-colors inline-flex items-center gap-1 rounded-xl bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10"
                  onClick={() => props.onBack?.()}
                >
                  ← 返回列表
                </button>
              </div>
            </Show>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="break-words text-base font-semibold text-zinc-100">{d().subject || "(无主题)"}</div>
                <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                  <div class="text-zinc-400">{d().fromName || d().fromAddress || ""}</div>
                  <Show when={d().toAddress}>
                    <div class="text-zinc-500">收件：{d().toAddress}</div>
                  </Show>
                  <div class="text-zinc-600">{formatTime(d().receivedAt)}</div>
                  <Show when={d().aiCode}>
                    <AiCodeCard code={d().aiCode || ""} service={d().aiService} size="md" />
                  </Show>
                  <Show when={d().status === "FAILED"}>
                    <span class="rounded-md bg-rose-500/15 px-2 py-0.5 font-medium text-rose-200">解析失败</span>
                  </Show>
                  <Show when={d().status === "PENDING"}>
                    <span class="rounded-md bg-amber-500/15 px-2 py-0.5 font-medium text-amber-200">解析中</span>
                  </Show>
                </div>
              </div>
              <div class="flex shrink-0 flex-wrap items-center gap-1.5 sm:gap-2">
                <Show when={Boolean(props.onReply && d().fromAddress)}>
                  <button
                    type="button"
                    class="spring-colors pressable rounded-xl bg-indigo-500/15 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/25"
                    onClick={() => props.onReply?.(d())}
                  >
                    回复
                  </button>
                </Show>
                <Show when={Boolean(props.onForward)}>
                  <button
                    type="button"
                    class="spring-colors pressable rounded-xl bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10"
                    onClick={() => props.onForward?.(d())}
                  >
                    转发
                  </button>
                </Show>
                <Show when={Boolean(props.onToggleRead)}>
                  <button
                    type="button"
                    class="spring-colors pressable rounded-xl bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10"
                    onClick={() => props.onToggleRead?.(d().id, d().isRead === false)}
                  >
                    {d().isRead === false ? "标为已读" : "标为未读"}
                  </button>
                </Show>
                <Show when={props.onDelete}>
                  <button
                    type="button"
                    disabled={deleting()}
                    class="spring-colors pressable rounded-xl bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-60"
                    onClick={() => void remove(d().id)}
                  >
                    {deleting() ? "删除中…" : "删除"}
                  </button>
                </Show>
              </div>
            </div>

            <Show when={deleteError()}>
              <div class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {deleteError()}
              </div>
            </Show>

            <Show
              when={d().status === "SUCCESS"}
              fallback={
                <Show
                  when={d().status === "FAILED"}
                  fallback={<div class="text-sm text-zinc-500">等待解析完成…</div>}
                >
                  <div class="space-y-3">
                    <div class="text-sm text-zinc-500">解析失败：邮件格式异常或解析服务暂时不可用。</div>
                    <Show when={props.onRetry}>
                      <button
                        disabled={retrying()}
                        class="spring-colors rounded-xl bg-indigo-500/15 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-60"
                        onClick={() => void retry(d().id)}
                      >
                        {retrying() ? "重试中…" : "重试解析"}
                      </button>
                    </Show>
                    <Show when={retryError()}>
                      <div class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                        {retryError()}
                      </div>
                    </Show>
                  </div>
                </Show>
              }
            >
              <Show
                when={d().hasHtml && props.html}
                fallback={
                  <Show
                    when={d().hasText && props.text}
                    fallback={
                      <div class="whitespace-pre-wrap rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-relaxed text-zinc-200">
                        {d().snippet || ""}
                      </div>
                    }
                  >                    <Show
                      when={looksLikeMarkdown(props.text)}
                      fallback={
                        <div class="whitespace-pre-wrap rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-relaxed text-zinc-200">
                          {props.text}
                        </div>
                      }
                    >
                      <ShadowHtml html={markdownToEmailHtml(props.text)} debugId={d().id} />
                    </Show>
                  </Show>
                }
              >
                <ShadowHtml html={viewerHtml() || ""} debugId={d().id} />
              </Show>

              <Show when={attachments().length > 0}>
                <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div class="text-xs font-semibold text-zinc-300">
                    附件（{attachments().length}）
                  </div>
                  <div class="mt-3 space-y-2">
                    <For each={attachments()}>
                      {(a) => (
                        <a
                          href={a.url}
                          download={a.filename}
                          class="spring-colors flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2 hover:bg-white/10"
                        >
                          <div class="min-w-0">
                            <div class="truncate text-sm text-zinc-200">{a.filename}</div>
                            <div class="text-xs text-zinc-500">
                              {a.contentType}
                              <Show when={formatSize(a.size)}> · {formatSize(a.size)}</Show>
                            </div>
                          </div>
                          <span class="shrink-0 text-xs font-semibold text-zinc-400">下载</span>
                        </a>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </Show>
          </div>
        )}
      </Show>
    </main>
  );
}
