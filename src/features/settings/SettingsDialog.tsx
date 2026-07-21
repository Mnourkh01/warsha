import { Minus, Plus, X } from "lucide-react";
import { useSettings } from "../../store/settings";
import { useUI } from "../../store/ui";
import { applySettingsToAll } from "../terminal/controller";
import { terminalThemeFor } from "../terminal/theme";
import { resolveTheme } from "../../lib/theme";
import type { ShellKind, ThemeMode } from "../../lib/types";

const THEMES: ThemeMode[] = ["dark", "light", "system"];
const SHELLS: { value: ShellKind["kind"]; label: string }[] = [
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "Command Prompt" },
  { value: "wsl", label: "WSL" },
];

export function SettingsDialog() {
  const open = useUI((s) => s.settingsOpen);
  const setSettings = useUI((s) => s.setSettings);
  const s = useSettings();

  if (!open) return null;

  const setFont = (n: number) => {
    s.setFontSize(n);
    applySettingsToAll({ fontSize: useSettings.getState().fontSize });
  };
  const setTheme = (t: ThemeMode) => {
    s.setTheme(t);
    applySettingsToAll({ theme: resolveTheme(t) });
  };
  const setBold = (b: boolean) => {
    s.setTermBold(b);
    applySettingsToAll({ bold: b });
  };
  const setFg = (c: string | undefined) => {
    s.setTermForeground(c);
    applySettingsToAll({ foreground: useSettings.getState().termForeground });
  };
  const fgValue = s.termForeground ?? (terminalThemeFor(resolveTheme(s.theme)).foreground as string);

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setSettings(false);
      }}
    >
      <div className="dialog" role="dialog" aria-label="Settings">
        <div className="dialog-header">
          Settings
          <span style={{ flex: 1 }} />
          <button className="icon-btn" title="Close" onClick={() => setSettings(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="dialog-body">
          <div className="field">
            <span className="field-label">Theme</span>
            <div className="seg">
              {THEMES.map((t) => (
                <button
                  key={t}
                  className={s.theme === t ? "on" : ""}
                  onClick={() => setTheme(t)}
                >
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <div className="field-row">
              <span className="field-label">Terminal font size</span>
              <div className="stepper">
                <button className="icon-btn" onClick={() => setFont(s.fontSize - 1)}>
                  <Minus size={14} />
                </button>
                <span className="val">{s.fontSize}</span>
                <button className="icon-btn" onClick={() => setFont(s.fontSize + 1)}>
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="field">
            <div className="field-row">
              <span className="field-label">Terminal text weight</span>
              <div className="seg">
                <button className={!s.termBold ? "on" : ""} onClick={() => setBold(false)}>
                  Normal
                </button>
                <button className={s.termBold ? "on" : ""} onClick={() => setBold(true)}>
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
              value={s.defaultShell.kind === "custom" ? "powershell" : s.defaultShell.kind}
              onChange={(e) =>
                s.setDefaultShell({ kind: e.target.value as ShellKind["kind"] } as ShellKind)
              }
            >
              {SHELLS.map((sh) => (
                <option key={sh.value} value={sh.value}>
                  {sh.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <span className="field-label">Default working directory (optional)</span>
            <input
              className="input"
              placeholder="e.g. C:\\projects\\my-app"
              value={s.defaultCwd ?? ""}
              onChange={(e) => s.setDefaultCwd(e.target.value)}
              dir="ltr"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
