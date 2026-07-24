import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Send, X } from "lucide-react";
import { DialogTrap } from "../../lib/dialog-trap";
import { clipboardWriteText, planSpecSave, whichProgram } from "../../lib/ipc";
import { AI_TYPES, type AiType } from "../../lib/sessionTypes";
import { useStrings } from "../../lib/i18n";
import { MAX_PER_WS, useWorkspaces } from "../../store/workspaces";
import { usePlans } from "../../store/plans";
import { useUI } from "../../store/ui";
import { BLUEPRINT_SPEC } from "./blueprintSpec";
import { buildContextPrompt, buildDraftRequestPrompt, buildPlanPrompt } from "./prompt";
import type { PlanReview } from "./review";
import { planToMarkdown } from "./serializeMarkdown";
import { sendPlanToAi, type SendError } from "./sendToAi";

type SendMode = "full" | "context" | "ask";

/** Preview-and-confirm step before the handoff: pick which AI CLI receives the plan
 *  (Claude Code, Gemini CLI, or Codex) and what to send - the full plan for an AI
 *  that has not seen it, or a short context prompt with the accepted review
 *  suggestions for an AI the plan was built with. Errors (CLI missing, workspace
 *  full) surface here instead of failing silently. */
export function SendToAiModal({
  wsId,
  cwd,
  review,
  onClose,
}: {
  wsId: string;
  cwd?: string;
  /** Last finished AI review, so Suggestions mode can offer its improvements. */
  review?: PlanReview;
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
  // An empty canvas has nothing to send; asking the AI to draft is the only move.
  const planEmpty = useMemo(() => {
    const doc = usePlans.getState().plans[wsId];
    return !doc || doc.nodes.length === 0;
  }, [wsId]);
  const [mode, setMode] = useState<SendMode>(planEmpty ? "ask" : "full");
  const suggestions = useMemo(() => review?.improvements ?? [], [review]);
  const [picked, setPicked] = useState<boolean[]>(() => suggestions.map(() => true));
  // A review can finish WHILE the modal is open (it runs in the panel behind); resync
  // the picks or the indices would point at the wrong suggestions.
  useEffect(() => {
    setPicked(suggestions.map(() => true));
  }, [suggestions]);
  const planName = useMemo(() => {
    const doc = usePlans.getState().plans[wsId];
    return doc?.name.trim() || "Plan";
  }, [wsId]);
  const fullPrompt = useMemo(() => {
    const doc = usePlans.getState().plans[wsId];
    if (!doc) return "";
    return buildPlanPrompt(planToMarkdown(doc, { cwd }), { cwd, planName });
  }, [wsId, cwd, planName]);
  const [prompt, setPrompt] = useState(fullPrompt);
  // Switching mode or toggling a suggestion regenerates the prompt (hand edits in
  // that mode are replaced - the textarea is a preview, the pickers are the source).
  useEffect(() => {
    if (mode === "full") {
      setPrompt(fullPrompt);
    } else if (mode === "ask" && cwd) {
      setPrompt(buildDraftRequestPrompt({ cwd }));
    } else if (mode === "context" && cwd) {
      setPrompt(
        buildContextPrompt({
          cwd,
          planName,
          suggestions: suggestions.filter((_, i) => picked[i]),
        }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, picked, fullPrompt, cwd, planName, suggestions]);
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
    if (mode === "ask" && cwd) {
      // The ask prompt cites .warsha/BLUEPRINT.md; drop it first. Non-fatal: the
      // prompt tells the AI to ask for the format if the file is missing.
      await planSpecSave(cwd, BLUEPRINT_SPEC).catch((e) =>
        console.warn("blueprint spec write failed", e),
      );
    }
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
          <div className="field">
            <span className="field-label">{t.sendPlanModeLabel}</span>
            <div className="seg plan-send-target">
              <button
                className={mode === "full" ? "on" : ""}
                disabled={busy || planEmpty}
                title={planEmpty ? t.sendPlanEmptyHint : undefined}
                onClick={() => setMode("full")}
              >
                {t.sendModeFull}
              </button>
              <button
                className={mode === "context" ? "on" : ""}
                disabled={busy || !cwd || planEmpty}
                title={!cwd ? t.sendNeedsFolder : planEmpty ? t.sendPlanEmptyHint : undefined}
                onClick={() => setMode("context")}
              >
                {t.sendModeContext}
              </button>
              <button
                className={mode === "ask" ? "on" : ""}
                disabled={busy || !cwd}
                title={!cwd ? t.sendNeedsFolder : undefined}
                onClick={() => setMode("ask")}
              >
                {t.sendModeAsk}
              </button>
            </div>
            {mode === "ask" && cwd && <span className="field-hint">{t.sendModeAskHint}</span>}
            {!cwd && <span className="field-hint">{t.sendNeedsFolder}</span>}
          </div>
          {mode === "context" &&
            (suggestions.length > 0 ? (
              <div className="field">
                <span className="field-label">{t.sendPickSuggestions}</span>
                <ul className="plan-send-suggests">
                  {suggestions.map((s, i) => (
                    <li key={i}>
                      <label>
                        <input
                          type="checkbox"
                          checked={picked[i] ?? false}
                          disabled={busy}
                          onChange={(e) =>
                            setPicked((prev) => {
                              const next = [...prev];
                              next[i] = e.target.checked;
                              return next;
                            })
                          }
                        />
                        <span>{s}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="field-hint">{t.sendNoSuggestions}</div>
            ))}
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
