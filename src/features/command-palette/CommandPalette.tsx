import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FolderPlus, Layers, Palette, Plus, Settings as SettingsIcon, X } from "lucide-react";
import { useWorkspaces } from "../../store/workspaces";
import { useSettings } from "../../store/settings";
import { useUI } from "../../store/ui";
import { resolveTheme } from "../../lib/theme";
import {
  closeSession,
  newSession,
  newWorkspace,
  openSession,
  switchWorkspace,
} from "../../actions";
import { SessionIcon } from "../icons";

interface Command {
  id: string;
  label: string;
  icon: ReactNode;
  hint?: string;
  run: () => void;
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setPalette = useUI((s) => s.setPalette);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const sessions = useWorkspaces((s) => s.sessions);
  const activeSessionId = useWorkspaces((s) => s.activeSessionId);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const setSettings = useUI((s) => s.setSettings);

  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      {
        id: "new-picker",
        label: "New session in a folder...",
        icon: <SessionIcon typeId="powershell" size={16} />,
        run: () => useUI.getState().setNewSession(true),
      },
      {
        id: "new-ps",
        label: "New PowerShell session",
        icon: <Plus size={15} />,
        run: () => newSession({ shell: { kind: "powershell" }, typeId: "powershell" }),
      },
      {
        id: "new-cmd",
        label: "New Command Prompt session",
        icon: <Plus size={15} />,
        run: () => newSession({ shell: { kind: "cmd" }, typeId: "cmd" }),
      },
      {
        id: "new-wsl",
        label: "New WSL session",
        icon: <Plus size={15} />,
        run: () => newSession({ shell: { kind: "wsl" }, typeId: "wsl" }),
      },
      {
        id: "new-bash",
        label: "New Bash session",
        icon: <Plus size={15} />,
        run: () =>
          newSession({
            shell: { kind: "custom", program: "bash.exe", args: ["-i", "-l"] },
            name: "Bash",
            typeId: "bash",
          }),
      },
      {
        id: "new-workspace",
        label: "New workspace",
        icon: <FolderPlus size={15} />,
        run: () => newWorkspace(),
      },
      {
        id: "close-session",
        label: "Close active session",
        icon: <X size={15} />,
        hint: "layout",
        run: () => {
          if (activeSessionId) closeSession(activeSessionId);
        },
      },
      {
        id: "toggle-theme",
        label: "Toggle light / dark theme",
        icon: <Palette size={15} />,
        run: () => setTheme(resolveTheme(theme) === "dark" ? "light" : "dark"),
      },
      {
        id: "settings",
        label: "Open settings",
        icon: <SettingsIcon size={15} />,
        run: () => setSettings(true),
      },
    ];

    const wsCmds: Command[] = workspaces.map((w) => ({
      id: `ws-${w.id}`,
      label: `Switch to: ${w.name}`,
      icon: <Layers size={15} />,
      hint: "workspace",
      run: () => switchWorkspace(w.id),
    }));

    const openers: Command[] = Object.values(sessions).map((n) => ({
      id: `open-${n.id}`,
      label: `Open: ${n.name}`,
      icon: <SessionIcon typeId={n.typeId} size={16} />,
      hint: "session",
      run: () => openSession(n.id),
    }));

    return [...base, ...wsCmds, ...openers];
  }, [workspaces, sessions, activeSessionId, theme, setTheme, setSettings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open) return null;

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    cmd.run();
    setPalette(false);
  };

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setPalette(false);
      }}
    >
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command, workspace, or session name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(filtered[index]);
            } else if (e.key === "Escape") {
              setPalette(false);
            }
          }}
        />
        <div className="palette-list">
          {filtered.length === 0 ? (
            <div className="palette-empty">No matching commands.</div>
          ) : (
            filtered.map((cmd, i) => (
              <div
                key={cmd.id}
                className={`palette-item${i === index ? " active" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  run(cmd);
                }}
              >
                <span className="pi-icon">{cmd.icon}</span>
                <span className="bidi-auto">{cmd.label}</span>
                {cmd.hint && <span className="pi-hint">{cmd.hint}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
