import { Show, createEffect, createResource, createSignal, onCleanup } from "solid-js";
import { EmailList } from "./components/EmailList";
import { EmailViewer } from "./components/EmailViewer";
import { LoginCard } from "./components/LoginCard";
import { RegisterCard } from "./components/RegisterCard";
import { SetupView } from "./components/SetupView";
import { Sidebar } from "./components/Sidebar";
import { AdminSettingsView } from "./components/AdminSettingsView";
import { UserSettingsView } from "./components/UserSettingsView";
import { NotificationIsland } from "./components/NotificationIsland";
import { Spotlight } from "./components/Spotlight";
import { AppProvider, useApp } from "./context/AppContext";
import { VisibilityProvider, useVisibility } from "./context/VisibilityContext";
import type { AuthUser } from "./types";
import { useMailboxSession } from "./hooks/useMailboxSession";
import { useInboxNotifications } from "./hooks/useInboxNotifications";
import { createMailSyncController } from "./services/mailSyncController";
import { createSpotlightActionBuilder } from "./services/spotlightActions";

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
      const data = await app.api.apiJson<{ user: AuthUser; token?: string }>("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      app.login(data.user, data.token);
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
      const data = await app.api.apiJson<{ user: AuthUser; token?: string }>("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, mailboxLocal, domain }),
      });
      app.login(data.user, data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setLoading(false);
    }
  };

  return (
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
      <SetupView onInitialized={(user, token) => app.login(user, token)} />
    </Show>
  );
}

function ConsoleView() {
  const app = useApp();
  const { isVisible } = useVisibility();

  const [spotlightOpen, setSpotlightOpen] = createSignal(false);
  const session = useMailboxSession(app, isVisible);
  const notifications = useInboxNotifications({
    mailboxAddress: () => session.mailboxAddress() || "",
    messages: () => session.messages() || [],
  });

  const sync = createMailSyncController({
    getAddress: () => (session.mailboxAddress() || "").trim().toLowerCase(),
    getIsVisible: isVisible,
    apiJson: app.api.apiJson,
    onUnreadChange: (address, count) => app.setUnseen(address, count),
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

  const getSpotlightActions = createSpotlightActionBuilder({
    app,
    mailbox: () => session.mailboxAddress() || "",
    aliases: () => session.aliases()?.aliases || [],
    displayAddress: session.displayAddress,
    setDisplayAddress: session.setDisplayAddress,
    messages: () => session.messages() || [],
  });

  const sidebar = () => (
    <Sidebar
      user={app.currentUser()!}
      page={app.page()}
      setPage={app.setPage}
      activeAddress={session.displayAddress() || session.mailboxAddress() || ""}
      currentUnseen={session.currentUnseen()}
      onRefresh={() => session.refetchMessages()}
      onLogout={() => app.logout()}
      onOpenSpotlight={() => setSpotlightOpen(true)}
    />
  );

  return (
    <div class="relative h-dvh w-full overflow-hidden p-4">
      <Show when={notifications.island()}>
        <NotificationIsland data={notifications.island()!} closing={notifications.islandClosing()} onClose={notifications.closeIsland} />
      </Show>
      <Spotlight open={spotlightOpen()} onClose={() => setSpotlightOpen(false)} getActions={getSpotlightActions} />

      <div class="glass-shell h-full overflow-hidden rounded-[28px]">
        <Show
          when={app.page() === "inbox"}
          fallback={
            <div class="grid h-full grid-cols-[280px_1fr] gap-0">
              {sidebar()}
              <Show when={app.page() === "settings"}>
                <UserSettingsView user={app.currentUser()!} api={app.api} />
              </Show>
              <Show when={app.page() === "admin"}>
                <AdminSettingsView api={app.api} />
              </Show>
            </div>
          }
        >
          <div class="grid h-full grid-cols-[280px_440px_1fr] gap-0">
            {sidebar()}

            <EmailList
              mailboxAddress={session.displayAddress() || session.activeOwnedAddress()}
              messages={session.messages() || []}
              loading={session.messages.state !== "ready"}
              selectedId={session.selectedId()}
              setSelectedId={(id) => app.setSelectedId(id)}
            />

            <EmailViewer detail={session.detail() || null} html={session.html() || ""} text={session.text() || ""} />
          </div>
        </Show>
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
    <AppProvider>
      <VisibilityProvider>
        <Root />
      </VisibilityProvider>
    </AppProvider>
  );
}
