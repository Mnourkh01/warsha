import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useSettings } from "../../store/settings";
import { useStrings } from "../../lib/i18n";
import {
  SHORTCUT_DEFS,
  chordFromEvent,
  chordOwner,
  effectiveChords,
  isValidChord,
  setCapturingShortcut,
  type ShortcutAction,
} from "../shortcuts/registry";

/** The editable shortcut list inside Settings. Click a chord, press the new keys.
 *  While recording, the global App key handler stands down (capture flag). */
export function ShortcutsSection() {
  const overrides = useSettings((s) => s.shortcuts);
  const t = useStrings();
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState<{ action: ShortcutAction; msg: string } | null>(null);

  const effective = effectiveChords(overrides ?? {});
  const hasOverrides = !!overrides && Object.keys(overrides).length > 0;

  useEffect(() => {
    if (!recording) return;
    setCapturingShortcut(true);
    const stop = () => setRecording(null);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        stop();
        return;
      }
      const chord = chordFromEvent(e);
      if (!chord) return; // bare modifier held down, keep waiting
      if (!isValidChord(chord)) {
        setError({ action: recording, msg: t.shortcutNeedCtrlAlt });
        stop();
        return;
      }
      const owner = chordOwner(chord, useSettings.getState().shortcuts ?? {}, recording);
      if (owner) {
        setError({ action: recording, msg: t.shortcutConflict(owner.label(t)) });
        stop();
        return;
      }
      useSettings.getState().setShortcut(recording, chord);
      setError(null);
      stop();
    };
    // A click anywhere else means "never mind".
    const onPointer = () => stop();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
      setCapturingShortcut(false);
    };
  }, [recording, t]);

  const begin = (action: ShortcutAction) => {
    setError(null);
    setRecording(action);
  };

  return (
    <>
      <div className="field-hint">{t.shortcutsIntro}</div>
      <div className="sc-list">
        {SHORTCUT_DEFS.map((def) => {
          const chords = effective.get(def.action) ?? [];
          const overridden = !!overrides?.[def.action];
          const isRec = recording === def.action;
          return (
            <div key={def.action}>
              <div className="sc-row">
                <span className="sc-label">{def.label(t)}</span>
                {overridden && !isRec && (
                  <button
                    className="icon-btn sm"
                    title={t.shortcutResetOne}
                    aria-label={t.shortcutResetOne}
                    onClick={() => useSettings.getState().setShortcut(def.action, undefined)}
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
                <button
                  className={"sc-kbd" + (isRec ? " recording" : "")}
                  title={t.shortcutChangeTitle(def.label(t))}
                  onClick={() => begin(def.action)}
                >
                  {isRec ? t.shortcutRecording : chords.length ? chords.join(" / ") : "-"}
                </button>
              </div>
              {error?.action === def.action && <div className="sc-error">{error.msg}</div>}
            </div>
          );
        })}
      </div>
      {hasOverrides && (
        <div>
          <button
            className="btn-ghost"
            onClick={() => {
              setError(null);
              useSettings.getState().resetShortcuts();
            }}
          >
            {t.shortcutsResetAll}
          </button>
        </div>
      )}
      <div className="field">
        <span className="field-label">
          {t.shortcutFixedHeader} <span className="field-hint">{t.shortcutFixedHint}</span>
        </span>
        <div className="sc-list">
          <div className="sc-row sc-fixed">
            <span className="sc-label">{t.scSigint}</span>
            <span className="sc-kbd-static">Ctrl+C</span>
          </div>
          <div className="sc-row sc-fixed">
            <span className="sc-label">{t.scCopy}</span>
            <span className="sc-kbd-static">Ctrl+Shift+C</span>
          </div>
          <div className="sc-row sc-fixed">
            <span className="sc-label">{t.scPaste}</span>
            <span className="sc-kbd-static">Ctrl+V / Ctrl+Shift+V</span>
          </div>
          <div className="sc-row sc-fixed">
            <span className="sc-label">{t.scEscape}</span>
            <span className="sc-kbd-static">Escape</span>
          </div>
        </div>
      </div>
    </>
  );
}
