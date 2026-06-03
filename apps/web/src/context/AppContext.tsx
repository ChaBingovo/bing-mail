import { createContext, createMemo, createSignal, useContext } from "solid-js";
import type { AuthUser } from "../types";
import { createApiClient } from "../services/api";
import { getJson, getString, removeKey, setJson, setString } from "../services/storage";

export type AppMode = "guest" | "user";

export type AppPage = "inbox" | "settings" | "admin";

export type AppContextValue = {
  mode: () => AppMode;
  setMode: (v: AppMode) => void;
  page: () => AppPage;
  setPage: (v: AppPage) => void;
  token: () => string | null;
  currentUser: () => AuthUser | null;
  activeAddress: () => string;
  setActiveAddress: (v: string) => void;
  selectedId: () => string | null;
  setSelectedId: (v: string | null) => void;
  unseenByMailbox: () => Record<string, number>;
  setUnseen: (address: string, count: number) => void;
  login: (user: AuthUser, token?: string | null) => void;
  logout: () => void;
  toGuest: () => void;
  api: ReturnType<typeof createApiClient>;
};

const USER_KEY = "bingmail.user";
const PAGE_KEY = "bingmail.page";

const Ctx = createContext<AppContextValue>();

export function AppProvider(props: { children: any }) {
  const [token, setToken] = createSignal<string | null>(null);
  const [currentUser, setCurrentUser] = createSignal<AuthUser | null>(getJson<AuthUser>(USER_KEY));
  const initialMode = ((): AppMode => {
    if (currentUser()) return "user";
    return "guest";
  })();
  const [mode, setMode] = createSignal<AppMode>(initialMode);

  const mailboxKey = createMemo(() => {
    if (mode() === "user") return `bingmail.mailbox.user.${currentUser()?.id || "unknown"}`;
    return "bingmail.mailbox";
  });

  const selectedKey = createMemo(() => {
    if (mode() === "user") return `bingmail.selected.user.${currentUser()?.id || "unknown"}`;
    return "bingmail.selected";
  });

  const pageKey = createMemo(() => {
    if (mode() === "user") return `${PAGE_KEY}.user.${currentUser()?.id || "unknown"}`;
    return PAGE_KEY;
  });

  const [activeAddress, _setActiveAddress] = createSignal(getString(mailboxKey()) || "");
  const [selectedId, _setSelectedId] = createSignal<string | null>(getString(selectedKey()) || null);
  const [unseenByMailbox, setUnseenByMailbox] = createSignal<Record<string, number>>({});
  const [page, _setPage] = createSignal<AppPage>((getString(pageKey()) as AppPage) || "inbox");

  const toGuest = () => {
    removeKey(USER_KEY);
    setToken(null);
    setCurrentUser(null);
    setMode("guest");
    setString(pageKey(), "inbox");
    _setPage("inbox");
  };

  const api = createApiClient(() => token(), toGuest);

  const setActiveAddress = (v: string) => {
    const addr = (v || "").trim().toLowerCase();
    _setActiveAddress(addr);
    setString(mailboxKey(), addr);
  };

  const setSelectedId = (v: string | null) => {
    const id = v || "";
    _setSelectedId(v || null);
    setString(selectedKey(), id);
  };

  const setUnseen = (address: string, count: number) => {
    const addr = (address || "").trim().toLowerCase();
    setUnseenByMailbox((m) => ({ ...m, [addr]: Math.max(count || 0, 0) }));
  };

  const setPage = (v: AppPage) => {
    _setPage(v);
    setString(pageKey(), v);
  };

  const login = (user: AuthUser, tokenValue?: string | null) => {
    setJson(USER_KEY, user);
    setCurrentUser(user);
    setToken(tokenValue || null);
    setMode("user");
    setPage("inbox");
  };

  const logout = () => {
    void api.apiJson("/api/auth/logout", { method: "POST" }).catch(() => {});
    toGuest();
  };

  const value: AppContextValue = {
    mode,
    setMode,
    page,
    setPage,
    token,
    currentUser,
    activeAddress,
    setActiveAddress,
    selectedId,
    setSelectedId,
    unseenByMailbox,
    setUnseen,
    login,
    logout,
    toGuest,
    api,
  };

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppContextMissing");
  return v;
}
