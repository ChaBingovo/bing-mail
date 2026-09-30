import type { MessageMeta } from "../types";

export type MessagePage = {
  messages: MessageMeta[];
  nextCursor: string | null;
};

/** Builds one screen-ordered, id-deduped list out of several pages. */
export function createMessagePage() {
  const map = new Map<string, MessageMeta>();
  let nextCursor: string | null = null;

  return {
    add(page: MessagePage) {
      for (const message of page.messages || []) map.set(message.id, message);
      if (page.nextCursor !== undefined) nextCursor = page.nextCursor ?? null;
    },
    /** Server order is newest first, so insertion order is the display order. */
    messages() {
      return Array.from(map.values());
    },
    nextCursor() {
      return nextCursor;
    },
  };
}

/** Flat list of first page followed by the cursor pages already fetched. */
export function listMessages(first: MessagePage | undefined | null, older: MessagePage[]) {
  const builder = createMessagePage();
  builder.add({ messages: first?.messages || [], nextCursor: first?.nextCursor ?? null });
  for (const page of older) builder.add(page);
  return builder;
}

const sameIds = (a: MessageMeta[], b: MessageMeta[]) =>
  a.length === b.length && a.every((m, i) => m.id === b[i]?.id);

/**
 * Poll refetch of page one: page one is replaced in place, and any older page that
 * is now empty (or contains nothing beyond the fresh head) is dropped.
 */
export function mergeFirstPage(
  previousFirst: MessagePage | undefined,
  fresh: MessagePage,
  older: MessagePage[],
): { first: MessagePage; older: MessagePage[]; changed: boolean } {
  const headChanged = !previousFirst || !sameIds(previousFirst.messages, fresh.messages);
  const cursorChanged = previousFirst?.nextCursor !== fresh.nextCursor;
  if (!headChanged && !cursorChanged) return { first: fresh, older, changed: false };
  if (!headChanged) return { first: fresh, older, changed: true };

  const seen = new Set(fresh.messages.map((m) => m.id));
  const trimmed = older
    .map((page) => ({ ...page, messages: page.messages.filter((m) => !seen.has(m.id)) }))
    .filter((page) => page.messages.length > 0);

  return { first: fresh, older: trimmed, changed: true };
}

/** Cursor pagination: the tail page is appended, duplicates in the new page are dropped. */
export function appendPage(loaded: MessagePage[], next: MessagePage): MessagePage[] {
  const seen = new Set<string>();
  for (const page of loaded) for (const message of page.messages) seen.add(message.id);

  const additions = (next.messages || []).filter((m) => !seen.has(m.id));
  const pages = loaded.map((page) => ({ ...page, messages: page.messages.slice() }));
  if (pages.length === 0) return [{ messages: additions, nextCursor: next.nextCursor ?? null }];
  pages[pages.length - 1] = {
    messages: [...pages[pages.length - 1].messages, ...additions],
    nextCursor: next.nextCursor ?? null,
  };
  return pages;
}