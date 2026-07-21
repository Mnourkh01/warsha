import { useRef } from "react";
import { X } from "lucide-react";
import { useUI } from "../../store/ui";
import { DialogTrap } from "../../lib/dialog-trap";

const SHORTCUTS: { chord: string; action: string }[] = [
  { chord: "Ctrl+K / Ctrl+Shift+P", action: "Command palette" },
  { chord: "Ctrl+Shift+B", action: "Toggle sidebar" },
  { chord: "Ctrl+Shift+F", action: "Find in the active terminal" },
  { chord: "Ctrl+Shift+M", action: "Maximize / restore the active pane" },
  { chord: "Ctrl+Shift+C", action: "Copy selection in the terminal" },
  { chord: "Ctrl+Shift+V", action: "Paste into the terminal" },
  { chord: "Escape", action: "Close the topmost dialog or the find bar" },
  { chord: "Ctrl+C", action: "Stays SIGINT for the shell (not copy)" },
];

export function ShortcutsDialog() {
  const open = useUI((s) => s.shortcutsOpen);
  const setShortcuts = useUI((s) => s.setShortcuts);
  const boxRef = useRef<HTMLDivElement>(null);

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
        aria-label="Keyboard shortcuts"
        ref={boxRef}
      >
        <DialogTrap containerRef={boxRef} />
        <div className="dialog-header">
          Keyboard shortcuts
          <span style={{ flex: 1 }} />
          <button
            className="icon-btn"
            title="Close"
            aria-label="Close shortcuts"
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
                  <td>{s.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
