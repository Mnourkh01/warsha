import { useStrings } from "../../lib/i18n";
import type { PlanNodeKind } from "../../store/plans";
import { KIND_GROUPS, NODE_KINDS, PLAN_NODE_MIME } from "./nodeKinds";

/** Left rail: drag a block onto the canvas, or click to add it at the canvas center.
 *  Grouped (Plan / Build / Ship) so eleven kinds still scan quickly. */
export function Palette({ onAdd }: { onAdd: (kind: PlanNodeKind) => void }) {
  const t = useStrings();
  const groupLabel = {
    plan: t.paletteGroupPlan,
    build: t.paletteGroupBuild,
    ship: t.paletteGroupShip,
  } as const;
  return (
    <aside className="plan-palette" aria-label={t.paletteBlocks}>
      {KIND_GROUPS.map((group) => (
        <div key={group} className="plan-palette-group">
          <div className="tree-group-label">{groupLabel[group]}</div>
          {NODE_KINDS.filter((k) => k.group === group).map(({ kind, icon: Icon }) => (
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
        </div>
      ))}
      <div className="plan-palette-hint">{t.paletteHint}</div>
    </aside>
  );
}
