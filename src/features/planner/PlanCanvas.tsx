import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
} from "@xyflow/react";
import { uid } from "../../lib/id";
import { useStrings } from "../../lib/i18n";
import {
  MAX_PLAN_EDGES,
  MAX_PLAN_NODES,
  PLAN_NODE_KINDS,
  usePlans,
  type PlanEdge,
  type PlanNode,
  type PlanNodeKind,
} from "../../store/plans";
import { compareNodes, criticalPathIds, topoSortNodes, wouldCreateCycle } from "./graph";
import { KIND_META, PLAN_NODE_MIME } from "./nodeKinds";
import { Inspector } from "./Inspector";
import { Palette } from "./Palette";
import { RunPreview, type SimPanelPhase } from "./RunPreview";
import type { ReviewError } from "./review";
import type { PlanSimulation } from "./simulate";
import { PlanNodeCard, type PlanFlowNode } from "./nodes/PlanNodeCard";

const nodeTypes = { plan: PlanNodeCard };

function toFlowNode(n: PlanNode, selected: boolean): PlanFlowNode {
  return { id: n.id, type: "plan", position: { x: n.x, y: n.y }, data: { plan: n }, selected };
}

// Dependency edges read source to target: arrowhead shows direction, the slow dash
// flow shows "this feeds into that". Applied to connect-time edges via
// defaultEdgeOptions and to hydrated edges via toFlowEdge.
const edgeOptions = {
  animated: true,
  // color lands in the marker's inline style, where the CSS var still resolves -
  // stylesheet rules cannot reach it (xyflow writes a hardcoded inline fill).
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
    color: "var(--border-strong)",
  },
};

function toFlowEdge(e: PlanEdge): Edge {
  // The (v2) edge label rides in data so a round-trip never loses it.
  return { id: e.id, source: e.source, target: e.target, data: { label: e.label }, ...edgeOptions };
}

function toPlanEdge(e: Edge): PlanEdge {
  const label = (e.data as { label?: string } | undefined)?.label;
  return { id: e.id, source: e.source, target: e.target, label };
}

/** The canvas owns the working copy (xyflow state); every real change is committed to
 *  the plans store, which persistence then debounces to disk. Remounted per workspace
 *  via key={wsId} in PlannerView. */
interface CanvasProps {
  wsId: string;
  previewOpen: boolean;
  onClosePreview: () => void;
  /** Simulation state owned by PlannerView (cached against doc.updatedAt there). */
  simPhase: "idle" | "running" | "ready" | "error";
  simData?: PlanSimulation;
  simError?: ReviewError;
  onRerunSim: () => void;
  /** Rendered instead of preview/inspector when set (the AI review panel). */
  sidePanel?: ReactNode;
}

export function PlanCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({
  wsId,
  previewOpen,
  onClosePreview,
  simPhase,
  simData,
  simError,
  onRerunSim,
  sidePanel,
}: CanvasProps) {
  const t = useStrings();
  const { screenToFlowPosition, setCenter, getZoom } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Hydrate the working copy once from the store; PlannerView guarantees the doc
  // exists before this mounts.
  const [init] = useState(() => {
    const doc = usePlans.getState().plans[wsId];
    return {
      nodes: doc ? doc.nodes.map((n) => toFlowNode(n, false)) : [],
      edges: doc ? doc.edges.map(toFlowEdge) : [],
      viewport: doc?.viewport ?? { x: 0, y: 0, zoom: 1 },
    };
  });
  const [nodes, setNodes, onNodesChange] = useNodesState<PlanFlowNode>(init.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(init.edges);

  // Commit real content changes to the store. The signature comparison filters out
  // selection / measure churn, so updatedAt and the autosave only move on substance.
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    const planNodes = nodes.map((n) => ({ ...n.data.plan, x: n.position.x, y: n.position.y }));
    const phaseIds = new Set(planNodes.filter((n) => n.kind === "phase").map((n) => n.id));
    for (const n of planNodes) {
      if (n.phaseId && !phaseIds.has(n.phaseId)) n.phaseId = undefined;
    }
    const planEdges = edges.map(toPlanEdge);
    const sig = JSON.stringify([planNodes, planEdges]);
    if (lastSig.current === null) {
      lastSig.current = sig; // mount: working copy came FROM the store
      return;
    }
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    usePlans.getState().setGraph(wsId, planNodes, planEdges);
  }, [nodes, edges, wsId]);

  const addNode = useCallback(
    (kind: PlanNodeKind, pos: { x: number; y: number }) => {
      setNodes((ns) => {
        if (ns.length >= MAX_PLAN_NODES) return ns;
        const plan: PlanNode = {
          id: uid(),
          kind,
          x: Math.round(pos.x),
          y: Math.round(pos.y),
          label: t.planKind[kind],
          tint: KIND_META[kind].tint,
        };
        // The new block arrives selected so the inspector opens on it right away.
        return [
          ...ns.map((n) => (n.selected ? { ...n, selected: false } : n)),
          toFlowNode(plan, true),
        ];
      });
    },
    [setNodes, t],
  );

  const addAtCenter = useCallback(
    (kind: PlanNodeKind) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      const center = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 0, y: 0 };
      // Cascade so repeated clicks land readable, not stacked (card is ~150x60).
      const step = (nodes.length % 5) * 40;
      addNode(kind, { x: center.x - 80 + step, y: center.y - 20 + step });
    },
    [screenToFlowPosition, addNode, nodes.length],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(PLAN_NODE_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      const kind = e.dataTransfer.getData(PLAN_NODE_MIME);
      if (!(PLAN_NODE_KINDS as readonly string[]).includes(kind)) return;
      e.preventDefault();
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(kind as PlanNodeKind, { x: pos.x - 80, y: pos.y - 20 });
    },
    [screenToFlowPosition, addNode],
  );

  const isValidConnection: IsValidConnection<Edge> = useCallback(
    (conn) => {
      const source = conn.source;
      const target = conn.target;
      if (!source || !target || source === target) return false;
      if (edges.some((e) => e.source === source && e.target === target)) return false;
      return !wouldCreateCycle(edges, source, target);
    },
    [edges],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      setEdges((es) => (es.length >= MAX_PLAN_EDGES ? es : addEdge({ ...conn, id: uid() }, es)));
    },
    [setEdges],
  );

  const patchNode = useCallback(
    (id: string, patch: Partial<Omit<PlanNode, "id">>) => {
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id ? { ...n, data: { plan: { ...n.data.plan, ...patch, id: n.id } } } : n,
        ),
      );
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    },
    [setNodes, setEdges],
  );

  const selectedNodes = nodes.filter((n) => n.selected);
  const selected = selectedNodes.length === 1 ? selectedNodes[0] : undefined;
  const phases = nodes
    .filter((n) => n.data.plan.kind === "phase")
    .map((n) => n.data.plan)
    .sort(compareNodes);
  const criticalIds = useMemo(
    () =>
      criticalPathIds(
        nodes.map((n) => n.data.plan),
        edges.map(toPlanEdge),
      ),
    [nodes, edges],
  );

  // ---- run preview: dependency-ordered walkthrough of the whole graph ----
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const preview = useMemo(() => {
    const { order, cyclic } = topoSortNodes(
      nodes.map((n) => n.data.plan),
      edges.map(toPlanEdge),
    );
    return { steps: [...order, ...cyclic], cyclicIds: new Set(cyclic.map((c) => c.id)) };
  }, [nodes, edges]);

  // The walkthrough starts only after the simulation settles: with AI content when it
  // succeeded, plain when it could not run.
  useEffect(() => {
    if (previewOpen && (simPhase === "ready" || simPhase === "error")) {
      setStepIndex(0);
      setPlaying(true);
    } else {
      setPlaying(false);
    }
  }, [previewOpen, simPhase]);

  useEffect(() => {
    setStepIndex((i) => Math.min(i, Math.max(0, preview.steps.length - 1)));
  }, [preview.steps.length]);

  useEffect(() => {
    if (!previewOpen || !playing) return;
    const timer = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, preview.steps.length - 1));
    }, 1100);
    return () => clearInterval(timer);
  }, [previewOpen, playing, preview.steps.length]);

  useEffect(() => {
    if (playing && stepIndex >= preview.steps.length - 1) setPlaying(false);
  }, [playing, stepIndex, preview.steps.length]);

  // Highlight the active step's node, reveal simulation status badges as the run
  // reaches each step, and glide the viewport along.
  const activeStepId = previewOpen ? (preview.steps[stepIndex]?.id ?? null) : null;
  const simSteps = previewOpen && simPhase === "ready" ? simData?.steps : undefined;
  useEffect(() => {
    const position = new Map(preview.steps.map((s, i) => [s.id, i]));
    setNodes((ns) => {
      // Bail out with the SAME array when no class changed: this effect's deps derive
      // from `nodes`, so returning a fresh array unconditionally would loop forever.
      let changed = false;
      const next = ns.map((n) => {
        const parts: string[] = [];
        if (n.id === activeStepId) parts.push("step-active");
        if (simSteps) {
          const p = position.get(n.id);
          const st = simSteps[n.id];
          if (st && p !== undefined && p <= stepIndex) parts.push(`sim-${st.status}`);
        }
        const cls = parts.length > 0 ? parts.join(" ") : undefined;
        if (n.className === cls) return n;
        changed = true;
        return { ...n, className: cls };
      });
      return changed ? next : ns;
    });
  }, [activeStepId, stepIndex, simSteps, preview.steps, setNodes]);

  useEffect(() => {
    if (!activeStepId) return;
    const node = nodes.find((n) => n.id === activeStepId);
    if (!node) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void setCenter(node.position.x + 90, node.position.y + 30, {
      duration: reduce ? 0 : 350,
      zoom: getZoom(),
    });
    // Pan only when the STEP changes, not on unrelated node-state churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStepId]);

  return (
    <div className="planner-body">
      <Palette onAdd={addAtCenter} />
      <div className="plan-flow" ref={wrapperRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onDrop={onDrop}
          onDragOver={onDragOver}
          defaultEdgeOptions={edgeOptions}
          defaultViewport={init.viewport}
          onMoveEnd={(_, viewport) => usePlans.getState().setViewport(wsId, viewport)}
          deleteKeyCode={["Delete", "Backspace"]}
          minZoom={0.2}
          maxZoom={2}
        >
          <Background gap={22} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
        {nodes.length === 0 && <div className="plan-empty-hint">{t.planEmptyHint}</div>}
      </div>
      {sidePanel ? (
        sidePanel
      ) : previewOpen ? (
        <RunPreview
          steps={preview.steps}
          cyclicIds={preview.cyclicIds}
          criticalIds={criticalIds}
          sim={(simPhase === "idle" ? "running" : simPhase) as SimPanelPhase}
          simData={simData}
          simError={simError}
          index={stepIndex}
          playing={playing}
          onTogglePlay={() => setPlaying((p) => !p)}
          onStep={(delta) => {
            setPlaying(false);
            setStepIndex((i) => Math.max(0, Math.min(i + delta, preview.steps.length - 1)));
          }}
          onRestart={() => {
            setStepIndex(0);
            setPlaying(true);
          }}
          onRerunSim={onRerunSim}
          onClose={onClosePreview}
        />
      ) : (
        selected && (
          <Inspector
            key={selected.id}
            node={selected.data.plan}
            phases={phases}
            onPatch={(patch) => patchNode(selected.id, patch)}
            onDelete={() => deleteNode(selected.id)}
          />
        )
      )}
    </div>
  );
}
