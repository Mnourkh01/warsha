import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FolderOpen,
  FolderPlus,
  Palette,
  Plus,
  SquarePlus,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { SessionIcon } from "../icons";
import type { SessionNode } from "../../lib/types";
import { useTree } from "../../store/tree";
import { useLayout } from "../../store/layout";
import { useSettings } from "../../store/settings";
import { useUI } from "../../store/ui";
import { resolveTheme } from "../../lib/theme";
import { addPaneAction, closePaneAction, newSession, openSession } from "../../actions";

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
  const nodes = useTree((s) => s.nodes);
  const activePaneId = useLayout((s) => s.activePaneId);
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
        icon: <FolderOpen size={15} />,
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
        id: "new-group",
        label: "New group",
        icon: <FolderPlus size={15} />,
        run: () => useTree.getState().addGroup(null),
      },
      {
        id: "add-pane",
        label: "Add pane",
        icon: <SquarePlus size={15} />,
        hint: "layout",
        run: () => addPaneAction(),
      },
      {
        id: "close-pane",
        label: "Close active pane",
        icon: <X size={15} />,
        hint: "layout",
        run: () => closePaneAction(activePaneId),
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

    const openers: Command[] = Object.values(nodes)
      .filter((n) => n.type === "session")
      .map((n) => ({
        id: `open-${n.id}`,
        label: `Open: ${n.name}`,
        icon: <SessionIcon typeId={(n as SessionNode).typeId} size={16} />,
        hint: "session",
        run: () => openSession(n.id),
      }));

    return [...base, ...openers];
  }, [nodes, activePaneId, theme, setTheme, setSettings]);

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
          placeholder="Type a command or a session name..."
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
