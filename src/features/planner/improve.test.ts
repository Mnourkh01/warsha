import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/ipc", () => ({
  runHeadless: vi.fn(),
  whichProgram: vi.fn(),
}));

import type { PlanDoc, PlanNode } from "../../store/plans";
import { buildImprovePrompt, draftFromAnswer } from "./improve";

function node(id: string, over: Partial<PlanNode> = {}): PlanNode {
  return { id, kind: "task", x: 100, y: 200, label: id, ...over };
}

function doc(over: Partial<PlanDoc> = {}): PlanDoc {
  return {
    id: "d1",
    name: "Plan",
    nodes: [node("keep", { label: "Keep me", tint: "green" })],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: 1,
    ...over,
  };
}

describe("buildImprovePrompt", () => {
  it("strips geometry and tint, includes improvement points and the plan JSON", () => {
    const out = buildImprovePrompt(doc(), ["add exit criteria"]);
    expect(out).toContain("- add exit criteria");
    expect(out).toContain('"Keep me"');
    expect(out).not.toContain('"x"');
    expect(out).not.toContain('"tint"');
  });
});

describe("draftFromAnswer", () => {
  it("keeps position and tint for kept ids and auto-places new blocks", () => {
    const current = doc();
    const answer = JSON.stringify({
      nodes: [
        { id: "keep", kind: "task", label: "Keep me improved" },
        { id: "new1", kind: "api", label: "List things", method: "GET", path: "/things" },
      ],
      edges: [{ source: "keep", target: "new1" }],
    });
    const out = draftFromAnswer(answer, current);
    expect(out).not.toBeNull();
    const kept = out!.draft.nodes.find((n) => n.id === "keep")!;
    expect(kept.x).toBe(100);
    expect(kept.y).toBe(200);
    expect(kept.tint).toBe("green");
    expect(kept.label).toBe("Keep me improved");
    const added = out!.draft.nodes.find((n) => n.id === "new1")!;
    expect(added.x).toBe(100 + 280);
    expect(added.method).toBe("GET");
    expect(out!.draft.edges).toHaveLength(1);
  });

  it("computes the diff: added, removed, changed, edge delta", () => {
    const current = doc({ nodes: [node("keep", { label: "Old" }), node("gone")] });
    const answer = JSON.stringify({
      nodes: [
        { id: "keep", kind: "task", label: "New label" },
        { id: "fresh", kind: "note", label: "Fresh note", description: "hi" },
      ],
      edges: [],
    });
    const out = draftFromAnswer(answer, current)!;
    expect(out.diff.added).toEqual(["Fresh note"]);
    expect(out.diff.removed).toEqual(["gone"]);
    expect(out.diff.changed).toEqual(["New label"]);
    expect(out.diff.edgeDelta).toBe(0);
  });

  it("survives fences and prose, sanitizes junk nodes and edges", () => {
    const answer =
      "Here you go:\n```json\n" +
      JSON.stringify({
        nodes: [
          { id: "keep", kind: "task", label: "ok" },
          { id: "bad", kind: "sprocket", label: "dropped" },
          "junk",
        ],
        edges: [
          { source: "keep", target: "keep" },
          { source: "keep", target: "ghost" },
        ],
      }) +
      "\n```\nDone!";
    const out = draftFromAnswer(answer, doc());
    expect(out).not.toBeNull();
    expect(out!.draft.nodes.map((n) => n.id)).toEqual(["keep"]);
    expect(out!.draft.edges).toEqual([]);
  });

  it("rejects garbage, empty node lists, and non-JSON", () => {
    expect(draftFromAnswer("no json", doc())).toBeNull();
    expect(draftFromAnswer("{ broken", doc())).toBeNull();
    expect(draftFromAnswer(JSON.stringify({ nodes: [], edges: [] }), doc())).toBeNull();
  });
});
