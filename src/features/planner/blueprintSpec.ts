// The format spec Warsha drops at <cwd>/.warsha/BLUEPRINT.md before asking an AI to
// draft a plan. Codex and Gemini have no skill system, so this file IS how any AI
// learns the draft contract; keep it in sync with the per-kind matrix in
// store/plans.ts (same tables as the user-level warsha-blueprint skill).

export const BLUEPRINT_SPEC = `# Warsha Blueprint - plan draft format

This project is planned on Warsha's Blueprint, a visual canvas (blocks + arrows).
Two files connect an AI to it:

| File | Direction | Rule |
|---|---|---|
| .warsha/plan.md | read-only mirror of the current plan | Never edit; rewritten by Warsha. |
| .warsha/plan.draft.json | your whole-plan proposal | Warsha detects it within seconds and the user loads it with one click. |

## Draft JSON shape

Write ONE object: \`{ "nodes": [...], "edges": [...] }\`. Omit top-level id/name.
Set every "x" and "y" to 0 - Warsha lays the blocks out automatically.

\`\`\`json
{
  "nodes": [
    { "id": "p1", "kind": "phase", "label": "Phase 1 - Core", "x": 0, "y": 0,
      "acceptance": ["Login works end to end"] },
    { "id": "s1", "kind": "screen", "label": "Login", "path": "/login", "phaseId": "p1",
      "x": 0, "y": 0, "acceptance": ["error state", "loading state"] },
    { "id": "a1", "kind": "api", "label": "POST /api/login", "method": "POST",
      "path": "/api/login", "auth": "public", "phaseId": "p1", "x": 0, "y": 0 },
    { "id": "sv1", "kind": "service", "label": "AuthService", "spec": "Laravel Sanctum",
      "phaseId": "p1", "x": 0, "y": 0 },
    { "id": "d1", "kind": "data", "label": "users", "spec": "id", "phaseId": "p1",
      "x": 0, "y": 0, "fields": [{ "name": "email", "type": "string" }] },
    { "id": "n1", "kind": "note", "label": "Rate limits unknown", "flavor": "risk",
      "x": 0, "y": 0, "description": "Verify provider limits before phase 2." }
  ],
  "edges": [
    { "id": "e1", "source": "s1", "target": "a1", "kind": "calls" },
    { "id": "e2", "source": "a1", "target": "sv1", "kind": "calls" },
    { "id": "e3", "source": "sv1", "target": "d1", "kind": "calls" }
  ]
}
\`\`\`

## Block kinds and their fields

Every block: id, kind, label, x, y; optional description, phaseId (id of a phase
node), tint (red orange yellow green cyan blue pink). Unknown fields are dropped.

| kind | extra fields |
|---|---|
| phase | acceptance = exit criteria, due, status |
| task | acceptance = acceptance criteria, status, effort, priority, owner, due |
| decision | acceptance = options, chosen, due |
| note | flavor: idea / risk / question / constraint |
| screen | path = route, acceptance = states/parts, link = design mock, status, effort, priority |
| api | method (GET/POST/PUT/PATCH/DELETE), path, auth: public / user / admin, status, effort, priority |
| service | spec = technology, status, effort, priority |
| ai | model, spec = input-to-output contract, status, effort, priority |
| agent | model, acceptance = tools, spec = exit condition, status, effort, priority |
| data | fields = [{"name","type","note"?}], spec = primary key, sensitivity: none / personal / sensitive, status, effort, priority |
| integration | spec = provider, link = provider docs, status, effort, priority |
| test | testType: unit / integration / e2e / manual, acceptance = checks, status, effort |
| gate | acceptance = pass criteria, owner = approver, status |
| deploy | env: dev / staging / prod, spec = rollback plan, due, status |

Values: status "doing"/"done" (omit = todo) - effort "s"/"m"/"l" - priority
"must"/"should"/"could" - link http(s) only.

## Arrow kinds (edges[].kind, omit = depends)

depends (target needs source first) - delegates (source assigns work to target) -
handoff (control moves to target) - tool (source uses target as a tool) - calls -
covers (a test covers target) - gates (a gate must pass before target).

## Caps

300 nodes - 600 edges - label 200 chars - description 4000 - 20 list items x 500
chars - 40 data fields.

## What a good plan looks like

- The plan is a MODEL OF THE PRODUCT, not a work log. Lead with system blocks:
  every screen the user touches, every api endpoint, the services behind them,
  the data models they read and write, integrations, and ai/agent blocks where a
  model runs - wired with calls/tool arrows so a reader can follow one user
  action end to end (screen -> api -> service -> data).
- task blocks only for work that is not a system part (setup, docs, migration,
  research). "Build login form" is wrong when a screen "Login" says it better.
- 2 to 4 phases group delivery order via phaseId, each with 2+ concrete exit criteria.
- Every risky or unknown area gets a note with flavor "risk" or "question" wired
  near the blocks it threatens.
- A gate before anything irreversible (deploy, payment, data migration).
- Tests cover the main flows via covers arrows; deploy blocks carry a rollback plan in spec.
- One idea per block.
`;
