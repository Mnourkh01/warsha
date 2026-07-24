import type { PlanEdge, PlanNode } from "../../store/plans";
import { compareNodes, topoSortNodes } from "./graph";

// Deterministic left-to-right layered layout. Hand-rolled instead of a layout library:
// plans cap at 300 nodes and cards have a known max width, so longest-path layering
// with a fixed row pitch already guarantees no overlap - no lockfile dependency needed.
// Used by the Tidy button and by AI-draft import (drafts usually carry no positions).

const MARGIN_X = 40;
const MARGIN_Y = 40;
/** Column pitch: card max-width 264px plus room for the arrow bend. */
const COL_W = 330;
/** Row pitch: a tall card (head + label + three list items + meta chips) stays under this. */
const ROW_H = 180;

/** True when the canvas positions are unusable: two or more blocks sit on the exact
 *  same spot (an AI draft without positions sanitizes every block to 0,0). */
export function needsLayout(nodes: readonly PlanNode[]): boolean {
  if (nodes.length < 2) return false;
  const seen = new Set<string>();
  for (const n of nodes) {
    const key = `${Math.round(n.x)},${Math.round(n.y)}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

/** New positions for every node: columns by dependency depth (longest path from the
 *  roots), rows grouped phases-first then by phase membership, ties by (label, id).
 *  Nodes caught in a dependency cycle land in one trailing column instead of being
 *  dropped. Pure - returns copies, never mutates. */
export function layoutPlan(nodes: readonly PlanNode[], edges: readonly PlanEdge[]): PlanNode[] {
  const { order, cyclic } = topoSortNodes(nodes, edges);
  const depth = new Map<string, number>();
  for (const n of order) depth.set(n.id, 0);
  // order is topological, so every source is final before its targets are relaxed.
  for (const n of order) {
    const d = depth.get(n.id) ?? 0;
    for (const e of edges) {
      if (e.source !== n.id || !depth.has(e.target)) continue;
      if (d + 1 > (depth.get(e.target) ?? 0)) depth.set(e.target, d + 1);
    }
  }
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  for (const n of cyclic) depth.set(n.id, maxDepth + 1);

  // Row order inside a column: phase blocks first, then members grouped by their
  // phase (phases sorted by label), unphased last, ties by (label, id).
  const phaseRank = new Map<string, number>();
  [...nodes]
    .filter((n) => n.kind === "phase")
    .sort(compareNodes)
    .forEach((p, i) => phaseRank.set(p.id, i));
  const rowRank = (n: PlanNode): number => {
    if (n.kind === "phase") return -1;
    if (n.phaseId !== undefined && phaseRank.has(n.phaseId)) {
      return phaseRank.get(n.phaseId) ?? phaseRank.size;
    }
    return phaseRank.size;
  };

  const columns = new Map<number, PlanNode[]>();
  for (const n of nodes) {
    const c = depth.get(n.id) ?? 0;
    const list = columns.get(c);
    if (list) list.push(n);
    else columns.set(c, [n]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [c, members] of columns) {
    members.sort((a, b) => rowRank(a) - rowRank(b) || compareNodes(a, b));
    members.forEach((n, i) => {
      pos.set(n.id, { x: MARGIN_X + c * COL_W, y: MARGIN_Y + i * ROW_H });
    });
  }
  return nodes.map((n) => ({ ...n, ...(pos.get(n.id) ?? { x: MARGIN_X, y: MARGIN_Y }) }));
}
