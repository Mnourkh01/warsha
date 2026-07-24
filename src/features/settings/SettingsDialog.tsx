import { useEffect, useRef, useState } from "react";
import { Keyboard, Minus, Paintbrush, Plus, RefreshCw, Terminal, X } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { useSettings, type TerminalTheme } from "../../store/settings";
import { useUI } from "../../store/ui";
import { applySettingsToAll } from "../terminal/controller";
import { terminalThemeFor } from "../terminal/theme";
import { termScheme } from "../../actions";
import { pickFolder } from "../../lib/ipc";
import { checkForUpdate, installUpdate } from "../../lib/updater";
import { DialogTrap } from "../../lib/dialog-trap";
import { useStrings, type Strings } from "../../lib/i18n";
import { SHELL_TYPES } from "../../lib/sessionTypes";
import { ShortcutsSection } from "./ShortcutsSection";
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

type Tab = "appearance" | "terminal" | "shortcuts" | "updates";

const TABS: { id: Tab; icon: typeof Paintbrush; label: (t: Strings) => string }[] = [
  { id: "appearance", icon: Paintbrush, label: (t) => t.settingsTabAppearance },
  { id: "terminal", icon: Terminal, label: (t) => t.settingsTabTerminal },
  { id: "shortcuts", icon: Keyboard, label: (t) => t.settingsTabShortcuts },
  { id: "updates", icon: RefreshCw, label: (t) => t.settingsTabUpdates },
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
  const t = useStrings();
  const boxRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("appearance");
  const [pickError, setPickError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [upd, setUpd] = useState<{
    phase: "idle" | "checking" | "none" | "found" | "installing" | "error";
    version?: string;
    progress?: number | null;
  }>({ phase: "idle" });

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {
        /* running outside Tauri (vitest/browser) */
      });
  }, []);

  if (!open) return null;

  const checkNow = async () => {
    setUpd({ phase: "checking" });
    try {
      const info = await checkForUpdate();
      setUpd(info ? { phase: "found", version: info.version } : { phase: "none" });
    } catch (e) {
      console.warn("update check failed", e);
      setUpd({ phase: "error" });
    }
  };

  const installNow = () => {
    setUpd((u) => ({ ...u, phase: "installing", progress: null }));
    installUpdate((p) => setUpd((u) => ({ ...u, progress: p }))).catch((e) => {
      console.warn("update install failed", e);
      setUpd({ phase: "error" });
    });
  };

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
      <div
        className="dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t.settings}
        ref={boxRef}
      >
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
        <div className="settings-layout">
          <nav className="settings-nav" aria-label={t.settings}>
            {TABS.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                className={tab === id ? "on" : ""}
                aria-current={tab === id}
                onClick={() => setTab(id)}
              >
                <Icon size={15} />
                {label(t)}
              </button>
            ))}
          </nav>
          <div className="settings-pane">
            {tab === "appearance" && (
              <>
                <div className="field">
                  <span className="field-label">{t.appTheme}</span>
                  <div className="seg">
                    {THEMES.map((m) => (
                      <button key={m} className={theme === m ? "on" : ""} onClick={() => setTheme(m)}>
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
                      <span className="val" aria-live="polite">
                        {fontSize}
                      </span>
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
              </>
            )}

            {tab === "terminal" && (
              <>
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
                      <button
                        className="btn-ghost"
                        onClick={() => useSettings.getState().setDefaultCwd("")}
                      >
                        {t.clear}
                      </button>
                    ) : null}
                  </div>
                  {pickError && <div className="picker-error">{pickError}</div>}
                </div>
              </>
            )}

            {tab === "shortcuts" && <ShortcutsSection />}

            {tab === "updates" && (
              <div className="field">
                <div className="field-row">
                  <span className="field-label">
                    {t.updatesLabel}{" "}
                    {appVersion && <span className="field-hint">{t.currentVersion(appVersion)}</span>}
                  </span>
                  {upd.phase === "found" && upd.version ? (
                    <button className="btn-ghost" onClick={installNow}>
                      {t.updateTo(upd.version)}
                    </button>
                  ) : (
                    <button
                      className="btn-ghost"
                      disabled={upd.phase === "checking" || upd.phase === "installing"}
                      onClick={() => void checkNow()}
                    >
                      {t.updateCheckNow}
                    </button>
                  )}
                </div>
                {upd.phase !== "idle" && upd.phase !== "found" && (
                  <div className="field-hint" aria-live="polite">
                    {upd.phase === "checking"
                      ? t.updateChecking
                      : upd.phase === "none"
                        ? t.updateUpToDate
                        : upd.phase === "installing"
                          ? upd.progress === 100
                            ? t.updateInstalling
                            : t.updateDownloading(upd.progress ?? null)
                          : t.updateFailed}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
