# CLAUDE.md - Warsha (terminal workspace)

Desktop terminal-workspace app. Tauri v2 + React/TS. See `PLAN.md` for product + phases,
`docs/system.md` for the system graph.

## Stack

- **Shell:** Tauri v2 (Rust core + Windows WebView2).
- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS. State: Zustand.
- **Terminal:** xterm.js (`@xterm/xterm`) + addons: fit, webgl, web-links, unicode11,
  search.
- **PTY:** custom thin Rust layer over `portable-pty` 0.9.0 (wraps Windows ConPTY out of
  the box), one ConPTY + reader thread per session. Output streams to the WebView over a
  per-session `tauri::ipc::Channel<&[u8]>` (NOT events). Switch to the `portable-pty-psmux`
  fork only if ConPTY resize/passthrough artifacts appear.
- **Panes:** `react-resizable-panels` v4 (nested split groups, drag-resize). If drag-to-
  rearrange / tabbed docks are needed later, migrate to `dockview`.
- **Persistence:** Rust `serde_json` atomic file write in `app_config_dir` (no store
  plugin). Window geometry via `tauri-plugin-window-state`.
- **Icons:** Lucide (one family, never emoji as UI icons).
- **Arabic UI font:** bundled (IBM Plex Sans Arabic or Cairo), subset, local.

## Commands

```bash
pnpm install            # deps
pnpm tauri dev          # run app (Vite + Rust, hot reload)
pnpm tauri build        # production installer (NSIS, output src-tauri/target/release/bundle/nsis/)
pnpm test               # frontend unit tests (Vitest)
cargo test              # (in src-tauri) Rust unit tests
pnpm lint               # tsc --noEmit (typecheck only; eslint is not configured)
```

**Release (auto-updater).** Releases MUST be signed or installed apps cannot auto-update.
Before `pnpm tauri build`, set `TAURI_SIGNING_PRIVATE_KEY=C:\Users\mnour\.tauri\warsha.key`
and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=` (empty). Bump the version in `package.json`,
`src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` first. After the build, run
`pnpm release:updater` and upload ALL THREE assets to the GitHub release: the
`*-setup.exe`, the `*-setup.exe.sig`, and `latest.json`. The app checks
`releases/latest/download/latest.json` on launch and from Settings. The private key
never enters the repo; losing it means shipping a new public key before updates work.

## Conventions

- **Layered architecture** (this is tool CRUD + I/O, not a deep domain). Dependencies point
  inward. No god files; each module testable in isolation.
- **Feature folders** on the frontend (`src/features/<feature>/`), not type-first.
- **Rust:** `src-tauri/src/{pty,session,commands}`. PTY I/O off the main thread. No
  `.unwrap()` on external I/O - return typed errors, log with context.
- **Typed IPC:** all `invoke`/event calls go through `src/lib/ipc.ts`; never inline string
  command names in components.
- **Validation at the boundary:** validate command args in Rust; never trust the WebView.
- **Structured logging:** Rust `tracing`/`log`; every PTY/session failure logs with the
  session id. No silent `catch`/`Err(_)` swallow.
- **Naming:** files/folders kebab or Rust-idiomatic; a stranger navigates from names alone.
- **No em-dash / en-dash in any user-visible copy** (labels, tooltips, errors, menus).
  ASCII hyphen, comma, or period instead.
- **Motion:** subtle, functional only (this is a devtool/dashboard surface, NOT a marketing
  page). No GSAP hero scenes, no Three.js/3D. Honor `prefers-reduced-motion`.
- **Theme:** dark-first is legitimate for a terminal tool, but ship a real light theme too;
  both use one spacing + type scale, design tokens, no ad-hoc padding, no `!important`.

## Terminal implementation notes (hard-won, enforce at gates)

- **WebGL context budget:** browsers cap ~16 live GL contexts/process. Do NOT give every
  pane its own permanent `WebglAddon`. Attach WebGL only to visible panes; dispose on
  hide and fall back to the DOM renderer; handle `onContextLoss`.
- **Font-metrics race:** `await document.fonts.ready` before `Terminal.open()`, then
  re-`fit()` on font load, or the grid misaligns.
- **Hidden-pane suspend:** keep the `Terminal` alive but detached (xterm pauses
  rendering, buffer keeps filling from the Channel). A `SerializeAddon` snapshot+dispose
  scheme for long-idle panes is a possible future optimization - NOT implemented; do not
  add the dependency until it is.
- **Process lifecycle:** track child PIDs; kill the process tree on app exit AND on pane
  close, or ConPTY children leak.
- **Copy/paste + input:** `Ctrl+C` is SIGINT, map copy to `Ctrl+Shift+C`; enable bracketed
  paste; wire IME/composition so Arabic can be typed into name fields; re-fit + reset the
  WebGL atlas on `devicePixelRatio` change (monitor move / DPI switch).

## Arabic / RTL rules

- App chrome is English-only (the locale switch was removed 2026-07-24; it added
  complexity without helping the terminal surface). Keep CSS logical properties
  (`margin-inline`, `padding-inline`, `inset-inline`) so a future `dir` flip stays cheap.
- User-named content (session/group names) uses `dir="auto"` + `unicode-bidi: plaintext`
  so Arabic names go RTL and English stay LTR, mixed lines not reversed. This stays.
- Terminal OUTPUT Arabic shaping (arabicGlyphs.ts presentation forms) stays - it is
  independent of any UI locale.
- Do NOT attempt to "fix" Arabic bidi inside the raw xterm grid - unsolved in every
  terminal; scoped out.

## Verification (nothing is "done" until verified)

- Rust change -> `cargo test` + a real PTY round-trip (spawn PowerShell, write, read).
- Frontend change -> load in the running app window, inspect via chrome-devtools (own tab),
  console clean, no overflow at small/medium/large window sizes.
- A feature is done only after the 4-pane manual flow works and Arabic strings render right.

## Hard gates (never without the user's explicit words in that moment)

git push / PR / merge / tag · deploy/publish · anything sent outward · spending money ·
deleting files you did not create. Local commits are the normal end of approved work.
