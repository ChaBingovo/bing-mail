import { Show, createEffect, createResource, createSignal, onCleanup } from "solid-js";
import { EmailList } from "./components/EmailList";
import { EmailViewer } from "./components/EmailViewer";
import { LoginCard } from "./components/LoginCard";
import { RegisterCard } from "./components/RegisterCard";
import { SetupView } from "./components/SetupView";
import { Sidebar } from "./components/Sidebar";
import { AdminSettingsView } from "./components/AdminSettingsView";
import { UserSettingsView } from "./components/UserSettingsView";
import { ComposeView } from "./components/ComposeView";
import { SentView } from "./components/SentView";
import { NotificationIsland } from "./components/NotificationIsland";
import { Spotlight } from "./components/Spotlight";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { AppProvider, useApp } from "./context/AppContext";
import { ThemeProvider } from "./context/ThemeContext";
import { VisibilityProvider, useVisibility } from "./context/VisibilityContext";
import type { AuthUser, MessageDetail, MessageMeta, SentMessage } from "./types";
import { useMailboxSession } from "./hooks/useMailboxSession";
import { useInboxNotifications } from "./hooks/useInboxNotifications";
import { createMailSyncController } from "./services/mailSyncController";
import { createSpotlightActionBuilder } from "./services/spotlightActions";
import { buildForwardPrefill, buildReplyPrefill, parseRecipientsInput, type ComposePrefill } from "./utils/compose";

function GuestView() {
  const app = useApp();
  const [tab, setTab] = createSignal<"login" | "register">("login");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const [setup] = createResource(async () => {
    try {
      const res = await fetch("/api/setup/status");
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { initialized: boolean; allowRegister: boolean };
    } catch {
      return { initialized: true, allowRegister: false };
    }
  });

  createEffect(() => {
    if (tab() !== "register") return;
    if (setup()?.allowRegister) return;
    setTab("login");
  });

  const [domains] = createResource(async () => {
    try {
      const res = await fetch("/api/domains");
      if (!res.ok) return [] as string[];
      const data = (await res.json()) as { domains: string[] };
      return Array.isArray(data.domains) ? data.domains : [];
    } catch {
      return [] as string[];
    }
  });

  const login = async (username: string, password: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await app.api.apiJson<{ user: AuthUser }>("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      app.login(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  const register = async (username: string, password: string, mailboxLocal: string, domain: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await app.api.apiJson<{ user: AuthUser }>("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, mailboxLocal, domain }),
      });
      app.login(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="relative h-dvh w-full">
      <Show
        when={setup.state === "ready" && setup()?.initialized === false}
        fallback={
          <div class="flex h-dvh w-full items-center justify-center p-6">
            <Show
              when={tab() === "login"}
              fallback={
                <RegisterCard
                  onRegister={register}
                  domains={domains() || []}
                  onGoLogin={() => setTab("login")}
                  loading={loading()}
                  error={error()}
                />
              }
            >
              <LoginCard
                onLogin={login}
                showRegister={Boolean(setup()?.allowRegister)}
                onGoRegister={() => setTab("register")}
                loading={loading()}
                error={error()}
              />
            </Show>
          </div>
        }
      >
        <SetupView onInitialized={(user) => app.login(user)} />
      </Show>
      <div class="fixed bottom-6 left-6 z-40">
        <ThemeSwitcher />
      </div>
    </div>
  );
}

function ConsoleView() {
  const app = useApp();
  const { isVisible } = useVisibility();

  const [spotlightOpen, setSpotlightOpen] = createSignal(false);
  const [mobileNavOpen, setMobileNavOpen] = createSignal(false);
  const [composePrefill, setComposePrefill] = createSignal<ComposePrefill | null>(null);
  const session = useMailboxSession(app, isVisible);
  const notifications = useInboxNotifications({
    mailboxAddress: () => session.mailboxAddress() || "",
    messages: () => session.messages() || [],
    readMarker: () => session.readMarker(),
    markerLoaded: () => session.readMarkerLoaded(),
  });

  const sync = createMailSyncController({
    getSessionKey: () => app.currentUser()?.id || "",
    getAddress: () => (session.mailboxAddress() || "").trim().toLowerCase(),
    getIsVisible: isVisible,
    apiJson: app.api.apiJson,
    onUnreadChange: (address, count) => app.setUnseen(address, count),
    onReadMarker: (since) => session.setReadMarker(Math.max(session.readMarker(), since)),
    onConnectionStateChange: session.setConnectionState,
    onHint: notifications.bumpHint,
    onRefetchRequested: () => session.refetchMessages(),
  });

  createEffect(() => {
    const address = (session.mailboxAddress() || "").trim().toLowerCase();
    isVisible();
    if (app.mode() === "user" && address) {
      sync.start();
      return;
    }
    sync.stop();
  });

  onCleanup(() => sync.stop());

  createEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== "k") return;
      const el = document.activeElement as HTMLElement | null;
      const tag = (el?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || (el as any)?.isContentEditable) return;
      e.preventDefault();
      setSpotlightOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  const canCompose = () => Boolean(session.mailboxAddress());

  const getSpotlightActions = createSpotlightActionBuilder({
    app,
    mailbox: () => session.mailboxAddress() || "",
    aliases: () => session.aliases()?.aliases || [],
    displayAddress: session.displayAddress,
    setDisplayAddress: session.setDisplayAddress,
    messages: () => session.messages() || [],
    canSend: canCompose,
  });

  /** Server-side FTS search for the Spotlight palette. */
  const searchMessages = async (q: string, opts: { advanced: boolean; allMailboxes: boolean }) => {
    const address = opts.allMailboxes
      ? "*"
      : (session.displayAddress() || session.mailboxAddress() || "").trim().toLowerCase();
    if (!address) return [];
    const params = new URLSearchParams({ address, q, limit: "20" });
    if (opts.advanced) params.set("mode", "advanced");
    const data = await app.api.apiJson<{ messages: MessageMeta[] }>(`/api/search?${params.toString()}`);
    return (data.messages || []).map((m) => ({
      key: `hit-${m.id}`,
      title: m.subject || "(无主题)",
      subtitle: m.fromName || m.fromAddress || "",
      right: "服务器",
      onPick: () => {
        app.setPage("inbox");
        app.setSelectedId(m.id);
      },
    }));
  };

  const startReply = (detail: MessageDetail) => {
    setComposePrefill(
      buildReplyPrefill({
        detail,
        text: session.text() || "",
        html: session.html() || "",
        fromAddress: detail.toAddress || session.displayAddress() || session.mailboxAddress() || "",
      }),
    );
    app.setPage("compose");
  };

  const startForward = (detail: MessageDetail) => {
    setComposePrefill(
      buildForwardPrefill({
        detail,
        text: session.text() || "",
        html: session.html() || "",
        fromAddress: detail.toAddress || session.displayAddress() || session.mailboxAddress() || "",
      }),
    );
    app.setPage("compose");
  };

  const startResend = (item: SentMessage) => {
    setComposePrefill({
      nonce: crypto.randomUUID(),
      mode: "resend",
      from: item.fromAddress,
      to: parseRecipientsInput(item.toAddress),
      subject: item.subject || "",
      body: item.snippet || "",
    });
    app.setPage("compose");
  };

  const sidebar = () => (
    <Sidebar
      user={app.currentUser()!}
      page={app.page()}
      setPage={app.setPage}
      mailbox={session.mailboxAddress() || ""}
      aliases={session.aliases()?.aliases || []}
      filterAddress={session.displayAddress()}
      onSelectFilter={(addr) => session.setDisplayAddress(addr)}
      currentUnseen={session.currentUnseen()}
      onRefresh={() => session.refetchMessages()}
      onLogout={() => app.logout()}
      onOpenSpotlight={() => setSpotlightOpen(true)}
      canSend={canCompose()}
      connectionState={session.connectionState()}
      onNavigate={() => setMobileNavOpen(false)}
    />
  );

  const mobilePageTitle = () => {
    const p = app.page();
    if (p === "compose") return "写邮件";
    if (p === "sent") return "已发邮件";
    if (p === "settings") return "账户设置";
    if (p === "admin") return "管理员设置";
    return session.displayAddress() || "收件箱";
  };

  return (
    <div class="relative h-dvh w-full overflow-hidden p-0 sm:p-4">
      <Show when={notifications.island()}>
        <NotificationIsland data={notifications.island()!} closing={notifications.islandClosing()} onClose={notifications.closeIsland} />
      </Show>
      <Spotlight
        open={spotlightOpen()}
        onClose={() => setSpotlightOpen(false)}
        getActions={getSpotlightActions}
        canSearchAllMailboxes={Boolean(app.currentUser()?.isAdmin)}
        search={searchMessages}
      />

      <div class="glass-shell flex h-full flex-col overflow-hidden rounded-none border-0 sm:rounded-[28px] sm:border">
        <header class="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-white/5 px-3 py-2.5 md:hidden">
          <div class="flex min-w-0 items-center gap-2">
            <button
              type="button"
              aria-label="打开菜单"
              class="pressable spring-colors flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
              onClick={() => setMobileNavOpen(true)}
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <div class="min-w-0 truncate text-sm font-semibold text-zinc-100">{mobilePageTitle()}</div>
            <Show when={session.currentUnseen() > 0}>
              <span class="shrink-0 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-rose-200">
                {session.currentUnseen()}
              </span>
            </Show>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <Show when={canCompose() && app.page() !== "compose"}>
              <button
                type="button"
                class="spring-colors rounded-xl bg-indigo-500/20 px-2.5 py-1.5 text-xs font-semibold text-indigo-100 hover:bg-indigo-500/30"
                onClick={() => app.setPage("compose")}
              >
                写邮件
              </button>
            </Show>
            <Show when={app.page() === "inbox"}>
              <button
                type="button"
                class="spring-colors rounded-xl bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10"
                onClick={() => session.refetchMessages()}
              >
                刷新
              </button>
            </Show>
            <span
              title={
                session.connectionState() === "connected"
                  ? "在线"
                  : session.connectionState() === "disconnected"
                    ? "离线"
                    : "繁忙"
              }
              class="ml-0.5 h-2 w-2 rounded-full"
              classList={{
                "bg-emerald-400": session.connectionState() === "connected",
                "bg-amber-400": session.connectionState() === "reconnecting",
                "bg-rose-500": session.connectionState() === "disconnected",
              }}
            />
          </div>
        </header>

        <div class="relative min-h-0 flex-1 overflow-hidden">
          <Show when={mobileNavOpen()}>
            <div class="fixed inset-0 z-40 flex md:hidden">
              <div
                class="fixed inset-0 bg-black/45 backdrop-blur-xs"
                onClick={() => setMobileNavOpen(false)}
              />
              <div class="mobile-drawer relative z-50 h-full w-[272px] max-w-[82vw] overflow-y-auto shadow-glass">
                {sidebar()}
              </div>
            </div>
          </Show>

          <Show
            when={app.page() === "inbox"}
            fallback={
              <div class="grid h-full grid-cols-1 gap-0 md:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[264px_minmax(0,1fr)]">
                <div class="hidden h-full min-w-0 md:block">{sidebar()}</div>
                <Show when={app.page() === "compose"}>
                  <ComposeView
                    api={app.api}
                    userId={app.currentUser()?.id || ""}
                    mailbox={session.mailboxAddress() || ""}
                    aliases={session.aliases()?.aliases || []}
                    canSendExternal={session.canSend()}
                    sendableAddresses={session.sendableAddresses()}
                    prefill={composePrefill()}
                    onConsumePrefill={() => setComposePrefill(null)}
                    onOpenSent={() => app.setPage("sent")}
                  />
                </Show>
                <Show when={app.page() === "sent"}>
                  <SentView
                    api={app.api}
                    onResend={startResend}
                    onNewCompose={() => app.setPage("compose")}
                    canSend={canCompose()}
                  />
                </Show>
                <Show when={app.page() === "settings"}>
                  <UserSettingsView user={app.currentUser()!} api={app.api} />
                </Show>
                <Show when={app.page() === "admin"}>
                  <AdminSettingsView api={app.api} onDomainsChanged={() => void session.refetchMailbox()} />
                </Show>
              </div>
            }
          >
            <div class="grid h-full grid-cols-1 gap-0 md:grid-cols-[240px_minmax(280px,340px)_minmax(0,1fr)] xl:grid-cols-[264px_380px_minmax(0,1fr)]">
              <div class="hidden h-full min-w-0 md:block">{sidebar()}</div>

              <div class="h-full min-w-0" classList={{ "hidden md:block": Boolean(session.selectedId()) }}>
                <EmailList
                  mailboxAddress={session.displayAddress()}
                  messages={session.messages()}
                  loading={session.messagesLoading()}
                  selectedId={session.selectedId()}
                  setSelectedId={(id) => app.setSelectedId(id)}
                  hasMore={session.hasMore()}
                  loadingMore={session.loadingMore()}
                  loadMoreError={session.loadMoreError()}
                  onLoadMore={() => void session.loadMoreMessages()}
                  onMarkAllRead={() => void session.markAllRead()}
                  markingAllRead={session.markingAllRead()}
                />
              </div>

              <div class="h-full min-w-0" classList={{ "hidden md:block": !session.selectedId() }}>
                <EmailViewer
                  detail={session.detail() || null}
                  html={session.html() || ""}
                  text={session.text() || ""}
                  onReply={canCompose() ? startReply : undefined}
                  onForward={canCompose() ? startForward : undefined}
                  onToggleRead={(id, read) => void session.toggleMessageRead(id, read)}
                  onRetry={(id) => session.retryMessage(id)}
                  onDelete={(id) => session.deleteMessage(id)}
                  onBack={() => app.setSelectedId(null)}
                />
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

function Root() {
  const app = useApp();
  return <Show when={app.mode() === "user"} fallback={<GuestView />}><ConsoleView /></Show>;
}

export default function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <VisibilityProvider>
          <Root />
        </VisibilityProvider>
      </AppProvider>
    </ThemeProvider>
  );
}
