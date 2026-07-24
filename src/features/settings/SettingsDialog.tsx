import { useRef, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { useSettings, type TerminalTheme } from "../../store/settings";
import { useUI } from "../../store/ui";
import { applySettingsToAll } from "../terminal/controller";
import { terminalThemeFor } from "../terminal/theme";
import { termScheme } from "../../actions";
import { pickFolder } from "../../lib/ipc";
import { DialogTrap } from "../../lib/dialog-trap";
import { useStrings } from "../../lib/i18n";
import { SHELL_TYPES } from "../../lib/sessionTypes";
import type { ShellKind, ThemeMode } from "../../lib/types";

const THEMES: ThemeMode[] = ["dark", "light", "system"];
const TERM_THEMES: TerminalTheme[] = ["dark", "light", "match"];
// One source of truth with the new-session wizard: the dropdown offers exactly the
// wizard's shell catalog (bash carries its full custom ShellKind, not just a kind
// string). Remote types are skipped - a default shell needs no per-use target input.
const SHELLS: { value: string; label: string; shell: ShellKind }[] = SHELL_TYPES.filter(
  (s) => !s.remote,
).map((s) => ({
  value: s.id,
  label: s.label,
  shell: s.shell,
}));

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
  const t = useStrings();
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
  // Map the stored default shell to a dropdown value: bash is a custom shell with a known
  // program; any other custom shell (legacy) shows the disabled "Custom" entry.
  const shellValue =
    defaultShell.kind === "custom"
      ? defaultShell.program === "bash.exe"
        ? "bash"
        : "custom"
      : defaultShell.kind;

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setSettings(false);
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t.settings} ref={boxRef}>
        <DialogTrap containerRef={boxRef} />
        <div className="dialog-header">
          {t.settings}
          <span style={{ flex: 1 }} />
          <button
            className="icon-btn"
            title={t.close}
            aria-label={t.closeSettings}
            onClick={() => setSettings(false)}
          >
            <X size={16} />
          </button>
        </div>
        <div className="dialog-body">
          <div className="field">
            <span className="field-label">{t.appTheme}</span>
            <div className="seg">
              {THEMES.map((m) => (
                <button
                  key={m}
                  className={theme === m ? "on" : ""}
                  onClick={() => setTheme(m)}
                >
                  {m === "dark" ? t.themeDark : m === "light" ? t.themeLight : t.themeSystem}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">
              {t.terminalColors} <span className="field-hint">{t.terminalColorsHint}</span>
            </span>
            <div className="seg">
              {TERM_THEMES.map((m) => (
                <button
                  key={m}
                  className={terminalTheme === m ? "on" : ""}
                  onClick={() => setTermTheme(m)}
                >
                  {m === "match" ? t.matchApp : m === "dark" ? t.themeDark : t.themeLight}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <div className="field-row">
              <span className="field-label">{t.terminalFontSize}</span>
              <div className="stepper">
                <button
                  className="icon-btn"
                  title={t.smaller}
                  aria-label={t.decreaseFont}
                  onClick={() => setFont(fontSize - 1)}
                >
                  <Minus size={14} />
                </button>
                <span className="val" aria-live="polite">{fontSize}</span>
                <button
                  className="icon-btn"
                  title={t.larger}
                  aria-label={t.increaseFont}
                  onClick={() => setFont(fontSize + 1)}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="field">
            <div className="field-row">
              <span className="field-label">{t.terminalTextWeight}</span>
              <div className="seg">
                <button className={!termBold ? "on" : ""} onClick={() => setBold(false)}>
                  {t.weightNormal}
                </button>
                <button className={termBold ? "on" : ""} onClick={() => setBold(true)}>
                  {t.weightBold}
                </button>
              </div>
            </div>
          </div>


          <div className="field">
            <div className="field-row">
              <span className="field-label">{t.terminalTextColor}</span>
              <div className="stepper">
                <input
                  type="color"
                  className="color-input"
                  aria-label={t.terminalTextColor}
                  value={fgValue}
                  onChange={(e) => setFg(e.target.value)}
                />
                <button className="btn-ghost" onClick={() => setFg(undefined)}>
                  {t.themeDefault}
                </button>
              </div>
            </div>
          </div>

          <div className="field">
            <span className="field-label">{t.defaultShellLabel}</span>
            <select
              className="select"
              value={shellValue}
              onChange={(e) => {
                const pick = SHELLS.find((sh) => sh.value === e.target.value);
                if (pick) useSettings.getState().setDefaultShell(pick.shell);
              }}
            >
              {defaultShell.kind === "custom" && shellValue === "custom" && (
                <option value="custom" disabled>
                  {t.customShell(defaultShell.program)}
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
              {t.defaultFolderLabel} <span className="field-hint">{t.defaultFolderHint}</span>
            </span>
            <div className="folder-set">
              <span className="folder-set-path bidi-auto" dir="ltr">
                {defaultCwd || t.notSet}
              </span>
              <button
                className="btn-ghost"
                onClick={async () => {
                  setPickError(null);
                  try {
                    const dir = await pickFolder(t.chooseDefaultFolder);
                    if (dir) useSettings.getState().setDefaultCwd(dir);
                  } catch (e) {
                    console.warn("folder picker failed", e);
                    setPickError(t.pickerFailed);
                  }
                }}
              >
                {t.browse}
              </button>
              {defaultCwd ? (
                <button className="btn-ghost" onClick={() => useSettings.getState().setDefaultCwd("")}>
                  {t.clear}
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
