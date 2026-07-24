import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/ipc", () => ({
  runHeadless: vi.fn(),
  whichProgram: vi.fn(),
}));

import { buildReviewPrompt, parseReview } from "./review";

describe("buildReviewPrompt", () => {
  it("embeds the plan between markers and demands bare JSON", () => {
    const out = buildReviewPrompt("# Plan: X\n\n- [ ] Task\n");
    expect(out).toContain("ONLY one JSON object");
    expect(out).toContain("--- PLAN START ---");
    expect(out).toContain("# Plan: X");
    expect(out.endsWith("--- PLAN END ---")).toBe(true);
  });
});

describe("parseReview", () => {
  const good = {
    verdict: "okay",
    summary: "Solid start.",
    strengths: ["clear phases"],
    weaknesses: ["no error handling"],
    improvements: ["add exit criteria"],
    tools: [{ name: "vitest", reason: "unit tests" }],
  };

  it("parses a clean JSON answer", () => {
    const r = parseReview(JSON.stringify(good));
    expect(r?.verdict).toBe("okay");
    expect(r?.tools[0]).toEqual({ name: "vitest", reason: "unit tests" });
  });

  it("survives markdown fences and prose around the JSON", () => {
    const raw = "Sure! Here is the review:\n```json\n" + JSON.stringify(good) + "\n```\nDone.";
    expect(parseReview(raw)?.summary).toBe("Solid start.");
  });

  it("falls back to okay for an unknown verdict and drops junk items", () => {
    const r = parseReview(
      JSON.stringify({
        verdict: "amazing",
        summary: "s",
        strengths: ["real", 7, "", "  "],
        weaknesses: [],
        improvements: [],
        tools: [{ name: "", reason: "no name" }, "junk", { name: "ok" }],
      }),
    );
    expect(r?.verdict).toBe("okay");
    expect(r?.strengths).toEqual(["real"]);
    expect(r?.tools).toEqual([{ name: "ok", reason: "" }]);
  });

  it("caps runaway lists and item lengths", () => {
    const r = parseReview(
      JSON.stringify({
        verdict: "weak",
        summary: "s",
        strengths: Array.from({ length: 30 }, (_, i) => `item ${i} ${"x".repeat(500)}`),
        weaknesses: [],
        improvements: [],
        tools: [],
      }),
    );
    expect(r?.strengths.length).toBe(8);
    expect(r?.strengths[0].length).toBeLessThanOrEqual(300);
  });

  it("returns null for garbage, empty content, or missing JSON", () => {
    expect(parseReview("no json here")).toBeNull();
    expect(parseReview("{ broken json")).toBeNull();
    expect(
      parseReview(
        JSON.stringify({ verdict: "okay", summary: "", strengths: [], weaknesses: [], improvements: [], tools: [] }),
      ),
    ).toBeNull();
  });
});
