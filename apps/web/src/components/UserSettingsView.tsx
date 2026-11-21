import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import type { ApiClient } from "../services/api";
import type { AuthUser } from "../types";
import { DropdownSelect } from "./DropdownSelect";
import { encryptAuthPayload } from "../utils/payloadCrypto";

export function UserSettingsView(props: { user: AuthUser; api: ApiClient }) {
  const [oldPassword, setOldPassword] = createSignal("");
  const [newPassword, setNewPassword] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [ok, setOk] = createSignal(false);

  const [aliasLocal, setAliasLocal] = createSignal("");
  const [aliasDomain, setAliasDomain] = createSignal("");
  const [aliasError, setAliasError] = createSignal("");

  const [blockedInput, setBlockedInput] = createSignal("");
  const [blockedError, setBlockedError] = createSignal("");

  const [blockedSenders, { refetch: refetchBlocked }] = createResource(async () => {
    return props.api.apiJson<{ senders: { sender: string; createdAt: number }[] }>("/api/user/blocked-senders");
  });

  const addBlockedSender = async () => {
    const sender = blockedInput().trim().toLowerCase();
    if (!sender) return;
    setBlockedError("");
    try {
      await props.api.apiJson("/api/user/blocked-senders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sender }),
      });
      setBlockedInput("");
      void refetchBlocked();
    } catch (err) {
      setBlockedError(err instanceof Error ? err.message : "拉黑失败");
    }
  };

  const removeBlockedSender = async (sender: string) => {
    setBlockedError("");
    try {
      await props.api.apiText("/api/user/blocked-senders", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sender }),
      });
      void refetchBlocked();
    } catch (err) {
      setBlockedError(err instanceof Error ? err.message : "解除失败");
    }
  };

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

  const domainOptions = createMemo(() => {
    const items = [{ value: "", label: "选择域名" }];
    for (const d of domains() || []) {
      items.push({ value: d, label: d });
    }
    return items;
  });

  const changePassword = async () => {
    setLoading(true);
    setError("");
    setOk(false);
    try {
      const encryptedAuth = await encryptAuthPayload({
        oldPassword: oldPassword(),
        newPassword: newPassword(),
      });
      await props.api.apiText("/api/user/password", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ encryptedAuth }),
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
            <DropdownSelect
              value={aliasDomain()}
              options={domainOptions()}
              placeholder="选择域名"
              wrapperClass="relative shrink-0"
              class="min-w-[140px]"
              onChange={(v) => setAliasDomain(v)}
            />
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
          <div class="text-sm font-semibold text-zinc-100">黑名单发件人</div>
          <div class="mt-1 text-xs text-zinc-500">被拉黑的地址发来的邮件会在收信入口直接拒收，不会进入收件箱。</div>

          <div class="mt-4 flex gap-2">
            <input
              value={blockedInput()}
              onInput={(e) => setBlockedInput(e.currentTarget.value)}
              placeholder="spam@example.com"
              class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <button
              class="shrink-0 rounded-md bg-indigo-500/15 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20"
              onClick={addBlockedSender}
            >
              拉黑
            </button>
          </div>

          <Show when={blockedError()}>
            <div class="mt-3 rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {blockedError()}
            </div>
          </Show>

          <div class="mt-4 space-y-2">
            <Show
              when={(blockedSenders()?.senders || []).length > 0}
              fallback={<div class="text-xs text-zinc-500">还没有拉黑的发件人。</div>}
            >
              <For each={blockedSenders()?.senders || []}>
                {(item) => (
                  <div class="flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
                    <div class="min-w-0 truncate text-sm text-zinc-200">{item.sender}</div>
                    <button
                      class="text-xs text-zinc-400 hover:text-zinc-200"
                      onClick={() => removeBlockedSender(item.sender)}
                    >
                      解除
                    </button>
                  </div>
                )}
              </For>
            </Show>
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

        <div class="rounded-xl border border-white/10 bg-white/5 p-5">
          <div class="text-sm font-semibold text-zinc-100">第三方组件与字体声明</div>
          <div class="mt-3 space-y-2 text-xs leading-relaxed text-zinc-400">
            <p>
              界面字体为 <span class="text-zinc-200">Noto Sans SC</span>（SIL Open Font License 1.1），
              经 Google Fonts 引入；网络不可达时自动回退到系统字体。
            </p>
            <p>
              其余第三方组件均以宽松许可证分发：SolidJS（MIT）、DOMPurify（Apache-2.0）、
              drizzle-orm（Apache-2.0）、postal-mime（MIT-0）。完整版权声明与许可证全文见仓库根目录的
              <code class="mx-1 rounded bg-white/10 px-1 py-0.5 text-zinc-300">THIRD-PARTY-NOTICES.md</code>。
            </p>
            <p>
              本应用自身以 <span class="text-zinc-200">MIT</span> 许可证开源。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
