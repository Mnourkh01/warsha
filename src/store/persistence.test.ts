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
import { useSettings } from "./settings";

// Verbatim copy of the on-disk state.json this app actually wrote (2026-07-21). The
// hydrate hardening must never be the thing that wipes a real user's workspaces.
const REAL_V3_BLOB = {
  settings: {
    defaultShell: { kind: "powershell" },
    fontSize: 14,
    termBold: false,
    terminalTheme: "dark",
    theme: "dark",
  },
  version: 3,
  workspaces: {
    activeWorkspaceId: "1f6d6efc-8578-495a-8c0f-b77a256c7bf4",
    sessions: {
      "82d3ed78-75e4-4e58-8def-390af046d653": {
        id: "82d3ed78-75e4-4e58-8def-390af046d653",
        name: "PowerShell",
        shell: { kind: "powershell" },
        typeId: "powershell",
      },
    },
    workspaces: [
      {
        id: "1f6d6efc-8578-495a-8c0f-b77a256c7bf4",
        name: "Workspace 1",
        sessionIds: ["82d3ed78-75e4-4e58-8def-390af046d653"],
      },
      {
        id: "6377dca4-60e6-4b19-af15-7170825e154c",
        name: "Workspace 2",
        sessionIds: [],
      },
    ],
  },
};

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

  it("the real on-disk v3 blob hydrates without loss", async () => {
    ipc.loadState.mockResolvedValueOnce(structuredClone(REAL_V3_BLOB));
    await initPersistence();
    const ws = useWorkspaces.getState();
    expect(ws.workspaces.map((w) => w.name)).toEqual(["Workspace 1", "Workspace 2"]);
    expect(ws.activeWorkspaceId).toBe("1f6d6efc-8578-495a-8c0f-b77a256c7bf4");
    expect(Object.keys(ws.sessions)).toEqual(["82d3ed78-75e4-4e58-8def-390af046d653"]);
    expect(ws.sessions["82d3ed78-75e4-4e58-8def-390af046d653"].shell.kind).toBe("powershell");
    expect(useSettings.getState().fontSize).toBe(14);
    expect(ipc.sessionStateBackup).not.toHaveBeenCalled();
  });

  it("focus-only changes do not rewrite an identical blob", async () => {
    vi.useFakeTimers();
    try {
      useWorkspaces.getState().addWorkspace("blob-guard");
      await vi.advanceTimersByTimeAsync(450); // first save lands and records the blob
      const before = ipc.saveState.mock.calls.length;
      // Focus churn only: serialized output is identical (focus is not persisted).
      useWorkspaces.getState().setActiveWorkspace(useWorkspaces.getState().activeWorkspaceId);
      await vi.advanceTimersByTimeAsync(450);
      expect(ipc.saveState.mock.calls.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushSave gives up after its timeout when the save hangs", async () => {
    vi.useFakeTimers();
    try {
      useWorkspaces.getState().addWorkspace("hang");
      ipc.saveState.mockImplementationOnce(() => new Promise<void>(() => {}));
      let resolved = false;
      void flushSave(500).then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(600);
      expect(resolved).toBe(true);
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
