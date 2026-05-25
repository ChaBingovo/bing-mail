import { For, Show } from "solid-js";
import type { AuthUser } from "../types";

export function Sidebar(props: {
  mode: "anon" | "user";
  user: AuthUser | null;
  activeAddress: string;
  setActiveAddress: (v: string) => void;
  currentUnseen: number;
  unseenByMailbox: Record<string, number>;
  onRefresh: () => void;
  userMailboxes: string[];
  publicMailboxes: string[];
  onBindToUser: (address: string) => void;
  onUnbindFromUser: (address: string) => void;
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
          <button
            class="rounded-md bg-white/5 px-2 py-1 text-xs text-zinc-200 hover:bg-white/10"
            onClick={props.onRefresh}
          >
            刷新
          </button>
        </div>
      </div>

      <Show when={props.mode === "user" && props.user}>
        <div class="mt-4 flex items-baseline justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <div class="min-w-0 text-xs text-zinc-300">
            <span class="text-zinc-500">登录：</span>
            <span class="truncate font-semibold text-zinc-200">{props.user?.username}</span>
          </div>
          <button class="shrink-0 text-xs text-zinc-400 hover:text-zinc-200" onClick={props.onLogout}>
            退出
          </button>
        </div>
      </Show>

      <div class="mt-4">
        <div class="text-xs font-medium text-zinc-400">收件箱地址</div>
        <input
          value={props.activeAddress}
          onInput={(e) => props.setActiveAddress(e.currentTarget.value.trim().toLowerCase())}
          placeholder="you@example.com"
          class="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        />
        <Show when={props.mode === "user"}>
          <button
            class="mt-2 w-full rounded-md bg-indigo-500/15 px-3 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/20"
            onClick={() => props.onBindToUser(props.activeAddress)}
          >
            绑定到我的邮箱
          </button>
        </Show>
      </div>

      <Show when={props.mode === "user"}>
        <div class="mt-5 text-xs font-medium text-zinc-400">我的邮箱</div>
        <div class="mt-2 space-y-1">
          <For each={props.userMailboxes}>
            {(addr) => (
              <button
                class="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/5"
                classList={{ "bg-white/10": addr === props.activeAddress }}
                onClick={() => props.setActiveAddress(addr)}
              >
                <div class="flex items-baseline justify-between gap-2">
                  <div class="min-w-0 flex-1 truncate">{addr}</div>
                  <div class="flex shrink-0 items-baseline gap-2">
                    <Show when={(props.unseenByMailbox[addr] ?? 0) > 0}>
                      <div class="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-200">
                        {props.unseenByMailbox[addr] ?? 0}
                      </div>
                    </Show>
                    <span
                      class="rounded-md bg-white/5 px-2 py-0.5 text-xs text-zinc-300 hover:bg-white/10"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        props.onUnbindFromUser(addr);
                      }}
                    >
                      解绑
                    </span>
                  </div>
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="mt-5 text-xs font-medium text-zinc-400">白名单</div>
      <div class="mt-2 space-y-1">
        <For each={props.publicMailboxes}>
          {(addr) => (
            <button
              class="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/5"
              classList={{ "bg-white/10": addr === props.activeAddress }}
              onClick={() => props.setActiveAddress(addr)}
            >
              <div class="flex items-baseline justify-between gap-2">
                <div class="min-w-0 flex-1 truncate">{addr}</div>
                <Show when={(props.unseenByMailbox[addr] ?? 0) > 0}>
                  <div class="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-200">
                    {props.unseenByMailbox[addr] ?? 0}
                  </div>
                </Show>
              </div>
            </button>
          )}
        </For>
      </div>

      <div class="mt-6 text-xs text-zinc-500">
        <div>搜索：/api/search?address=...&q=...</div>
      </div>
    </aside>
  );
}

