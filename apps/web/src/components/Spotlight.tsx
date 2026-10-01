import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

export type SpotlightAction = {
  key: string;
  title: string;
  subtitle?: string;
  right?: string;
  onPick: () => void;
};

export type SpotlightSearchOptions = { advanced: boolean; allMailboxes: boolean };

export function Spotlight(props: {
  open: boolean;
  onClose: () => void;
  getActions: (query: string) => SpotlightAction[];
  /** Server-side FTS search. Omit to keep the palette purely local. */
  search?: (query: string, opts: SpotlightSearchOptions) => Promise<SpotlightAction[]>;
  canSearchAllMailboxes?: boolean;
}) {
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const [advancedMode, setAdvancedMode] = createSignal(false);
  const [allMailboxes, setAllMailboxes] = createSignal(false);
  const [hits, setHits] = createSignal<SpotlightAction[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [searchError, setSearchError] = createSignal("");
  let inputEl: HTMLInputElement | undefined;

  const localActions = createMemo(() => props.getActions(query()));
  const actions = createMemo(() => [...localActions(), ...hits()]);

  const close = () => {
    props.onClose();
  };

  const pick = (idx: number) => {
    const list = actions();
    const item = list[idx];
    if (!item) return;
    item.onPick();
    close();
  };

  // Debounced server search; the previous request is abandoned when the query,
  // a toggle or the open state changes.
  createEffect(() => {
    if (!props.open) return;
    const q = query().trim();
    const advanced = advancedMode();
    const all = allMailboxes();
    if (!props.search || q.length < 2) {
      setHits([]);
      setSearchError("");
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void props
        .search!(q, { advanced, allMailboxes: all })
        .then((results) => {
          if (cancelled) return;
          setHits(results);
          setSearchError("");
        })
        .catch((err) => {
          if (cancelled) return;
          setHits([]);
          setSearchError(err instanceof Error ? err.message : "搜索失败");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    onCleanup(() => {
      cancelled = true;
      clearTimeout(timer);
    });
  });

  createEffect(() => {
    if (!props.open) return;
    setQuery("");
    setActive(0);
    setHits([]);
    setSearchError("");
    queueMicrotask(() => inputEl?.focus());
  });

  createEffect(() => {
    if (!props.open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(actions().length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        pick(active());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-4 pt-24"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div class="glass-panel w-full max-w-2xl animate-pop rounded-3xl p-3">
          <div class="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div class="text-xs font-semibold text-zinc-400">搜索</div>
            <input
              ref={(el) => (inputEl = el)}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder="搜索邮件 / 切换别名 / 跳转页面"
              class="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            />
            <div class="text-[11px] font-semibold text-zinc-500">Esc</div>
          </div>

          <Show when={props.search}>
            <div class="mt-2 flex flex-wrap items-center gap-2 px-1">
              <button
                type="button"
                class="spring-colors rounded-full px-3 py-1 text-[11px] font-semibold"
                classList={{
                  "bg-indigo-500/20 text-indigo-100": advancedMode(),
                  "bg-white/5 text-zinc-400 hover:bg-white/10": !advancedMode(),
                }}
                onClick={() => setAdvancedMode((v) => !v)}
              >
                高级语法 {advancedMode() ? "开" : "关"}
              </button>
              <Show when={props.canSearchAllMailboxes}>
                <button
                  type="button"
                  class="spring-colors rounded-full px-3 py-1 text-[11px] font-semibold"
                  classList={{
                    "bg-indigo-500/20 text-indigo-100": allMailboxes(),
                    "bg-white/5 text-zinc-400 hover:bg-white/10": !allMailboxes(),
                  }}
                  onClick={() => setAllMailboxes((v) => !v)}
                >
                  全部邮箱 {allMailboxes() ? "开" : "关"}
                </button>
              </Show>
              <Show when={searching()}>
                <span class="text-[11px] text-zinc-500">搜索中…</span>
              </Show>
              <Show when={searchError()}>
                <span class="text-[11px] text-rose-300">{searchError()}</span>
              </Show>
            </div>
          </Show>

          <div class="mt-3 max-h-[52vh] overflow-auto">
            <For each={actions()}>
              {(a, idx) => (
                <button
                  type="button"
                  class="spring-colors flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left hover:bg-white/5"
                  classList={{ "bg-white/10": idx() === active() }}
                  onMouseEnter={() => setActive(idx())}
                  onClick={() => pick(idx())}
                >
                  <div class="min-w-0">
                    <div class="truncate text-sm font-semibold text-zinc-100">{a.title}</div>
                    <Show when={a.subtitle}>
                      <div class="mt-0.5 truncate text-xs text-zinc-500">{a.subtitle}</div>
                    </Show>
                  </div>
                  <Show when={a.right}>
                    <div class="shrink-0 text-xs font-semibold text-zinc-400">{a.right}</div>
                  </Show>
                </button>
              )}
            </For>
            <Show when={actions().length === 0}>
              <div class="px-4 py-8 text-center text-sm text-zinc-500">没有匹配项</div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
