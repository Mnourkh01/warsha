import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardCheck, FileDown, Play, Send, Workflow } from "lucide-react";
import "@xyflow/react/dist/style.css";
import "../../styles/planner.css";
import { clipboardWriteText } from "../../lib/ipc";
import { useStrings } from "../../lib/i18n";
import { useSettings } from "../../store/settings";
import { usePlans } from "../../store/plans";
import { useUI } from "../../store/ui";
import { useWorkspaces } from "../../store/workspaces";
import { PlanCanvas } from "./PlanCanvas";
import { SendToClaudeModal } from "./SendToClaudeModal";
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
          onClick={() => setPreviewOpen((p) => !p)}
        >
          <Play size={14} />
          {t.previewRun}
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
        key={wsId}
        wsId={wsId}
        previewOpen={previewOpen}
        onClosePreview={() => setPreviewOpen(false)}
      />
      {sendOpen && <SendToClaudeModal wsId={wsId} cwd={cwd} onClose={() => setPlanSend(false)} />}
    </div>
  );
}
