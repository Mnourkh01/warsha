import { useState } from "react";
import { Check, Copy, FolderOpen } from "lucide-react";
import { useUI } from "../../store/ui";
import { newSession } from "../../actions";
import { pickFolder, whichProgram } from "../../lib/ipc";
import { SESSION_TYPES, type SessionType } from "../../lib/sessionTypes";
import { SessionIcon } from "../icons";

export function NewSessionDialog() {
  const open = useUI((s) => s.newSessionOpen);
  const setNewSession = useUI((s) => s.setNewSession);
  const [missing, setMissing] = useState<{ label: string; install: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const close = () => {
    setMissing(null);
    setBusy(false);
    setNewSession(false);
  };

  const pick = async (t: SessionType) => {
    setMissing(null);
    setBusy(true);
    try {
      if (t.probe) {
        const found = await whichProgram(t.probe);
        if (!found) {
          setMissing({ label: t.label, install: t.install ?? `Program not found: ${t.probe}` });
          setBusy(false);
          return;
        }
      }
      const folder = await pickFolder(`Choose a folder for ${t.label}`);
      if (!folder) {
        setBusy(false);
        return;
      }
      const base = folder.split(/[\\/]/).filter(Boolean).pop() || folder;
      newSession({
        shell: t.shell,
        name: `${t.label} · ${base}`,
        cwd: folder,
        initCommand: t.initCommand,
        typeId: t.id,
      });
      close();
    } catch (e) {
      setMissing({ label: t.label, install: `This step needs the desktop app. (${String(e)})` });
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const shells = SESSION_TYPES.filter((t) => t.group === "shell");
  const ais = SESSION_TYPES.filter((t) => t.group === "ai");

  const renderCard = (t: SessionType) => (
    <button key={t.id} className="type-card" disabled={busy} onClick={() => pick(t)}>
      <SessionIcon typeId={t.id} size={22} />
      <span className="type-label">{t.label}</span>
    </button>
  );

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="picker" role="dialog" aria-label="New session">
        <div className="picker-head">
          New session
          <span style={{ flex: 1 }} />
          <span className="picker-hint">pick a type, then a folder</span>
        </div>
        <div className="picker-body">
          <div className="picker-group-label">Shells</div>
          <div className="picker-grid">{shells.map(renderCard)}</div>
          <div className="picker-group-label">AI agents</div>
          <div className="picker-grid">{ais.map(renderCard)}</div>
          {missing && (
            <div className="install-note">
              <div className="install-title">{missing.label} is not installed. Run this to add it:</div>
              <div className="install-row">
                <code>{missing.install}</code>
                <button className="icon-btn" title="Copy" onClick={() => copy(missing.install)}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="picker-foot">
          <FolderOpen size={14} />
          <span>A folder browser opens after you pick a type; the session starts there.</span>
        </div>
      </div>
    </div>
  );
}
