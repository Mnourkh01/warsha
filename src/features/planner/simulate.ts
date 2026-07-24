import { runHeadless, whichProgram } from "../../lib/ipc";
import type { PlanDoc, PlanNode } from "../../store/plans";
import type { ReviewError } from "./review";

// "Run the plan" = a pre-mortem simulation (Gary Klein's method): Claude first
// imagines the project already failed and works backward, then reports per step what
// happens when it is built, its status, and what to watch - in plain words a
// non-technical person follows, with the technical detail in the watch items.

export type SimStatus = "ok" | "risky" | "blocked";

export interface SimStep {
  status: SimStatus;
  /** What actually happens when this step is built (plain words). */
  happens: string;
  /** The concrete risk, bug, or missing piece; empty when there is none. */
  watch: string;
}

export interface SimRisk {
  severity: "critical" | "warning";
  text: string;
  fix: string;
}

export interface PlanSimulation {
  verdict: string;
  confidence: "high" | "medium" | "low";
  steps: Record<string, SimStep>;
  risks: SimRisk[];
}

export type SimOutcome = { sim: PlanSimulation } | { error: ReviewError; raw?: string };

const SIM_TIMEOUT_MS = 240_000;
const MAX_TEXT = 400;
const MAX_RISKS = 6;

function nodeLine(n: PlanNode, phaseLabelById: Map<string, string>): string {
  const bits = [n.id, n.kind, n.label];
  const phase = n.phaseId ? phaseLabelById.get(n.phaseId) : undefined;
  if (phase) bits.push(`phase: ${phase}`);
  if (n.kind === "api") bits.push(`${n.method ?? "GET"} ${n.path ?? "/"}`);
  else if (n.path) bits.push(`route: ${n.path}`);
  if (n.model) bits.push(`model: ${n.model}`);
  if (n.status) bits.push(n.status === "done" ? "already done" : "in progress");
  if (n.effort) bits.push(`effort: ${n.effort.toUpperCase()}`);
  if (n.priority) bits.push(`priority: ${n.priority}`);
  if (n.owner) bits.push(`owner: ${n.owner}`);
  if (n.due) bits.push(`due: ${n.due}`);
  if (n.acceptance?.length) bits.push(`items: ${n.acceptance.join("; ").slice(0, 160)}`);
  if (n.fields?.length) bits.push(`fields: ${n.fields.map((f) => f.name).join(", ").slice(0, 120)}`);
  if (n.description) bits.push(n.description.replace(/\s+/g, " ").slice(0, 120));
  return bits.join(" | ");
}

export function buildSimulationPrompt(doc: PlanDoc): string {
  const phaseLabelById = new Map(
    doc.nodes.filter((n) => n.kind === "phase").map((n) => [n.id, n.label]),
  );
  return [
    "You are running a pre-mortem simulation of a project plan drawn on a visual canvas (blocks connected by dependency arrows).",
    "",
    "First, silently imagine the project was built exactly as planned and FAILED. Work backward: at which steps did it break, and why? Then report.",
    "",
    'Respond with ONLY one JSON object, no fences, no prose: {"verdict": string (one plain-words sentence: will this plan work as it stands?), "confidence": "high" | "medium" | "low", "steps": [{"id": string, "status": "ok" | "risky" | "blocked", "happens": string (1-2 short sentences in plain everyday words: what happens when this step is built), "watch": string (the concrete bug, risk, or missing piece for THIS step, technical detail welcome; empty string if none)}], "risks": [{"severity": "critical" | "warning", "text": string, "fix": string (the concrete way to prevent it)}] (up to 5 plan-wide risks)}.',
    "",
    "Rules:",
    "- Include one steps entry for EVERY block id listed below, using the id exactly as given.",
    '- "blocked" = this step cannot succeed as planned (missing dependency, undefined data, contradiction). "risky" = likely bugs or unclear scope. "ok" = sound.',
    "- Plain everyday words in verdict and happens; put the technical depth in watch and fix.",
    "- Calibrate to the project's apparent size; do not invent enterprise problems for a small tool.",
    "",
    "Plan blocks (id | kind | label | details):",
    ...doc.nodes.map((n) => nodeLine(n, phaseLabelById)),
    "",
    "Arrows (source -> target (meaning)); meanings: depends = target needs source first, delegates = target is the source's sub-agent, handoff = control transfers, tool = source uses target as a tool, calls = source calls target, covers = source test covers target, gates = source approval must pass first:",
    ...(doc.edges.length > 0
      ? doc.edges.map((e) => `${e.source} -> ${e.target} (${e.kind ?? "depends"})`)
      : ["(none - no arrows drawn yet)"]),
    ...(doc.nodes.some((n) => n.kind === "agent" || n.kind === "ai" || n.kind === "gate")
      ? [
          "",
          "Because this plan contains AI/agent blocks, also check these known multi-agent failure modes: context loss at handoffs (key info summarized away), circular delegation, missing exit/termination conditions (agent runs forever), vague role boundaries (duplicated or missed work), no output contract between agents, unverified outputs (no test or gate on agent results), overlapping tool permissions (two agents writing the same thing), token cost explosion (parallel agents whose subtasks are not independent), and gates missing around risky actions.",
        ]
      : []),
  ].join("\n");
}

/** Boundary validation for the model's answer; null when nothing usable came back. */
export function parseSimulation(raw: string, doc: PlanDoc): PlanSimulation | null {
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
  const validIds = new Set(doc.nodes.map((n) => n.id));
  const steps: Record<string, SimStep> = {};
  for (const s of Array.isArray(r.steps) ? r.steps : []) {
    if (!s || typeof s !== "object") continue;
    const ss = s as Record<string, unknown>;
    if (typeof ss.id !== "string" || !validIds.has(ss.id)) continue;
    steps[ss.id] = {
      status: ss.status === "risky" || ss.status === "blocked" ? ss.status : "ok",
      happens: typeof ss.happens === "string" ? ss.happens.trim().slice(0, MAX_TEXT) : "",
      watch: typeof ss.watch === "string" ? ss.watch.trim().slice(0, MAX_TEXT) : "",
    };
  }
  const risks: SimRisk[] = (Array.isArray(r.risks) ? r.risks : [])
    .map((k) => {
      if (!k || typeof k !== "object") return null;
      const kk = k as Record<string, unknown>;
      if (typeof kk.text !== "string" || !kk.text.trim()) return null;
      return {
        severity: kk.severity === "critical" ? ("critical" as const) : ("warning" as const),
        text: kk.text.trim().slice(0, MAX_TEXT),
        fix: typeof kk.fix === "string" ? kk.fix.trim().slice(0, MAX_TEXT) : "",
      };
    })
    .filter((k): k is SimRisk => k !== null)
    .slice(0, MAX_RISKS);
  const sim: PlanSimulation = {
    verdict: typeof r.verdict === "string" ? r.verdict.trim().slice(0, MAX_TEXT) : "",
    confidence:
      r.confidence === "high" || r.confidence === "low" ? r.confidence : "medium",
    steps,
    risks,
  };
  return Object.keys(steps).length > 0 || sim.verdict ? sim : null;
}

export async function runPlanSimulation(doc: PlanDoc): Promise<SimOutcome> {
  const found = await whichProgram("claude").catch(() => null);
  if (!found) return { error: "claude-missing" };
  const res = await runHeadless(
    "claude",
    ["-p", "--max-turns", "1"],
    buildSimulationPrompt(doc),
    SIM_TIMEOUT_MS,
  ).catch(() => null);
  if (!res) return { error: "failed" };
  if (res.timed_out) return { error: "timeout" };
  if (!res.ok) return { error: "failed", raw: res.stderr.slice(0, 2000) };
  const sim = parseSimulation(res.stdout, doc);
  if (!sim) return { error: "unparsable", raw: res.stdout.slice(0, 2000) };
  return { sim };
}
