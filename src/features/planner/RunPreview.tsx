import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import type { PlanNode } from "../../store/plans";
import { KIND_META } from "./nodeKinds";

/** Step-through panel for the plan: the dependency-ordered node list with play,
 *  pause and manual stepping. Pure presentation; ordering and the active-node
 *  highlight live in PlanCanvas. */
export function RunPreview({
  steps,
  cyclicIds,
  index,
  playing,
  onTogglePlay,
  onStep,
  onRestart,
  onClose,
}: {
  steps: PlanNode[];
  cyclicIds: ReadonlySet<string>;
  index: number;
  playing: boolean;
  onTogglePlay: () => void;
  onStep: (delta: number) => void;
  onRestart: () => void;
  onClose: () => void;
}) {
  const t = useStrings();
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [index]);

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
      <div className="plan-preview-sub">
        {t.previewStepOf(Math.min(index + 1, steps.length), steps.length)}
      </div>
      <ol className="plan-steps">
        {steps.map((s, i) => {
          const Icon = KIND_META[s.kind].icon;
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
              <Icon size={13} />
              <span className="plan-step-label bidi-auto">{s.label}</span>
              {cyclicIds.has(s.id) && <span className="plan-step-cycle">{t.previewCycle}</span>}
            </li>
          );
        })}
      </ol>
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
      <div className="plan-preview-hint">{t.previewHint}</div>
    </aside>
  );
}
