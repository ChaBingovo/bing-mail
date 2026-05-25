import { createContext, createMemo, createSignal, useContext } from "solid-js";
import type { AuthUser } from "../types";
import { createApiClient } from "../services/api";
import { getJson, getString, removeKey, setJson, setString } from "../services/storage";

export type AppMode = "guest" | "anon" | "user";

export type AppContextValue = {
  mode: () => AppMode;
  setMode: (v: AppMode) => void;
  token: () => string | null;
  currentUser: () => AuthUser | null;
  activeAddress: () => string;
  setActiveAddress: (v: string) => void;
  selectedId: () => string | null;
  setSelectedId: (v: string | null) => void;
  unseenByMailbox: () => Record<string, number>;
  setUnseen: (address: string, count: number) => void;
  login: (user: AuthUser, token: string) => void;
  logout: () => void;
  enterAnon: () => void;
  toGuest: () => void;
  api: ReturnType<typeof createApiClient>;
};

const TOKEN_KEY = "bingmail.token";
const USER_KEY = "bingmail.user";
const MODE_KEY = "bingmail.mode";

const Ctx = createContext<AppContextValue>();

export function AppProvider(props: { children: any }) {
  const [token, setToken] = createSignal<string | null>(getString(TOKEN_KEY));
  const [currentUser, setCurrentUser] = createSignal<AuthUser | null>(getJson<AuthUser>(USER_KEY));
  const initialMode = ((): AppMode => {
    if (token() && currentUser()) return "user";
    const saved = getString(MODE_KEY);
    if (saved === "anon") return "anon";
    return "guest";
  })();
  const [mode, setMode] = createSignal<AppMode>(initialMode);

  const mailboxKey = createMemo(() => {
    const m = mode();
    if (m === "user") return `bingmail.mailbox.user.${currentUser()?.id || "unknown"}`;
    return "bingmail.mailbox";
  });

  const selectedKey = createMemo(() => {
    const m = mode();
    if (m === "user") return `bingmail.selected.user.${currentUser()?.id || "unknown"}`;
    return "bingmail.selected";
  });

  const [activeAddress, _setActiveAddress] = createSignal(getString(mailboxKey()) || "");
  const [selectedId, _setSelectedId] = createSignal<string | null>(getString(selectedKey()) || null);
  const [unseenByMailbox, setUnseenByMailbox] = createSignal<Record<string, number>>({});

  const toGuest = () => {
    removeKey(TOKEN_KEY);
    removeKey(USER_KEY);
    setToken(null);
    setCurrentUser(null);
    setString(MODE_KEY, "guest");
    setMode("guest");
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

  const login = (user: AuthUser, tokenValue: string) => {
    setJson(USER_KEY, user);
    setString(TOKEN_KEY, tokenValue);
    setString(MODE_KEY, "user");
    setCurrentUser(user);
    setToken(tokenValue);
    setMode("user");
  };

  const logout = () => {
    toGuest();
  };

  const enterAnon = () => {
    setString(MODE_KEY, "anon");
    setMode("anon");
  };

  const value: AppContextValue = {
    mode,
    setMode,
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
    enterAnon,
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

