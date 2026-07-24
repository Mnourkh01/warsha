import { useRef } from "react";
import { X } from "lucide-react";
import { useUI } from "../../store/ui";
import { DialogTrap } from "../../lib/dialog-trap";
import { useStrings, type Strings } from "../../lib/i18n";

const SHORTCUTS: { chord: string; action: (t: Strings) => string }[] = [
  { chord: "Ctrl+K / Ctrl+Shift+P", action: (t) => t.scPalette },
  { chord: "Ctrl+Shift+B", action: (t) => t.scSidebar },
  { chord: "Ctrl+Shift+F", action: (t) => t.scFind },
  { chord: "Ctrl+Shift+M", action: (t) => t.scMaximize },
  { chord: "Ctrl+Shift+I", action: (t) => t.scBroadcast },
  { chord: "Ctrl+Shift+C", action: (t) => t.scCopy },
  { chord: "Ctrl+V / Ctrl+Shift+V", action: (t) => t.scPaste },
  { chord: "Escape", action: (t) => t.scEscape },
  { chord: "Ctrl+C", action: (t) => t.scSigint },
];

export function ShortcutsDialog() {
  const open = useUI((s) => s.shortcutsOpen);
  const setShortcuts = useUI((s) => s.setShortcuts);
  const boxRef = useRef<HTMLDivElement>(null);
  const t = useStrings();

  if (!open) return null;

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
              {SHORTCUTS.map((s) => (
                <tr key={s.chord}>
                  <td className="shortcut-chord">
                    <kbd>{s.chord}</kbd>
                  </td>
                  <td>{s.action(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
