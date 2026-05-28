import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import type { AuthUser } from "../types";
import { DropdownSelect } from "./DropdownSelect";

export function SetupView(props: {
  onInitialized: (user: AuthUser, token: string) => void;
}) {
  const [step, setStep] = createSignal<1 | 2 | 3>(1);
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [domainInput, setDomainInput] = createSignal("");
  const [mailboxLocal, setMailboxLocal] = createSignal("");
  const [selectedDomain, setSelectedDomain] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const [domains, { refetch: refetchDomains }] = createResource(async () => {
    try {
      const res = await fetch("/api/domains");
      if (!res.ok) return [] as string[];
      const data = (await res.json()) as { domains: string[] };
      return Array.isArray(data.domains) ? data.domains : [];
    } catch {
      return [] as string[];
    }
  });

  const domainOptions = createMemo(() => {
    const items = [{ value: "", label: "选择域名" }];
    for (const d of domains() || []) {
      items.push({ value: d, label: d });
    }
    return items;
  });

  const init = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/setup/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: username().trim(),
          password: password(),
          domain: selectedDomain().trim(),
          mailboxLocal: mailboxLocal().trim(),
        }),
      });
      if (!res.ok) {
        let msg = String(res.status);
        try {
          const data = (await res.clone().json()) as { error?: unknown };
          if (typeof data?.error === "string") msg = data.error;
        } catch {}
        throw new Error(msg);
      }
      const data = (await res.json()) as { user: AuthUser; token: string };
      props.onInitialized(data.user, data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "初始化失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="flex h-dvh w-full items-center justify-center bg-zinc-950 p-6">
      <div class="mx-auto w-full max-w-md rounded-xl border border-white/10 bg-zinc-950/60 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
        <div class="text-sm font-semibold tracking-wide text-zinc-100">初始化 Bingmail</div>
        <div class="mt-1 text-xs text-zinc-500">创建管理员账户 → 绑定域名 → 分配主邮箱地址</div>

        <div class="mt-6 space-y-4">
          <Show when={step() === 1}>
            <div>
              <div class="text-xs font-medium text-zinc-400">管理员用户名</div>
              <input
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
                placeholder="admin"
                class="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>
            <div>
              <div class="text-xs font-medium text-zinc-400">管理员密码</div>
              <input
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                type="password"
                placeholder="••••••••"
                class="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>
            <button
              disabled={loading()}
              class="w-full rounded-md bg-indigo-500/15 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-60"
              onClick={() => setStep(2)}
            >
              下一步
            </button>
          </Show>

          <Show when={step() === 2}>
            <div>
              <div class="text-xs font-medium text-zinc-400">域名</div>
              <div class="mt-2 flex gap-2">
                <input
                  value={domainInput()}
                  onInput={(e) => setDomainInput(e.currentTarget.value)}
                  placeholder="example.com"
                  class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>
            </div>
            <div class="flex gap-2">
              <button
                disabled={loading() || !domainInput().trim()}
                class="w-full rounded-md bg-indigo-500/15 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-60"
                onClick={async () => {
                  const d = domainInput().trim().toLowerCase();
                  if (!d) return;
                  setLoading(true);
                  setError("");
                  try {
                    const res = await fetch("/api/setup/domains", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ domain: d }),
                    });
                    if (!res.ok) {
                      let msg = String(res.status);
                      try {
                        const data = (await res.clone().json()) as { error?: unknown };
                        if (typeof data?.error === "string") msg = data.error;
                      } catch {}
                      throw new Error(msg);
                    }
                    setSelectedDomain(d);
                    refetchDomains();
                    setStep(3);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "添加失败");
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                下一步
              </button>
              <button
                class="w-full rounded-md bg-white/5 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/10"
                onClick={() => setStep(1)}
              >
                上一步
              </button>
            </div>
          </Show>

          <Show when={step() === 3}>
            <div>
              <div class="text-xs font-medium text-zinc-400">主邮箱</div>
              <div class="mt-2 flex gap-2">
                <input
                  value={mailboxLocal()}
                  onInput={(e) => setMailboxLocal(e.currentTarget.value)}
                  placeholder="admin"
                  class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
                <DropdownSelect
                  value={selectedDomain()}
                  options={domainOptions()}
                  placeholder="选择域名"
                  wrapperClass="relative shrink-0"
                  class="min-w-[140px]"
                  onChange={(v) => setSelectedDomain(v)}
                />
              </div>
            </div>

          <Show when={error()}>
            <div class="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {error()}
            </div>
          </Show>

          <button
            disabled={loading()}
            class="w-full rounded-md bg-indigo-500/15 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-60"
            onClick={init}
          >
            完成初始化
          </button>
          <button
            class="w-full rounded-md bg-white/5 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/10"
            onClick={() => setStep(2)}
          >
            上一步
          </button>
          </Show>
        </div>
      </div>
    </div>
  );
}
