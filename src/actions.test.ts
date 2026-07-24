import { beforeEach, describe, expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({
  disposeTerminal: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
  getTerminal: vi.fn().mockReturnValue(undefined),
}));
vi.mock("./features/terminal/controller", () => controller);

import {
  closeSession,
  deleteWorkspace,
  newSession,
  openSession,
  restartSession,
  switchWorkspace,
} from "./actions";
import { useWorkspaces } from "./store/workspaces";
import { useRuntime } from "./store/runtime";
import { useSettings } from "./store/settings";
import { useUI } from "./store/ui";

// The exact hard-won failure class from CLAUDE.md: a session gone from the UI while its
// ConPTY child leaks, or a stale "running" dot on a dead pane. These tests pin the
// orchestration: store + terminal registry + runtime status always move together.
describe("actions orchestration", () => {
  beforeEach(() => {
    controller.disposeTerminal.mockClear();
    useRuntime.setState({ status: {}, epoch: {} });
    useUI.setState({ maximizedSessionId: null, broadcast: false });
    useWorkspaces.getState().hydrate({
      workspaces: [{ id: "w1", name: "Workspace 1", sessionIds: [] }],
      sessions: {},
      activeWorkspaceId: "w1",
    });
  });

  it("newSession registers the session and marks it running", () => {
    const id = newSession({ shell: { kind: "cmd" }, name: "test" })!;
    expect(id).toBeTruthy();
    expect(useWorkspaces.getState().sessions[id]).toBeTruthy();
    expect(useRuntime.getState().status[id]).toBe("running");
  });

  it("newSession folder priority: explicit cwd, then workspace folder, then global", () => {
    useSettings.getState().setDefaultCwd("C:\\global");
    useWorkspaces.getState().setWorkspaceCwd("w1", "C:\\project");
    const a = newSession({ shell: { kind: "cmd" }, name: "a" })!;
    expect(useWorkspaces.getState().sessions[a].cwd).toBe("C:\\project");
    const b = newSession({ shell: { kind: "cmd" }, name: "b", cwd: "C:\\explicit" })!;
    expect(useWorkspaces.getState().sessions[b].cwd).toBe("C:\\explicit");
    useWorkspaces.getState().setWorkspaceCwd("w1", undefined);
    const c = newSession({ shell: { kind: "cmd" }, name: "c" })!;
    expect(useWorkspaces.getState().sessions[c].cwd).toBe("C:\\global");
    useSettings.getState().setDefaultCwd("");
  });

  it("newSession on a full workspace adds nothing and sets no status", () => {
    for (let i = 0; i < 6; i++) newSession({ shell: { kind: "cmd" }, name: `s${i}` });
    const id = newSession({ shell: { kind: "cmd" }, name: "overflow" });
    expect(id).toBeNull();
    expect(Object.keys(useRuntime.getState().status)).toHaveLength(6);
  });

  it("closeSession removes the session, kills the terminal, and clears runtime state", () => {
    const id = newSession({ shell: { kind: "cmd" }, name: "bye" })!;
    useRuntime.getState().bumpEpoch(id);
    closeSession(id);
    expect(useWorkspaces.getState().sessions[id]).toBeUndefined();
    expect(controller.disposeTerminal).toHaveBeenCalledWith(id);
    expect(useRuntime.getState().status[id]).toBeUndefined();
    expect(useRuntime.getState().epoch[id]).toBeUndefined();
  });

  it("restartSession disposes FIRST, then remounts via a fresh epoch", async () => {
    const id = newSession({ shell: { kind: "cmd" }, name: "again" })!;
    let epochAtDispose = -1;
    controller.disposeTerminal.mockImplementationOnce((sid) => {
      epochAtDispose = useRuntime.getState().epoch[sid] ?? 0;
      return Promise.resolve();
    });
    await restartSession(id);
    // The kill completed while the epoch was still old; the bump came after.
    expect(epochAtDispose).toBe(0);
    expect(useRuntime.getState().epoch[id]).toBe(1);
    expect(useRuntime.getState().status[id]).toBe("running");
  });

  // Maximize is transient view state; a stale value hid the clicked/created session
  // behind another pane (the "blank when I come back" class of bug).
  it("openSession clears a maximized OTHER pane but keeps its own", () => {
    const a = newSession({ shell: { kind: "cmd" }, name: "a" })!;
    const b = newSession({ shell: { kind: "cmd" }, name: "b" })!;
    useUI.getState().setMaximized(a);
    openSession(a);
    expect(useUI.getState().maximizedSessionId).toBe(a);
    openSession(b);
    expect(useUI.getState().maximizedSessionId).toBeNull();
  });

  it("newSession un-maximizes so the new pane is actually visible", () => {
    const a = newSession({ shell: { kind: "cmd" }, name: "a" })!;
    useUI.getState().setMaximized(a);
    newSession({ shell: { kind: "cmd" }, name: "b" });
    expect(useUI.getState().maximizedSessionId).toBeNull();
  });

  it("switchWorkspace clears maximize (it never follows a workspace change)", () => {
    const a = newSession({ shell: { kind: "cmd" }, name: "a" })!;
    const w2 = useWorkspaces.getState().addWorkspace("W2");
    useWorkspaces.getState().setActiveWorkspace("w1"); // addWorkspace activated w2
    useUI.getState().setMaximized(a);
    switchWorkspace(w2);
    expect(useUI.getState().maximizedSessionId).toBeNull();
  });

  it("deleteWorkspace disposes every session it contained", () => {
    const a = newSession({ shell: { kind: "cmd" }, name: "a" })!;
    const b = newSession({ shell: { kind: "cmd" }, name: "b" })!;
    const w2 = useWorkspaces.getState().addWorkspace("W2");
    expect(w2).toBeTruthy();
    // back to w1 which holds a + b
    useWorkspaces.getState().setActiveWorkspace("w1");
    deleteWorkspace("w1");
    expect(controller.disposeTerminal).toHaveBeenCalledWith(a);
    expect(controller.disposeTerminal).toHaveBeenCalledWith(b);
    expect(useRuntime.getState().status[a]).toBeUndefined();
    expect(useRuntime.getState().status[b]).toBeUndefined();
  });
});
