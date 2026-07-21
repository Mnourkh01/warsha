# System diagram — Warsha

```mermaid
flowchart TD
    User([User])

    subgraph WebView["WebView UI (React + TypeScript)"]
        Tree["Sidebar tree<br/>projects / groups / named sessions"]
        Work["Tiled workspace<br/>resizable split panes"]
        Term["Terminal view (xterm.js)<br/>fit · webgl · unicode11 · search"]
        Palette["Command palette + shortcuts"]
        Settings["Settings + theme (light/dark)"]
        Store["Zustand stores<br/>tree · layout · settings"]
        IPC["Typed IPC bridge (src/lib/ipc.ts)"]
    end

    subgraph Core["Rust core (Tauri backend)"]
        Cmds["Command surface<br/>pty_spawn / write / resize / kill"]
        PTY["PTY manager (portable-pty)<br/>one ConPTY + reader thread per session"]
        Sess["Session store<br/>tree · names · shell · cwd · tags · layout"]
        Persist["JSON persistence<br/>(app config dir)"]
    end

    Shells["Shells / AI CLIs<br/>PowerShell · cmd · WSL · Claude Code"]

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

1. User right-clicks a project in the tree, "New session", names it, picks a shell.
2. Frontend writes the node into the tree store and calls `pty_spawn` over typed IPC.
3. Rust spawns a ConPTY via `portable-pty`, starts a reader thread, returns a `sessionId`.
4. Reader thread streams output as `pty://data/{id}` events; the bound pane's xterm renders.
5. Keystrokes in the focused pane call `pty_write(id, data)`; resize calls `pty_resize`.
6. Tree + layout changes persist to JSON so the workspace restores on next launch.
