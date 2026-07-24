// The prompts that carry a plan into an AI CLI session (Claude Code, Gemini CLI, or
// Codex - both are CLI-agnostic). Pure templates so tests can pin them and the send
// modal shows exactly what will be typed into the session.

/** Full handoff: the AI has not seen the plan before; the whole plan rides along. */
export function buildPlanPrompt(
  markdown: string,
  opts: { cwd?: string; planName: string },
): string {
  const folder = opts.cwd ?? "the folder this session started in";
  return [
    `Project plan: "${opts.planName}"`,
    `Working folder: ${folder}`,
    "",
    "I designed this plan on a visual canvas (Warsha Blueprint). Blocks are plan items - phases, tasks, screens, APIs, data models, tests, gates - and arrows are dependencies or relations between them.",
    ...(opts.cwd
      ? [
          "",
          "A live copy of the plan is kept at .warsha/plan.md in the working folder. When I later ask you to check the plan or the workflow, read that file instead of relying on this message.",
        ]
      : []),
    "",
    "What I need from you now:",
    "1. Read the whole plan below before answering.",
    '2. Treat phase order and "Depends on" lines as hard constraints.',
    "3. Reply with a short implementation outline for the FIRST phase only, then stop and wait for my confirmation.",
    "4. If anything is ambiguous, ask me instead of assuming.",
    "",
    "--- PLAN START ---",
    markdown.trimEnd(),
    "--- PLAN END ---",
  ].join("\n");
}

/** Ask mode: no plan exists yet (or the user wants a fresh one) - the AI studies the
 *  project and writes the draft file; Warsha drops .warsha/BLUEPRINT.md with the
 *  format right before this prompt is sent. Requires a project folder. */
export function buildDraftRequestPrompt(opts: { cwd: string }): string {
  return [
    "I want a project plan I can load onto Warsha's Blueprint canvas (a visual plan: blocks and arrows).",
    "",
    `Working folder: ${opts.cwd}`,
    "",
    "Do this:",
    "1. Read .warsha/BLUEPRINT.md in this folder - it defines the exact plan JSON format. If the file is missing, ask me for the format before writing anything.",
    "2. Study the project first (README, manifests, source layout). If the folder is empty or the goal is unclear, ask me 3 to 5 short questions before planning.",
    "3. Write the full plan to .warsha/plan.draft.json. Model the product as a working system first, not a task list: every screen the user touches, every api endpoint, the services behind them, the data models they read and write, integrations, and ai/agent blocks where a model runs - wired with calls/tool arrows so one user action can be followed end to end (screen -> api -> service -> data). Use task blocks only for work that is not a system part (setup, docs, research).",
    "4. Then add the delivery layer on top: 2 to 4 phases with exit criteria (attach blocks via phaseId), risks as risk notes near the blocks they threaten, a gate before anything irreversible, tests covering the main flows, and a deploy step with a rollback plan.",
    "5. Tell me when it is written - I will load it on the Blueprint and review it there.",
  ].join("\n");
}

/** Continue mode: the AI already knows the plan (built or reviewed together, or it can
 *  read .warsha/plan.md). Sends only context plus the review suggestions the user
 *  accepted - no plan dump. Requires a project folder (the AI reads the file). */
export function buildContextPrompt(opts: {
  cwd: string;
  planName: string;
  suggestions: string[];
}): string {
  const head = [
    `We are continuing work on the project plan "${opts.planName}".`,
    `The current plan lives at .warsha/plan.md in this folder (${opts.cwd}). Read it now to refresh your memory.`,
  ];
  if (opts.suggestions.length === 0) {
    return [
      ...head,
      "",
      "Then tell me in two sentences what the plan builds and what the first phase delivers, and wait for my instructions.",
    ].join("\n");
  }
  return [
    ...head,
    "",
    "From the plan review, I accepted the improvements below. For each one:",
    "1. One line on why it makes the plan better.",
    "2. Exactly what to add or change - which blocks, fields, or arrows.",
    "",
    "Then apply all of them: write the full updated plan as JSON to .warsha/plan.draft.json (same shape as the plan, positions optional - Warsha lays it out) so I can load it onto the Blueprint canvas with one click. If you cannot write files, list the exact block changes instead.",
    "",
    "Accepted improvements:",
    ...opts.suggestions.map((s) => `- ${s}`),
  ].join("\n");
}
