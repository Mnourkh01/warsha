import { describe, expect, it } from "vitest";
import type { PlanDoc, PlanNode } from "../../store/plans";
import { planToMarkdown } from "./serializeMarkdown";

function node(id: string, over: Partial<PlanNode> = {}): PlanNode {
  return { id, kind: "task", x: 0, y: 0, label: id, ...over };
}

function doc(over: Partial<PlanDoc> = {}): PlanDoc {
  return {
    id: "d1",
    name: "Warsha vNext",
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: 1,
    ...over,
  };
}

const FULL = doc({
  nodes: [
    node("p2", { kind: "phase", label: "Ship" }),
    node("p1", { kind: "phase", label: "Zebra build", description: "Core work." }),
    node("t1", { label: "Wire store", phaseId: "p1", acceptance: ["saves", "loads"] }),
    node("t2", { label: "Announce", phaseId: "p2" }),
    node("a1", { kind: "api", label: "List users", phaseId: "p1", method: "GET", path: "/api/users" }),
    node("s1", { kind: "service", label: "Auth service", phaseId: "p1", description: "Sessions." }),
    node("d1", {
      kind: "data",
      label: "User",
      phaseId: "p1",
      fields: [{ name: "id", type: "uuid", note: "primary" }],
    }),
    node("n1", { kind: "note", label: "Reminder", description: "Line one.\nLine two." }),
    node("g1", { label: "Loose task" }),
  ],
  edges: [
    { id: "e1", source: "p1", target: "p2" }, // Ship depends on Zebra build
    { id: "e2", source: "t1", target: "a1" },
  ],
});

describe("planToMarkdown", () => {
  it("orders phases by dependency, not by label or array order", () => {
    const md = planToMarkdown(FULL);
    const zebra = md.indexOf("## Phase: Zebra build");
    const ship = md.indexOf("## Phase: Ship");
    expect(zebra).toBeGreaterThan(-1);
    expect(ship).toBeGreaterThan(zebra); // Z-label first because Ship depends on it
  });

  it("renders every kind in its section with depends-on lines", () => {
    const md = planToMarkdown(FULL, { cwd: "C:\\dev\\warsha" });
    expect(md).toContain("# Plan: Warsha vNext");
    expect(md).toContain("Project folder: C:\\dev\\warsha");
    expect(md).toContain("- [ ] Wire store");
    expect(md).toContain("  - Acceptance: saves");
    expect(md).toContain("- [ ] `GET /api/users` - List users");
    expect(md).toContain("  - Depends on: Wire store");
    expect(md).toContain("- [ ] **Auth service** - Sessions.");
    expect(md).toContain("- `id`: uuid - primary");
    expect(md).toContain("> **Reminder**");
    expect(md).toContain("> Line one.");
    expect(md).toContain("## General");
    expect(md).toContain("- [ ] Loose task");
  });

  it("is identical after shuffling arrays and moving nodes around the canvas", () => {
    const base = planToMarkdown(FULL);
    const shuffled = doc({
      nodes: [...FULL.nodes].reverse().map((n) => ({ ...n, x: n.x + 500, y: n.y - 300 })),
      edges: [...FULL.edges].reverse(),
    });
    expect(planToMarkdown(shuffled)).toBe(base);
  });

  it("emits only the header for an empty plan", () => {
    expect(planToMarkdown(doc())).toBe("# Plan: Warsha vNext\n\nProject folder: not set\n");
  });

  it("disambiguates duplicate labels with a short id suffix", () => {
    const md = planToMarkdown(
      doc({ nodes: [node("abcd1234", { label: "Task" }), node("wxyz9876", { label: "Task" })] }),
    );
    expect(md).toContain("Task (abcd)");
    expect(md).toContain("Task (wxyz)");
  });

  it("disambiguates two whitespace-only labels through the Untitled fallback", () => {
    const md = planToMarkdown(
      doc({ nodes: [node("aaaa1111", { label: "  " }), node("bbbb2222", { label: "Untitled" })] }),
    );
    expect(md).toContain("Untitled (aaaa)");
    expect(md).toContain("Untitled (bbbb)");
  });

  it("keeps content when phaseId dangles and flags phase cycles instead of dropping", () => {
    const md = planToMarkdown(
      doc({
        nodes: [
          node("p1", { kind: "phase", label: "A" }),
          node("p2", { kind: "phase", label: "B" }),
          node("t1", { label: "Orphan", phaseId: "ghost" }),
        ],
        edges: [
          { id: "e1", source: "p1", target: "p2" },
          { id: "e2", source: "p2", target: "p1" },
        ],
      }),
    );
    expect(md).toContain("<!-- dependency cycle -->");
    expect(md).toContain("## Phase: A");
    expect(md).toContain("## Phase: B");
    expect(md).toContain("- [ ] Orphan"); // dangling phaseId lands in General
  });

  it("escapes backticks in code spans and collapses label newlines", () => {
    const md = planToMarkdown(
      doc({
        nodes: [
          node("a1", { kind: "api", label: "Tricky\nlabel", method: "POST", path: "/x/`y`" }),
        ],
      }),
    );
    expect(md).toContain("- [ ] `POST /x/'y'` - Tricky label");
  });

  it("renders the power fields: done boxes, effort tags, options, checks, routes", () => {
    const md = planToMarkdown(
      doc({
        nodes: [
          node("t1", { label: "Ship it", status: "done", effort: "l" }),
          node("t2", { label: "Busy", status: "doing" }),
          node("d1", { kind: "decision", label: "Pick db", acceptance: ["SQLite", "Postgres"] }),
          node("q1", { kind: "test", label: "Smoke", acceptance: ["app boots"] }),
          node("s1", { kind: "screen", label: "Login", path: "/login" }),
          node("dep1", { kind: "deploy", label: "Release" }),
          node("i1", { kind: "integration", label: "Stripe" }),
        ],
      }),
    );
    expect(md).toContain("- [x] Ship it [L]");
    expect(md).toContain("- [ ] Busy (in progress)");
    expect(md).toContain("### Decisions");
    expect(md).toContain("  - Option: SQLite");
    expect(md).toContain("### Tests");
    expect(md).toContain("  - Check: app boots");
    expect(md).toContain("- [ ] **Login** `/login`");
    expect(md).toContain("### Deploy steps");
    expect(md).toContain("### Integrations");
  });

  it("never emits trailing spaces or triple blank lines", () => {
    const md = planToMarkdown(FULL);
    expect(md).not.toMatch(/[ \t]\n/);
    expect(md).not.toMatch(/\n{3,}/);
    expect(md.endsWith("\n")).toBe(true);
  });
});
