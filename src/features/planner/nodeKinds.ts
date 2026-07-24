import {
  Database,
  FlaskConical,
  GitBranch,
  Globe,
  Milestone,
  Monitor,
  Plug,
  Rocket,
  Server,
  SquareCheck,
  StickyNote,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PlanNodeKind } from "../../store/plans";
import type { Tint } from "../../lib/tints";

// Palette catalog: one entry per block kind, grouped so eleven kinds still read at a
// glance. Labels live in i18n (t.planKind).

export type NodeKindGroup = "plan" | "build" | "ship";

export interface NodeKindMeta {
  kind: PlanNodeKind;
  icon: LucideIcon;
  group: NodeKindGroup;
  /** Default accent so fresh blocks are tellable-apart before the inspector opens. */
  tint?: Tint;
}

export const NODE_KINDS: NodeKindMeta[] = [
  { kind: "phase", icon: Milestone, group: "plan", tint: "blue" },
  { kind: "task", icon: SquareCheck, group: "plan", tint: "green" },
  { kind: "decision", icon: GitBranch, group: "plan", tint: "red" },
  { kind: "note", icon: StickyNote, group: "plan" },
  { kind: "screen", icon: Monitor, group: "build", tint: "pink" },
  { kind: "api", icon: Globe, group: "build", tint: "cyan" },
  { kind: "service", icon: Server, group: "build", tint: "orange" },
  { kind: "data", icon: Database, group: "build", tint: "yellow" },
  { kind: "integration", icon: Plug, group: "build", tint: "orange" },
  { kind: "test", icon: FlaskConical, group: "ship", tint: "green" },
  { kind: "deploy", icon: Rocket, group: "ship", tint: "blue" },
];

export const KIND_META = Object.fromEntries(NODE_KINDS.map((k) => [k.kind, k])) as Record<
  PlanNodeKind,
  NodeKindMeta
>;

export const KIND_GROUPS: NodeKindGroup[] = ["plan", "build", "ship"];

/** HTML5 drag payload type for palette-to-canvas drags (same pattern as the
 *  sidebar's text/warsha-session). Lowercase: dataTransfer.types lowercases MIMEs. */
export const PLAN_NODE_MIME = "application/warsha-plan-node";
