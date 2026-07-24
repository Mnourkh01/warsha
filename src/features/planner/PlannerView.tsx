import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardCheck, FileDown, Play, Send, Sparkles, Workflow } from "lucide-react";
import "@xyflow/react/dist/style.css";
import "../../styles/planner.css";
import { clipboardWriteText } from "../../lib/ipc";
import { useStrings } from "../../lib/i18n";
import { useSettings } from "../../store/settings";
import { usePlans } from "../../store/plans";
import { useUI } from "../../store/ui";
import { useWorkspaces } from "../../store/workspaces";
import { PlanCanvas } from "./PlanCanvas";
import { ReviewPanel, type ImproveState, type ReviewState } from "./ReviewPanel";
import { SendToClaudeModal } from "./SendToClaudeModal";
import { runPlanImprove } from "./improve";
import { runPlanReview, type ReviewError } from "./review";
import { runPlanSimulation, type PlanSimulation } from "./simulate";
import { planToMarkdown } from "./serializeMarkdown";

/** Full-workspace planner mode: toolbar + palette/canvas/inspector + send modal.
 *  One plan per workspace; the canvas remounts per workspace via key={wsId}. */
export function PlannerView() {
  const t = useStrings();
  const wsId = useWorkspaces((s) => s.activeWorkspaceId);
  const ws = useWorkspaces((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId));
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

  if (!doc) return null;

  const cwd = ws?.defaultCwd ?? globalCwd;

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
        <span className="planner-count">{t.planNodeCount(doc.nodes.length)}</span>
        <span className="spacer" />
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
        <button
          className="btn"
          disabled={doc.nodes.length === 0}
          onClick={() => setPlanSend(true)}
        >
          <Send size={14} />
          {t.sendToClaude}
        </button>
        <button className="btn-ghost" onClick={() => useUI.getState().setPlanner(false)}>
          <ArrowLeft size={14} />
          {t.closePlanner}
        </button>
      </header>
      <PlanCanvas
        key={`${wsId}:${canvasEpoch}`}
        wsId={wsId}
        previewOpen={previewOpen}
        onClosePreview={() => setPreviewOpen(false)}
        simPhase={sim.status}
        simData={sim.data}
        simError={sim.error}
        onRerunSim={() => void doSim()}
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
      {sendOpen && <SendToClaudeModal wsId={wsId} cwd={cwd} onClose={() => setPlanSend(false)} />}
    </div>
  );
}
