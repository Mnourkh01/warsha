import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/ipc", () => ({
  runHeadless: vi.fn(),
  whichProgram: vi.fn(),
}));

import type { PlanDoc, PlanNode } from "../../store/plans";
import { buildSimulationPrompt, parseSimulation } from "./simulate";

function node(id: string, over: Partial<PlanNode> = {}): PlanNode {
  return { id, kind: "task", x: 0, y: 0, label: id, ...over };
}

function doc(over: Partial<PlanDoc> = {}): PlanDoc {
  return {
    id: "d1",
    name: "Plan",
    nodes: [
      node("p1", { kind: "phase", label: "Core" }),
      node("t1", { label: "Wire db", phaseId: "p1" }),
      node("a1", { kind: "api", label: "List", method: "GET", path: "/x", phaseId: "p1" }),
    ],
    edges: [{ id: "e1", source: "t1", target: "a1" }],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: 1,
    ...over,
  };
}

describe("buildSimulationPrompt", () => {
  it("lists every block id, its details, and the dependency lines", () => {
    const out = buildSimulationPrompt(doc());
    expect(out).toContain("pre-mortem");
    expect(out).toContain("FAILED");
    expect(out).toMatch(/t1 \| task \| Wire db \| phase: Core/);
    expect(out).toContain("GET /x");
    expect(out).toContain("t1 -> a1");
  });

  it("says so when no arrows exist yet", () => {
    const out = buildSimulationPrompt(doc({ edges: [] }));
    expect(out).toContain("(none - no arrows drawn yet)");
  });
});

describe("parseSimulation", () => {
  const good = {
    verdict: "Works with fixes.",
    confidence: "medium",
    steps: [
      { id: "t1", status: "ok", happens: "The database gets set up.", watch: "" },
      { id: "a1", status: "risky", happens: "The list endpoint is built.", watch: "No pagination." },
      { id: "ghost", status: "blocked", happens: "x", watch: "" },
    ],
    risks: [
      { severity: "critical", text: "No auth anywhere.", fix: "Add a login phase." },
      { severity: "silly", text: "Minor thing.", fix: "" },
      { text: "" },
    ],
  };

  it("keeps valid steps, drops unknown ids, validates statuses and risks", () => {
    const sim = parseSimulation(JSON.stringify(good), doc());
    expect(sim).not.toBeNull();
    expect(Object.keys(sim!.steps).sort()).toEqual(["a1", "t1"]);
    expect(sim!.steps.a1.status).toBe("risky");
    expect(sim!.steps.a1.watch).toBe("No pagination.");
    expect(sim!.risks).toHaveLength(2);
    expect(sim!.risks[0].severity).toBe("critical");
    expect(sim!.risks[1].severity).toBe("warning"); // unknown severity falls back
    expect(sim!.confidence).toBe("medium");
  });

  it("falls back to ok status and medium confidence for junk values", () => {
    const sim = parseSimulation(
      JSON.stringify({
        verdict: "v",
        confidence: "cosmic",
        steps: [{ id: "t1", status: "exploded", happens: 7, watch: null }],
        risks: [],
      }),
      doc(),
    );
    expect(sim!.steps.t1.status).toBe("ok");
    expect(sim!.steps.t1.happens).toBe("");
    expect(sim!.confidence).toBe("medium");
  });

  it("survives fences and prose around the JSON", () => {
    const raw = "Result:\n```json\n" + JSON.stringify(good) + "\n```";
    expect(parseSimulation(raw, doc())?.verdict).toBe("Works with fixes.");
  });

  it("returns null for garbage or an answer with nothing usable", () => {
    expect(parseSimulation("nope", doc())).toBeNull();
    expect(parseSimulation("{ broken", doc())).toBeNull();
    expect(
      parseSimulation(JSON.stringify({ verdict: "", steps: [], risks: [] }), doc()),
    ).toBeNull();
  });
});
