import { useRef, useState } from "react";
import { ArrowLeft, Check, Copy, FolderOpen, Folder } from "lucide-react";
import { useUI } from "../../store/ui";
import { useSettings } from "../../store/settings";
import { MAX_PER_WS, useWorkspaces } from "../../store/workspaces";
import { newSession } from "../../actions";
import { pickFolder, whichProgram } from "../../lib/ipc";
import { SESSION_TYPES, type SessionType } from "../../lib/sessionTypes";
import { DialogTrap } from "../../lib/dialog-trap";
import { SessionIcon } from "../icons";

const FULL_MSG = `This workspace already has ${MAX_PER_WS} sessions. Make a new workspace or close one.`;

export function NewSessionDialog() {
  const open = useUI((s) => s.newSessionOpen);
  const setNewSession = useUI((s) => s.setNewSession);
  const defaultCwd = useSettings((s) => s.defaultCwd);
  const activeFull = useWorkspaces((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    return !!ws && ws.sessionIds.length >= MAX_PER_WS;
  });

  const [selected, setSelected] = useState<SessionType | null>(null);
  const [missing, setMissing] = useState<{ label: string; install: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  if (!open) return null;

  const close = () => {
    setSelected(null);
    setMissing(null);
    setBusy(false);
    setError(null);
    setNewSession(false);
  };

  const chooseType = async (t: SessionType) => {
    setMissing(null);
    setError(null);
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
      setSelected(t);
      setBusy(false);
    } catch (e) {
      console.warn("install probe failed", e);
      setError(`Could not check whether ${t.label} is installed. Try again.`);
      setBusy(false);
    }
  };

  const start = async (folder: string | null) => {
    if (!selected) return;
    if (activeFull) {
      setError(FULL_MSG);
      return;
    }
    const cwd = folder ?? undefined;
    const base = cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() || cwd : selected.label;
    const id = newSession({ shell: selected.shell, name: `${selected.label} · ${base}`, cwd, typeId: selected.id });
    if (!id) {
      setError(FULL_MSG);
      return;
    }
    close();
  };

  const browse = async () => {
    setBusy(true);
    try {
      const folder = await pickFolder(`Choose a folder for ${selected?.label}`);
      setBusy(false);
      if (folder) void start(folder);
    } catch (e) {
      console.warn("folder picker failed", e);
      setBusy(false);
      setError("Could not open the folder picker. Try again.");
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
    <button key={t.id} className="type-card" disabled={busy} onClick={() => chooseType(t)}>
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
      <div className="picker" role="dialog" aria-modal="true" aria-label="New session" ref={boxRef}>
        <DialogTrap containerRef={boxRef} />
        <div className="picker-head">
          {selected ? (
            <button
              className="icon-btn"
              title="Back"
              aria-label="Back to session types"
              onClick={() => setSelected(null)}
            >
              <ArrowLeft size={16} />
            </button>
          ) : null}
          {selected ? `Where should ${selected.label} start?` : "New session"}
          <span style={{ flex: 1 }} />
          <span className="picker-hint">
            {selected ? "pick a folder" : "pick a type, then a folder"}
          </span>
        </div>

        <div className="picker-body" aria-busy={busy}>
          {!selected ? (
            <>
              <div className="picker-group-label">Shells</div>
              <div className="picker-grid">{shells.map(renderCard)}</div>
              <div className="picker-group-label">AI agents</div>
              <div className="picker-grid">{ais.map(renderCard)}</div>
              {missing && (
                <div className="install-note">
                  <div className="install-title">{missing.label} is not installed. Run this to add it:</div>
                  <div className="install-row">
                    <code>{missing.install}</code>
                    <button
                      className="icon-btn"
                      title="Copy"
                      aria-label="Copy install command"
                      onClick={() => copy(missing.install)}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
              )}
              {error && <div className="picker-error">{error}</div>}
            </>
          ) : (
            <div className="folder-choice">
              {defaultCwd ? (
                <button className="folder-btn" disabled={busy} onClick={() => void start(defaultCwd)}>
                  <Folder size={16} />
                  <span className="folder-btn-main">Default folder</span>
                  <span className="folder-btn-path bidi-auto">{defaultCwd}</span>
                </button>
              ) : null}
              <button className="folder-btn" disabled={busy} onClick={() => void browse()}>
                <FolderOpen size={16} />
                <span className="folder-btn-main">Choose a folder...</span>
                <span className="folder-btn-path">opens a folder browser</span>
              </button>
              <button className="folder-btn" disabled={busy} onClick={() => void start(null)}>
                <span className="folder-btn-main" style={{ marginInlineStart: 26 }}>
                  No folder (start in home)
                </span>
              </button>
              {error && <div className="picker-error">{error}</div>}
            </div>
          )}
        </div>

        <div className="picker-foot">
          <FolderOpen size={14} />
          <span>Sessions open in the active workspace (up to {MAX_PER_WS}).</span>
        </div>
      </div>
    </div>
  );
}
