import { beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  loadState: vi.fn<() => Promise<unknown>>().mockResolvedValue(null),
  saveState: vi.fn<(s: unknown) => Promise<void>>().mockResolvedValue(undefined),
  sessionStateBackup: vi.fn<(l: string) => Promise<void>>().mockResolvedValue(undefined),
  onWindowCloseRequested: vi.fn().mockResolvedValue(() => {}),
  destroyAppWindow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/ipc", () => ipc);

import { flushSave, initPersistence } from "./persistence";
import { useWorkspaces } from "./workspaces";

// NB: persistence is a module singleton (ready flag + one subscription per init call),
// so assertions use call deltas, not absolute counts.
describe("persistence", () => {
  beforeEach(() => {
    ipc.loadState.mockClear();
    ipc.saveState.mockClear();
    ipc.sessionStateBackup.mockClear();
  });

  it("a version-mismatched blob is backed up and NOT hydrated", async () => {
    useWorkspaces.getState().hydrate({
      workspaces: [{ id: "keep", name: "Keep", sessionIds: [] }],
      sessions: {},
      activeWorkspaceId: "keep",
    });
    ipc.loadState.mockResolvedValueOnce({
      version: 2,
      workspaces: {
        workspaces: [{ id: "old", name: "Old", sessionIds: [] }],
        sessions: {},
        activeWorkspaceId: "old",
      },
    });
    await initPersistence();
    expect(ipc.sessionStateBackup).toHaveBeenCalledWith("v2");
    // The v2 payload must not have replaced the in-memory state.
    expect(useWorkspaces.getState().workspaces[0].id).toBe("keep");
  });

  it("autosave still works after a failed load (ready is set in finally)", async () => {
    vi.useFakeTimers();
    try {
      ipc.loadState.mockRejectedValueOnce(new Error("disk gone"));
      await initPersistence();
      const before = ipc.saveState.mock.calls.length;
      useWorkspaces.getState().addWorkspace("after-failure");
      await vi.advanceTimersByTimeAsync(450);
      expect(ipc.saveState.mock.calls.length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushSave writes immediately without waiting for the debounce", async () => {
    vi.useFakeTimers();
    try {
      const before = ipc.saveState.mock.calls.length;
      useWorkspaces.getState().addWorkspace("pending-change");
      // Debounce (400ms) has not elapsed; flush must not wait for it.
      await flushSave(500);
      expect(ipc.saveState.mock.calls.length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a current-version blob hydrates the stores", async () => {
    ipc.loadState.mockResolvedValueOnce({
      version: 3,
      workspaces: {
        workspaces: [{ id: "w9", name: "Nine", sessionIds: [] }],
        sessions: {},
        activeWorkspaceId: "w9",
      },
      settings: { fontSize: 16 },
    });
    await initPersistence();
    expect(useWorkspaces.getState().activeWorkspaceId).toBe("w9");
    expect(ipc.sessionStateBackup).not.toHaveBeenCalled();
  });
});
