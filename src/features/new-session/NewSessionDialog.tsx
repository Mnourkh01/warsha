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
import { useStrings } from "../../lib/i18n";

export function NewSessionDialog() {
  const t = useStrings();
  const open = useUI((s) => s.newSessionOpen);
  const setNewSession = useUI((s) => s.setNewSession);
  const globalCwd = useSettings((s) => s.defaultCwd);
  const workspaceCwd = useWorkspaces(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.defaultCwd,
  );
  // The workspace's project folder wins over the global default.
  const defaultCwd = workspaceCwd ?? globalCwd;
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

  const chooseType = async (type: SessionType) => {
    setMissing(null);
    setError(null);
    setBusy(true);
    try {
      if (type.probe) {
        const found = await whichProgram(type.probe);
        if (!found) {
          setMissing({
            label: type.label,
            install: type.install ?? `Program not found: ${type.probe}`,
          });
          setBusy(false);
          return;
        }
      }
      setSelected(type);
      setBusy(false);
    } catch (e) {
      console.warn("install probe failed", e);
      setError(t.checkFailed(type.label));
      setBusy(false);
    }
  };

  const start = async (folder: string | null) => {
    if (!selected) return;
    if (activeFull) {
      setError(t.workspaceFullMsg(MAX_PER_WS));
      return;
    }
    const cwd = folder ?? undefined;
    const base = cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() || cwd : null;
    const id = newSession({
      shell: selected.shell,
      // "Claude Chat · myproject" with a folder, plain "Claude Chat" without one.
      name: base ? `${selected.label} · ${base}` : selected.label,
      cwd,
      typeId: selected.id,
      agent: selected.agent,
    });
    if (!id) {
      setError(t.workspaceFullMsg(MAX_PER_WS));
      return;
    }
    close();
  };

  const browse = async () => {
    setBusy(true);
    try {
      const folder = await pickFolder(t.chooseFolderFor(selected?.label ?? ""));
      setBusy(false);
      if (folder) void start(folder);
    } catch (e) {
      console.warn("folder picker failed", e);
      setBusy(false);
      setError(t.pickerFailed);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const shells = SESSION_TYPES.filter((t) => t.group === "shell");
  const ais = SESSION_TYPES.filter((t) => t.group === "ai");

  const renderCard = (type: SessionType) => (
    <button key={type.id} className="type-card" disabled={busy} onClick={() => chooseType(type)}>
      <SessionIcon typeId={type.id} size={22} />
      <span className="type-label">{type.label}</span>
    </button>
  );

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="picker" role="dialog" aria-modal="true" aria-label={t.newSession} ref={boxRef}>
        <DialogTrap containerRef={boxRef} />
        <div className="picker-head">
          {selected ? (
            <button
              className="icon-btn"
              title={t.back}
              aria-label={t.backToTypes}
              onClick={() => setSelected(null)}
            >
              <ArrowLeft size={16} />
            </button>
          ) : null}
          {selected ? t.whereStart(selected.label) : t.newSession}
          <span style={{ flex: 1 }} />
          <span className="picker-hint">
            {selected ? t.pickFolderHint : t.pickTypeHint}
          </span>
        </div>

        <div className="picker-body" aria-busy={busy}>
          {!selected ? (
            <>
              <div className="picker-group-label">{t.shellsGroup}</div>
              <div className="picker-grid">{shells.map(renderCard)}</div>
              <div className="picker-group-label">{t.aiGroup}</div>
              <div className="picker-grid">{ais.map(renderCard)}</div>
              {missing && (
                <div className="install-note">
                  <div className="install-title">{t.notInstalled(missing.label)}</div>
                  <div className="install-row">
                    <code>{missing.install}</code>
                    <button
                      className="icon-btn"
                      title={t.copy}
                      aria-label={t.copyInstall}
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
                  <span className="folder-btn-main">{t.defaultFolderBtn}</span>
                  <span className="folder-btn-path bidi-auto">{defaultCwd}</span>
                </button>
              ) : null}
              <button className="folder-btn" disabled={busy} onClick={() => void browse()}>
                <FolderOpen size={16} />
                <span className="folder-btn-main">{t.chooseFolderBtn}</span>
                <span className="folder-btn-path">{t.opensFolderBrowser}</span>
              </button>
              <button className="folder-btn" disabled={busy} onClick={() => void start(null)}>
                <span className="folder-btn-main" style={{ marginInlineStart: 26 }}>
                  {t.noFolderBtn}
                </span>
              </button>
              {error && <div className="picker-error">{error}</div>}
            </div>
          )}
        </div>

        <div className="picker-foot">
          <FolderOpen size={14} />
          <span>{t.sessionsOpenNote(MAX_PER_WS)}</span>
        </div>
      </div>
    </div>
  );
}
