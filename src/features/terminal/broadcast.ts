// Broadcast input: with the toggle on, keystrokes typed into any pane go to EVERY
// session in the active workspace (tmux "synchronize-panes"). The flag lives in the
// transient UI store on purpose - it must never survive a restart or a workspace
// switch, or the user will type a password into six shells by accident.

import { useUI } from "../../store/ui";
import { useWorkspaces } from "../../store/workspaces";

/** Session ids that should receive input typed into `sourceId`: just the source
 *  normally; the whole active workspace (source included) while broadcast is on and
 *  the source belongs to it. */
export function inputTargets(sourceId: string): string[] {
  if (!useUI.getState().broadcast) return [sourceId];
  const ws = useWorkspaces.getState();
  const active = ws.workspaces.find((w) => w.id === ws.activeWorkspaceId);
  if (!active || !active.sessionIds.includes(sourceId)) return [sourceId];
  return [...active.sessionIds];
}
