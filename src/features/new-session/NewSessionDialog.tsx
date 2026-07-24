import { useRef, useState } from "react";
import { ArrowLeft, Check, Copy, FolderOpen, Folder, SquareTerminal } from "lucide-react";
import { useUI } from "../../store/ui";
import { useSettings } from "../../store/settings";
import { MAX_PER_WS, useWorkspaces } from "../../store/workspaces";
import { newSession } from "../../actions";
import { checkShell, clipboardWriteText, pickFolder, whichProgram } from "../../lib/ipc";
import {
  AI_TYPES,
  SHELL_TYPES,
  buildShell,
  buildSshShell,
  parseSshTarget,
  sessionLabel,
  shellTypeOf,
  type AiType,
  type ShellType,
} from "../../lib/sessionTypes";
import { DialogTrap } from "../../lib/dialog-trap";
import { SessionIcon } from "../icons";
import { useStrings } from "../../lib/i18n";

// Three-step wizard: terminal type -> AI (or none) -> folder. Each step is one click;
// Back always goes exactly ONE step back. The user's default shell is focused on step 1
// so Enter-Enter-Enter recreates the old two-click speed. Remote types (SSH) branch to
// a target-input step instead of AI + folder.
type Step = "shell" | "ai" | "folder" | "ssh";

export function NewSessionDialog() {
  const t = useStrings();
  const open = useUI((s) => s.newSessionOpen);
  const setNewSession = useUI((s) => s.setNewSession);
  const defaultShellKind = useSettings((s) => s.defaultShell);
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

  const [step, setStep] = useState<Step>("shell");
  const [shellType, setShellType] = useState<ShellType | null>(null);
  const [ai, setAi] = useState<AiType | null>(null);
  const [sshTarget, setSshTarget] = useState("");
  const [missing, setMissing] = useState<{
    label: string;
    install: string;
    title?: string;
    detail?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  if (!open) return null;

  const close = () => {
    setStep("shell");
    setShellType(null);
    setAi(null);
    setSshTarget("");
    setMissing(null);
    setBusy(false);
    setError(null);
    setNewSession(false);
  };

  const goBack = () => {
    setMissing(null);
    setError(null);
    if (step === "folder") setStep("ai");
    else if (step === "ai" || step === "ssh") setStep("shell");
  };

  const chooseShell = async (s: ShellType) => {
    setMissing(null);
    setError(null);
    setBusy(true);
    try {
      // Deep check first (wsl.exe exists without a distro, bash.exe can be a dead
      // stub); PATH probe covers the launchers where existence really means working.
      if (s.check) {
        const res = await checkShell(s.check);
        if (!res.ok) {
          setMissing({
            label: s.label,
            title: s.missingTitle,
            install: s.install ?? `${s.label} is not available.`,
            detail: res.detail,
          });
          setBusy(false);
          return;
        }
      } else if (s.probe && !(await whichProgram(s.probe))) {
        setMissing({ label: s.label, install: s.install ?? `Program not found: ${s.probe}` });
        setBusy(false);
        return;
      }
      setShellType(s);
      setStep(s.remote ? "ssh" : "ai");
      setBusy(false);
    } catch (e) {
      console.warn("install probe failed", e);
      setError(t.checkFailed(s.label));
      setBusy(false);
    }
  };

  const connectSsh = () => {
    const parsed = parseSshTarget(sshTarget);
    const shell = buildSshShell(sshTarget);
    if (!parsed || !shell) {
      setError(t.sshInvalid);
      return;
    }
    if (activeFull) {
      setError(t.workspaceFullMsg(MAX_PER_WS));
      return;
    }
    const id = newSession({ shell, name: parsed.target, typeId: "ssh" });
    if (!id) {
      setError(t.workspaceFullMsg(MAX_PER_WS));
      return;
    }
    close();
  };

  const chooseAi = async (a: AiType | null) => {
    setMissing(null);
    setError(null);
    // WSL runs the CLI inside the distro, so a Windows PATH probe would be wrong;
    // a missing CLI surfaces as command-not-found inside the pane instead.
    if (!a || shellType?.id === "wsl") {
      setAi(a);
      setStep("folder");
      return;
    }
    setBusy(true);
    try {
      if (!(await whichProgram(a.cli))) {
        setMissing({ label: a.label, install: a.install });
        setBusy(false);
        return;
      }
      setAi(a);
      setStep("folder");
      setBusy(false);
    } catch (e) {
      console.warn("install probe failed", e);
      setError(t.checkFailed(a.label));
      setBusy(false);
    }
  };

  const start = (folder: string | null) => {
    if (!shellType) return;
    if (activeFull) {
      setError(t.workspaceFullMsg(MAX_PER_WS));
      return;
    }
    const label = sessionLabel(shellType, ai);
    const cwd = folder ?? undefined;
    const base = cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() || cwd : null;
    const id = newSession({
      shell: buildShell(shellType, ai),
      // "Claude Code · myproject" with a folder, plain "Claude Code" without one.
      name: base ? `${label} · ${base}` : label,
      cwd,
      typeId: ai ? ai.id : shellType.id,
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
      const folder = await pickFolder(
        t.chooseFolderFor(shellType ? sessionLabel(shellType, ai) : ""),
      );
      setBusy(false);
      if (folder) start(folder);
    } catch (e) {
      console.warn("folder picker failed", e);
      setBusy(false);
      setError(t.pickerFailed);
    }
  };

  const copy = (text: string) => {
    void clipboardWriteText(text).catch((err) => console.warn("clipboard copy failed", err));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const defaultShellId = shellTypeOf(defaultShellKind).id;
  const title =
    step === "shell"
      ? t.newSession
      : step === "ai"
        ? t.pickAiTitle
        : step === "ssh"
          ? t.sshTitle
          : t.whereStart(shellType ? sessionLabel(shellType, ai) : "");
  const hint =
    step === "shell"
      ? `${t.stepOf(1)} · ${t.pickShellHint}`
      : step === "ai"
        ? `${t.stepOf(2)} · ${t.pickAiHint(shellType?.label ?? "")}`
        : step === "ssh"
          ? t.sshHint
          : `${t.stepOf(3)} · ${t.pickFolderHint}`;

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
          {step !== "shell" ? (
            <button
              className="icon-btn"
              title={t.back}
              aria-label={step === "ai" ? t.backToShells : t.backToAi}
              onClick={goBack}
            >
              <ArrowLeft size={16} />
            </button>
          ) : null}
          {title}
          <span style={{ flex: 1 }} />
          <span className="picker-hint">{hint}</span>
        </div>

        <div className="picker-body" aria-busy={busy}>
          {step === "shell" && (
            <div className="picker-grid">
              {SHELL_TYPES.map((s) => (
                <button
                  key={s.id}
                  className="type-card"
                  disabled={busy}
                  autoFocus={s.id === defaultShellId}
                  onClick={() => void chooseShell(s)}
                >
                  <SessionIcon typeId={s.id} size={22} />
                  <span className="type-label">{s.label}</span>
                </button>
              ))}
            </div>
          )}

          {step === "ai" && (
            <div className="picker-grid">
              <button
                className="type-card"
                disabled={busy}
                autoFocus
                onClick={() => void chooseAi(null)}
              >
                <span className="row-icon">
                  <SquareTerminal size={16} />
                </span>
                <span className="type-label">{t.aiNoneLabel}</span>
              </button>
              {AI_TYPES.map((a) => (
                <button
                  key={a.id}
                  className="type-card"
                  disabled={busy}
                  onClick={() => void chooseAi(a)}
                >
                  <SessionIcon typeId={a.id} size={22} />
                  <span className="type-label">{a.label}</span>
                </button>
              ))}
            </div>
          )}

          {step === "ssh" && (
            <form
              className="ssh-form"
              onSubmit={(e) => {
                e.preventDefault();
                connectSsh();
              }}
            >
              <input
                className="text-input"
                autoFocus
                placeholder={t.sshPlaceholder}
                aria-label={t.sshTargetLabel}
                value={sshTarget}
                onChange={(e) => {
                  setSshTarget(e.target.value);
                  setError(null);
                }}
              />
              <button className="btn-solid" type="submit" disabled={busy}>
                {t.sshConnect}
              </button>
            </form>
          )}

          {step === "folder" && (
            <div className="folder-choice">
              {defaultCwd ? (
                <button
                  className="folder-btn"
                  disabled={busy}
                  autoFocus
                  onClick={() => start(defaultCwd)}
                >
                  <Folder size={16} />
                  <span className="folder-btn-main">{t.defaultFolderBtn}</span>
                  <span className="folder-btn-path bidi-auto">{defaultCwd}</span>
                </button>
              ) : null}
              <button
                className="folder-btn"
                disabled={busy}
                autoFocus={!defaultCwd}
                onClick={() => void browse()}
              >
                <FolderOpen size={16} />
                <span className="folder-btn-main">{t.chooseFolderBtn}</span>
                <span className="folder-btn-path">{t.opensFolderBrowser}</span>
              </button>
              <button className="folder-btn" disabled={busy} onClick={() => start(null)}>
                <span className="folder-btn-main" style={{ marginInlineStart: 26 }}>
                  {t.noFolderBtn}
                </span>
              </button>
            </div>
          )}

          {missing && (
            <div className="install-note">
              <div className="install-title">{missing.title ?? t.notInstalled(missing.label)}</div>
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
              {missing.detail && <div className="install-detail">{missing.detail}</div>}
            </div>
          )}
          {error && <div className="picker-error">{error}</div>}
        </div>

        <div className="picker-foot">
          <FolderOpen size={14} />
          <span>{t.sessionsOpenNote(MAX_PER_WS)}</span>
        </div>
      </div>
    </div>
  );
}
