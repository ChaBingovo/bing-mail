import { Show } from "solid-js";

export type NotificationIslandData = {
  title: string;
  subtitle?: string;
  service?: string | null;
  code?: string | null;
};

export function NotificationIsland(props: { data: NotificationIslandData; closing?: boolean; onClose: () => void }) {
  const copy = async () => {
    const v = props.data.code || "";
    if (!v) return;
    try {
      await navigator.clipboard?.writeText(v);
    } catch {}
  };

  return (
    <div class="pointer-events-none fixed left-0 right-0 top-0 z-50 flex justify-center px-4 pt-4">
      <div
        class="pointer-events-auto w-full max-w-md"
        classList={{ "animate-island-in": !props.closing, "animate-island-out": Boolean(props.closing) }}
      >
        <div class="glass-panel flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
          <div class="min-w-0">
            <div class="truncate text-sm font-semibold text-zinc-100">{props.data.title}</div>
            <Show when={props.data.subtitle}>
              <div class="mt-0.5 truncate text-xs text-zinc-400">{props.data.subtitle}</div>
            </Show>
            <Show when={props.data.code}>
              <button
                type="button"
                class="mt-2 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-zinc-100 transition-colors duration-200 ease-spring hover:bg-white/10"
                onClick={copy}
              >
                <Show when={props.data.service}>
                  <span class="rounded-lg bg-white/5 px-2 py-0.5 text-xs font-semibold text-zinc-200/90">
                    {props.data.service}
                  </span>
                </Show>
                <span class="tracking-wider">{props.data.code}</span>
                <span class="text-xs text-zinc-400">点击复制</span>
              </button>
            </Show>
          </div>
          <button
            type="button"
            class="spring-colors rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/10"
            onClick={props.onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
