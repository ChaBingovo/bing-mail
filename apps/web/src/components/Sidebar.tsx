import { Show } from "solid-js";
import type { AuthUser } from "../types";
import type { AppPage } from "../context/AppContext";

export function Sidebar(props: {
  user: AuthUser;
  page: AppPage;
  setPage: (v: AppPage) => void;
  currentUnseen: number;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  return (
    <aside class="h-full border-r border-zinc-800 bg-zinc-950/60 p-4">
      <div class="flex items-baseline justify-between">
        <div class="text-sm font-semibold tracking-wide text-zinc-100">Bingmail</div>
        <div class="flex items-baseline gap-2">
          <Show when={props.currentUnseen > 0}>
            <div class="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-200">
              {props.currentUnseen}
            </div>
          </Show>
          <Show when={props.page === "inbox"}>
            <button
              class="rounded-md bg-white/5 px-2 py-1 text-xs text-zinc-200 hover:bg-white/10"
              onClick={props.onRefresh}
            >
              刷新
            </button>
          </Show>
        </div>
      </div>

      <div class="mt-4 flex items-baseline justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
        <div class="min-w-0 text-xs text-zinc-300">
          <span class="text-zinc-500">登录：</span>
          <span class="truncate font-semibold text-zinc-200">{props.user.username}</span>
        </div>
        <button class="shrink-0 text-xs text-zinc-400 hover:text-zinc-200" onClick={props.onLogout}>
          退出
        </button>
      </div>

      <div class="mt-4 space-y-1">
        <button
          class="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/5"
          classList={{ "bg-white/10": props.page === "inbox" }}
          onClick={() => props.setPage("inbox")}
        >
          收件箱
        </button>
        <button
          class="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/5"
          classList={{ "bg-white/10": props.page === "settings" }}
          onClick={() => props.setPage("settings")}
        >
          账户设置
        </button>
        <Show when={props.user.isAdmin}>
          <button
            class="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/5"
            classList={{ "bg-white/10": props.page === "admin" }}
            onClick={() => props.setPage("admin")}
          >
            管理员设置
          </button>
        </Show>
      </div>
    </aside>
  );
}
