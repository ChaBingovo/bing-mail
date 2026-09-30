import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCAL_STATE_DIRS, clearLocalState } from "../scripts/local-state";

const roots: string[] = [];

/** Builds a realistic <root>/.wrangler/state tree and returns the temp root. */
function makeLocalState() {
  const root = mkdtempSync(join(tmpdir(), "bingmail-state-"));
  roots.push(root);
  const state = join(root, ".wrangler", "state", "v3");

  for (const dir of LOCAL_STATE_DIRS) {
    mkdirSync(join(root, ".wrangler", dir), { recursive: true });
    writeFileSync(join(root, ".wrangler", dir, "payload.bin"), "data");
  }
  // D1 is the one thing a reset must NOT delete here (the SQL reset drops tables).
  mkdirSync(join(state, "d1"), { recursive: true });
  writeFileSync(join(state, "d1", "bingmail.sqlite"), "db");
  writeFileSync(join(root, ".wrangler", "keep-me.txt"), "unrelated");

  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("a reset drops attachments, DO state and cache", () => {
  const root = makeLocalState();
  clearLocalState(root);

  for (const dir of LOCAL_STATE_DIRS) {
    expect(existsSync(join(root, ".wrangler", dir))).toBe(false);
  }
  // the D1 database survives: it is emptied by SQL, not by deleting the file
  expect(existsSync(join(root, ".wrangler", "state", "v3", "d1", "bingmail.sqlite"))).toBe(true);
  // and files outside those directories are left alone
  expect(existsSync(join(root, ".wrangler", "keep-me.txt"))).toBe(true);
});

test("clearing twice is a no-op instead of an error", () => {
  const root = makeLocalState();
  clearLocalState(root);
  expect(() => clearLocalState(root)).not.toThrow();
});

test("a missing state tree does not break the reset", () => {
  const root = mkdtempSync(join(tmpdir(), "bingmail-empty-"));
  roots.push(root);
  expect(() => clearLocalState(root)).not.toThrow();
});

test("every directory the reset is expected to clear is covered", () => {
  // Guards against someone adding a new local-state dir and forgetting the reset.
  expect([...LOCAL_STATE_DIRS]).toEqual(["state/v3/r2", "state/v3/do", "state/v3/cache"]);
});