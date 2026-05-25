import { createSignal, Show } from "solid-js";

export function LoginCard(props: {
  onLogin: (username: string, password: string) => void;
  showRegister: boolean;
  onGoRegister: () => void;
  loading: boolean;
  error: string;
}) {
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");

  return (
    <div class="mx-auto w-full max-w-md rounded-xl border border-white/10 bg-zinc-950/60 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <div class="text-sm font-semibold tracking-wide text-zinc-100">Bingmail</div>
      <div class="mt-1 text-xs text-zinc-500">登录后可管理与持久化你的临时邮箱</div>

      <div class="mt-6 space-y-4">
        <div>
          <div class="text-xs font-medium text-zinc-400">用户名</div>
          <input
            value={username()}
            onInput={(e) => setUsername(e.currentTarget.value)}
            placeholder="your_name"
            class="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>
        <div>
          <div class="text-xs font-medium text-zinc-400">密码</div>
          <input
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            type="password"
            placeholder="••••••••"
            class="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>

        <Show when={props.error}>
          <div class="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {props.error}
          </div>
        </Show>

        <button
          disabled={props.loading}
          class="w-full rounded-md bg-indigo-500/15 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-60"
          onClick={() => props.onLogin(username().trim(), password())}
        >
          登录
        </button>

        <div class="flex items-center justify-between text-xs text-zinc-500">
          <Show when={props.showRegister}>
            <button class="hover:text-zinc-300" onClick={props.onGoRegister}>
              没有账号？注册
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}
