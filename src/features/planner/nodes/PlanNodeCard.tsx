import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { tintClasses } from "../../../lib/tints";
import { useStrings } from "../../../lib/i18n";
import { KIND_META } from "../nodeKinds";
import type { PlanNode } from "../../../store/plans";

// The full PlanNode rides inside xyflow's data bag; position is mirrored back from the
// flow node when the canvas commits to the store.
export type PlanNodeData = { plan: PlanNode };
export type PlanFlowNode = Node<PlanNodeData, "plan">;

/** One card component for every kind: kind tag, label, and a kind-specific summary. */
export function PlanNodeCard({ data, selected }: NodeProps<PlanFlowNode>) {
  const t = useStrings();
  const n = data.plan;
  const Icon = KIND_META[n.kind].icon;
  return (
    <div className={`plan-node${selected ? " selected" : ""} tinted${tintClasses(n.tint)}`}>
      <Handle type="target" position={Position.Left} />
      <div className="plan-node-head">
        <Icon size={12} />
        <span>{t.planKind[n.kind]}</span>
      </div>
      <div className="plan-node-label bidi-auto">{n.label}</div>
      {n.kind === "api" ? (
        <div className="plan-node-sub mono">{`${n.method ?? "GET"} ${n.path ?? "/"}`}</div>
      ) : n.kind === "data" && n.fields?.length ? (
        <div className="plan-node-sub">{t.planFieldCount(n.fields.length)}</div>
      ) : n.kind === "task" && n.acceptance?.length ? (
        <div className="plan-node-sub">{t.planAcceptanceCount(n.acceptance.length)}</div>
      ) : n.description ? (
        <div className="plan-node-sub clamp bidi-auto">{n.description}</div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
