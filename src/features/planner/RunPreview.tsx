import { useEffect, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  X,
} from "lucide-react";
import { useStrings } from "../../lib/i18n";
import type { PlanNode } from "../../store/plans";
import { KIND_META } from "./nodeKinds";
import type { ReviewError } from "./review";
import type { PlanSimulation, SimStatus } from "./simulate";

export type SimPanelPhase = "running" | "ready" | "error";

/** Step-through panel for the plan run. The run IS a simulation: Claude pre-mortems
 *  the plan, then the walkthrough plays each step with what-happens text, a status,
 *  and watch-outs. Falls back to the plain walkthrough when the AI cannot run. */
export function RunPreview({
  steps,
  cyclicIds,
  criticalIds,
  sim,
  simData,
  simError,
  index,
  playing,
  onTogglePlay,
  onStep,
  onRestart,
  onRerunSim,
  onClose,
}: {
  steps: PlanNode[];
  cyclicIds: ReadonlySet<string>;
  criticalIds: ReadonlySet<string>;
  sim: SimPanelPhase;
  simData?: PlanSimulation;
  simError?: ReviewError;
  index: number;
  playing: boolean;
  onTogglePlay: () => void;
  onStep: (delta: number) => void;
  onRestart: () => void;
  onRerunSim: () => void;
  onClose: () => void;
}) {
  const t = useStrings();
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const active = steps[index];
  const activeSim = sim === "ready" && active ? simData?.steps[active.id] : undefined;
  const statusFor = (id: string, i: number): SimStatus | undefined =>
    sim === "ready" && i <= index ? simData?.steps[id]?.status : undefined;

  return (
    <aside className="plan-preview" aria-label={t.previewTitle}>
      <div className="plan-preview-head">
        <span>{t.previewTitle}</span>
        <span className="spacer" />
        <button
          className="icon-btn sm"
          title={t.previewClose}
          aria-label={t.previewClose}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      {sim === "running" && (
        <div className="plan-review-running" role="status">
          <LoaderCircle size={16} className="plan-spin" />
          {t.simRunning}
        </div>
      )}

      {sim === "ready" && simData && (
        <div className="plan-sim-verdict">
          <span className={`plan-sim-conf c-${simData.confidence}`}>
            {simData.confidence === "high"
              ? t.simConfidenceHigh
              : simData.confidence === "low"
                ? t.simConfidenceLow
                : t.simConfidenceMedium}
          </span>
          {simData.verdict && <span className="plan-sim-verdict-text bidi-auto">{simData.verdict}</span>}
        </div>
      )}

      {sim === "error" && (
        <div className="plan-sim-noai">
          <div className="picker-error">
            {simError === "claude-missing"
              ? t.reviewErrFailed
              : simError === "timeout"
                ? t.reviewErrTimeout
                : simError === "unparsable"
                  ? t.reviewErrUnparsable
                  : t.reviewErrFailed}
          </div>
          <div className="plan-preview-hint">{t.simNoAi}</div>
          <button className="btn-ghost plan-review-run" onClick={onRerunSim}>
            <RefreshCw size={14} />
            {t.reviewRetry}
          </button>
        </div>
      )}

      {sim !== "running" && (
        <div className="plan-preview-sub">
          {t.previewStepOf(Math.min(index + 1, steps.length), steps.length)}
        </div>
      )}

      <ol className="plan-steps">
        {steps.map((s, i) => {
          const Icon = KIND_META[s.kind].icon;
          const status = statusFor(s.id, i);
          return (
            <li
              key={s.id}
              ref={i === index ? activeRef : undefined}
              className={`plan-step${i === index ? " active" : ""}${i < index ? " done" : ""}${
                s.kind === "phase" ? " phase" : ""
              }`}
              aria-current={i === index ? "step" : undefined}
            >
              <span className="plan-step-num">{i + 1}</span>
              <span
                className={`plan-step-dot${status ? ` st-${status}` : ""}`}
                role="img"
                aria-label={
                  status === "blocked"
                    ? t.simStatusBlocked
                    : status === "risky"
                      ? t.simStatusRisky
                      : status === "ok"
                        ? t.simStatusOk
                        : ""
                }
              />
              <Icon size={13} />
              <span className="plan-step-label bidi-auto">{s.label}</span>
              {criticalIds.has(s.id) && <span className="plan-step-crit">{t.simCritical}</span>}
              {cyclicIds.has(s.id) && <span className="plan-step-cycle">{t.previewCycle}</span>}
            </li>
          );
        })}
      </ol>

      {activeSim && (activeSim.happens || activeSim.watch) && (
        <div className={`plan-sim-card st-${activeSim.status}`}>
          {activeSim.happens && <p className="plan-sim-happens bidi-auto">{activeSim.happens}</p>}
          {activeSim.watch && (
            <p className="plan-sim-watch bidi-auto">
              <ShieldAlert size={12} />
              {activeSim.watch}
            </p>
          )}
        </div>
      )}

      {sim !== "running" && (
        <div className="plan-preview-controls">
          <button
            className="icon-btn"
            title={t.previewRestart}
            aria-label={t.previewRestart}
            onClick={onRestart}
          >
            <RotateCcw size={15} />
          </button>
          <button
            className="icon-btn"
            title={t.previewPrev}
            aria-label={t.previewPrev}
            onClick={() => onStep(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button className="btn plan-preview-play" onClick={onTogglePlay}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
            {playing ? t.previewPause : t.previewPlay}
          </button>
          <button
            className="icon-btn"
            title={t.previewNext}
            aria-label={t.previewNext}
            onClick={() => onStep(1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {sim === "ready" && simData && simData.risks.length > 0 && (
        <div className="plan-review-section">
          <div className="plan-review-label tone-danger">
            <ShieldAlert size={13} />
            {t.simRisks}
          </div>
          <ul className="plan-review-list">
            {simData.risks.map((risk) => (
              <li key={risk.text} className={risk.severity === "critical" ? "diff-del" : undefined}>
                <span className="bidi-auto">{risk.text}</span>
                {risk.fix && (
                  <span className="plan-sim-fix bidi-auto">
                    {" "}
                    {t.simFix}: {risk.fix}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {sim === "ready" && (
        <button className="btn-ghost plan-review-run" onClick={onRerunSim}>
          <RefreshCw size={14} />
          {t.simRerun}
        </button>
      )}
    </aside>
  );
}
