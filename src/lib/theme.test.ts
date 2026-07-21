import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme";
import { resolveTerminalTheme } from "../store/settings";
import { paneRows } from "../store/workspaces";

describe("theme resolution chain", () => {
  it("explicit modes pass through", () => {
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });

  it("system mode defaults to dark when matchMedia is unavailable", () => {
    // jsdom has no matchMedia; the ?? true fallback must pick dark, not crash.
    expect(resolveTheme("system")).toBe("dark");
  });

  it("terminal theme follows the app only in match mode", () => {
    expect(resolveTerminalTheme("dark", "light")).toBe("dark");
    expect(resolveTerminalTheme("light", "dark")).toBe("light");
    expect(resolveTerminalTheme("match", "light")).toBe("light");
    expect(resolveTerminalTheme("match", "dark")).toBe("dark");
  });
});

describe("paneRows", () => {
  it("splits ids into rows of three", () => {
    expect(paneRows([])).toEqual([]);
    expect(paneRows(["a"])).toEqual([["a"]]);
    expect(paneRows(["a", "b", "c"])).toEqual([["a", "b", "c"]]);
    expect(paneRows(["a", "b", "c", "d"])).toEqual([["a", "b", "c"], ["d"]]);
    expect(paneRows(["a", "b", "c", "d", "e", "f"])).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
  });
});
