import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  ClipboardCheck,
  FileDown,
  Info,
  LayoutGrid,
  Play,
  Send,
  Sparkles,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import "../../styles/planner.css";
import {
  clipboardWriteText,
  planDraftConsume,
  planDraftRead,
  planFileSave,
  planSpecSave,
} from "../../lib/ipc";
import { BLUEPRINT_SPEC } from "./blueprintSpec";
import { useStrings } from "../../lib/i18n";
import { useSettings } from "../../store/settings";
import { sanitizePlanDoc, usePlans } from "../../store/plans";
import { useUI } from "../../store/ui";
import { useWorkspaces } from "../../store/workspaces";
import { mirrorCollisions, resolveMirrorCwd, sessionsOffMirror } from "./mirrorScope";
import { PlanCanvas } from "./PlanCanvas";
import { ReviewPanel, type ImproveState, type ReviewState } from "./ReviewPanel";
import { SendToAiModal } from "./SendToAiModal";
import { runPlanImprove } from "./improve";
import { layoutPlan, needsLayout } from "./layout";
import { runPlanReview, type ReviewError } from "./review";
import { runPlanSimulation, type PlanSimulation } from "./simulate";
import { planToMarkdown } from "./serializeMarkdown";

/** How often the Blueprint checks the project folder for an AI-written draft. */
const DRAFT_POLL_MS = 5000;

/** Appended to the on-disk mirror ONLY (never to the export or the send prompt): any
 *  AI that reads the plan also learns the write-back path, without a skill installed. */
const MIRROR_FOOTER =
  "\n---\nTo propose changes to this plan: write the full updated plan to .warsha/plan.draft.json (format spec: .warsha/BLUEPRINT.md). Warsha offers to load it while the Blueprint is open.\n";

type DraftState =
  | { status: "none" }
  | { status: "found"; text: string }
  | { status: "invalid" }
  | { status: "applied" };

/** Full-workspace planner mode: toolbar + palette/canvas/inspector + send modal.
 *  One plan per workspace; the canvas remounts per workspace via key={wsId}. */
export function PlannerView() {
  const t = useStrings();
  const wsId = useWorkspaces((s) => s.activeWorkspaceId);
  const ws = useWorkspaces((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId));
  const workspaces = useWorkspaces((s) => s.workspaces);
  const sessions = useWorkspaces((s) => s.sessions);
  const allPlans = usePlans((s) => s.plans);
  const globalCwd = useSettings((s) => s.defaultCwd);
  const doc = usePlans((s) => s.plans[wsId]);
  const renamePlan = usePlans((s) => s.renamePlan);
  const sendOpen = useUI((s) => s.planSendOpen);
  const setPlanSend = useUI((s) => s.setPlanSend);
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Simulation cache: valid for the doc revision it ran against; a changed plan
  // triggers a fresh run on the next Run press.
  const [sim, setSim] = useState<{
    status: "idle" | "running" | "ready" | "error";
    data?: PlanSimulation;
    error?: ReviewError;
    forUpdatedAt?: number;
  }>({ status: "idle" });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [review, setReview] = useState<ReviewState>({ status: "idle" });
  const [improve, setImprove] = useState<ImproveState>({ status: "idle" });
  // Bumped after an AI draft is applied or reverted: the canvas owns a working copy,
  // so an external doc replacement needs a remount to rehydrate from the store.
  const [canvasEpoch, setCanvasEpoch] = useState(0);

  // Create the plan doc on first open. The workspace name only seeds the plan name.
  const wsName = ws?.name ?? "Plan";
  useEffect(() => {
    usePlans.getState().ensurePlan(wsId, wsName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const cwd = resolveMirrorCwd(ws, globalCwd);

  // Scope notices (gap guards): another workspace mirroring to the same folder means
  // the two plan.md files overwrite each other; sessions running elsewhere have AIs
  // that never see this plan. The info-tone notices are dismissible per workspace,
  // the collision one stays until the folders actually differ.
  const collisions = mirrorCollisions({
    workspaces,
    wsId,
    globalCwd,
    hasPlan: (id) => (allPlans[id]?.nodes.length ?? 0) > 0,
  });
  const offMirror = sessionsOffMirror(ws, sessions, cwd);
  const [scopeDismissed, setScopeDismissed] = useState(false);
  useEffect(() => setScopeDismissed(false), [wsId]);

  // Mirror the plan to <cwd>/.warsha/plan.md (debounced) so any AI CLI working in the
  // project folder - claude, codex, gemini - can read the current plan on request.
  // Keyed on updatedAt: panning bumps the doc object but not updatedAt, so it never
  // rewrites the file. Empty plans write nothing (no littering fresh folders).
  const updatedAt = doc?.updatedAt;
  const specWrittenFor = useRef<string | null>(null);
  useEffect(() => {
    if (!cwd || !updatedAt) return;
    const timer = setTimeout(() => {
      const current = usePlans.getState().plans[wsId];
      if (!current || current.nodes.length === 0) return;
      planFileSave(cwd, planToMarkdown(current, { cwd }) + MIRROR_FOOTER).catch((e) => {
        console.warn("plan file mirror failed", e);
      });
      // The format spec rides along once per folder, so a downloaded Warsha is
      // self-contained: any AI that finds the mirror also finds the contract.
      if (specWrittenFor.current !== cwd) {
        planSpecSave(cwd, BLUEPRINT_SPEC)
          .then(() => {
            specWrittenFor.current = cwd;
          })
          .catch((e) => console.warn("blueprint spec write failed", e));
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [cwd, wsId, updatedAt]);

  // The reverse channel: an AI CLI writes <cwd>/.warsha/plan.draft.json, the Blueprint
  // notices (on open + every few seconds) and offers to load it. A dismissed draft is
  // remembered by content so the poll does not re-nag about the same text.
  const [draft, setDraft] = useState<DraftState>({ status: "none" });
  const dismissedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!cwd) return;
    let alive = true;
    // The dismissal is per workspace+folder: the same draft text in ANOTHER project
    // must still get its banner.
    dismissedRef.current = null;
    const check = () => {
      planDraftRead(cwd)
        .then((text) => {
          if (!alive || text === null || text === dismissedRef.current) return;
          setDraft((prev) => {
            // Never clobber the applied banner (Undo): consume may be slow, so the
            // file can outlive the load by one poll tick.
            if (prev.status === "applied") return prev;
            return prev.status === "found" && prev.text === text
              ? prev
              : { status: "found", text };
          });
        })
        .catch((e) => console.warn("plan draft poll failed", e));
    };
    check();
    const timer = setInterval(check, DRAFT_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [cwd, wsId]);

  if (!doc) return null;

  /** Parse -> sanitize -> auto-layout (drafts rarely carry positions) -> apply with a
   *  one-level backup -> consume the file. Anything unparsable flips the banner to an
   *  actionable error instead of silently dropping the AI's work. */
  const loadDraft = () => {
    if (draft.status !== "found") return;
    let candidate: unknown;
    try {
      candidate = JSON.parse(draft.text);
    } catch {
      setDraft({ status: "invalid" });
      return;
    }
    if (candidate && typeof candidate === "object") {
      const c = candidate as Record<string, unknown>;
      // The AI does not know our internal ids; keep the doc's identity and name.
      if (typeof c.id !== "string" || !c.id) c.id = doc.id;
      if (typeof c.name !== "string" || !c.name) c.name = doc.name;
    }
    const clean = sanitizePlanDoc(candidate);
    if (!clean || clean.nodes.length === 0) {
      setDraft({ status: "invalid" });
      return;
    }
    if (needsLayout(clean.nodes)) {
      clean.nodes = layoutPlan(clean.nodes, clean.edges);
    }
    clean.viewport = doc.viewport;
    usePlans.getState().applyDoc(wsId, clean);
    setCanvasEpoch((e) => e + 1);
    setDraft({ status: "applied" });
    if (cwd) {
      planDraftConsume(cwd).catch((e) => console.warn("plan draft consume failed", e));
    }
  };

  const dismissDraft = () => {
    if (draft.status === "found") dismissedRef.current = draft.text;
    setDraft({ status: "none" });
  };

  const undoDraft = () => {
    if (usePlans.getState().revertDoc(wsId)) {
      setCanvasEpoch((e) => e + 1);
    }
    setDraft({ status: "none" });
  };

  /** One-click clean layout for a messy canvas (same engine as draft import). */
  const tidyLayout = () => {
    const current = usePlans.getState().plans[wsId];
    if (!current || current.nodes.length < 2) return;
    usePlans.getState().setGraph(wsId, layoutPlan(current.nodes, current.edges), current.edges);
    setCanvasEpoch((e) => e + 1);
  };

  const exportMarkdown = async () => {
    const current = usePlans.getState().plans[wsId];
    if (!current) return;
    try {
      await clipboardWriteText(planToMarkdown(current, { cwd }));
      setCopied(true);
    } catch (e) {
      console.warn("plan markdown copy failed", e);
    }
  };

  const doSim = async () => {
    const current = usePlans.getState().plans[wsId];
    if (!current) return;
    setSim({ status: "running" });
    const outcome = await runPlanSimulation(current);
    setSim(
      "sim" in outcome
        ? { status: "ready", data: outcome.sim, forUpdatedAt: current.updatedAt }
        : { status: "error", error: outcome.error },
    );
  };

  const runPlan = () => {
    setReviewOpen(false);
    setPreviewOpen(true);
    const current = usePlans.getState().plans[wsId];
    if (!current || sim.status === "running") return;
    if (sim.status === "ready" && sim.forUpdatedAt === current.updatedAt) return;
    void doSim();
  };

  // One review in flight at a time; the answer replaces the panel content in place.
  const startReview = async () => {
    const current = usePlans.getState().plans[wsId];
    if (!current || review.status === "running") return;
    setReview({ status: "running" });
    setImprove({ status: "idle" });
    const outcome = await runPlanReview(planToMarkdown(current, { cwd }));
    setReview(
      "review" in outcome
        ? { status: "done", data: outcome.review }
        : { status: "error", error: outcome.error, raw: outcome.raw },
    );
  };

  const startImprove = async () => {
    const current = usePlans.getState().plans[wsId];
    if (!current || review.status !== "done" || improve.status === "running") return;
    setImprove({ status: "running" });
    const outcome = await runPlanImprove(current, review.data.improvements);
    setImprove(
      "draft" in outcome
        ? { status: "ready", draft: outcome.draft, diff: outcome.diff }
        : { status: "error", error: outcome.error, raw: outcome.raw },
    );
  };

  const applyImprove = () => {
    if (improve.status !== "ready") return;
    usePlans.getState().applyDoc(wsId, improve.draft);
    setImprove({ status: "applied" });
    setCanvasEpoch((e) => e + 1);
  };

  const revertImprove = () => {
    if (usePlans.getState().revertDoc(wsId)) {
      setImprove({ status: "idle" });
      setCanvasEpoch((e) => e + 1);
    }
  };

  return (
    <div className="planner">
      <header className="planner-toolbar">
        <span className="planner-mark">
          <Workflow size={16} />
        </span>
        <input
          className="plan-name-input bidi-auto"
          dir="auto"
          aria-label={t.planName}
          value={doc.name}
          onChange={(e) => renamePlan(wsId, e.target.value)}
        />
        <span
          className="planner-ws-chip bidi-auto"
          dir="auto"
          title={cwd ? t.planWsChipTitle(cwd) : t.planWsChipNoFolder}
        >
          {wsName}
        </span>
        <span className="planner-count">{t.planNodeCount(doc.nodes.length)}</span>
        <span className="spacer" />
        <button className="btn-ghost" disabled={doc.nodes.length < 2} onClick={tidyLayout}>
          <LayoutGrid size={14} />
          {t.tidyLayout}
        </button>
        <button
          className="btn-ghost"
          disabled={doc.nodes.length === 0}
          onClick={() => {
            if (previewOpen) setPreviewOpen(false);
            else runPlan();
          }}
        >
          <Play size={14} />
          {t.previewRun}
        </button>
        <button
          className="btn-ghost"
          disabled={doc.nodes.length === 0}
          onClick={() => {
            setPreviewOpen(false);
            setReviewOpen((r) => !r);
          }}
        >
          <Sparkles size={14} />
          {t.reviewBtn}
        </button>
        <button className="btn-ghost" onClick={() => void exportMarkdown()}>
          {copied ? <ClipboardCheck size={14} /> : <FileDown size={14} />}
          {copied ? t.exportCopied : t.exportMarkdown}
        </button>
        <button className="btn" onClick={() => setPlanSend(true)}>
          <Send size={14} />
          {t.sendToAi}
        </button>
        <button className="btn-ghost" onClick={() => useUI.getState().setPlanner(false)}>
          <ArrowLeft size={14} />
          {t.closePlanner}
        </button>
      </header>
      {collisions.length > 0 && (
        <div className="plan-scope-bar plan-scope-warn" role="alert">
          <TriangleAlert size={14} />
          <span>{t.planMirrorCollision(collisions.join(", "))}</span>
        </div>
      )}
      {!scopeDismissed && (offMirror.length > 0 || !cwd) && (
        <div className="plan-scope-bar" role="status">
          <Info size={14} />
          <span>{cwd ? t.planSessionsOffMirror(offMirror.length) : t.planNoMirrorFolder}</span>
          <button className="btn-ghost" onClick={() => setScopeDismissed(true)}>
            {t.close}
          </button>
        </div>
      )}
      {draft.status !== "none" && (
        <div className="plan-draft-bar" role="status">
          <Bot size={14} />
          {draft.status === "found" && (
            <>
              <span>{t.draftFound}</span>
              <button className="btn" onClick={loadDraft}>
                {t.draftLoad}
              </button>
              <button className="btn-ghost" onClick={dismissDraft}>
                {t.draftDismiss}
              </button>
            </>
          )}
          {draft.status === "invalid" && (
            <>
              <span className="plan-draft-error">{t.draftInvalid}</span>
              <button className="btn-ghost" onClick={dismissDraft}>
                {t.draftDismiss}
              </button>
            </>
          )}
          {draft.status === "applied" && (
            <>
              <span>{t.draftApplied}</span>
              <button className="btn-ghost" onClick={undoDraft}>
                {t.draftUndo}
              </button>
              <button className="btn-ghost" onClick={() => setDraft({ status: "none" })}>
                {t.close}
              </button>
            </>
          )}
        </div>
      )}
      <PlanCanvas
        key={`${wsId}:${canvasEpoch}`}
        wsId={wsId}
        previewOpen={previewOpen}
        onClosePreview={() => setPreviewOpen(false)}
        simPhase={sim.status}
        simData={sim.data}
        simError={sim.error}
        onRerunSim={() => void doSim()}
        onAskAi={() => setPlanSend(true)}
        sidePanel={
          reviewOpen ? (
            <ReviewPanel
              state={review}
              improve={improve}
              onRun={() => void startReview()}
              onImprove={() => void startImprove()}
              onApplyImprove={applyImprove}
              onDiscardImprove={() => setImprove({ status: "idle" })}
              onRevertImprove={revertImprove}
              onClose={() => setReviewOpen(false)}
            />
          ) : undefined
        }
      />
      {sendOpen && (
        <SendToAiModal
          wsId={wsId}
          cwd={cwd}
          review={review.status === "done" ? review.data : undefined}
          onClose={() => setPlanSend(false)}
        />
      )}
    </div>
  );
}
