import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FolderPlus,
  Keyboard,
  Layers,
  Maximize2,
  Minus,
  Palette,
  PanelLeft,
  Plus,
  RotateCw,
  Search,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { useWorkspaces } from "../../store/workspaces";
import { useSettings } from "../../store/settings";
import { useUI } from "../../store/ui";
import { resolveTheme } from "../../lib/theme";
import {
  bumpFontSize,
  closeSession,
  newSession,
  newWorkspace,
  openSession,
  restartSession,
  switchWorkspace,
} from "../../actions";
import { DialogTrap } from "../../lib/dialog-trap";
import { SessionIcon } from "../icons";
import { useStrings } from "../../lib/i18n";

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
  const t = useStrings();

  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      {
        id: "new-picker",
        label: t.cmdNewPicker,
        icon: <SessionIcon typeId="powershell" size={16} />,
        run: () => useUI.getState().setNewSession(true),
      },
      {
        id: "new-ps",
        label: t.cmdNewPs,
        icon: <Plus size={15} />,
        run: () => newSession({ shell: { kind: "powershell" }, typeId: "powershell" }),
      },
      {
        id: "new-cmd",
        label: t.cmdNewCmd,
        icon: <Plus size={15} />,
        run: () => newSession({ shell: { kind: "cmd" }, typeId: "cmd" }),
      },
      {
        id: "new-wsl",
        label: t.cmdNewWsl,
        icon: <Plus size={15} />,
        run: () => newSession({ shell: { kind: "wsl" }, typeId: "wsl" }),
      },
      {
        id: "new-bash",
        label: t.cmdNewBash,
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
        label: t.newWorkspace,
        icon: <FolderPlus size={15} />,
        run: () => newWorkspace(),
      },
      {
        id: "close-session",
        label: t.cmdCloseActive,
        icon: <X size={15} />,
        hint: t.hintSession,
        run: () => {
          if (activeSessionId) closeSession(activeSessionId);
        },
      },
      {
        id: "restart-session",
        label: t.cmdRestartActive,
        icon: <RotateCw size={15} />,
        hint: t.hintSession,
        run: () => {
          if (activeSessionId) void restartSession(activeSessionId);
        },
      },
      {
        id: "maximize-pane",
        label: t.cmdMaximize,
        icon: <Maximize2 size={15} />,
        hint: "Ctrl+Shift+M",
        run: () => {
          if (activeSessionId) useUI.getState().toggleMaximized(activeSessionId);
        },
      },
      {
        id: "find-terminal",
        label: t.findInTerminal,
        icon: <Search size={15} />,
        hint: "Ctrl+Shift+F",
        run: () => {
          if (activeSessionId) useUI.getState().setFind(true);
        },
      },
      {
        id: "font-bigger",
        label: t.cmdFontUp,
        icon: <Plus size={15} />,
        run: () => bumpFontSize(1),
      },
      {
        id: "font-smaller",
        label: t.cmdFontDown,
        icon: <Minus size={15} />,
        run: () => bumpFontSize(-1),
      },
      {
        id: "toggle-sidebar",
        label: t.cmdToggleSidebar,
        icon: <PanelLeft size={15} />,
        hint: "Ctrl+Shift+B",
        run: () => useUI.getState().toggleSidebar(),
      },
      {
        id: "shortcuts",
        label: t.cmdShortcuts,
        icon: <Keyboard size={15} />,
        run: () => useUI.getState().setShortcuts(true),
      },
      {
        id: "toggle-theme",
        label: t.cmdToggleTheme,
        icon: <Palette size={15} />,
        run: () => setTheme(resolveTheme(theme) === "dark" ? "light" : "dark"),
      },
      {
        id: "settings",
        label: t.cmdSettings,
        icon: <SettingsIcon size={15} />,
        run: () => setSettings(true),
      },
    ];

    const wsCmds: Command[] = workspaces.map((w) => ({
      id: `ws-${w.id}`,
      label: t.cmdSwitchTo(w.name),
      icon: <Layers size={15} />,
      hint: t.hintWorkspace,
      run: () => switchWorkspace(w.id),
    }));

    const openers: Command[] = Object.values(sessions).map((n) => ({
      id: `open-${n.id}`,
      label: t.cmdOpen(n.name),
      icon: <SessionIcon typeId={n.typeId} size={16} />,
      hint: t.hintSession,
      run: () => openSession(n.id),
    }));

    return [...base, ...wsCmds, ...openers];
  }, [workspaces, sessions, activeSessionId, theme, setTheme, setSettings, t]);

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
      <div className="palette" role="dialog" aria-modal="true" aria-label={t.commandPalette} ref={boxRef}>
        <DialogTrap containerRef={boxRef} />
        <input
          ref={inputRef}
          className="palette-input"
          aria-label={t.searchCommands}
          placeholder={t.palettePlaceholder}
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
        <div className="palette-list" role="listbox" aria-label={t.searchCommands}>
          {filtered.length === 0 ? (
            <div className="palette-empty">{t.paletteEmpty}</div>
          ) : (
            filtered.map((cmd, i) => (
              <div
                key={cmd.id}
                role="option"
                aria-selected={i === index}
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
