# Warsha

Named workspaces of live terminals, with one-click AI agent sessions (Claude Code,
Gemini CLI, Codex), in a ~3 MB Windows app with an Arabic-first UI.

Warsha is a terminal workspace for people who run several shells and AI CLIs at once.
Each project gets a workspace; each workspace tiles up to 6 live terminals in a grid
(3 per row, drag to resize). Close the app and reopen it: your workspaces come back and
every session restarts in its folder.

## Why not Windows Terminal / Warp / Wave

- Workspace-per-project organization: sessions live under named workspaces in a sidebar,
  not in an anonymous tab row.
- AI-native: pick Claude Code, Gemini CLI, or Codex from the new-session dialog, choose a
  folder, and it launches ready to work. If the CLI is missing you get the install
  command to copy.
- Arabic-first app chrome: true RTL, bundled IBM Plex Sans Arabic, bidi-safe session
  names (the terminal grid itself stays LTR; that limitation is industry-wide).
- Tiny: Tauri v2 + WebView2, no bundled Chromium. The installer is about 3 MB.

## Requirements

- Windows 11 (WebView2 is preinstalled; on older Windows install the WebView2 runtime).
- [Rust toolchain](https://rustup.rs) with the MSVC target (Visual Studio Build Tools).
- [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io) (repo pins `pnpm@10`).

## Run it

```bash
pnpm install
pnpm tauri dev          # dev app with hot reload
```

## Build the installer

```bash
pnpm tauri build        # NSIS installer -> src-tauri/target/release/bundle/nsis/
```

## Tests and checks

```bash
pnpm test               # frontend unit tests (Vitest)
pnpm lint               # tsc --noEmit
cargo test              # Rust tests, run inside src-tauri/ (spawns a real ConPTY)
```

## Shortcuts

| Chord | Action |
| --- | --- |
| Ctrl+K or Ctrl+Shift+P | Command palette |
| Ctrl+Shift+B | Toggle sidebar |
| Ctrl+Shift+C / Ctrl+Shift+V | Copy / paste in the terminal (Ctrl+C stays SIGINT) |
| Escape | Close the topmost dialog |

## Project layout

- `src/` React + TypeScript UI (feature folders, Zustand stores, typed IPC in `src/lib/ipc.ts`).
- `src-tauri/src/` Rust core: `pty.rs` (ConPTY sessions), `session.rs` (state persistence),
  `commands.rs` (IPC surface).
- `PLAN.md` product plan and phases; `docs/system.md` system diagram; `CLAUDE.md`
  conventions and commands.
