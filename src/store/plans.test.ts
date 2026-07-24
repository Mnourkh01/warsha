import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_PLAN_EDGES,
  MAX_PLAN_NODES,
  sanitizePlanDoc,
  usePlans,
  type PlanDoc,
  type PlanNode,
} from "./plans";

function node(id: string, over: Partial<PlanNode> = {}): PlanNode {
  return { id, kind: "task", x: 0, y: 0, label: id, ...over };
}

function doc(over: Partial<PlanDoc> = {}): PlanDoc {
  return {
    id: "d1",
    name: "Test plan",
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: 1,
    ...over,
  };
}

describe("sanitizePlanDoc", () => {
  it("rejects garbage roots", () => {
    expect(sanitizePlanDoc(null)).toBeNull();
    expect(sanitizePlanDoc("x")).toBeNull();
    expect(sanitizePlanDoc(42)).toBeNull();
    expect(sanitizePlanDoc({})).toBeNull(); // no id
  });

  it("drops malformed nodes, unknown kinds, and duplicate ids", () => {
    const out = sanitizePlanDoc(
      doc({
        nodes: [
          node("a"),
          { kind: "task", x: 0, y: 0, label: "no id" } as unknown as PlanNode,
          { id: "weird", kind: "sprocket", x: 0, y: 0, label: "?" } as unknown as PlanNode,
          node("a", { label: "duplicate id" }),
          null as unknown as PlanNode,
        ],
      }),
    );
    expect(out?.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(out?.nodes[0].label).toBe("a");
  });

  it("clamps non-finite positions and junk viewport to safe values", () => {
    const out = sanitizePlanDoc(
      doc({
        nodes: [node("a", { x: Number.NaN, y: Number.POSITIVE_INFINITY })],
        viewport: { x: Number.NaN, y: 3, zoom: 99 },
      }),
    );
    expect(out?.nodes[0].x).toBe(0);
    expect(out?.nodes[0].y).toBe(0);
    expect(out?.viewport.x).toBe(0);
    expect(out?.viewport.y).toBe(3);
    expect(out?.viewport.zoom).toBeLessThanOrEqual(4);
  });

  it("validates edge kinds and never stores the default", () => {
    const out = sanitizePlanDoc(
      doc({
        nodes: [node("a"), node("b"), node("c")],
        edges: [
          { id: "e1", source: "a", target: "b", kind: "delegates" },
          { id: "e2", source: "b", target: "c", kind: "depends" },
          { id: "e3", source: "a", target: "c", kind: "teleports" as never },
        ],
      }),
    );
    const byId = new Map(out?.edges.map((e) => [e.id, e]));
    expect(byId.get("e1")?.kind).toBe("delegates");
    expect(byId.get("e2")?.kind).toBeUndefined(); // depends = default = not stored
    expect(byId.get("e3")?.kind).toBeUndefined(); // unknown kind dropped
  });

  it("drops edges that are self, duplicated, or point at missing nodes", () => {
    const out = sanitizePlanDoc(
      doc({
        nodes: [node("a"), node("b")],
        edges: [
          { id: "e1", source: "a", target: "b" },
          { id: "e2", source: "a", target: "b" }, // duplicate pair
          { id: "e1", source: "b", target: "a" }, // duplicate edge id
          { id: "e3", source: "a", target: "a" }, // self
          { id: "e4", source: "a", target: "ghost" }, // missing endpoint
        ],
      }),
    );
    expect(out?.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("gates kind-specific fields to their kind and validates them", () => {
    const out = sanitizePlanDoc(
      doc({
        nodes: [
          node("t", { acceptance: ["ok", "", 7 as unknown as string, "  "] }),
          node("a", { kind: "api", method: "YEET" as never, path: "/x", acceptance: ["nope"] }),
          node("d", {
            kind: "data",
            fields: [{ name: "id", type: "uuid" }, { name: "" } as never, "junk" as never],
          }),
          node("bad-tint", { tint: "magenta" as never }),
        ],
      }),
    );
    const byId = new Map(out?.nodes.map((n) => [n.id, n]));
    expect(byId.get("t")?.acceptance).toEqual(["ok"]);
    expect(byId.get("a")?.method).toBeUndefined(); // invalid method dropped
    expect(byId.get("a")?.path).toBe("/x");
    expect(byId.get("a")?.acceptance).toBeUndefined(); // acceptance is task-only
    expect(byId.get("d")?.fields).toEqual([{ name: "id", type: "uuid", note: undefined }]);
    expect(byId.get("bad-tint")?.tint).toBeUndefined();
  });

  it("validates power fields and gates the list field to its kinds", () => {
    const out = sanitizePlanDoc(
      doc({
        nodes: [
          node("d", { kind: "decision", acceptance: ["A", "B"], status: "doing", effort: "m" }),
          node("q", { kind: "test", acceptance: ["boots"] }),
          node("s", { kind: "screen", path: "/login" }),
          node("bad", { status: "exploded" as never, effort: "xxl" as never }),
        ],
      }),
    );
    const byId = new Map(out?.nodes.map((n) => [n.id, n]));
    expect(byId.get("d")?.acceptance).toEqual(["A", "B"]);
    expect(byId.get("d")?.status).toBe("doing");
    expect(byId.get("d")?.effort).toBe("m");
    expect(byId.get("q")?.acceptance).toEqual(["boots"]);
    expect(byId.get("s")?.path).toBe("/login");
    const withAi = sanitizePlanDoc(
      doc({
        nodes: [
          node("ag", { kind: "agent", model: "claude-sonnet-5", acceptance: ["firecrawl"] }),
          node("t", { model: "gpt-x" as never }), // model is ai/agent-only
        ],
      }),
    );
    const aiById = new Map(withAi?.nodes.map((n) => [n.id, n]));
    expect(aiById.get("ag")?.model).toBe("claude-sonnet-5");
    expect(aiById.get("ag")?.acceptance).toEqual(["firecrawl"]);
    expect(aiById.get("t")?.model).toBeUndefined();
    expect(byId.get("bad")?.status).toBeUndefined();
    expect(byId.get("bad")?.effort).toBeUndefined();
  });

  it("gates the per-kind selects and spec to their kinds", () => {
    const out = sanitizePlanDoc(
      doc({
        nodes: [
          node("api1", { kind: "api", auth: "user" }),
          node("t1", { auth: "admin" as never, spec: "sneaky" as never }),
          node("n1", { kind: "note", flavor: "risk" }),
          node("d1", { kind: "data", sensitivity: "personal", spec: "id uuid" }),
          node("q1", { kind: "test", testType: "e2e" }),
          node("dep1", { kind: "deploy", env: "prod", spec: "revert release" }),
          node("dec1", { kind: "decision", acceptance: ["A", "B"], chosen: "A" }),
          node("p1", { kind: "phase", acceptance: ["all tests green"] }),
          node("sv1", { kind: "service", spec: "Rust + Tauri" }),
        ],
      }),
    );
    const byId = new Map(out?.nodes.map((n) => [n.id, n]));
    expect(byId.get("api1")?.auth).toBe("user");
    expect(byId.get("t1")?.auth).toBeUndefined();
    expect(byId.get("t1")?.spec).toBeUndefined();
    expect(byId.get("n1")?.flavor).toBe("risk");
    expect(byId.get("d1")?.sensitivity).toBe("personal");
    expect(byId.get("d1")?.spec).toBe("id uuid");
    expect(byId.get("q1")?.testType).toBe("e2e");
    expect(byId.get("dep1")?.env).toBe("prod");
    expect(byId.get("dec1")?.chosen).toBe("A");
    expect(byId.get("p1")?.acceptance).toEqual(["all tests green"]);
    expect(byId.get("sv1")?.spec).toBe("Rust + Tauri");
  });

  it("validates priority, owner, due, and link (http(s) only)", () => {
    const out = sanitizePlanDoc(
      doc({
        nodes: [
          node("a", {
            priority: "must",
            owner: "  Claude  ",
            due: "Friday",
            link: "https://example.com/spec",
          }),
          node("b", {
            priority: "urgent" as never,
            link: "javascript:alert(1)" as never,
          }),
        ],
      }),
    );
    const byId = new Map(out?.nodes.map((n) => [n.id, n]));
    expect(byId.get("a")?.priority).toBe("must");
    expect(byId.get("a")?.owner).toBe("  Claude  ".slice(0, 80));
    expect(byId.get("a")?.due).toBe("Friday");
    expect(byId.get("a")?.link).toBe("https://example.com/spec");
    expect(byId.get("b")?.priority).toBeUndefined();
    expect(byId.get("b")?.link).toBeUndefined();
  });

  it("nulls phaseId that does not point at a surviving phase node", () => {
    const out = sanitizePlanDoc(
      doc({
        nodes: [
          node("p", { kind: "phase" }),
          node("in-phase", { phaseId: "p" }),
          node("dangling", { phaseId: "ghost" }),
          node("to-task", { phaseId: "in-phase" }), // points at a task, not a phase
        ],
      }),
    );
    const byId = new Map(out?.nodes.map((n) => [n.id, n]));
    expect(byId.get("in-phase")?.phaseId).toBe("p");
    expect(byId.get("dangling")?.phaseId).toBeUndefined();
    expect(byId.get("to-task")?.phaseId).toBeUndefined();
  });

  it("enforces the node and edge caps", () => {
    const nodes = Array.from({ length: MAX_PLAN_NODES + 40 }, (_, i) => node(`n${i}`));
    const edges = Array.from({ length: MAX_PLAN_EDGES + 40 }, (_, i) => ({
      id: `e${i}`,
      source: `n${i % 100}`,
      target: `n${(i % 100) + 100}`,
    }));
    const out = sanitizePlanDoc(doc({ nodes, edges }));
    expect(out?.nodes.length).toBe(MAX_PLAN_NODES);
    expect(out?.edges.length).toBeLessThanOrEqual(MAX_PLAN_EDGES);
  });

  it("caps runaway strings", () => {
    const out = sanitizePlanDoc(doc({ nodes: [node("a", { label: "x".repeat(9000) })] }));
    expect(out?.nodes[0].label.length).toBe(200);
  });
});

describe("plans store", () => {
  beforeEach(() => {
    usePlans.getState().hydrate({ plans: {} });
  });

  it("ensurePlan creates once and is stable on repeat calls", () => {
    const first = usePlans.getState().ensurePlan("w1", "  My workspace  ");
    const second = usePlans.getState().ensurePlan("w1", "Other name");
    expect(first.name).toBe("My workspace");
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("My workspace");
  });

  it("setGraph replaces the graph and bumps updatedAt", () => {
    const before = usePlans.getState().ensurePlan("w1", "P");
    usePlans.getState().setGraph("w1", [node("a")], []);
    const after = usePlans.getState().plans.w1;
    expect(after.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it("setGraph on an unknown workspace is a no-op", () => {
    usePlans.getState().setGraph("ghost", [node("a")], []);
    expect(usePlans.getState().plans.ghost).toBeUndefined();
  });

  it("renamePlan stores the raw draft (capped); hydrate restores a fallback for blank", () => {
    usePlans.getState().ensurePlan("w1", "P");
    usePlans.getState().renamePlan("w1", "");
    expect(usePlans.getState().plans.w1.name).toBe("");
    const blob = usePlans.getState().serialize();
    usePlans.getState().hydrate(JSON.parse(JSON.stringify(blob)));
    expect(usePlans.getState().plans.w1.name).toBe("Plan");
  });

  it("prune drops plans for unknown workspaces and keeps the rest", () => {
    usePlans.getState().ensurePlan("alive", "Keep");
    usePlans.getState().ensurePlan("ghost", "Drop");
    usePlans.getState().prune(["alive"]);
    expect(Object.keys(usePlans.getState().plans)).toEqual(["alive"]);
  });

  it("removePlanFor deletes only that workspace's plan", () => {
    usePlans.getState().ensurePlan("w1", "One");
    usePlans.getState().ensurePlan("w2", "Two");
    usePlans.getState().removePlanFor("w1");
    expect(usePlans.getState().plans.w1).toBeUndefined();
    expect(usePlans.getState().plans.w2?.name).toBe("Two");
  });

  it("hydrate survives garbage and a serialize round-trip keeps content", () => {
    usePlans.getState().hydrate("garbage");
    expect(usePlans.getState().plans).toEqual({});
    usePlans.getState().ensurePlan("w1", "Round trip");
    usePlans
      .getState()
      .setGraph("w1", [node("a", { kind: "phase" }), node("b", { phaseId: "a" })], [
        { id: "e1", source: "a", target: "b" },
      ]);
    const blob = JSON.parse(JSON.stringify(usePlans.getState().serialize()));
    usePlans.getState().hydrate(blob);
    const back = usePlans.getState().plans.w1;
    expect(back.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(back.edges).toEqual([{ id: "e1", source: "a", target: "b", label: undefined }]);
  });
});
