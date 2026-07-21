import { describe, expect, it } from "vitest";
import { useSettings } from "./settings";

// hydrate() takes the persisted blob, which is untrusted (hand-edited, corrupt, or from
// an older build). Every field must be validated at this boundary - a bad fontSize used
// to reach xterm unclamped.
describe("settings hydrate sanitization", () => {
  it("clamps and rounds fontSize, rejects non-numbers", () => {
    useSettings.getState().hydrate({ fontSize: 500 });
    expect(useSettings.getState().fontSize).toBe(28);
    useSettings.getState().hydrate({ fontSize: 1 });
    expect(useSettings.getState().fontSize).toBe(9);
    useSettings.getState().hydrate({ fontSize: 13.6 });
    expect(useSettings.getState().fontSize).toBe(14);
    useSettings.getState().hydrate({ fontSize: Number.NaN });
    expect(useSettings.getState().fontSize).toBe(14);
    useSettings.getState().hydrate({ fontSize: "12" as never });
    expect(useSettings.getState().fontSize).toBe(14);
  });

  it("rejects unknown theme values", () => {
    useSettings.getState().hydrate({ theme: "purple" as never, terminalTheme: "neon" as never });
    expect(useSettings.getState().theme).toBe("dark");
    expect(useSettings.getState().terminalTheme).toBe("dark");
    useSettings.getState().hydrate({ theme: "light", terminalTheme: "match" });
    expect(useSettings.getState().theme).toBe("light");
    expect(useSettings.getState().terminalTheme).toBe("match");
  });

  it("validates the default shell shape", () => {
    useSettings.getState().hydrate({ defaultShell: { kind: "wsl" } });
    expect(useSettings.getState().defaultShell).toEqual({ kind: "wsl" });
    // custom without a program string is invalid -> default
    useSettings.getState().hydrate({ defaultShell: { kind: "custom" } as never });
    expect(useSettings.getState().defaultShell).toEqual({ kind: "powershell" });
    useSettings.getState().hydrate({ defaultShell: { kind: "rocket" } as never });
    expect(useSettings.getState().defaultShell).toEqual({ kind: "powershell" });
    useSettings.getState().hydrate({ defaultShell: "cmd" as never });
    expect(useSettings.getState().defaultShell).toEqual({ kind: "powershell" });
  });

  it("accepts only known locales, falls back to English", () => {
    useSettings.getState().hydrate({ locale: "ar" });
    expect(useSettings.getState().locale).toBe("ar");
    useSettings.getState().hydrate({ locale: "fr" as never });
    expect(useSettings.getState().locale).toBe("en");
    useSettings.getState().hydrate({});
    expect(useSettings.getState().locale).toBe("en");
  });

  it("normalizes optional strings and booleans", () => {
    useSettings.getState().hydrate({
      termForeground: "   ",
      defaultCwd: "",
      termBold: "yes" as never,
    });
    expect(useSettings.getState().termForeground).toBeUndefined();
    expect(useSettings.getState().defaultCwd).toBeUndefined();
    expect(useSettings.getState().termBold).toBe(false);
    useSettings.getState().hydrate({ termForeground: "#aabbcc", termBold: true });
    expect(useSettings.getState().termForeground).toBe("#aabbcc");
    expect(useSettings.getState().termBold).toBe(true);
  });
});
