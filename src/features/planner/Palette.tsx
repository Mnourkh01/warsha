import { useStrings } from "../../lib/i18n";
import type { PlanNodeKind } from "../../store/plans";
import { NODE_KINDS, PLAN_NODE_MIME } from "./nodeKinds";

/** Left rail: drag a block onto the canvas, or click to add it at the canvas center. */
export function Palette({ onAdd }: { onAdd: (kind: PlanNodeKind) => void }) {
  const t = useStrings();
  return (
    <aside className="plan-palette" aria-label={t.paletteBlocks}>
      <div className="tree-group-label">{t.paletteBlocks}</div>
      {NODE_KINDS.map(({ kind, icon: Icon }) => (
        <button
          key={kind}
          className="plan-palette-item"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(PLAN_NODE_MIME, kind);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => onAdd(kind)}
          title={t.planAddBlock(t.planKind[kind])}
        >
          <Icon size={14} />
          <span>{t.planKind[kind]}</span>
        </button>
      ))}
      <div className="plan-palette-hint">{t.paletteHint}</div>
    </aside>
  );
}
