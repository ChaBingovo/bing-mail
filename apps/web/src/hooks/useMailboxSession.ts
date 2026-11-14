import { createEffect, createMemo, createResource, createSignal } from "solid-js";
import { appendPage, dropMessage, listMessages, mergeFirstPage, type MessagePage } from "../services/messagePages";
import type { AppContextValue } from "../context/AppContext";
import type { MessageDetail, MessageMeta, RedDotResponse } from "../types";
import { clearLastSeen, getLastSeen } from "../services/lastSeen";

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

  // Page one always uses a stable limit, so a poll refetch can be merged with the
  // pages loaded by "load more" by message id. Older pages are appended on demand.
  const FIRST_PAGE_LIMIT = 100;
  const NEXT_PAGE_LIMIT = 50;

  // Extra pages fetched via the cursor, appended after page one. Page one is not
  // mirrored here: a poll refetch replaces it in place.
  const [morePages, setMorePages] = createSignal<MessagePage[]>([]);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [loadMoreError, setLoadMoreError] = createSignal("");

  const messagesQueryKey = createMemo(() => {
    const address = mailboxAddress();
    if (!address) return null;
    return { address, filter: displayAddress().trim().toLowerCase() };
  });

  const [firstPage, { refetch: refetchMessages }] = createResource(messagesQueryKey, async (key) => {
    if (!key) return { messages: [] as MessageMeta[], nextCursor: null } satisfies MessagePage;
    const filterParam = key.filter ? `&address=${encodeURIComponent(key.filter)}` : "";
    const data = await app.api.apiJson<MessagePage>(`/api/user/messages?limit=${FIRST_PAGE_LIMIT}${filterParam}`);
    return { messages: data.messages || [], nextCursor: data.nextCursor ?? null } satisfies MessagePage;
  });

  /** Page one plus every cursor page loaded so far, deduped and in display order. */
  const messages = createMemo(() => listMessages(firstPage(), morePages()));

  const loadMoreMessages = async () => {
    const address = mailboxAddress();
    const cursor = messages().nextCursor();
    if (!address || !cursor || loadingMore()) return;
    setLoadingMore(true);
    setLoadMoreError("");
    try {
      const filter = displayAddress().trim().toLowerCase();
      const filterParam = filter ? `&address=${encodeURIComponent(filter)}` : "";
      const data = await app.api.apiJson<MessagePage>(
        `/api/user/messages?limit=${NEXT_PAGE_LIMIT}&cursor=${encodeURIComponent(cursor)}${filterParam}`,
      );
      const fresh: MessagePage = { messages: data.messages || [], nextCursor: data.nextCursor ?? null };
      setMorePages((pages) => appendPage(pages, fresh));
    } catch (err) {
      setLoadMoreError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoadingMore(false);
    }
  };

  const displayedMessages = createMemo(() => messages().messages());
  const hasMore = createMemo(() => Boolean(messages().nextCursor()));

  // Reset pagination whenever the mailbox or inbox filter changes.
  createEffect(() => {
    mailboxAddress();
    displayAddress();
    setMorePages([]);
    setLoadMoreError("");
  });

  // A poll refetch is a page-one lookup. Keep the older pages, but drop the
  // duplicates it now covers so nothing is rendered twice.
  let seenFirstPage: MessagePage | undefined;
  createEffect(() => {
    const first = firstPage();
    if (!first) return;
    const result = mergeFirstPage(seenFirstPage, first, morePages());
    seenFirstPage = first;
    if (result.changed && result.older.length !== morePages().length) {
      setMorePages(result.older);
    }
  });

  const selectedId = createMemo(() => {
    if (app.page() !== "inbox") return null;
    if (!activeOwnedAddress()) return null;
    return app.selectedId();
  });

  const [detail, { refetch: refetchDetail }] = createResource(selectedId, async (id) => {
    if (!id || app.page() !== "inbox") return null;
    const data = await app.api.apiJson<{ message: MessageDetail }>(`/api/messages/${encodeURIComponent(id)}`);
    return data.message;
  });

  /** Server-owned read marker; `since` in the red-dot response is authoritative. */
  const [readMarker, setReadMarker] = createSignal(0);
  /** Highest receivedAt seen locally, used to advance the read marker. */
  const [observedMax, setObservedMax] = createSignal(0);
  /** Guards the one-time upload of the legacy browser-local marker. */
  let legacyMarkerPushed = false;

  /** Re-queue a FAILED message for parsing; refreshes both the row and the list. */
  const retryMessage = async (id: string) => {
    await app.api.apiJson(`/api/messages/${encodeURIComponent(id)}/retry`, { method: "POST" });
    void refetchDetail();
    void refetchMessages();
  };

  /** Deletes a message and drops it from the local list without a full refetch. */
  const deleteMessage = async (id: string) => {
    await app.api.apiText(`/api/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (app.selectedId() === id) app.setSelectedId(null);
    dropLocalMessage(id);
    void refetchMessages();
  };

  const dropLocalMessage = (id: string) => {
    setMorePages((pages) => dropMessage(pages, id));
  };

  const [html] = createResource(selectedId, async (id) => {
    if (!id || app.page() !== "inbox") return "";
    return app.api.apiText(`/api/messages/${encodeURIComponent(id)}/html`);
  });

  const [text] = createResource(selectedId, async (id) => {
    if (!id || app.page() !== "inbox") return "";
    return app.api.apiText(`/api/messages/${encodeURIComponent(id)}/text`);
  });

  createEffect(() => {
    if (app.page() !== "inbox") return;
    const addr = activeOwnedAddress();
    const list = displayedMessages();
    if (!addr || !list.length) return;

    const max = list.reduce((acc, m) => Math.max(acc, m.receivedAt || 0), 0);
    if (max > observedMax()) setObservedMax(max);
    app.setUnseen(addr, 0);
  });

  // One-time migration: browsers that only knew the localStorage marker push it to
  // the server so already-read mail does not reappear as unread.
  createEffect(() => {
    const addr = activeOwnedAddress();
    if (!addr || getIsVisible() || legacyMarkerPushed) return;
    if (app.page() !== "inbox") return;
    legacyMarkerPushed = true;
    const legacy = getLastSeen(addr);
    if (legacy <= 0) return;
    void app.api
      .apiJson<RedDotResponse>("/api/user/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ receivedAt: legacy }),
      })
      .then((data) => {
        setReadMarker(data.since || 0);
        clearLastSeen(addr);
      })
      .catch(() => undefined);
  });

  // Advance the server marker once the visible list has settled.
  createEffect(() => {
    const addr = activeOwnedAddress();
    const max = observedMax();
    if (!addr || !getIsVisible() || app.page() !== "inbox") return;
    if (max <= 0 || max <= readMarker()) return;
    void app.api
      .apiJson<RedDotResponse>("/api/user/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ receivedAt: max }),
      })
      .then((data) => setReadMarker(data.since || 0))
      .catch(() => undefined);
  });

  return {
    readMarker,
    setReadMarker,
    mailboxAddress,
    aliases,
    messages: displayedMessages,
    messagesLoading: () => Boolean(firstPage.loading),
    refetchMessages,
    loadMoreMessages,
    loadingMore,
    loadMoreError,
    hasMore,
    selectedId,
    detail,
    html,
    text,
    retryMessage,
    deleteMessage,
    displayAddress,
    setDisplayAddress,
    activeOwnedAddress,
    currentUnseen,
  };
}
