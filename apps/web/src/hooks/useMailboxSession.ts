import { createEffect, createMemo, createResource, createSignal } from "solid-js";
import type { AppContextValue } from "../context/AppContext";
import type { MessageDetail, MessageMeta } from "../types";
import { getLastSeen, setLastSeen } from "../services/lastSeen";

export function useMailboxSession(app: AppContextValue, getIsVisible: () => boolean) {
  const [displayAddress, setDisplayAddress] = createSignal("");

  const [mailboxAddress] = createResource(
    () => (app.mode() === "user" ? app.currentUser()?.id || "user" : ""),
    async (k) => {
      if (!k) return null;
      const data = await app.api.apiJson<{ address: string | null }>("/api/user/mailbox");
      return data.address;
    },
  );

  createEffect(() => {
    const addr = mailboxAddress();
    if (!addr) return;
    if (app.activeAddress() !== addr) app.setActiveAddress(addr);
    if (!displayAddress()) setDisplayAddress(addr);
  });

  const [aliases] = createResource(
    () => (app.mode() === "user" ? app.currentUser()?.id || "user" : ""),
    async (k) => {
      if (!k) return { mailbox: "", aliases: [] as string[] };
      const data = await app.api.apiJson<{ aliases: string[]; mailbox: string }>("/api/user/aliases");
      return { mailbox: data.mailbox || "", aliases: Array.isArray(data.aliases) ? data.aliases : [] };
    },
  );

  const activeOwnedAddress = createMemo(() => {
    if (app.page() !== "inbox") return "";
    return mailboxAddress() || "";
  });

  const currentUnseen = createMemo(() => {
    const addr = mailboxAddress() || "";
    if (!addr) return 0;
    return app.unseenByMailbox()[addr] ?? 0;
  });

  const [messages, { refetch: refetchMessages }] = createResource(() => mailboxAddress() || "", async (address) => {
    if (!address) return [];
    const data = await app.api.apiJson<{ messages: MessageMeta[] }>("/api/user/messages?limit=100");
    return data.messages;
  });

  const selectedId = createMemo(() => {
    if (app.page() !== "inbox") return null;
    if (!activeOwnedAddress()) return null;
    return app.selectedId();
  });

  const [detail] = createResource(selectedId, async (id) => {
    if (!id || app.page() !== "inbox") return null;
    const data = await app.api.apiJson<{ message: MessageDetail }>(`/api/messages/${encodeURIComponent(id)}`);
    return data.message;
  });

  const [html] = createResource(selectedId, async (id) => {
    if (!id || app.page() !== "inbox") return "";
    return app.api.apiText(`/api/messages/${encodeURIComponent(id)}/html`);
  });

  createEffect(() => {
    if (app.page() !== "inbox") return;
    const addr = activeOwnedAddress();
    const list = messages() || [];
    if (!addr || !getIsVisible() || list.length === 0) return;
    const max = list.reduce((acc, m) => Math.max(acc, m.receivedAt || 0), 0);
    if (!max) return;
    if (max > getLastSeen(addr)) setLastSeen(addr, max);
    app.setUnseen(addr, 0);
  });

  return {
    mailboxAddress,
    aliases,
    messages,
    refetchMessages,
    selectedId,
    detail,
    html,
    displayAddress,
    setDisplayAddress,
    activeOwnedAddress,
    currentUnseen,
  };
}
