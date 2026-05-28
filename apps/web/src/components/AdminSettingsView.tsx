import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js";
import type { ApiClient } from "../services/api";
import { DropdownSelect } from "./DropdownSelect";

type AdminUserRow = {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: number;
};

type AdminDomainRow = {
  id: string;
  domain: string;
  isActive: boolean;
  createdAt: number;
};

type AdminMailboxRow = {
  address: string;
  userId: string | null;
  username: string | null;
  isActive: boolean;
};

export function AdminSettingsView(props: { api: ApiClient }) {
  const [error, setError] = createSignal("");

  const [settings, { refetch: refetchSettings }] = createResource(async () => {
    const data = await props.api.apiJson<{ allowRegister: boolean; maxAliases: number }>("/api/admin/settings");
    return data;
  });

  const [turnstile, { refetch: refetchTurnstile }] = createResource(async () => {
    const data = await props.api.apiJson<{ mode: string; siteKey: string; hasSecret: boolean }>("/api/admin/turnstile");
    return data;
  });

  const [domains, { refetch: refetchDomains }] = createResource(async () => {
    const data = await props.api.apiJson<{ domains: AdminDomainRow[] }>("/api/admin/domains");
    return data.domains;
  });

  const [users, { refetch: refetchUsers }] = createResource(async () => {
    const data = await props.api.apiJson<{ users: AdminUserRow[] }>("/api/admin/users");
    return data.users;
  });

  const [mailboxes, { refetch: refetchMailboxes }] = createResource(async () => {
    const data = await props.api.apiJson<{ mailboxes: AdminMailboxRow[] }>("/api/admin/mailboxes");
    return data.mailboxes;
  });

  const activeDomainOptions = createMemo(() => {
    const items = [{ value: "", label: "选择域名" }];
    for (const d of domains() || []) {
      if (!d?.isActive) continue;
      items.push({ value: d.domain, label: d.domain });
    }
    return items;
  });

  const [domainInput, setDomainInput] = createSignal("");
  const [createUsername, setCreateUsername] = createSignal("");
  const [createPassword, setCreatePassword] = createSignal("");
  const [createMailboxLocal, setCreateMailboxLocal] = createSignal("");
  const [createMailboxDomain, setCreateMailboxDomain] = createSignal("");
  const [createIsAdmin, setCreateIsAdmin] = createSignal(false);
  const [resetUserId, setResetUserId] = createSignal("");
  const [resetPassword, setResetPassword] = createSignal("");
  const [mbMailboxLocal, setMbMailboxLocal] = createSignal("");
  const [mbMailboxDomain, setMbMailboxDomain] = createSignal("");
  const [mbUserId, setMbUserId] = createSignal("");
  const [maxAliasesDraft, setMaxAliasesDraft] = createSignal(0);
  const [turnstileModeDraft, setTurnstileModeDraft] = createSignal("off");
  const [turnstileSiteKeyDraft, setTurnstileSiteKeyDraft] = createSignal("");
  const [turnstileSecretDraft, setTurnstileSecretDraft] = createSignal("");

  createEffect(() => {
    const v = settings()?.maxAliases;
    if (typeof v === "number") setMaxAliasesDraft(v);
  });

  createEffect(() => {
    const t = turnstile();
    if (!t) return;
    if (typeof t.mode === "string") setTurnstileModeDraft(t.mode);
    if (typeof t.siteKey === "string") setTurnstileSiteKeyDraft(t.siteKey);
    setTurnstileSecretDraft("");
  });

  const toggleRegister = async (next: boolean) => {
    setError("");
    try {
      await props.api.apiJson("/api/admin/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowRegister: next }),
      });
      refetchSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  };

  const saveMaxAliases = async () => {
    setError("");
    try {
      await props.api.apiJson("/api/admin/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxAliases: maxAliasesDraft() }),
      });
      refetchSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  };

  const saveTurnstile = async () => {
    setError("");
    try {
      const mode = turnstileModeDraft();
      const siteKey = turnstileSiteKeyDraft().trim();
      const secretDraft = turnstileSecretDraft().trim();
      if (mode !== "off") {
        if (!siteKey) {
          setError("Turnstile Site Key 不能为空");
          return;
        }
        if (!turnstile()?.hasSecret && !secretDraft) {
          setError("Turnstile Secret 不能为空");
          return;
        }
      }
      const payload: Record<string, unknown> = {
        mode,
        siteKey,
      };
      const secret = secretDraft;
      if (secret) payload.secret = secret;
      await props.api.apiJson("/api/admin/turnstile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      setTurnstileSecretDraft("");
      refetchTurnstile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  };

  const addDomain = async () => {
    const d = domainInput().trim().toLowerCase();
    if (!d) return;
    setError("");
    try {
      await props.api.apiJson("/api/admin/domains", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: d }),
      });
      setDomainInput("");
      refetchDomains();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加失败");
    }
  };

  const deleteDomain = async (domain: string) => {
    setError("");
    try {
      await props.api.apiText(`/api/admin/domains/${encodeURIComponent(domain)}`, { method: "DELETE" });
      refetchDomains();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  };

  const createUser = async () => {
    setError("");
    try {
      await props.api.apiJson("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: createUsername().trim(),
          password: createPassword(),
          mailboxLocal: createMailboxLocal().trim(),
          domain: createMailboxDomain(),
          isAdmin: createIsAdmin(),
        }),
      });
      setCreateUsername("");
      setCreatePassword("");
      setCreateMailboxLocal("");
      setCreateMailboxDomain("");
      setCreateIsAdmin(false);
      refetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    }
  };

  const resetPasswordForUser = async () => {
    setError("");
    try {
      const userId = resetUserId().trim();
      await props.api.apiText(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: resetPassword() }),
      });
      setResetPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "重置失败");
    }
  };

  const assignMailbox = async () => {
    setError("");
    try {
      await props.api.apiJson("/api/admin/mailboxes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mailboxLocal: mbMailboxLocal().trim(), domain: mbMailboxDomain(), userId: mbUserId().trim() }),
      });
      setMbMailboxLocal("");
      setMbMailboxDomain("");
      setMbUserId("");
      refetchMailboxes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "绑定失败");
    }
  };

  return (
    <div class="h-full overflow-auto bg-white/0 p-6">
      <div class="mx-auto w-full max-w-3xl space-y-6">
        <div>
          <div class="text-lg font-semibold text-zinc-100">管理员设置</div>
          <div class="mt-1 text-sm text-zinc-500">系统配置与用户/邮箱管理</div>
        </div>

        <Show when={error()}>
          <div class="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error()}</div>
        </Show>

        <div class="rounded-xl border border-white/10 bg-white/5 p-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-sm font-semibold text-zinc-100">注册开关</div>
              <div class="mt-1 text-xs text-zinc-500">决定是否允许普通用户自助注册</div>
            </div>
            <button
              class="rounded-md bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/10"
              onClick={() => toggleRegister(!settings()?.allowRegister)}
            >
              {settings()?.allowRegister ? "已开启" : "已关闭"}
            </button>
          </div>
        </div>

        <div class="rounded-xl border border-white/10 bg-white/5 p-5">
          <div class="text-sm font-semibold text-zinc-100">别名数量上限</div>
          <div class="mt-1 text-xs text-zinc-500">限制每个账户可添加的邮箱别名数量</div>
          <div class="mt-4 flex gap-2">
            <input
              value={String(maxAliasesDraft())}
              onInput={(e) => setMaxAliasesDraft(Math.max(0, Math.min(50, Math.floor(Number(e.currentTarget.value) || 0))))}
              inputMode="numeric"
              placeholder="3"
              class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <button
              class="shrink-0 rounded-md bg-indigo-500/15 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20"
              onClick={saveMaxAliases}
            >
              保存
            </button>
          </div>
        </div>

        <div class="rounded-xl border border-white/10 bg-white/5 p-5">
          <div class="text-sm font-semibold text-zinc-100">Turnstile 人机验证</div>
          <div class="mt-1 text-xs text-zinc-500">用于注册/登录/初始化的防刷验证（Site Key 可公开，Secret 仅后端使用）</div>
          <div class="mt-4 grid grid-cols-1 gap-3">
            <div class="flex gap-2">
              <DropdownSelect
                value={turnstileModeDraft()}
                options={[
                  { value: "off", label: "off（关闭）" },
                  { value: "always", label: "always（总是）" },
                  { value: "on_failure", label: "on_failure（失败后）" },
                ]}
                wrapperClass="relative shrink-0"
                class="min-w-[190px]"
                onChange={(v) => setTurnstileModeDraft(v)}
              />
              <Show when={turnstile()?.hasSecret} fallback={<div class="self-center text-xs text-zinc-500">未配置 Secret</div>}>
                <div class="self-center text-xs text-zinc-500">已配置 Secret</div>
              </Show>
            </div>
            <input
              value={turnstileSiteKeyDraft()}
              onInput={(e) => setTurnstileSiteKeyDraft(e.currentTarget.value)}
              placeholder="Turnstile Site Key"
              class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <input
              value={turnstileSecretDraft()}
              onInput={(e) => setTurnstileSecretDraft(e.currentTarget.value)}
              placeholder="Turnstile Secret（留空则不修改）"
              type="password"
              class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <button
              class="rounded-md bg-indigo-500/15 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20"
              onClick={saveTurnstile}
            >
              保存 Turnstile 配置
            </button>
          </div>
        </div>

        <div class="rounded-xl border border-white/10 bg-white/5 p-5">
          <div class="text-sm font-semibold text-zinc-100">域名</div>
          <div class="mt-1 text-xs text-zinc-500">仅记录域名，用于管理与提示外部 Email Routing 配置</div>
          <div class="mt-4 flex gap-2">
            <input
              value={domainInput()}
              onInput={(e) => setDomainInput(e.currentTarget.value)}
              placeholder="example.com"
              class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <button
              class="shrink-0 rounded-md bg-indigo-500/15 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20"
              onClick={addDomain}
            >
              添加
            </button>
          </div>
          <div class="mt-4 space-y-2">
            <For each={domains() || []}>
              {(d) => (
                <div class="flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
                  <div class="min-w-0">
                    <div class="truncate text-sm text-zinc-200">{d.domain}</div>
                    <div class="text-xs text-zinc-500">{new Date(d.createdAt).toLocaleString()}</div>
                  </div>
                  <button class="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => deleteDomain(d.domain)}>
                    删除
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>

        <div class="rounded-xl border border-white/10 bg-white/5 p-5">
          <div class="text-sm font-semibold text-zinc-100">创建用户</div>
          <div class="mt-4 grid grid-cols-1 gap-3">
            <input
              value={createUsername()}
              onInput={(e) => setCreateUsername(e.currentTarget.value)}
              placeholder="username"
              class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <input
              value={createPassword()}
              onInput={(e) => setCreatePassword(e.currentTarget.value)}
              placeholder="password"
              type="password"
              class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <div class="flex gap-2">
              <input
                value={createMailboxLocal()}
                onInput={(e) => setCreateMailboxLocal(e.currentTarget.value)}
                placeholder="mailbox"
                class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
              <DropdownSelect
                value={createMailboxDomain()}
                options={activeDomainOptions()}
                placeholder="选择域名"
                wrapperClass="relative shrink-0"
                class="min-w-[140px]"
                onChange={(v) => setCreateMailboxDomain(v)}
              />
            </div>
            <label class="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={createIsAdmin()}
                onChange={(e) => setCreateIsAdmin(e.currentTarget.checked)}
              />
              设为管理员
            </label>
            <button
              class="rounded-md bg-indigo-500/15 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20"
              onClick={createUser}
            >
              创建
            </button>
          </div>
        </div>

        <div class="rounded-xl border border-white/10 bg-white/5 p-5">
          <div class="text-sm font-semibold text-zinc-100">用户列表</div>
          <div class="mt-4 space-y-2">
            <For each={users() || []}>
              {(u) => (
                <div class="flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
                  <div class="min-w-0">
                    <div class="truncate text-sm text-zinc-200">
                      {u.username}
                      <Show when={u.isAdmin}>
                        <span class="ml-2 rounded bg-white/5 px-2 py-0.5 text-xs text-zinc-300">admin</span>
                      </Show>
                    </div>
                    <div class="text-xs text-zinc-500">{u.id}</div>
                  </div>
                  <button
                    class="text-xs text-zinc-400 hover:text-zinc-200"
                    onClick={() => {
                      setResetUserId(u.id);
                    }}
                  >
                    选中
                  </button>
                </div>
              )}
            </For>
          </div>
          <div class="mt-4 grid grid-cols-1 gap-2">
            <input
              value={resetUserId()}
              onInput={(e) => setResetUserId(e.currentTarget.value)}
              placeholder="user id"
              class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <input
              value={resetPassword()}
              onInput={(e) => setResetPassword(e.currentTarget.value)}
              placeholder="new password"
              type="password"
              class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <button
              class="rounded-md bg-white/5 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/10"
              onClick={resetPasswordForUser}
            >
              重置密码
            </button>
          </div>
        </div>

        <div class="rounded-xl border border-white/10 bg-white/5 p-5">
          <div class="text-sm font-semibold text-zinc-100">分配邮箱</div>
          <div class="mt-4 grid grid-cols-1 gap-2">
            <div class="flex gap-2">
              <input
                value={mbMailboxLocal()}
                onInput={(e) => setMbMailboxLocal(e.currentTarget.value)}
                placeholder="mailbox"
                class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
              <DropdownSelect
                value={mbMailboxDomain()}
                options={activeDomainOptions()}
                placeholder="选择域名"
                wrapperClass="relative shrink-0"
                class="min-w-[140px]"
                onChange={(v) => setMbMailboxDomain(v)}
              />
            </div>
            <input
              value={mbUserId()}
              onInput={(e) => setMbUserId(e.currentTarget.value)}
              placeholder="user id"
              class="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <button
              class="rounded-md bg-indigo-500/15 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20"
              onClick={assignMailbox}
            >
              绑定
            </button>
          </div>

          <div class="mt-5 text-sm font-semibold text-zinc-100">邮箱列表</div>
          <div class="mt-3 space-y-2">
            <For each={mailboxes() || []}>
              {(m) => (
                <div class="flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
                  <div class="min-w-0">
                    <div class="truncate text-sm text-zinc-200">{m.address}</div>
                    <div class="text-xs text-zinc-500">
                      {m.username || "未分配"} {m.userId ? `(${m.userId})` : ""}
                    </div>
                  </div>
                  <div class="text-xs text-zinc-500">{m.isActive ? "active" : "inactive"}</div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}
