import { useEffect, useRef } from "react";
import { ensureTerminal, getTerminal } from "./controller";
import { useTree } from "../../store/tree";
import { useSettings, resolveTerminalTheme } from "../../store/settings";
import { resolveTheme } from "../../lib/theme";
import type { NodeId } from "../../lib/types";

// Mounts the (registry-owned) terminal element for a session into this pane. On unmount
// it only detaches - the controller + PTY stay alive so moving a session between panes,
// or a React re-render, never restarts the shell.
export function TerminalView({ sessionId, active }: { sessionId: NodeId; active: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const node = useTree.getState().nodes[sessionId];
    if (!node || node.type !== "session") return;
    const settings = useSettings.getState();
    const ctrl = ensureTerminal(sessionId, {
      shell: node.shell,
      cwd: node.cwd,
      fontSize: settings.fontSize,
      theme: resolveTerminalTheme(settings.terminalTheme, resolveTheme(settings.theme)),
      foreground: settings.termForeground,
      bold: settings.termBold,
      initCommand: node.initCommand,
    });
    ctrl.attach(mount);
    return () => ctrl.detach();
  }, [sessionId]);

  useEffect(() => {
    if (active) getTerminal(sessionId)?.focus();
  }, [active, sessionId]);

  return <div className="term-mount" ref={mountRef} />;
}
