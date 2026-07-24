import { describe, expect, it } from "vitest";
import type { PlanEdge, PlanNode } from "../../store/plans";
import { layoutPlan, needsLayout } from "./layout";

function node(id: string, over: Partial<PlanNode> = {}): PlanNode {
  return { id, kind: "task", x: 0, y: 0, label: id, ...over };
}

function edge(source: string, target: string): PlanEdge {
  return { id: `${source}->${target}`, source, target };
}

describe("needsLayout", () => {
  it("flags stacked blocks (an AI draft sanitizes missing positions to 0,0)", () => {
    expect(needsLayout([node("a"), node("b")])).toBe(true);
    expect(needsLayout([node("a"), node("b", { x: 300, y: 0 })])).toBe(false);
  });

  it("never flags a single block or an empty plan", () => {
    expect(needsLayout([])).toBe(false);
    expect(needsLayout([node("a")])).toBe(false);
  });
});

describe("layoutPlan", () => {
  it("places a dependency chain in increasing columns with no overlap", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [edge("a", "b"), edge("b", "c")];
    const out = layoutPlan(nodes, edges);
    const by = new Map(out.map((n) => [n.id, n]));
    expect(by.get("a")!.x).toBeLessThan(by.get("b")!.x);
    expect(by.get("b")!.x).toBeLessThan(by.get("c")!.x);
    expect(needsLayout(out)).toBe(false);
  });

  it("stacks same-column nodes in separate rows, phases first", () => {
    const nodes = [node("t1"), node("t2"), node("p", { kind: "phase", label: "Phase 1" })];
    const out = layoutPlan(nodes, []);
    const by = new Map(out.map((n) => [n.id, n]));
    expect(by.get("p")!.y).toBeLessThan(by.get("t1")!.y);
    expect(by.get("t1")!.y).not.toBe(by.get("t2")!.y);
    expect(needsLayout(out)).toBe(false);
  });

  it("gives cyclic leftovers a trailing column instead of dropping them", () => {
    const nodes = [node("a"), node("x"), node("y")];
    const edges = [edge("x", "y"), edge("y", "x")];
    const out = layoutPlan(nodes, edges);
    expect(out).toHaveLength(3);
    const by = new Map(out.map((n) => [n.id, n]));
    expect(by.get("x")!.x).toBeGreaterThan(by.get("a")!.x);
    expect(Number.isFinite(by.get("y")!.y)).toBe(true);
    expect(needsLayout(out)).toBe(false);
  });

  it("is deterministic and pure", () => {
    const nodes = [node("b"), node("a")];
    const first = layoutPlan(nodes, []);
    const second = layoutPlan(nodes, []);
    expect(first).toEqual(second);
    expect(nodes[0].x).toBe(0); // inputs untouched
  });
});
