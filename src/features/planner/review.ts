import { runHeadless, whichProgram } from "../../lib/ipc";

// AI plan review: one headless `claude -p` round trip (the user's logged-in CLI
// account). The model is instructed to answer with bare JSON; parseReview is the
// untrusted-input boundary that turns whatever came back into a typed PlanReview.

export interface PlanReviewTool {
  name: string;
  reason: string;
}

export interface PlanReview {
  verdict: "strong" | "okay" | "weak";
  summary: string;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
  tools: PlanReviewTool[];
}

export type ReviewError = "claude-missing" | "timeout" | "failed" | "unparsable";

export type ReviewOutcome = { review: PlanReview } | { error: ReviewError; raw?: string };

const REVIEW_TIMEOUT_MS = 180_000;
const MAX_ITEMS = 8;
const MAX_ITEM_LEN = 300;

export function buildReviewPrompt(markdown: string): string {
  return [
    "You are a senior software architect reviewing a project plan that was drawn on a visual canvas (blocks connected by dependency arrows).",
    "",
    'Respond with ONLY one JSON object. No markdown fences, no prose before or after. Schema: {"verdict": "strong" | "okay" | "weak", "summary": string (at most 2 sentences), "strengths": string[] (2-5 short items), "weaknesses": string[] (2-5 short items), "improvements": string[] (2-5 concrete, actionable items), "tools": [{"name": string, "reason": string}] (2-6 real libraries, services, CLIs, or MCP servers that fit THIS plan; if you can see MCP servers configured in this environment, prefer suggesting those by name)}.',
    "",
    "Judge scope realism, missing pieces (auth, errors, data, deploy), dependency order, and whether phases have clear exit criteria. Calibrate to the project's apparent size: a tiny tool does not need enterprise architecture.",
    "",
    "--- PLAN START ---",
    markdown.trimEnd(),
    "--- PLAN END ---",
  ].join("\n");
}

function cleanList(v: unknown): string[] {
  return (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().slice(0, MAX_ITEM_LEN))
    .slice(0, MAX_ITEMS);
}

/** Boundary validation for the model's answer. Null when nothing usable came back. */
export function parseReview(raw: string): PlanReview | null {
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
  const verdict =
    r.verdict === "strong" || r.verdict === "weak" || r.verdict === "okay"
      ? r.verdict
      : "okay";
  const tools: PlanReviewTool[] = (Array.isArray(r.tools) ? r.tools : [])
    .map((t) => {
      if (!t || typeof t !== "object") return null;
      const tt = t as Record<string, unknown>;
      if (typeof tt.name !== "string" || !tt.name.trim()) return null;
      return {
        name: tt.name.trim().slice(0, 80),
        reason: typeof tt.reason === "string" ? tt.reason.trim().slice(0, MAX_ITEM_LEN) : "",
      };
    })
    .filter((t): t is PlanReviewTool => t !== null)
    .slice(0, MAX_ITEMS);
  const review: PlanReview = {
    verdict,
    summary: typeof r.summary === "string" ? r.summary.trim().slice(0, 600) : "",
    strengths: cleanList(r.strengths),
    weaknesses: cleanList(r.weaknesses),
    improvements: cleanList(r.improvements),
    tools,
  };
  const hasContent =
    review.summary.length > 0 ||
    review.strengths.length > 0 ||
    review.weaknesses.length > 0 ||
    review.improvements.length > 0;
  return hasContent ? review : null;
}

export async function runPlanReview(markdown: string): Promise<ReviewOutcome> {
  const found = await whichProgram("claude").catch(() => null);
  if (!found) return { error: "claude-missing" };
  const res = await runHeadless(
    "claude",
    ["-p", "--max-turns", "1"],
    buildReviewPrompt(markdown),
    REVIEW_TIMEOUT_MS,
  ).catch(() => null);
  if (!res) return { error: "failed" };
  if (res.timed_out) return { error: "timeout" };
  if (!res.ok) return { error: "failed", raw: res.stderr.slice(0, 2000) };
  const review = parseReview(res.stdout);
  if (!review) return { error: "unparsable", raw: res.stdout.slice(0, 2000) };
  return { review };
}
