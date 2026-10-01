import { expect, test } from "bun:test";
import type { AppContextValue } from "../src/context/AppContext";
import { createSpotlightActionBuilder } from "../src/services/spotlightActions";

function build(opts: { isAdmin?: boolean } = {}) {
  const picked: { page?: string; selectedId?: string | null } = {};
  const app = {
    setPage: (page: string) => {
      picked.page = page;
    },
    setSelectedId: (id: string | null) => {
      picked.selectedId = id;
    },
    currentUser: () => ({ id: "u1", username: "alice", isAdmin: Boolean(opts.isAdmin) }),
  } as unknown as AppContextValue;

  const builder = createSpotlightActionBuilder({
    app,
    mailbox: () => "me@example.test",
    aliases: () => [],
    displayAddress: () => "me@example.test",
    setDisplayAddress: () => {},
    messages: () => [],
  });
  return { builder, picked };
}

test("the palette offers a compose action that opens the composer", () => {
  const { builder, picked } = build();
  const compose = builder("").find((a) => a.key === "nav-compose");
  expect(compose?.title).toBe("写邮件");
  compose!.onPick();
  expect(picked.page).toBe("compose");
});

test("typing a compose hint keeps the action", () => {
  const { builder } = build();
  expect(builder("写邮件").some((a) => a.key === "nav-compose")).toBe(true);
  expect(builder("写").some((a) => a.key === "nav-compose")).toBe(true);
  expect(builder("写").find((a) => a.key === "nav-compose")?.subtitle).toBe("撰写并发送新邮件");
});

test("navigation actions still cover the other pages", () => {
  const { builder, picked } = build();
  const keys = builder("").map((a) => a.key);
  expect(keys).toContain("nav-inbox");
  expect(keys).toContain("nav-compose");
  expect(keys).toContain("nav-settings");

  builder("收件箱").find((a) => a.key === "nav-inbox")!.onPick();
  expect(picked.page).toBe("inbox");
});

test("the admin entry is only offered to admins", () => {
  expect(build({ isAdmin: true }).builder("").some((a) => a.key === "nav-admin")).toBe(true);
  expect(build({ isAdmin: false }).builder("").some((a) => a.key === "nav-admin")).toBe(false);
});
