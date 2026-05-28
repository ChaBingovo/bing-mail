import { Show, createMemo, createSignal } from "solid-js";
import { DropdownSelect } from "./DropdownSelect";

export function RegisterCard(props: {
  domains: string[];
  onRegister: (username: string, password: string, mailboxLocal: string, domain: string) => void;
  onGoLogin: () => void;
  loading: boolean;
  error: string;
}) {
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [mailboxLocal, setMailboxLocal] = createSignal("");
  const [domain, setDomain] = createSignal("");

  const domainOptions = createMemo(() => {
    const items = [{ value: "", label: "选择域名" }];
    for (const d of props.domains || []) {
      items.push({ value: d, label: d });
    }
    return items;
  });

  return (
    <div class="mx-auto w-full max-w-md rounded-xl border border-white/10 bg-zinc-950/60 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <div class="text-sm font-semibold tracking-wide text-zinc-100">Bingmail</div>
      <div class="mt-1 text-xs text-zinc-500">注册一个账号，并分配一个主邮箱</div>

      <div class="mt-6 space-y-4">
        <div>
          <div class="text-xs font-medium text-zinc-400">用户名</div>
          <input
            value={username()}
            onInput={(e) => setUsername(e.currentTarget.value)}
            placeholder="your_name"
            class="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
          <div class="mt-1 text-[11px] text-zinc-600">仅支持 3-32 位字母/数字/下划线</div>
        </div>
        <div>
          <div class="text-xs font-medium text-zinc-400">密码</div>
          <input
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            type="password"
            placeholder="至少 8 位"
            class="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>

        <div>
          <div class="text-xs font-medium text-zinc-400">主邮箱</div>
          <div class="mt-2 flex gap-2">
            <input
              value={mailboxLocal()}
              onInput={(e) => setMailboxLocal(e.currentTarget.value)}
              placeholder="your_name"
              class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <DropdownSelect
              value={domain()}
              options={domainOptions()}
              placeholder="选择域名"
              wrapperClass="relative shrink-0"
              class="min-w-[140px]"
              onChange={(v) => setDomain(v)}
            />
          </div>
          <Show when={props.domains.length === 0}>
            <div class="mt-1 text-[11px] text-zinc-600">系统尚未配置域名，请联系管理员</div>
          </Show>
        </div>

        <Show when={props.error}>
          <div class="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {props.error}
          </div>
        </Show>

        <button
          disabled={props.loading || props.domains.length === 0}
          class="w-full rounded-md bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-60"
          onClick={() => props.onRegister(username().trim(), password(), mailboxLocal().trim(), domain())}
        >
          创建账号
        </button>

        <div class="flex items-center justify-between text-xs text-zinc-500">
          <button class="hover:text-zinc-300" onClick={props.onGoLogin}>
            已有账号？登录
          </button>
        </div>
      </div>
    </div>
  );
}
