# System diagram - Warsha

```mermaid
flowchart TD
    User([User])

    subgraph WebView["WebView UI (React + TypeScript)"]
        Tree["Sidebar<br/>workspaces + their named sessions"]
        Work["Workspace grid<br/>3 panes per row, max 6, drag-resize"]
        Term["Terminal view (xterm.js)<br/>fit · webgl · unicode11 · search"]
        Palette["Command palette + shortcuts"]
        Settings["Settings + theme (light/dark)"]
        Store["Zustand stores<br/>workspaces · settings · ui · runtime"]
        IPC["Typed IPC bridge (src/lib/ipc.ts)"]
    end

    subgraph Core["Rust core (Tauri backend)"]
        Cmds["Command surface<br/>pty_spawn / write / resize / kill"]
        PTY["PTY manager (portable-pty)<br/>one ConPTY + reader thread per session"]
        Sess["State file<br/>workspaces · session defs (name/shell/cwd)"]
        Persist["JSON persistence<br/>(app config dir, atomic + fsync)"]
    end

    Shells["Shells / AI CLIs<br/>PowerShell · cmd · WSL · Bash · Claude Code · Gemini · Codex"]

    User --> Tree
    User --> Work
    Tree --> Store
    Work --> Store
    Store --> IPC
    Term --> IPC
    Palette --> Store
    Settings --> Store

    IPC -- "invoke commands" --> Cmds
    Cmds --> PTY
    Cmds --> Sess
    Sess --> Persist
    PTY <--> Shells
    PTY -- "per-session Channel<&[u8]> (binary stream)" --> IPC
    IPC --> Term
```

## Flow: create + run a session

1. User clicks + (or palette), picks a session type (shell or AI CLI), then a folder
   (default folder / browse / none).
2. Frontend adds the session to the active workspace store; the pane's TerminalView calls
   `pty_spawn` over typed IPC.
3. Rust spawns a ConPTY via `portable-pty`, starts a reader thread, returns.
4. The reader thread streams raw bytes over a per-session `Channel`; the pane's xterm renders.
5. Keystrokes in the focused pane call `pty_write(id, data)`; resize calls `pty_resize`.
6. Workspaces + session defs persist to JSON (debounced + flushed on close) so a restart
   restores each workspace and re-opens its sessions in their folders.
