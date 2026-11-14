import { expect, test } from "bun:test";
import { nextThemeMode, parseThemeMode, resolveTheme } from "../src/context/ThemeContext";

test("parseThemeMode accepts system, light, dark and falls back to system", () => {
  expect(parseThemeMode("light")).toBe("light");
  expect(parseThemeMode("dark")).toBe("dark");
  expect(parseThemeMode("system")).toBe("system");
  expect(parseThemeMode("unknown")).toBe("system");
  expect(parseThemeMode(null)).toBe("system");
});

test("resolveTheme resolves explicit modes and follows system preference", () => {
  expect(resolveTheme("light", false)).toBe("light");
  expect(resolveTheme("dark", true)).toBe("dark");
  expect(resolveTheme("system", true)).toBe("light");
  expect(resolveTheme("system", false)).toBe("dark");
});

test("nextThemeMode cycles system -> light -> dark -> system", () => {
  expect(nextThemeMode("system")).toBe("light");
  expect(nextThemeMode("light")).toBe("dark");
  expect(nextThemeMode("dark")).toBe("system");
});
