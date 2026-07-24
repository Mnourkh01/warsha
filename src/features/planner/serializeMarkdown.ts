import type { PlanDoc, PlanNode, PlanNodeKind } from "../../store/plans";
import { compareNodes, dependsOf, topoSortNodes } from "./graph";

// Deterministic markdown for a plan: identical content produces identical output,
// regardless of array order, node positions, or viewport. Shared by the Export button
// and the Send-to-Claude prompt, so what the user reads IS what the AI receives.

const KIND_ORDER: readonly PlanNodeKind[] = [
  "task",
  "decision",
  "screen",
  "api",
  "service",
  "data",
  "integration",
  "test",
  "deploy",
  "note",
];

const KIND_HEADINGS: Record<PlanNodeKind, string> = {
  phase: "Phases",
  task: "Tasks",
  decision: "Decisions",
  screen: "Screens",
  api: "API endpoints",
  service: "Services",
  data: "Data models",
  integration: "Integrations",
  test: "Tests",
  deploy: "Deploy steps",
  note: "Notes",
};

/** One-line contexts: strip \r and collapse whitespace runs. */
function inline(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Paragraph contexts: keep line structure, normalize endings, trim edges. */
function block(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

/** Inline-code contexts: a backtick would break the span. */
function code(text: string): string {
  return inline(text).replace(/`/g, "'");
}

export function planToMarkdown(doc: PlanDoc, opts: { cwd?: string } = {}): string {
  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  // Duplicate labels get a short id suffix on ALL occurrences so references stay unique.
  const labelCounts = new Map<string, number>();
  for (const n of doc.nodes) {
    // Count the POST-fallback label so two empty-label blocks (or an empty one next
    // to a literal "Untitled") still get disambiguated.
    const key = (inline(n.label) || "Untitled").toLowerCase();
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }
  const ref = (n: PlanNode): string => {
    const label = inline(n.label) || "Untitled";
    return (labelCounts.get(label.toLowerCase()) ?? 0) > 1
      ? `${label} (${n.id.slice(0, 4)})`
      : label;
  };

  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const dependsLine = (n: PlanNode): string | null => {
    const names = dependsOf(n.id, doc.edges)
      .map((id) => byId.get(id))
      .filter((d): d is PlanNode => Boolean(d))
      .map(ref)
      .sort((a, b) => {
        const la = a.toLowerCase();
        const lb = b.toLowerCase();
        if (la !== lb) return la < lb ? -1 : 1;
        return a < b ? -1 : a > b ? 1 : 0;
      });
    return names.length > 0 ? `Depends on: ${names.join(", ")}` : null;
  };

  // Sub-line label for the shared list field.
  const LIST_PREFIX: Partial<Record<PlanNodeKind, string>> = {
    task: "Acceptance",
    decision: "Option",
    test: "Check",
  };

  const emitItem = (m: PlanNode) => {
    const dep = dependsLine(m);
    const desc = m.description ? inline(m.description) : "";
    if (m.kind === "note") {
      push(`> **${ref(m)}**`);
      const body = m.description ? block(m.description) : "";
      for (const l of body ? body.split("\n") : []) push(`> ${l}`.trimEnd());
      push();
      return;
    }
    if (m.kind === "phase") return; // phases are sections, never list items
    // Every work item is a checkbox; effort, priority and in-progress ride as tags.
    const box = m.status === "done" ? "[x]" : "[ ]";
    const tags = `${m.effort ? ` [${m.effort.toUpperCase()}]` : ""}${
      m.priority ? ` (${m.priority})` : ""
    }${m.status === "doing" ? " (in progress)" : ""}`;
    let head: string;
    switch (m.kind) {
      case "api":
        head = `\`${m.method ?? "GET"} ${m.path ? code(m.path) : "/"}\` - ${ref(m)}`;
        break;
      case "screen":
        head = `**${ref(m)}**${m.path ? ` \`${code(m.path)}\`` : ""}`;
        break;
      case "task":
        head = ref(m);
        break;
      default:
        head = `**${ref(m)}**`;
    }
    const sep = m.kind === "api" ? ": " : " - ";
    push(`- ${box} ${head}${tags}${desc ? `${sep}${desc}` : ""}`);
    const prefix = LIST_PREFIX[m.kind];
    if (prefix) {
      for (const a of m.acceptance ?? []) push(`  - ${prefix}: ${inline(a)}`);
    }
    for (const f of m.fields ?? []) {
      push(`  - \`${code(f.name)}\`: ${inline(f.type)}${f.note ? ` - ${inline(f.note)}` : ""}`);
    }
    if (m.owner) push(`  - Owner: ${inline(m.owner)}`);
    if (m.due) push(`  - Due: ${inline(m.due)}`);
    if (m.link && /^https?:\/\//i.test(m.link)) push(`  - Link: ${inline(m.link)}`);
    if (dep) push(`  - ${dep}`);
  };

  const emitMembers = (members: PlanNode[]) => {
    for (const kind of KIND_ORDER) {
      const list = members.filter((m) => m.kind === kind).sort(compareNodes);
      if (list.length === 0) continue;
      push();
      push(`### ${KIND_HEADINGS[kind]}`);
      push();
      for (const m of list) emitItem(m);
    }
  };

  push(`# Plan: ${inline(doc.name) || "Plan"}`);
  push();
  push(`Project folder: ${opts.cwd ? inline(opts.cwd) : "not set"}`);

  const phases = doc.nodes.filter((n) => n.kind === "phase");
  const phaseIds = new Set(phases.map((p) => p.id));
  const phaseEdges = doc.edges.filter(
    (e) => phaseIds.has(e.source) && phaseIds.has(e.target),
  );
  const { order, cyclic } = topoSortNodes(phases, phaseEdges);
  const cyclicIds = new Set(cyclic.map((c) => c.id));

  for (const p of [...order, ...cyclic]) {
    push();
    if (cyclicIds.has(p.id)) push("<!-- dependency cycle -->");
    push(`## Phase: ${ref(p)}`);
    if (p.description) {
      push();
      push(block(p.description));
    }
    const dep = dependsLine(p);
    if (dep) {
      push();
      push(dep);
    }
    emitMembers(doc.nodes.filter((n) => n.kind !== "phase" && n.phaseId === p.id));
  }

  // Unphased blocks last; a phaseId pointing at a deleted node counts as unphased
  // (hydrate normally cleans these, but the serializer never silently drops content).
  const general = doc.nodes.filter(
    (n) => n.kind !== "phase" && (!n.phaseId || !phaseIds.has(n.phaseId)),
  );
  if (general.length > 0) {
    push();
    push("## General");
    emitMembers(general);
  }

  // Normalize: no trailing spaces, max one blank line between blocks, single final \n.
  return (
    lines
      .join("\n")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\n+$/, "") + "\n"
  );
}
