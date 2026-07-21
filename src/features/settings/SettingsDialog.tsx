import { useRef, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { useSettings, type TerminalTheme } from "../../store/settings";
import { useUI } from "../../store/ui";
import { applySettingsToAll } from "../terminal/controller";
import { terminalThemeFor } from "../terminal/theme";
import { termScheme } from "../../actions";
import { pickFolder } from "../../lib/ipc";
import { DialogTrap } from "../../lib/dialog-trap";
import type { ShellKind, ThemeMode } from "../../lib/types";

const THEMES: ThemeMode[] = ["dark", "light", "system"];
const TERM_THEMES: TerminalTheme[] = ["dark", "light", "match"];
const SHELLS: { value: ShellKind["kind"]; label: string }[] = [
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "Command Prompt" },
  { value: "wsl", label: "WSL" },
];

export function SettingsDialog() {
  const open = useUI((s) => s.settingsOpen);
  const setSettings = useUI((s) => s.setSettings);
  const theme = useSettings((s) => s.theme);
  const terminalTheme = useSettings((s) => s.terminalTheme);
  const fontSize = useSettings((s) => s.fontSize);
  const termBold = useSettings((s) => s.termBold);
  const termForeground = useSettings((s) => s.termForeground);
  const defaultShell = useSettings((s) => s.defaultShell);
  const defaultCwd = useSettings((s) => s.defaultCwd);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  if (!open) return null;

  const setFont = (n: number) => {
    useSettings.getState().setFontSize(n);
    applySettingsToAll({ fontSize: useSettings.getState().fontSize });
  };
  // Theme changes only touch the store: the App effect is the single owner of syncing
  // terminals to theme changes (double-applying from here caused drift).
  const setTheme = (t: ThemeMode) => useSettings.getState().setTheme(t);
  const setTermTheme = (t: TerminalTheme) => useSettings.getState().setTerminalTheme(t);
  const setBold = (b: boolean) => {
    useSettings.getState().setTermBold(b);
    applySettingsToAll({ bold: b });
  };
  const setFg = (c: string | undefined) => {
    useSettings.getState().setTermForeground(c);
    applySettingsToAll({ foreground: useSettings.getState().termForeground });
  };
  const fgValue = termForeground ?? (terminalThemeFor(termScheme()).foreground as string);

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setSettings(false);
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Settings" ref={boxRef}>
        <DialogTrap containerRef={boxRef} />
        <div className="dialog-header">
          Settings
          <span style={{ flex: 1 }} />
          <button
            className="icon-btn"
            title="Close"
            aria-label="Close settings"
            onClick={() => setSettings(false)}
          >
            <X size={16} />
          </button>
        </div>
        <div className="dialog-body">
          <div className="field">
            <span className="field-label">App theme</span>
            <div className="seg">
              {THEMES.map((t) => (
                <button
                  key={t}
                  className={theme === t ? "on" : ""}
                  onClick={() => setTheme(t)}
                >
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">
              Terminal colors <span className="field-hint">(keep dark so CLIs like Claude look right)</span>
            </span>
            <div className="seg">
              {TERM_THEMES.map((t) => (
                <button
                  key={t}
                  className={terminalTheme === t ? "on" : ""}
                  onClick={() => setTermTheme(t)}
                >
                  {t === "match" ? "Match app" : t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <div className="field-row">
              <span className="field-label">Terminal font size</span>
              <div className="stepper">
                <button
                  className="icon-btn"
                  title="Smaller"
                  aria-label="Decrease font size"
                  onClick={() => setFont(fontSize - 1)}
                >
                  <Minus size={14} />
                </button>
                <span className="val" aria-live="polite">{fontSize}</span>
                <button
                  className="icon-btn"
                  title="Larger"
                  aria-label="Increase font size"
                  onClick={() => setFont(fontSize + 1)}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="field">
            <div className="field-row">
              <span className="field-label">Terminal text weight</span>
              <div className="seg">
                <button className={!termBold ? "on" : ""} onClick={() => setBold(false)}>
                  Normal
                </button>
                <button className={termBold ? "on" : ""} onClick={() => setBold(true)}>
                  Bold
                </button>
              </div>
            </div>
          </div>

          <div className="field">
            <div className="field-row">
              <span className="field-label">Terminal text color</span>
              <div className="stepper">
                <input
                  type="color"
                  className="color-input"
                  aria-label="Terminal text color"
                  value={fgValue}
                  onChange={(e) => setFg(e.target.value)}
                />
                <button className="btn-ghost" onClick={() => setFg(undefined)}>
                  Theme default
                </button>
              </div>
            </div>
          </div>

          <div className="field">
            <span className="field-label">Default shell for new sessions</span>
            <select
              className="select"
              value={defaultShell.kind}
              onChange={(e) => {
                const kind = e.target.value as ShellKind["kind"];
                if (kind === "custom") return; // display-only entry, not a choice
                useSettings.getState().setDefaultShell({ kind } as ShellKind);
              }}
            >
              {defaultShell.kind === "custom" && (
                <option value="custom" disabled>
                  Custom ({defaultShell.program})
                </option>
              )}
              {SHELLS.map((sh) => (
                <option key={sh.value} value={sh.value}>
                  {sh.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <span className="field-label">
              Default project folder{" "}
              <span className="field-hint">(new sessions can start here in one click)</span>
            </span>
            <div className="folder-set">
              <span className="folder-set-path bidi-auto" dir="ltr">
                {defaultCwd || "Not set"}
              </span>
              <button
                className="btn-ghost"
                onClick={async () => {
                  setPickError(null);
                  try {
                    const dir = await pickFolder("Choose your default project folder");
                    if (dir) useSettings.getState().setDefaultCwd(dir);
                  } catch (e) {
                    console.warn("folder picker failed", e);
                    setPickError("Could not open the folder picker. Try again.");
                  }
                }}
              >
                Browse
              </button>
              {defaultCwd ? (
                <button className="btn-ghost" onClick={() => useSettings.getState().setDefaultCwd("")}>
                  Clear
                </button>
              ) : null}
            </div>
            {pickError && <div className="picker-error">{pickError}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
