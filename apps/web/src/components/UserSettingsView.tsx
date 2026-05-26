import { For, Show, createResource, createSignal } from "solid-js";
import type { ApiClient } from "../services/api";
import type { AuthUser } from "../types";

export function UserSettingsView(props: { user: AuthUser; api: ApiClient }) {
  const [oldPassword, setOldPassword] = createSignal("");
  const [newPassword, setNewPassword] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [ok, setOk] = createSignal(false);

  const [aliasLocal, setAliasLocal] = createSignal("");
  const [aliasDomain, setAliasDomain] = createSignal("");
  const [aliasError, setAliasError] = createSignal("");

  const [aliases, { refetch: refetchAliases }] = createResource(async () => {
    return props.api.apiJson<{ aliases: string[]; maxAliases: number; mailbox: string }>("/api/user/aliases");
  });

  const [domains] = createResource(async () => {
    try {
      const data = await props.api.apiJson<{ domains: string[] }>("/api/domains");
      return Array.isArray(data.domains) ? data.domains : [];
    } catch {
      return [] as string[];
    }
  });

  const changePassword = async () => {
    setLoading(true);
    setError("");
    setOk(false);
    try {
      await props.api.apiText("/api/user/password", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ oldPassword: oldPassword(), newPassword: newPassword() }),
      });
      setOldPassword("");
      setNewPassword("");
      setOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改失败");
    } finally {
      setLoading(false);
    }
  };

  const addAlias = async () => {
    const local = aliasLocal().trim();
    const domain = aliasDomain();
    if (!local || !domain) return;
    setAliasError("");
    try {
      await props.api.apiJson("/api/user/aliases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ local, domain }),
      });
      setAliasLocal("");
      refetchAliases();
    } catch (err) {
      setAliasError(err instanceof Error ? err.message : "添加失败");
    }
  };

  const removeAlias = async (addr: string) => {
    setAliasError("");
    try {
      await props.api.apiText(`/api/user/aliases/${encodeURIComponent(addr)}`, { method: "DELETE" });
      refetchAliases();
    } catch (err) {
      setAliasError(err instanceof Error ? err.message : "删除失败");
    }
  };

  return (
    <div class="h-full overflow-auto bg-white/0 p-6">
      <div class="mx-auto w-full max-w-2xl space-y-6">
        <div>
          <div class="text-lg font-semibold text-zinc-100">账户设置</div>
          <div class="mt-1 text-sm text-zinc-500">当前用户：{props.user.username}</div>
        </div>

        <div class="rounded-xl border border-white/10 bg-white/5 p-5">
          <div class="text-sm font-semibold text-zinc-100">邮箱</div>
          <div class="mt-2 text-sm text-zinc-200">{aliases()?.mailbox || "未分配（请联系管理员）"}</div>
          <div class="mt-5 text-sm font-semibold text-zinc-100">邮箱别名</div>
          <div class="mt-1 text-xs text-zinc-500">
            已使用 {aliases()?.aliases?.length || 0} / {aliases()?.maxAliases ?? 0}
          </div>

          <div class="mt-4 flex gap-2">
            <input
              value={aliasLocal()}
              onInput={(e) => setAliasLocal(e.currentTarget.value)}
              placeholder="alias"
              class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <select
              value={aliasDomain()}
              onChange={(e) => setAliasDomain(e.currentTarget.value)}
              class="shrink-0 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            >
              <option value="">选择域名</option>
              <For each={domains() || []}>{(d) => <option value={d}>{d}</option>}</For>
            </select>
            <button
              class="shrink-0 rounded-md bg-indigo-500/15 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20"
              onClick={addAlias}
            >
              添加
            </button>
          </div>

          <Show when={aliasError()}>
            <div class="mt-3 rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {aliasError()}
            </div>
          </Show>

          <div class="mt-4 space-y-2">
            <For each={aliases()?.aliases || []}>
              {(addr) => (
                <div class="flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
                  <div class="min-w-0 truncate text-sm text-zinc-200">{addr}</div>
                  <button class="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => removeAlias(addr)}>
                    删除
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>

        <div class="rounded-xl border border-white/10 bg-white/5 p-5">
          <div class="text-sm font-semibold text-zinc-100">修改密码</div>
          <div class="mt-4 space-y-4">
            <div>
              <div class="text-xs font-medium text-zinc-400">旧密码</div>
              <input
                value={oldPassword()}
                onInput={(e) => setOldPassword(e.currentTarget.value)}
                type="password"
                placeholder="••••••••"
                class="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>
            <div>
              <div class="text-xs font-medium text-zinc-400">新密码</div>
              <input
                value={newPassword()}
                onInput={(e) => setNewPassword(e.currentTarget.value)}
                type="password"
                placeholder="至少 8 位"
                class="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>

            <Show when={error()}>
              <div class="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {error()}
              </div>
            </Show>
            <Show when={ok()}>
              <div class="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                已更新密码
              </div>
            </Show>

            <button
              disabled={loading()}
              class="rounded-md bg-indigo-500/15 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-60"
              onClick={changePassword}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
