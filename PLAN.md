# PLAN — Warsha (working name) · a terminal workspace

> Working name "Warsha" (ورشة = workshop). Rename freely: it appears only in
> `package.json`, `tauri.conf.json` (productName + identifier), and the window title.

## 1. Product

A lightweight Windows desktop app that organizes many terminal sessions the way a person
thinks about their work: a **left tree of named, per-project sessions**, several **live
sessions tiled on screen at once**, each an independent PowerShell / cmd / WSL or AI-CLI
session you can talk to and stop at will. It replaces the pain of anonymous IDE terminal
tabs ("terminal 1, 2, 3, 4") with named, grouped, persistent sessions, and it renders
**Arabic in the UI correctly** (readable, shaped, right-to-left) where every mainstream
terminal fails.

**Who it is for:** a solo developer who runs several shells and AI CLIs across a few
projects at once, reads both English and Arabic, and wants low RAM / small disk.

**The one-sentence outcome:** open the app, see your projects and their named sessions in a
tree, click to tile 3-5 of them live, work each independently, and read Arabic without
distortion.

## 2. Domain glossary

- **Session** — one running (or restartable) shell/PTY with a name, a shell kind, a working
  directory, and optional tags. The atomic unit.
- **Group / Project** — a named tree node that contains sessions (and sub-groups). Pure
  organization; not a process.
- **Pane** — a slot in the tiled workspace that is currently displaying one session.
- **Layout** — the current split arrangement of panes (which sessions are tiled and how).
- **Tree** — the left sidebar: projects -> groups -> sessions, user-named and reorderable.
- **PTY** — pseudo-terminal; on Windows this is ConPTY, one per running session.
- **AI session** (Stable phase) — a session whose output is rendered as bidi markdown in a
  chat pane instead of the raw grid, via a generic AI adapter.

## 3. Architecture

**Stack (locked):** Tauri v2 (Rust core + system WebView2) · React + TypeScript + Vite +
Tailwind frontend · xterm.js terminal engine · Rust `portable-pty` for ConPTY.

```
User
  └─ WebView UI (React/TS)  ── sidebar tree · tiled panes · terminal views · palette · settings
        │  Tauri IPC (commands + events, binary PTY stream)
        ▼
     Rust core (Tauri backend)
        ├─ PTY manager   (portable-pty: spawn/read/write/resize/kill, one ConPTY per session)
        ├─ Session store (tree, names, shell, cwd, tags, layout — persisted as JSON)
        └─ Config        (theme, fonts, defaults)
        │
        ▼
   Shells / AI CLIs (PowerShell, cmd, WSL, Claude Code, ...)
```

**Layering (Layered, not Clean — this is tool CRUD + I/O, not a deep domain):**
- `src-tauri/src/pty/` — PTY manager (portable-pty wrapper, per-session reader thread, ID map).
- `src-tauri/src/session/` — session/tree model + persistence (serde JSON in app config dir).
- `src-tauri/src/commands.rs` — Tauri command surface; `src-tauri/src/main.rs` wiring.
- `src/features/tree/` — sidebar tree (create/rename/group/reorder/tag).
- `src/features/workspace/` — tiling pane manager + layout.
- `src/features/terminal/` — xterm.js binding + addons + PTY event wiring.
- `src/features/command-palette/`, `src/features/settings/`, `src/features/theme/`.
- `src/store/` — Zustand stores (tree, layout, settings) + persistence bridge.
- `src/lib/ipc.ts` — typed wrappers over Tauri `invoke` / event listeners.

**IPC contract:**
- Commands: `pty_spawn({shell, cwd, cols, rows}, onData: Channel<bytes>) -> sessionId`,
  `pty_write(id, data)`, `pty_resize(id, cols, rows)`, `pty_kill(id)`,
  `session_state_load()`, `session_state_save(state)`.
- **PTY output streams over a per-session `tauri::ipc::Channel<&[u8]>`** passed into
  `pty_spawn` (Tauri's event system is not built for high-throughput byte streams). Exit
  is signalled by the channel closing / a final `{exit, code}` message.

## 4. Non-functional requirements (NFRs)

- **RAM:** target < ~250 MB with 4 idle sessions + 1 active; hidden panes suspend rendering
  (PTY stays alive, output buffered, repaint on focus). Scrollback capped (~8k lines/term).
- **Disk:** installer target < 15 MB (WebView2 shared on Win11, no bundled Chromium).
- **Startup:** cold start to interactive < ~1.5 s.
- **Latency:** keystroke-to-echo indistinguishable from native terminal; PTY output batched
  to animation frames, never per-byte re-render.
- **Arabic:** UI chrome + all user-named content render Arabic shaped + correctly ordered
  (`dir="auto"`, logical CSS, bundled Arabic UI font). Raw terminal-grid Arabic is
  best-effort and explicitly out of scope to "fix" (unsolved in every terminal).
- **Fidelity:** hosts heavy TUIs (Claude Code, vim, htop) — alt-screen, mouse, truecolor,
  correct resize.

## 5. Quality strategy

- Rust: unit tests on the session/tree model + persistence (pure logic, TDD-friendly);
  PTY manager smoke-tested against a real ConPTY (`cmd /c echo`, `powershell`).
- Frontend: component tests for tree ops (rename/move/group) and layout reducer; the rest
  verified in a real window (browser-mode QA via the app's WebView + chrome-devtools).
- Every gate: build green, real PTY round-trip, 4-pane manual flow, Arabic strings render
  correctly at 320/768/1440-equivalent window sizes, console + no unhandled errors.

## 6. Deploy path

Local-first. `pnpm tauri dev` for development; `pnpm tauri build` produces an NSIS/MSI
installer. No cloud, no telemetry in v1. Signing + auto-update are Production-phase.

## 7. Phases (exit criteria each)

**v1 — Core multiplexer** (this run's target)
- Named session tree with groups (create, rename, nest, reorder, tag/color).
- Spawn PowerShell / cmd / WSL via ConPTY; independent I/O per session.
- Tiled split panes (H/V split, drag-resize, focus); bind any session to any pane.
- Run Claude Code as a normal TUI inside a grid pane.
- Perfect RTL/Arabic app chrome + bundled Arabic UI font; light/dark theme.
- Persist tree + names + shell + cwd + layout across restarts.
- Command palette + keyboard shortcuts.
- **Exit:** create named sessions in a tree; open 4 panes at once, each an independent
  live shell; switch/stop any; Arabic UI reads correctly; RAM within budget with 4 idle;
  `tauri build` installer within size target.

**Stable — Arabic AI-chat + polish**
- Dedicated AI chat session type via a **generic AI adapter** (Claude Code + Gemini CLI as
  first two), headless/stream, markdown rendered with full bidi Arabic.
- Hidden-pane render suspension, session restore, in-terminal search, copy/paste hardening,
  settings UI.
- **Exit:** AI answers in Arabic render fully shaped + correctly ordered for >= 2 tools;
  RAM/perf budgets verified; crash-free multi-session soak.

**Production**
- Auto-update, error reporting, config import/export, per-project env, signed installer,
  docs.
- **Exit:** signed build, update channel, no P1 bugs across a week of daily use.

## 8. Risks + mitigations

- ConPTY resize/passthrough quirks -> use `portable-pty`; switch to `portable-pty-psmux`
  fork if resize artifacts appear.
- PTY throughput on busy TUIs -> stream binary chunks over a Tauri channel, batch to rAF.
- Raw-grid Arabic stays imperfect -> scoped out; chat pane (Stable) is the reading surface.
- Scope creep in tiling -> v1 uses nested resizable panels (split H/V + resize), not full
  drag-rearrange mosaic (deferred).
