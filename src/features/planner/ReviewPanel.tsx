import {
  ArrowUpRight,
  Check,
  CircleCheck,
  Copy,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import { useState } from "react";
import { clipboardWriteText } from "../../lib/ipc";
import { AI_TYPES } from "../../lib/sessionTypes";
import { useStrings } from "../../lib/i18n";
import type { PlanReview, ReviewError } from "./review";

export type ReviewState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; data: PlanReview }
  | { status: "error"; error: ReviewError; raw?: string };

/** Right panel for the AI plan review: idle explainer, progress, typed verdict, or a
 *  readable failure with retry. Presentation only; the run lives in PlannerView. */
export function ReviewPanel({
  state,
  onRun,
  onClose,
}: {
  state: ReviewState;
  onRun: () => void;
  onClose: () => void;
}) {
  const t = useStrings();
  const [copied, setCopied] = useState(false);
  const claude = AI_TYPES.find((a) => a.id === "claude");

  return (
    <aside className="plan-review" aria-label={t.reviewTitle}>
      <div className="plan-preview-head">
        <Sparkles size={13} />
        <span>{t.reviewTitle}</span>
        <span className="spacer" />
        <button
          className="icon-btn sm"
          title={t.reviewCloseBtn}
          aria-label={t.reviewCloseBtn}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      {state.status === "idle" && (
        <>
          <div className="plan-review-hint">{t.reviewIdleHint}</div>
          <button className="btn plan-review-run" onClick={onRun}>
            <Sparkles size={14} />
            {t.reviewRunBtn}
          </button>
        </>
      )}

      {state.status === "running" && (
        <div className="plan-review-running" role="status">
          <LoaderCircle size={16} className="plan-spin" />
          {t.reviewRunning}
        </div>
      )}

      {state.status === "done" && (
        <div className="plan-review-body">
          <div className={`plan-review-verdict v-${state.data.verdict}`}>
            {state.data.verdict === "strong"
              ? t.reviewVerdictStrong
              : state.data.verdict === "weak"
                ? t.reviewVerdictWeak
                : t.reviewVerdictOkay}
          </div>
          {state.data.summary && (
            <p className="plan-review-summary bidi-auto">{state.data.summary}</p>
          )}
          <ReviewList
            icon={<CircleCheck size={13} />}
            title={t.reviewStrengths}
            items={state.data.strengths}
            tone="ok"
          />
          <ReviewList
            icon={<TriangleAlert size={13} />}
            title={t.reviewWeaknesses}
            items={state.data.weaknesses}
            tone="danger"
          />
          <ReviewList
            icon={<ArrowUpRight size={13} />}
            title={t.reviewImprovements}
            items={state.data.improvements}
            tone="accent"
          />
          {state.data.tools.length > 0 && (
            <div className="plan-review-section">
              <div className="plan-review-label tone-accent">
                <Wrench size={13} />
                {t.reviewTools}
              </div>
              <ul className="plan-review-list">
                {state.data.tools.map((tool) => (
                  <li key={tool.name}>
                    <b>{tool.name}</b>
                    {tool.reason ? ` - ${tool.reason}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button className="btn-ghost plan-review-run" onClick={onRun}>
            <RefreshCw size={14} />
            {t.reviewRetry}
          </button>
        </div>
      )}

      {state.status === "error" && (
        <div className="plan-review-body">
          {state.error === "claude-missing" && claude ? (
            <div className="install-note">
              <div className="install-title">{t.notInstalled(claude.label)}</div>
              <div className="install-row">
                <code>{claude.install}</code>
                <button
                  className="icon-btn"
                  title={t.copyInstall}
                  aria-label={t.copyInstall}
                  onClick={() => {
                    void clipboardWriteText(claude.install)
                      .then(() => setCopied(true))
                      .catch(() => {});
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          ) : (
            <div className="picker-error">
              {state.error === "timeout"
                ? t.reviewErrTimeout
                : state.error === "unparsable"
                  ? t.reviewErrUnparsable
                  : t.reviewErrFailed}
            </div>
          )}
          {state.raw && <pre className="plan-review-raw">{state.raw}</pre>}
          <button className="btn plan-review-run" onClick={onRun}>
            <RefreshCw size={14} />
            {t.reviewRetry}
          </button>
        </div>
      )}
    </aside>
  );
}

function ReviewList({
  icon,
  title,
  items,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  tone: "ok" | "danger" | "accent";
}) {
  if (items.length === 0) return null;
  return (
    <div className="plan-review-section">
      <div className={`plan-review-label tone-${tone}`}>
        {icon}
        {title}
      </div>
      <ul className="plan-review-list">
        {items.map((item) => (
          <li key={item} className="bidi-auto">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
