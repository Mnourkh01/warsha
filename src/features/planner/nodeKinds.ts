import { Database, Globe, Milestone, Server, SquareCheck, StickyNote } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PlanNodeKind } from "../../store/plans";
import type { Tint } from "../../lib/tints";

// Palette catalog: one entry per block kind. Labels live in i18n (t.planKind).

export interface NodeKindMeta {
  kind: PlanNodeKind;
  icon: LucideIcon;
  /** Default accent so fresh blocks are tellable-apart before the inspector opens. */
  tint?: Tint;
}

export const NODE_KINDS: NodeKindMeta[] = [
  { kind: "phase", icon: Milestone, tint: "blue" },
  { kind: "task", icon: SquareCheck, tint: "green" },
  { kind: "api", icon: Globe, tint: "cyan" },
  { kind: "service", icon: Server, tint: "orange" },
  { kind: "data", icon: Database, tint: "yellow" },
  { kind: "note", icon: StickyNote },
];

export const KIND_META = Object.fromEntries(NODE_KINDS.map((k) => [k.kind, k])) as Record<
  PlanNodeKind,
  NodeKindMeta
>;

/** HTML5 drag payload type for palette-to-canvas drags (same pattern as the
 *  sidebar's text/warsha-session). Lowercase: dataTransfer.types lowercases MIMEs. */
export const PLAN_NODE_MIME = "application/warsha-plan-node";
