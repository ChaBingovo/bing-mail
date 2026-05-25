import { Show } from "solid-js";
import type { MessageDetail } from "../types";
import { formatTime } from "../utils/format";
import { ShadowHtml } from "./ShadowHtml";

export function EmailViewer(props: { detail: MessageDetail | null; html: string }) {
  return (
    <main class="h-full bg-zinc-950 p-4">
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
                    <span class="rounded-md bg-amber-500/15 px-2 py-0.5 font-medium text-amber-200">解析中</span>
                  </Show>
                </div>
              </div>
            </div>

            <Show when={d().status === "SUCCESS"} fallback={<div class="text-sm text-zinc-500">等待解析完成…</div>}>
              <Show
                when={d().hasHtml && props.html}
                fallback={
                  <div class="whitespace-pre-wrap rounded-lg bg-white/5 p-4 text-sm leading-relaxed text-zinc-200">
                    {d().snippet || ""}
                  </div>
                }
              >
                <ShadowHtml html={props.html || ""} />
              </Show>
            </Show>
          </div>
        )}
      </Show>
    </main>
  );
}

