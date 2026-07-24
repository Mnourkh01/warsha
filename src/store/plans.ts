import { create } from "zustand";
import { uid } from "../lib/id";
import { isTint, type Tint } from "../lib/tints";

// Plan Canvas domain model + store. One plan per workspace, keyed by workspace id.
// The doc shape is OURS, not the canvas library's - the sanitizer and the markdown
// serializer never depend on @xyflow types (mapping lives in PlanCanvas only).

export const PLAN_NODE_KINDS = [
  "phase",
  "task",
  "decision",
  "note",
  "screen",
  "api",
  "service",
  "ai",
  "agent",
  "data",
  "integration",
  "test",
  "deploy",
] as const;
export type PlanNodeKind = (typeof PLAN_NODE_KINDS)[number];

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Absent status means "todo" - only progress is stored. */
export const PLAN_STATUSES = ["doing", "done"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLAN_EFFORTS = ["s", "m", "l"] as const;
export type PlanEffort = (typeof PLAN_EFFORTS)[number];

/** MoSCoW-lite; absent = unranked. */
export const PLAN_PRIORITIES = ["must", "should", "could"] as const;
export type PlanPriority = (typeof PLAN_PRIORITIES)[number];

const MAX_OWNER = 80;
const MAX_DUE = 40;
const MAX_LINK = 300;

/** Kinds whose list field is meaningful (acceptance / options / checks / tools). */
export const LIST_KINDS = ["task", "decision", "test", "agent"] as const;
/** Kinds that carry a path-like field (URL path / screen route). */
export const PATH_KINDS = ["api", "screen"] as const;
/** Kinds that carry a model name (AI step, agent). */
export const MODEL_KINDS = ["ai", "agent"] as const;
const MAX_MODEL = 60;

// Boundary caps, used on hydrate AND as add-time guards. A max-size plan stays far
// under the 5 MB Rust state-file cap.
export const MAX_PLAN_NODES = 300;
export const MAX_PLAN_EDGES = 600;
export const MAX_LABEL = 200;
export const MAX_DESC = 4000;
export const MAX_PATH = 300;
export const MAX_ACCEPTANCE = 20;
export const MAX_ACCEPTANCE_LEN = 500;
export const MAX_FIELDS = 40;
export const MAX_FIELD_STR = 120;
const MAX_EDGE_LABEL = 100;
const MAX_PLAN_NAME = 120;

export interface PlanField {
  name: string;
  type: string;
  note?: string;
}

export interface PlanNode {
  id: string;
  kind: PlanNodeKind;
  /** Canvas position (finite; clamped to 0 on hydrate when corrupt). */
  x: number;
  y: number;
  label: string;
  description?: string;
  /** Accent color id (see lib/tints.ts), same palette as session tints. */
  tint?: Tint;
  /** Phase this block belongs to (id of a phase node). Ignored on phase nodes. */
  phaseId?: string;
  /** Progress; absent = todo. */
  status?: PlanStatus;
  /** Rough size: s / m / l. */
  effort?: PlanEffort;
  /** MoSCoW-lite ranking; absent = unranked. */
  priority?: PlanPriority;
  /** Who does it: the user, Claude, a friend - free text. */
  owner?: string;
  /** Free-text target date ("Friday", "2026-08-01"). */
  due?: string;
  /** Reference URL (doc, design, repo); http(s) only. */
  link?: string;
  /** api only */
  method?: HttpMethod;
  /** api (URL path) and screen (route) */
  path?: string;
  /** ai and agent: which model runs it (free text). */
  model?: string;
  /** task (acceptance criteria), decision (options), test (checks), agent (tools) */
  acceptance?: string[];
  /** data only */
  fields?: PlanField[];
}

export interface PlanEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface PlanViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface PlanDoc {
  id: string;
  name: string;
  nodes: PlanNode[];
  edges: PlanEdge[];
  viewport: PlanViewport;
  updatedAt: number;
}

function cleanStr(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.trim() ? v.slice(0, max) : undefined;
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Boundary validation for one persisted plan node (same discipline as
 *  sanitizeSessionSpec): unknown kinds and malformed shapes are dropped, strings are
 *  capped, kind-specific fields are only kept on their kind. */
export function sanitizePlanNode(raw: unknown): PlanNode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (!(PLAN_NODE_KINDS as readonly string[]).includes(r.kind as string)) return null;
  const kind = r.kind as PlanNodeKind;
  const node: PlanNode = {
    id: r.id,
    kind,
    x: finiteOr(r.x, 0),
    y: finiteOr(r.y, 0),
    label: cleanStr(r.label, MAX_LABEL) ?? "Untitled",
    description: cleanStr(r.description, MAX_DESC),
    tint: isTint(r.tint) ? r.tint : undefined,
    phaseId:
      kind !== "phase" && typeof r.phaseId === "string" && r.phaseId ? r.phaseId : undefined,
  };
  node.status = (PLAN_STATUSES as readonly string[]).includes(r.status as string)
    ? (r.status as PlanStatus)
    : undefined;
  node.effort = (PLAN_EFFORTS as readonly string[]).includes(r.effort as string)
    ? (r.effort as PlanEffort)
    : undefined;
  node.priority = (PLAN_PRIORITIES as readonly string[]).includes(r.priority as string)
    ? (r.priority as PlanPriority)
    : undefined;
  node.owner = cleanStr(r.owner, MAX_OWNER);
  node.due = cleanStr(r.due, MAX_DUE);
  const link = cleanStr(r.link, MAX_LINK);
  node.link = link && /^https?:\/\//i.test(link) ? link : undefined;
  if (kind === "api") {
    node.method = (HTTP_METHODS as readonly string[]).includes(r.method as string)
      ? (r.method as HttpMethod)
      : undefined;
  }
  if ((PATH_KINDS as readonly string[]).includes(kind)) {
    node.path = cleanStr(r.path, MAX_PATH);
  }
  if ((MODEL_KINDS as readonly string[]).includes(kind)) {
    node.model = cleanStr(r.model, MAX_MODEL);
  }
  if ((LIST_KINDS as readonly string[]).includes(kind)) {
    const list = Array.isArray(r.acceptance) ? r.acceptance : [];
    const acceptance = list
      .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
      .map((a) => a.slice(0, MAX_ACCEPTANCE_LEN))
      .slice(0, MAX_ACCEPTANCE);
    if (acceptance.length > 0) node.acceptance = acceptance;
  }
  if (kind === "data") {
    const list = Array.isArray(r.fields) ? r.fields : [];
    const fields: PlanField[] = [];
    for (const f of list) {
      if (!f || typeof f !== "object") continue;
      const ff = f as Record<string, unknown>;
      const name = cleanStr(ff.name, MAX_FIELD_STR);
      if (!name) continue;
      fields.push({
        name,
        type: cleanStr(ff.type, MAX_FIELD_STR) ?? "text",
        note: cleanStr(ff.note, MAX_FIELD_STR),
      });
      if (fields.length >= MAX_FIELDS) break;
    }
    if (fields.length > 0) node.fields = fields;
  }
  return node;
}

/** Boundary validation for a whole persisted plan. Drops malformed nodes, edges whose
 *  endpoints are missing / self / duplicated, and phase memberships that do not point
 *  at a surviving phase node. Never throws on garbage. */
export function sanitizePlanDoc(raw: unknown): PlanDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;

  const nodes: PlanNode[] = [];
  const nodeIds = new Set<string>();
  for (const n of Array.isArray(r.nodes) ? r.nodes : []) {
    const ok = sanitizePlanNode(n);
    if (!ok || nodeIds.has(ok.id)) continue;
    nodeIds.add(ok.id);
    nodes.push(ok);
    if (nodes.length >= MAX_PLAN_NODES) break;
  }
  const phaseIds = new Set(nodes.filter((n) => n.kind === "phase").map((n) => n.id));
  for (const n of nodes) {
    if (n.phaseId && !phaseIds.has(n.phaseId)) n.phaseId = undefined;
  }

  const edges: PlanEdge[] = [];
  const seenPairs = new Set<string>();
  const seenEdgeIds = new Set<string>();
  for (const e of Array.isArray(r.edges) ? r.edges : []) {
    if (!e || typeof e !== "object") continue;
    const ee = e as Record<string, unknown>;
    if (typeof ee.id !== "string" || ee.id.length === 0 || seenEdgeIds.has(ee.id)) continue;
    if (typeof ee.source !== "string" || typeof ee.target !== "string") continue;
    if (ee.source === ee.target) continue;
    if (!nodeIds.has(ee.source) || !nodeIds.has(ee.target)) continue;
    const pair = `${ee.source}->${ee.target}`;
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);
    seenEdgeIds.add(ee.id);
    edges.push({
      id: ee.id,
      source: ee.source,
      target: ee.target,
      label: cleanStr(ee.label, MAX_EDGE_LABEL),
    });
    if (edges.length >= MAX_PLAN_EDGES) break;
  }

  const vp = (r.viewport && typeof r.viewport === "object" ? r.viewport : {}) as Record<
    string,
    unknown
  >;
  return {
    id: r.id,
    name: cleanStr(r.name, MAX_PLAN_NAME) ?? "Plan",
    nodes,
    edges,
    viewport: {
      x: finiteOr(vp.x, 0),
      y: finiteOr(vp.y, 0),
      zoom: Math.min(4, Math.max(0.1, finiteOr(vp.zoom, 1))),
    },
    updatedAt: finiteOr(r.updatedAt, 0),
  };
}

interface PlansPersist {
  plans: Record<string, PlanDoc>;
}

interface PlansState extends PlansPersist {
  /** One-level undo for AI-applied drafts. Transient: never serialized. */
  draftBackups: Record<string, PlanDoc>;
  /** Get or create the plan for a workspace (name defaults to the workspace name). */
  ensurePlan: (workspaceId: string, name: string) => PlanDoc;
  /** Replace the whole doc (an applied AI draft), keeping the old one as backup. */
  applyDoc: (workspaceId: string, doc: PlanDoc) => void;
  /** Restore the pre-apply doc. Returns false when there is nothing to restore. */
  revertDoc: (workspaceId: string) => boolean;
  /** Replace the graph (canvas commits here on every real change). */
  setGraph: (workspaceId: string, nodes: PlanNode[], edges: PlanEdge[]) => void;
  setViewport: (workspaceId: string, viewport: PlanViewport) => void;
  renamePlan: (workspaceId: string, name: string) => void;
  removePlanFor: (workspaceId: string) => void;
  /** Drop plans whose workspace no longer exists (a delete the app never saw, e.g.
   *  a blob edited by hand). Called once after hydrate. */
  prune: (keepWorkspaceIds: string[]) => void;
  hydrate: (data: unknown) => void;
  serialize: () => PlansPersist;
}

export const usePlans = create<PlansState>((set, get) => ({
  plans: {},
  draftBackups: {},

  applyDoc: (workspaceId, doc) =>
    set((s) => {
      const current = s.plans[workspaceId];
      if (!current) return s;
      return {
        plans: { ...s.plans, [workspaceId]: doc },
        draftBackups: { ...s.draftBackups, [workspaceId]: current },
      };
    }),

  revertDoc: (workspaceId) => {
    const backup = get().draftBackups[workspaceId];
    if (!backup) return false;
    set((s) => {
      const draftBackups = { ...s.draftBackups };
      delete draftBackups[workspaceId];
      return { plans: { ...s.plans, [workspaceId]: backup }, draftBackups };
    });
    return true;
  },

  ensurePlan: (workspaceId, name) => {
    const existing = get().plans[workspaceId];
    if (existing) return existing;
    const doc: PlanDoc = {
      id: uid(),
      name: name.trim().slice(0, MAX_PLAN_NAME) || "Plan",
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: Date.now(),
    };
    set((s) => ({ plans: { ...s.plans, [workspaceId]: doc } }));
    return doc;
  },

  setGraph: (workspaceId, nodes, edges) =>
    set((s) => {
      const doc = s.plans[workspaceId];
      if (!doc) return s;
      return {
        plans: {
          ...s.plans,
          [workspaceId]: { ...doc, nodes, edges, updatedAt: Date.now() },
        },
      };
    }),

  setViewport: (workspaceId, viewport) =>
    set((s) => {
      const doc = s.plans[workspaceId];
      if (!doc) return s;
      // No updatedAt bump: panning is not a content change.
      return { plans: { ...s.plans, [workspaceId]: { ...doc, viewport } } };
    }),

  renamePlan: (workspaceId, name) =>
    set((s) => {
      const doc = s.plans[workspaceId];
      if (!doc) return s;
      // Raw (capped) value so a controlled input can pass through an empty draft;
      // hydrate + serializer fall back to "Plan" for blank names.
      return { plans: { ...s.plans, [workspaceId]: { ...doc, name: name.slice(0, MAX_PLAN_NAME) } } };
    }),

  removePlanFor: (workspaceId) =>
    set((s) => {
      if (!(workspaceId in s.plans)) return s;
      const plans = { ...s.plans };
      delete plans[workspaceId];
      return { plans };
    }),

  prune: (keepWorkspaceIds) =>
    set((s) => {
      const keep = new Set(keepWorkspaceIds);
      const stale = Object.keys(s.plans).filter((id) => !keep.has(id));
      if (stale.length === 0) return s;
      const plans = { ...s.plans };
      for (const id of stale) delete plans[id];
      return { plans };
    }),

  hydrate: (data) => {
    // Same boundary discipline as the other stores: the blob is untrusted.
    const d = data as Partial<PlansPersist> | undefined;
    const src = d?.plans && typeof d.plans === "object" ? d.plans : {};
    const plans: Record<string, PlanDoc> = {};
    for (const [wsId, doc] of Object.entries(src)) {
      if (!wsId) continue;
      const ok = sanitizePlanDoc(doc);
      if (ok) plans[wsId] = ok;
    }
    set({ plans, draftBackups: {} });
  },

  serialize: () => ({ plans: get().plans }),
}));
