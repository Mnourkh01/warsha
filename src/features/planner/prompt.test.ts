import { describe, expect, it } from "vitest";
import { buildClaudePrompt } from "./prompt";

describe("buildClaudePrompt", () => {
  it("wraps the markdown between plan markers with the name and folder", () => {
    const out = buildClaudePrompt("# Plan: X\n\nBody.\n", {
      cwd: "C:\\dev\\x",
      planName: "X",
    });
    expect(out).toContain('project plan named "X"');
    expect(out).toContain("Working folder: C:\\dev\\x");
    const start = out.indexOf("--- PLAN START ---");
    const end = out.indexOf("--- PLAN END ---");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(out.slice(start, end)).toContain("# Plan: X");
    expect(out.endsWith("--- PLAN END ---")).toBe(true);
  });

  it("falls back to a neutral folder line without a cwd", () => {
    const out = buildClaudePrompt("plan", { planName: "P" });
    expect(out).toContain("Working folder: the folder this session started in");
  });
});
