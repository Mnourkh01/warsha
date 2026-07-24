import { useRef } from "react";
import { X } from "lucide-react";
import { useUI } from "../../store/ui";
import { useSettings } from "../../store/settings";
import { DialogTrap } from "../../lib/dialog-trap";
import { useStrings, type Strings } from "../../lib/i18n";
import { SHORTCUT_DEFS, effectiveChords } from "./registry";

// Terminal-contract chords, not rebindable; shown after the registry actions.
const FIXED: { chord: string; action: (t: Strings) => string }[] = [
  { chord: "Ctrl+Shift+C", action: (t) => t.scCopy },
  { chord: "Ctrl+V / Ctrl+Shift+V", action: (t) => t.scPaste },
  { chord: "Escape", action: (t) => t.scEscape },
  { chord: "Ctrl+C", action: (t) => t.scSigint },
];

export function ShortcutsDialog() {
  const open = useUI((s) => s.shortcutsOpen);
  const setShortcuts = useUI((s) => s.setShortcuts);
  const overrides = useSettings((s) => s.shortcuts);
  const boxRef = useRef<HTMLDivElement>(null);
  const t = useStrings();

  if (!open) return null;

  const effective = effectiveChords(overrides ?? {});
  const rows = [
    ...SHORTCUT_DEFS.map((def) => ({
      chord: (effective.get(def.action) ?? []).join(" / ") || "-",
      label: def.label(t),
    })),
    ...FIXED.map((f) => ({ chord: f.chord, label: f.action(t) })),
  ];

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setShortcuts(false);
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t.keyboardShortcuts}
        ref={boxRef}
      >
        <DialogTrap containerRef={boxRef} />
        <div className="dialog-header">
          {t.keyboardShortcuts}
          <span style={{ flex: 1 }} />
          <button
            className="icon-btn"
            title={t.close}
            aria-label={t.closeShortcuts}
            onClick={() => setShortcuts(false)}
          >
            <X size={16} />
          </button>
        </div>
        <div className="dialog-body">
          <table className="shortcut-table">
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className="shortcut-chord">
                    <kbd>{r.chord}</kbd>
                  </td>
                  <td>{r.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
