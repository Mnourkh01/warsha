import type { PlanEdge, PlanNode } from "../../store/plans";

// Pure graph helpers for the plan canvas. No @xyflow imports - testable in node.

/** Deterministic node ordering used everywhere: label (case-insensitive), then id. */
export function compareNodes(a: PlanNode, b: PlanNode): number {
  const la = a.label.toLowerCase();
  const lb = b.label.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** True if adding source->target would close a directed cycle, i.e. target already
 *  reaches source through existing edges. Also true for a self edge. */
export function wouldCreateCycle(
  edges: readonly { source: string; target: string }[],
  source: string,
  target: string,
): boolean {
  if (source === target) return true;
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const list = out.get(e.source);
    if (list) list.push(e.target);
    else out.set(e.source, [e.target]);
  }
  const stack: string[] = [target];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) break;
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of out.get(cur) ?? []) stack.push(next);
  }
  return false;
}

/** Sources of edges pointing INTO the node: its dependencies. */
export function dependsOf(nodeId: string, edges: readonly PlanEdge[]): string[] {
  return edges.filter((e) => e.target === nodeId).map((e) => e.source);
}

/** Deterministic Kahn topo sort of `nodes` using only edges BETWEEN them. Ready ties
 *  break by (label, id). Nodes stuck in a cycle come back in `cyclic` (same sort) so
 *  callers can flag them instead of dropping them - hydrated data is untrusted even
 *  though the canvas prevents cycles at connect time. */
export function topoSortNodes(
  nodes: readonly PlanNode[],
  edges: readonly PlanEdge[],
): { order: PlanNode[]; cyclic: PlanNode[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    const list = out.get(e.source);
    if (list) list.push(e.target);
    else out.set(e.source, [e.target]);
  }
  let ready = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).sort(compareNodes);
  const order: PlanNode[] = [];
  const done = new Set<string>();
  while (ready.length > 0) {
    const n = ready.shift();
    if (n === undefined) break;
    order.push(n);
    done.add(n.id);
    const freed: PlanNode[] = [];
    for (const targetId of out.get(n.id) ?? []) {
      const d = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, d);
      if (d === 0) {
        const target = byId.get(targetId);
        if (target) freed.push(target);
      }
    }
    if (freed.length > 0) ready = [...ready, ...freed].sort(compareNodes);
  }
  const cyclic = nodes.filter((n) => !done.has(n.id)).sort(compareNodes);
  return { order, cyclic };
}
