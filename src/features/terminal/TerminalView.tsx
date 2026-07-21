import { useEffect, useRef } from "react";
import { ensureTerminal, getTerminal } from "./controller";
import { useWorkspaces } from "../../store/workspaces";
import { useRuntime } from "../../store/runtime";
import { useSettings } from "../../store/settings";
import { termScheme } from "../../actions";

// Mounts the (registry-owned) terminal element for a session into this pane. Unmount only
// detaches - the controller + PTY stay alive across pane moves, workspace switches, and
// React re-renders. A restart bumps the session's runtime epoch, which re-runs the effect
// (the controller was disposed, so ensureTerminal creates a fresh one and respawns).
export function TerminalView({ sessionId, active }: { sessionId: string; active: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const epoch = useRuntime((s) => s.epoch[sessionId] ?? 0);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const session = useWorkspaces.getState().sessions[sessionId];
    if (!session) return;
    const settings = useSettings.getState();
    const ctrl = ensureTerminal(sessionId, {
      shell: session.shell,
      cwd: session.cwd,
      fontSize: settings.fontSize,
      theme: termScheme(),
      foreground: settings.termForeground,
      bold: settings.termBold,
    });
    ctrl.attach(mount);
    return () => ctrl.detach();
  }, [sessionId, epoch]);

  useEffect(() => {
    if (active) getTerminal(sessionId)?.focus();
  }, [active, sessionId]);

  return <div className="term-mount" ref={mountRef} />;
}
