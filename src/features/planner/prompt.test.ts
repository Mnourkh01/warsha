import { describe, expect, it } from "vitest";
import { buildContextPrompt, buildPlanPrompt } from "./prompt";

describe("buildPlanPrompt", () => {
  it("wraps the markdown between plan markers with the name and folder", () => {
    const out = buildPlanPrompt("# Plan: X\n\nBody.\n", {
      cwd: "C:\\dev\\x",
      planName: "X",
    });
    expect(out).toContain('Project plan: "X"');
    expect(out).toContain("Working folder: C:\\dev\\x");
    expect(out).toContain(".warsha/plan.md");
    const start = out.indexOf("--- PLAN START ---");
    const end = out.indexOf("--- PLAN END ---");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(out.slice(start, end)).toContain("# Plan: X");
    expect(out.endsWith("--- PLAN END ---")).toBe(true);
  });

  it("falls back to a neutral folder line without a cwd", () => {
    const out = buildPlanPrompt("plan", { planName: "P" });
    expect(out).toContain("Working folder: the folder this session started in");
    // No cwd means no on-disk mirror exists, so the prompt must not point at one.
    expect(out).not.toContain(".warsha/plan.md");
  });
});

describe("buildContextPrompt", () => {
  it("sends only context and accepted suggestions, never the plan body", () => {
    const out = buildContextPrompt({
      cwd: "C:\\dev\\x",
      planName: "Shop",
      suggestions: ["Add a payment gate before deploy", "Split phase 2"],
    });
    expect(out).toContain('project plan "Shop"');
    expect(out).toContain(".warsha/plan.md");
    expect(out).toContain(".warsha/plan.draft.json");
    expect(out).toContain("- Add a payment gate before deploy");
    expect(out).toContain("- Split phase 2");
    expect(out).not.toContain("--- PLAN START ---");
  });

  it("degrades to a pure context prompt when no suggestions were picked", () => {
    const out = buildContextPrompt({ cwd: "C:\\dev\\x", planName: "Shop", suggestions: [] });
    expect(out).toContain(".warsha/plan.md");
    expect(out).toContain("wait for my instructions");
    expect(out).not.toContain("Accepted improvements");
  });
});
