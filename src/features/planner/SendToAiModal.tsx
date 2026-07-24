import { useEffect, useRef, useState } from "react";
import { Check, Copy, Send, X } from "lucide-react";
import { DialogTrap } from "../../lib/dialog-trap";
import { clipboardWriteText, whichProgram } from "../../lib/ipc";
import { AI_TYPES, type AiType } from "../../lib/sessionTypes";
import { useStrings } from "../../lib/i18n";
import { MAX_PER_WS, useWorkspaces } from "../../store/workspaces";
import { usePlans } from "../../store/plans";
import { useUI } from "../../store/ui";
import { buildPlanPrompt } from "./prompt";
import { planToMarkdown } from "./serializeMarkdown";
import { sendPlanToAi, type SendError } from "./sendToAi";

/** Preview-and-confirm step before the handoff: pick which AI CLI receives the plan
 *  (Claude Code, Gemini CLI, or Codex), edit the prompt, then send. Errors (CLI
 *  missing, workspace full) surface here instead of failing silently. */
export function SendToAiModal({
  wsId,
  cwd,
  onClose,
}: {
  wsId: string;
  cwd?: string;
  onClose: () => void;
}) {
  const t = useStrings();
  const boxRef = useRef<HTMLDivElement>(null);
  const full = useWorkspaces((s) => {
    const ws = s.workspaces.find((w) => w.id === wsId);
    return !!ws && ws.sessionIds.length >= MAX_PER_WS;
  });
  const [ai, setAi] = useState<AiType>(AI_TYPES[0]);
  // Absent = probe still running; a missing CLI disables Send and shows its install line.
  const [avail, setAvail] = useState<Record<string, boolean>>({});
  const [prompt, setPrompt] = useState(() => {
    const doc = usePlans.getState().plans[wsId];
    if (!doc) return "";
    return buildPlanPrompt(planToMarkdown(doc, { cwd }), {
      cwd,
      planName: doc.name.trim() || "Plan",
    });
  });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<SendError | null>(null);
  const [copied, setCopied] = useState(false);

  // Probe all CLIs once so the picker can mark what is installed on this PC.
  useEffect(() => {
    let alive = true;
    for (const a of AI_TYPES) {
      whichProgram(a.cli)
        .then((found) => {
          if (alive) setAvail((prev) => ({ ...prev, [a.id]: !!found }));
        })
        .catch(() => {
          if (alive) setAvail((prev) => ({ ...prev, [a.id]: false }));
        });
    }
    return () => {
      alive = false;
    };
  }, []);

  // The planner is a view mode, not part of the App Escape chain; the modal closes
  // itself - but not while a higher layer (command palette) owns the Escape press,
  // and not mid-send.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const ui = useUI.getState();
      if (ui.paletteOpen || ui.settingsOpen || ui.shortcutsOpen || ui.newSessionOpen) return;
      if (busyRef.current) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async () => {
    setBusy(true);
    busyRef.current = true;
    setError(null);
    const err = await sendPlanToAi(prompt, ai);
    // On success the send flow closed the planner, which unmounted this modal.
    if (err) {
      setError(err);
      setBusy(false);
      busyRef.current = false;
    }
  };

  const missing = avail[ai.id] === false || error === "cli-missing";

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="dialog plan-send-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t.sendPlanTitle}
        ref={boxRef}
      >
        <DialogTrap containerRef={boxRef} />
        <div className="dialog-header">
          {t.sendPlanTitle}
          <span style={{ flex: 1 }} />
          <button
            className="icon-btn"
            title={t.close}
            aria-label={t.close}
            disabled={busy}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="dialog-body">
          <div className="field">
            <span className="field-label">{t.sendPlanTarget}</span>
            <div className="seg plan-send-target">
              {AI_TYPES.map((a) => (
                <button
                  key={a.id}
                  className={ai.id === a.id ? "on" : ""}
                  disabled={busy}
                  onClick={() => {
                    setAi(a);
                    setError(null);
                  }}
                >
                  {a.label}
                  {avail[a.id] === false ? ` (${t.sendPlanNotFound})` : ""}
                </button>
              ))}
            </div>
          </div>
          <div className="plan-send-folder">{cwd ? t.sendPlanFolder(cwd) : t.sendPlanNoFolder}</div>
          <label className="field">
            <span className="field-label">{t.sendPlanPromptLabel}</span>
            <textarea
              className="input plan-send-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={14}
              spellCheck={false}
            />
          </label>
          <div className="field-hint">{t.sendPlanClipboardNote}</div>
          {(full || error === "workspace-full") && (
            <div className="picker-error">{t.workspaceFullMsg(MAX_PER_WS)}</div>
          )}
          {missing && (
            <div className="install-note">
              <div className="install-title">{t.notInstalled(ai.label)}</div>
              <div className="install-row">
                <code>{ai.install}</code>
                <button
                  className="icon-btn"
                  title={t.copyInstall}
                  aria-label={t.copyInstall}
                  onClick={() => {
                    void clipboardWriteText(ai.install)
                      .then(() => setCopied(true))
                      .catch(() => {});
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}
          {error === "spawn-failed" && <div className="picker-error">{t.sendPlanFailed}</div>}
          <div className="plan-send-actions">
            <button className="btn-ghost" disabled={busy} onClick={onClose}>
              {t.cancel}
            </button>
            <button
              className="btn"
              disabled={busy || full || missing || prompt.trim().length === 0}
              onClick={() => void send()}
            >
              <Send size={14} />
              {busy ? t.sendPlanBusy(ai.label) : t.sendPlanGo}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
