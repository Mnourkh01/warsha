import { MoveRight, Trash2 } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { EDGE_KINDS, type EdgeKind } from "../../store/plans";

/** Right panel for a selected arrow: pick what the arrow MEANS. Typed arrows are what
 *  the AI reasons over (delegation trees, test coverage, gates), so this is the whole
 *  panel's job - one choice, clearly explained. */
export function EdgeInspector({
  kind,
  sourceLabel,
  targetLabel,
  onKind,
  onDelete,
}: {
  kind: EdgeKind;
  sourceLabel: string;
  targetLabel: string;
  onKind: (kind: EdgeKind) => void;
  onDelete: () => void;
}) {
  const t = useStrings();
  return (
    <aside className="plan-inspector" aria-label={t.edgeTitle}>
      <div className="plan-inspector-kind">
        <MoveRight size={14} />
        <span>{t.edgeTitle}</span>
      </div>
      <div className="plan-edge-ends">
        <span className="bidi-auto">{sourceLabel}</span>
        <MoveRight size={12} />
        <span className="bidi-auto">{targetLabel}</span>
      </div>
      <div className="field">
        <span className="field-label">{t.edgeKindLabel}</span>
        <div className="plan-edge-kinds" role="radiogroup" aria-label={t.edgeKindLabel}>
          {EDGE_KINDS.map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={kind === k}
              className={`plan-edge-kind${kind === k ? " on" : ""}`}
              onClick={() => onKind(k)}
            >
              <b>{t.edgeKind[k]}</b>
              <span>{t.edgeKindHint[k]}</span>
            </button>
          ))}
        </div>
      </div>
      <button className="btn-ghost plan-delete" onClick={onDelete}>
        <Trash2 size={14} />
        {t.edgeDelete}
      </button>
    </aside>
  );
}
