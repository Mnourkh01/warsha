import { uid } from "../../lib/id";
import { runHeadless, whichProgram } from "../../lib/ipc";
import {
  sanitizePlanDoc,
  type PlanDoc,
  type PlanNode,
} from "../../store/plans";
import { KIND_META } from "./nodeKinds";
import type { ReviewError } from "./review";

// "Make the plan better": one headless claude round trip that returns a full
// replacement graph as JSON. The model NEVER controls geometry - existing blocks keep
// their positions, new blocks are auto-placed - and the whole draft passes through
// sanitizePlanDoc, the same boundary that guards hydrated state.

export interface DraftDiff {
  added: string[];
  removed: string[];
  changed: string[];
  edgeDelta: number;
}

export type ImproveOutcome =
  | { draft: PlanDoc; diff: DraftDiff }
  | { error: ReviewError; raw?: string };

const IMPROVE_TIMEOUT_MS = 240_000;

export function buildImprovePrompt(doc: PlanDoc, improvements: string[]): string {
  const slim = {
    name: doc.name,
    nodes: doc.nodes.map(({ x: _x, y: _y, tint: _tint, ...rest }) => rest),
    edges: doc.edges.map((e) => ({ source: e.source, target: e.target, kind: e.kind })),
  };
  const goals =
    improvements.length > 0
      ? ["Apply these improvement points:", ...improvements.map((i) => `- ${i}`), ""]
      : [];
  return [
    "You are improving a project plan drawn on a visual canvas (blocks connected by dependency arrows).",
    "",
    ...goals,
    'Respond with ONLY one JSON object, no fences, no prose: {"nodes": [...], "edges": [{"source": string, "target": string, "kind"?: "depends" | "delegates" | "handoff" | "tool" | "calls" | "covers" | "gates"}]}.',
    "Rules:",
    "- Keep the exact id of every block you keep; give NEW blocks new short unique ids.",
    "- Allowed kinds: phase | task | decision | note | screen | api | service | ai | agent | data | integration | test | deploy.",
    "- api blocks may set method (GET|POST|PUT|PATCH|DELETE); api and screen blocks may set path; ai and agent blocks may set model (string); task, decision, test, and agent blocks may set acceptance (string[]: acceptance criteria, options, checks, or the agent's tools); data blocks may set fields ([{name, type, note?}]); any block may set status (doing|done), effort (s|m|l), priority (must|should|could), owner (string), due (string), and link (https url).",
    "- Non-phase blocks may set phaseId referencing a phase block's id.",
    "- Edges point from prerequisite to dependent; never create a cycle.",
    "- Do NOT include positions, tints, or any other field.",
    "- Improve, do not rewrite: keep what is already good.",
    "",
    "Current plan JSON:",
    JSON.stringify(slim),
  ].join("\n");
}

/** Stable projection for change detection (ignores geometry and key order). */
function fingerprint(n: PlanNode): string {
  return JSON.stringify([
    n.kind,
    n.label,
    n.description ?? "",
    n.phaseId ?? "",
    n.method ?? "",
    n.path ?? "",
    n.acceptance ?? [],
    n.fields ?? [],
  ]);
}

function diffDocs(current: PlanDoc, draft: PlanDoc): DraftDiff {
  const curById = new Map(current.nodes.map((n) => [n.id, n]));
  const draftById = new Map(draft.nodes.map((n) => [n.id, n]));
  return {
    added: draft.nodes.filter((n) => !curById.has(n.id)).map((n) => n.label),
    removed: current.nodes.filter((n) => !draftById.has(n.id)).map((n) => n.label),
    changed: draft.nodes
      .filter((n) => {
        const old = curById.get(n.id);
        return old ? fingerprint(old) !== fingerprint(n) : false;
      })
      .map((n) => n.label),
    edgeDelta: draft.edges.length - current.edges.length,
  };
}

/** Turn the model's answer into a sanitized draft doc, or null when unusable.
 *  Existing ids keep their canvas position and tint; new blocks are placed in a
 *  column to the right of the current graph. */
export function draftFromAnswer(raw: string, current: PlanDoc): { draft: PlanDoc; diff: DraftDiff } | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const r = parsed as Record<string, unknown>;
  const rawNodes = Array.isArray(r.nodes) ? r.nodes : [];
  const rawEdges = Array.isArray(r.edges) ? r.edges : [];
  if (rawNodes.length === 0) return null; // a plan wiped empty is never an improvement

  const byId = new Map(current.nodes.map((n) => [n.id, n]));
  const maxX = current.nodes.reduce((m, n) => Math.max(m, n.x), 0);
  let newIndex = 0;
  const placed = rawNodes.map((rn) => {
    const rec = rn && typeof rn === "object" ? (rn as Record<string, unknown>) : {};
    const old = typeof rec.id === "string" ? byId.get(rec.id) : undefined;
    if (old) return { ...rec, x: old.x, y: old.y, tint: old.tint };
    const kind = rec.kind as keyof typeof KIND_META;
    return {
      ...rec,
      x: maxX + 280,
      y: 40 + newIndex++ * 90,
      tint: KIND_META[kind]?.tint,
    };
  });
  const draft = sanitizePlanDoc({
    id: current.id,
    name: current.name,
    nodes: placed,
    edges: rawEdges.map((e) => {
      const ee = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
      return { id: uid(), source: ee.source, target: ee.target, kind: ee.kind };
    }),
    viewport: current.viewport,
    updatedAt: Date.now(),
  });
  if (!draft || draft.nodes.length === 0) return null;
  return { draft, diff: diffDocs(current, draft) };
}

export async function runPlanImprove(
  current: PlanDoc,
  improvements: string[],
): Promise<ImproveOutcome> {
  const found = await whichProgram("claude").catch(() => null);
  if (!found) return { error: "claude-missing" };
  const res = await runHeadless(
    "claude",
    ["-p", "--max-turns", "1"],
    buildImprovePrompt(current, improvements),
    IMPROVE_TIMEOUT_MS,
  ).catch(() => null);
  if (!res) return { error: "failed" };
  if (res.timed_out) return { error: "timeout" };
  if (!res.ok) return { error: "failed", raw: res.stderr.slice(0, 2000) };
  const out = draftFromAnswer(res.stdout, current);
  if (!out) return { error: "unparsable", raw: res.stdout.slice(0, 2000) };
  return out;
}
