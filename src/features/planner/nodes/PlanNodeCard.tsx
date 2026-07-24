import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { CalendarClock, CircleCheck, Link2, UserRound } from "lucide-react";
import { tintClasses } from "../../../lib/tints";
import { useStrings } from "../../../lib/i18n";
import { KIND_META } from "../nodeKinds";
import type { PlanNode } from "../../../store/plans";

// The full PlanNode rides inside xyflow's data bag; position is mirrored back from the
// flow node when the canvas commits to the store.
export type PlanNodeData = { plan: PlanNode };
export type PlanFlowNode = Node<PlanNodeData, "plan">;

/** How many list items / data fields a card previews before collapsing to "+N more". */
const PREVIEW_ITEMS = 3;

/** One card component for every kind: kind tag + label, then the details that make the
 *  block readable at canvas zoom - kind facts line, list preview, owner/due chips. */
export function PlanNodeCard({ data, selected }: NodeProps<PlanFlowNode>) {
  const t = useStrings();
  const n = data.plan;
  const Icon = KIND_META[n.kind].icon;
  const list = n.acceptance ?? [];
  const fields = n.kind === "data" ? (n.fields ?? []) : [];
  const showList = list.length > 0 || fields.length > 0;
  return (
    <div className={`plan-node${selected ? " selected" : ""} tinted${tintClasses(n.tint)}`}>
      <Handle type="target" position={Position.Left} />
      <div className="plan-node-head">
        <Icon size={12} />
        <span>{t.planKind[n.kind]}</span>
        <span className="plan-node-flags">
          {n.kind === "note" && n.flavor && (
            <b className={`plan-node-flavor f-${n.flavor}`}>{n.flavor}</b>
          )}
          {n.priority === "must" && (
            <b className="plan-node-must" title={t.priorityMust}>
              !
            </b>
          )}
          {n.link && /^https?:\/\//i.test(n.link) && <Link2 size={11} aria-label={t.inspLink} />}
          {n.effort && <b className="plan-node-eff">{n.effort.toUpperCase()}</b>}
          {n.status === "doing" && (
            <span className="plan-node-doing" role="img" aria-label={t.statusDoing} />
          )}
          {n.status === "done" && <CircleCheck size={12} aria-label={t.statusDone} />}
        </span>
      </div>
      <div className={`plan-node-label bidi-auto${n.status === "done" ? " done" : ""}`}>
        {n.label}
      </div>
      {n.kind === "api" ? (
        <div className="plan-node-sub mono">
          {`${n.method ?? "GET"} ${n.path ?? "/"}${n.auth ? ` · ${n.auth}` : ""}`}
        </div>
      ) : n.kind === "screen" && n.path ? (
        <div className="plan-node-sub mono">{n.path}</div>
      ) : n.kind === "deploy" && n.env ? (
        <div className="plan-node-sub mono">{n.env}</div>
      ) : n.kind === "test" && n.testType ? (
        <div className="plan-node-sub">{n.testType}</div>
      ) : (n.kind === "ai" || n.kind === "agent") && n.model ? (
        <div className="plan-node-sub mono">{n.model}</div>
      ) : (n.kind === "service" || n.kind === "integration") && n.spec ? (
        <div className="plan-node-sub bidi-auto">{n.spec}</div>
      ) : n.kind === "decision" && n.chosen ? (
        <div className="plan-node-sub bidi-auto">{`${t.inspChosen}: ${n.chosen}`}</div>
      ) : null}
      {fields.length > 0 ? (
        <ul className="plan-node-list mono">
          {fields.slice(0, PREVIEW_ITEMS).map((f) => (
            <li key={f.name}>{`${f.name}: ${f.type}`}</li>
          ))}
          {fields.length > PREVIEW_ITEMS && (
            <li className="plan-node-more">{t.planMore(fields.length - PREVIEW_ITEMS)}</li>
          )}
        </ul>
      ) : list.length > 0 ? (
        <ul className="plan-node-list">
          {list.slice(0, PREVIEW_ITEMS).map((item, i) => (
            <li key={i} className="bidi-auto">
              {item}
            </li>
          ))}
          {list.length > PREVIEW_ITEMS && (
            <li className="plan-node-more">{t.planMore(list.length - PREVIEW_ITEMS)}</li>
          )}
        </ul>
      ) : null}
      {!showList && n.description && (
        <div className="plan-node-sub clamp bidi-auto">{n.description}</div>
      )}
      {(n.owner || n.due) && (
        <div className="plan-node-meta">
          {n.owner && (
            <span className="bidi-auto">
              <UserRound size={10} />
              {n.owner}
            </span>
          )}
          {n.due && (
            <span className="bidi-auto">
              <CalendarClock size={10} />
              {n.due}
            </span>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
