import { Show, createSignal } from "solid-js";
import type { MessageDetail } from "../types";
import { formatTime } from "../utils/format";
import { looksLikeMarkdown, markdownToEmailHtml } from "../utils/markdownEmail";
import { ShadowHtml } from "./ShadowHtml";
import { AiCodeCard } from "./AiCodeCard";

export function EmailViewer(props: {
  detail: MessageDetail | null;
  html: string;
  text: string;
  onRetry?: (id: string) => Promise<void> | void;
}) {
  const [retrying, setRetrying] = createSignal(false);
  const [retryError, setRetryError] = createSignal("");

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

  return (
    <main class="h-full bg-white/0 p-4">
      <Show when={props.detail} fallback={<div class="text-sm text-zinc-500">选择一封邮件查看详情</div>}>
        {(d) => (
          <div class="flex h-full flex-col gap-4">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="truncate text-base font-semibold text-zinc-100">{d().subject || "(无主题)"}</div>
                <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                  <div class="text-zinc-400">{d().fromName || d().fromAddress || ""}</div>
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
            </div>

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
                  >
                    <Show
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
                <ShadowHtml html={props.html || ""} debugId={d().id} />
              </Show>
            </Show>
          </div>
        )}
      </Show>
    </main>
  );
}
