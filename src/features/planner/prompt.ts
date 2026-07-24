// The prompt that carries a plan into an AI CLI session (Claude Code, Gemini CLI, or
// Codex - it is CLI-agnostic). Pure template so tests can pin it and the preview modal
// shows exactly what will be typed into the session.

export function buildPlanPrompt(
  markdown: string,
  opts: { cwd?: string; planName: string },
): string {
  const folder = opts.cwd ?? "the folder this session started in";
  return [
    `You are receiving a project plan named "${opts.planName}". It was designed visually on a planning canvas: blocks are plan items and arrows are dependencies.`,
    "",
    `Working folder: ${folder}`,
    ...(opts.cwd
      ? [
          "",
          "A live copy of this plan is saved at .warsha/plan.md inside the working folder and stays updated while the planner is open. If I later ask you to check the plan, the workflow, or how the system fits together, read that file again instead of relying on this message.",
        ]
      : []),
    "",
    "Instructions:",
    "1. Read the entire plan before doing anything.",
    '2. Phases are ordered milestones. "Depends on" lines are hard ordering constraints.',
    "3. Propose a concise implementation outline for the first phase and wait for my confirmation before writing code.",
    "4. Ask about anything ambiguous instead of guessing.",
    "",
    "--- PLAN START ---",
    markdown.trimEnd(),
    "--- PLAN END ---",
  ].join("\n");
}
