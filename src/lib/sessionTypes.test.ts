import { describe, expect, it } from "vitest";
import {
  AI_TYPES,
  SHELL_TYPES,
  buildShell,
  sessionLabel,
  shellTypeOf,
} from "./sessionTypes";
import { quotePath } from "../features/terminal/terminalDrop";

const claude = AI_TYPES.find((a) => a.id === "claude")!;
const byId = (id: string) => SHELL_TYPES.find((s) => s.id === id)!;

describe("buildShell matrix", () => {
  it("plain shells pass through unchanged", () => {
    for (const s of SHELL_TYPES) {
      expect(buildShell(s, null)).toEqual(s.shell);
    }
  });

  it("launches the AI CLI inside each shell and keeps the shell alive", () => {
    expect(buildShell(byId("powershell"), claude)).toEqual({
      kind: "custom",
      program: "powershell.exe",
      args: ["-NoLogo", "-NoExit", "-Command", "claude"],
    });
    expect(buildShell(byId("cmd"), claude)).toEqual({
      kind: "custom",
      program: "cmd.exe",
      args: ["/K", "claude"],
    });
    expect(buildShell(byId("wsl"), claude)).toEqual({
      kind: "custom",
      program: "wsl.exe",
      args: ["--", "bash", "-lic", "claude; exec bash"],
    });
    expect(buildShell(byId("bash"), claude)).toEqual({
      kind: "custom",
      program: "bash.exe",
      args: ["-l", "-i", "-c", "claude; exec bash -l -i"],
    });
  });

  it("labels sessions by AI when one is picked, else by shell", () => {
    expect(sessionLabel(byId("cmd"), claude)).toBe("Claude Code");
    expect(sessionLabel(byId("cmd"), null)).toBe("Command Prompt");
  });
});

describe("shellTypeOf", () => {
  it("maps stored shells back to catalog entries", () => {
    expect(shellTypeOf({ kind: "wsl" }).id).toBe("wsl");
    expect(shellTypeOf({ kind: "custom", program: "bash.exe", args: ["-i", "-l"] }).id).toBe(
      "bash",
    );
  });

  it("falls back to PowerShell for unknown custom shells", () => {
    expect(shellTypeOf({ kind: "custom", program: "nu.exe" }).id).toBe("powershell");
  });
});

describe("quotePath", () => {
  it("leaves plain paths bare and quotes anything shell-hostile", () => {
    expect(quotePath("C:\\repo\\file.txt")).toBe("C:\\repo\\file.txt");
    expect(quotePath("C:\\my repo\\a.txt")).toBe('"C:\\my repo\\a.txt"');
    expect(quotePath("C:\\a&b\\x.png")).toBe('"C:\\a&b\\x.png"');
  });
});
