import { describe, expect, it } from "vitest";
import type { PlanEdge, PlanNode } from "../../store/plans";
import { dependsOf, topoSortNodes, wouldCreateCycle } from "./graph";

function node(id: string, label = id): PlanNode {
  return { id, kind: "phase", x: 0, y: 0, label };
}

function edge(source: string, target: string): PlanEdge {
  return { id: `${source}-${target}`, source, target };
}

describe("wouldCreateCycle", () => {
  it("flags a direct back edge", () => {
    expect(wouldCreateCycle([edge("a", "b")], "b", "a")).toBe(true);
  });

  it("flags a transitive cycle", () => {
    expect(wouldCreateCycle([edge("a", "b"), edge("b", "c")], "c", "a")).toBe(true);
  });

  it("flags a self edge", () => {
    expect(wouldCreateCycle([], "a", "a")).toBe(true);
  });

  it("allows forward and diamond edges", () => {
    const edges = [edge("a", "b"), edge("a", "c")];
    expect(wouldCreateCycle(edges, "b", "c")).toBe(false);
    expect(wouldCreateCycle(edges, "a", "d")).toBe(false);
    // Second path to the same node is a diamond, not a cycle.
    expect(wouldCreateCycle([...edges, edge("b", "d")], "c", "d")).toBe(false);
  });
});

describe("dependsOf", () => {
  it("returns sources of incoming edges only", () => {
    const edges = [edge("a", "x"), edge("b", "x"), edge("x", "c")];
    expect(dependsOf("x", edges).sort()).toEqual(["a", "b"]);
    expect(dependsOf("a", edges)).toEqual([]);
  });
});

describe("topoSortNodes", () => {
  it("orders by dependency, then by label for ties", () => {
    const nodes = [node("z", "Zeta"), node("a", "Alpha"), node("m", "Mid")];
    // Zeta must come first despite its label: Alpha and Mid depend on it.
    const edges = [edge("z", "a"), edge("z", "m")];
    const { order, cyclic } = topoSortNodes(nodes, edges);
    expect(order.map((n) => n.id)).toEqual(["z", "a", "m"]);
    expect(cyclic).toEqual([]);
  });

  it("is deterministic under shuffled input arrays", () => {
    const nodes = [node("a", "One"), node("b", "Two"), node("c", "Three"), node("d", "Four")];
    const edges = [edge("a", "b"), edge("a", "c"), edge("c", "d")];
    const base = topoSortNodes(nodes, edges).order.map((n) => n.id);
    const shuffledNodes = [nodes[3], nodes[1], nodes[0], nodes[2]];
    const shuffledEdges = [edges[2], edges[0], edges[1]];
    expect(topoSortNodes(shuffledNodes, shuffledEdges).order.map((n) => n.id)).toEqual(base);
  });

  it("returns cycle members separately instead of dropping them", () => {
    const nodes = [node("a", "A"), node("b", "B"), node("c", "C")];
    const edges = [edge("a", "b"), edge("b", "a")];
    const { order, cyclic } = topoSortNodes(nodes, edges);
    expect(order.map((n) => n.id)).toEqual(["c"]);
    expect(cyclic.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("ignores edges to nodes outside the given set", () => {
    const nodes = [node("a", "A"), node("b", "B")];
    const edges = [edge("outside", "a"), edge("a", "b")];
    const { order } = topoSortNodes(nodes, edges);
    expect(order.map((n) => n.id)).toEqual(["a", "b"]);
  });
});
