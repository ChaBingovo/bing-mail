import { expect, test } from "bun:test";
import { appendPage, createMessagePage, listMessages, mergeFirstPage, type MessagePage } from "../src/services/messagePages";
import type { MessageMeta } from "../src/types";

function msg(id: string, receivedAt: number): MessageMeta {
  return { id, receivedAt, subject: id };
}

function page(ids: string[], nextCursor: string | null): MessagePage {
  return { messages: ids.map((id, i) => msg(id, 1000 - i)), nextCursor };
}

test("createMessagePage dedupes by id and keeps insertion order", () => {
  const builder = createMessagePage();
  builder.add(page(["a", "b"], "c1"));
  builder.add(page(["b", "c"], "c2"));
  expect(builder.messages().map((m) => m.id)).toEqual(["a", "b", "c"]);
  expect(builder.nextCursor()).toBe("c2");
});

test("listMessages flattens page one and the cursor pages", () => {
  const list = listMessages(page(["a", "b"], "c1"), [page(["c", "d"], "c2")]);
  expect(list.messages().map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
  expect(list.nextCursor()).toBe("c2");
});

test("an unchanged first page refetch reports no change", () => {
  const previous = page(["a", "b"], "c1");
  const result = mergeFirstPage(previous, page(["a", "b"], "c1"), []);
  expect(result.changed).toBe(false);
});

test("new mail at the top drops the duplicates page one now covers", () => {
  const older = [page(["c", "d"], "c2"), page(["d", "e"], "c3")];
  const result = mergeFirstPage(page(["c", "d"], "c2"), page(["a", "b", "c", "d"], "c1"), older);
  expect(result.changed).toBe(true);
  expect(result.first.messages.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
  expect(result.older[0].messages.map((m) => m.id)).toEqual(["e"]);
});

test("appending a tail page grows the list without reordering", () => {
  const loaded = [page(["a", "b"], "c1"), page(["c", "d"], "c1")];
  const pages = appendPage(loaded, page(["e", "f"], "c2"));
  expect(pages.flatMap((p) => p.messages.map((m) => m.id))).toEqual(["a", "b", "c", "d", "e", "f"]);
  expect(pages[pages.length - 1].nextCursor).toBe("c2");
});

test("appendPage drops messages that are already loaded", () => {
  const loaded = [page(["a", "b"], "c1")];
  const pages = appendPage(loaded, page(["b", "c"], "c2"));
  expect(pages.flatMap((p) => p.messages.map((m) => m.id))).toEqual(["a", "b", "c"]);
});

test("FAILED is a valid status on the wire type", () => {
  const failed: MessageMeta = { id: "x", status: "FAILED" };
  expect(failed.status).toBe("FAILED");
});
