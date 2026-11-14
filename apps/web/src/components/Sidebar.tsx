import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { AuthUser, RedDotConnectionState } from "../types";
import type { AppPage } from "../context/AppContext";
import { ThemeSwitcher } from "./ThemeSwitcher";

export function Sidebar(props: {
  user: AuthUser;
  page: AppPage;
  setPage: (v: AppPage) => void;
  mailbox: string;
  aliases: string[];
  filterAddress: string;
  onSelectFilter: (address: string) => void;
  currentUnseen: number;
  onRefresh: () => void;
  onLogout: () => void;
  onOpenSpotlight: () => void;
  canSend?: boolean;
  connectionState?: RedDotConnectionState;
}) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  let menuRootEl: HTMLDivElement | undefined;

  const filterLabel = createMemo(() => props.filterAddress || "全部收件箱");

  const addressOptions = createMemo(() => {
    const primary = (props.mailbox || "").trim().toLowerCase();
    const out: { address: string; tag: string }[] = [];
    if (primary) out.push({ address: primary, tag: "主邮箱" });
    for (const alias of props.aliases) {
      const addr = (alias || "").trim().toLowerCase();
      if (addr && addr !== primary && !out.some((o) => o.address === addr)) {
        out.push({ address: addr, tag: "别名" });
      }
    }
    return out;
  });

  createEffect(() => {
    if (!menuOpen()) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target || !menuRootEl) return;
      if (!menuRootEl.contains(target)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  const pickFilter = (address: string) => {
    props.onSelectFilter(address);
    if (props.page !== "inbox") props.setPage("inbox");
    setMenuOpen(false);
  };

  return (
    <aside class="flex h-full min-w-0 flex-col justify-between border-r border-white/10 bg-white/5 p-4">
      <div class="min-h-0 flex-1 overflow-visible">
        <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold tracking-wide text-zinc-100">Bingmail</div>
          <div class="mt-0.5 truncate text-xs text-zinc-500">{filterLabel()}</div>
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
          <Show when={props.currentUnseen > 0}>
            <div class="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-200">
              {props.currentUnseen}
            </div>
          </Show>
          <Show when={props.page === "inbox"}>
            <button
              type="button"
              class="spring-colors rounded-xl bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10"
              onClick={props.onRefresh}
            >
              刷新
            </button>
          </Show>

          <div ref={(el) => (menuRootEl = el)} class="relative">
            <button
              type="button"
              aria-label="账号与收件箱筛选"
              title={`${props.user.username} · ${filterLabel()}`}
              class="pressable spring-colors relative flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/10 text-zinc-200 hover:bg-white/20"
              classList={{ "ring-2 ring-indigo-400/40 bg-white/20": menuOpen() }}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="12" cy="8.5" r="3.5" />
                <path stroke-linecap="round" d="M5.5 19.5c1.5-3 4-4.5 6.5-4.5s5 1.5 6.5 4.5" />
              </svg>
              <span
                title={
                  props.connectionState === "connected"
                    ? "在线"
                    : props.connectionState === "disconnected"
                      ? "离线"
                      : "繁忙"
                }
                class="absolute bottom-0 right-0 h-2 w-2 rounded-full"
                classList={{
                  "bg-emerald-400": props.connectionState === "connected",
                  "bg-amber-400": !props.connectionState || props.connectionState === "reconnecting",
                  "bg-rose-500": props.connectionState === "disconnected",
                }}
              />
            </button>

            <Show when={menuOpen()}>
              <div class="glass-panel-sm animate-pop absolute right-0 top-10 z-50 w-64 rounded-2xl p-2 shadow-glass">
                <div class="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2">
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                      <span class="truncate text-xs font-semibold text-zinc-100">{props.user.username}</span>
                      <Show when={props.user.isAdmin}>
                        <span class="shrink-0 rounded-md bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-200">
                          管理员
                        </span>
                      </Show>
                    </div>
                    <div class="mt-0.5 truncate text-[11px] text-zinc-500">{props.mailbox || "未分配邮箱"}</div>
                  </div>
                  <button
                    type="button"
                    class="spring-colors shrink-0 rounded-lg bg-white/5 px-2 py-1 text-xs font-semibold text-zinc-300 hover:bg-rose-500/20 hover:text-rose-200"
                    onClick={() => {
                      setMenuOpen(false);
                      props.onLogout();
                    }}
                  >
                    登出
                  </button>
                </div>

                <div class="my-2 border-t border-white/10" />

                <div class="px-2 py-1 text-[11px] font-semibold text-zinc-500">筛选收件箱</div>
                <div class="mt-1 max-h-56 space-y-0.5 overflow-auto">
                  <button
                    type="button"
                    class="spring-colors flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/10"
                    classList={{ "bg-white/10 font-semibold": props.filterAddress === "" }}
                    onClick={() => pickFilter("")}
                  >
                    <span class="truncate">全部收件箱</span>
                    <Show when={props.filterAddress === ""}>
                      <span class="shrink-0 text-indigo-300">✓</span>
                    </Show>
                  </button>
                  <For each={addressOptions()}>
                    {(item) => (
                      <button
                        type="button"
                        class="spring-colors flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/10"
                        classList={{ "bg-white/10 font-semibold": props.filterAddress === item.address }}
                        onClick={() => pickFilter(item.address)}
                      >
                        <span class="min-w-0 flex-1 truncate">{item.address}</span>
                        <span class="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          {item.tag}
                        </span>
                        <Show when={props.filterAddress === item.address}>
                          <span class="shrink-0 text-indigo-300">✓</span>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>

      <Show when={Boolean(props.canSend)}>
        <button
          type="button"
          class="pressable spring-colors mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-indigo-400/25 bg-indigo-500/20 px-3 py-2.5 text-sm font-semibold text-indigo-100 hover:bg-indigo-500/30"
          classList={{ "ring-2 ring-indigo-400/40 bg-indigo-500/30": props.page === "compose" }}
          onClick={() => props.setPage("compose")}
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 20h9" />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5Z"
            />
          </svg>
          <span>写邮件</span>
        </button>
      </Show>

      <button
        type="button"
        class="spring-colors mt-3 flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm font-semibold text-zinc-200 hover:bg-white/10"
        onClick={props.onOpenSpotlight}
      >
        <span>Spotlight 搜索</span>
        <span class="text-xs font-semibold text-zinc-500">Ctrl / ⌘ K</span>
      </button>

      <div class="mt-4 space-y-1">
        <button
          type="button"
          class="spring-colors w-full rounded-2xl px-3 py-2 text-left text-sm font-semibold text-zinc-200 hover:bg-white/5"
          classList={{ "bg-white/10": props.page === "inbox" }}
          onClick={() => props.setPage("inbox")}
        >
          收件箱
        </button>
        <button
          type="button"
          class="spring-colors w-full rounded-2xl px-3 py-2 text-left text-sm font-semibold text-zinc-200 hover:bg-white/5"
          classList={{ "bg-white/10": props.page === "sent" }}
          onClick={() => props.setPage("sent")}
        >
          已发邮件
        </button>
        <button
          type="button"
          class="spring-colors w-full rounded-2xl px-3 py-2 text-left text-sm font-semibold text-zinc-200 hover:bg-white/5"
          classList={{ "bg-white/10": props.page === "settings" }}
          onClick={() => props.setPage("settings")}
        >
          账户设置
        </button>
          <Show when={props.user.isAdmin}>
            <button
              type="button"
              class="spring-colors w-full rounded-2xl px-3 py-2 text-left text-sm font-semibold text-zinc-200 hover:bg-white/5"
              classList={{ "bg-white/10": props.page === "admin" }}
              onClick={() => props.setPage("admin")}
            >
              管理员设置
            </button>
          </Show>
        </div>
      </div>

      <div class="shrink-0 pt-3">
        <ThemeSwitcher />
      </div>
    </aside>
  );
}
