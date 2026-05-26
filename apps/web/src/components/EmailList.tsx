import { For, Show } from "solid-js";
import type { MessageMeta } from "../types";
import { formatTime } from "../utils/format";
import { AiCodeCard } from "./AiCodeCard";

export function EmailList(props: {
  mailboxAddress: string;
  messages: MessageMeta[];
  loading: boolean;
  selectedId: string | null;
  setSelectedId: (id: string) => void;
}) {
  return (
    <section class="h-full border-r border-white/10 bg-white/0 p-2">
      <div class="px-2 py-2 text-xs font-medium text-zinc-400">
        <Show when={props.mailboxAddress} fallback={"请选择收件箱"}>
          {props.mailboxAddress}
        </Show>
      </div>

      <div class="h-[calc(100%-36px)] overflow-auto px-2 pb-4">
        <Show when={!props.loading} fallback={<div class="text-sm text-zinc-500">加载中…</div>}>
          <For each={props.messages}>
            {(m) => {
              const code = m.aiCode;
              const service = m.aiService;
              return (
                <button
                  class="pressable spring-colors mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-left hover:bg-white/10"
                  classList={{ "bg-white/10": props.selectedId === m.id }}
                  onClick={() => props.setSelectedId(m.id)}
                >
                  <div class="flex items-baseline justify-between gap-2">
                    <div class="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">
                      {m.subject || "(无主题)"}
                    </div>
                    <div class="shrink-0 text-xs text-zinc-500">{formatTime(m.receivedAt)}</div>
                  </div>
                  <div class="mt-1 flex items-baseline justify-between gap-2">
                    <div class="min-w-0 flex-1 truncate text-xs text-zinc-400">{m.fromName || m.fromAddress || ""}</div>
                    <Show when={code}>
                      <div class="shrink-0">
                        <AiCodeCard code={code || ""} service={service} size="sm" />
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
  );
}
