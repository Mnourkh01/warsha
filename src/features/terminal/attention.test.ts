import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_BURST_BYTES, QUIET_MS, dropTracking, noteExit, noteOutput } from "./attention";
import { useRuntime } from "../../store/runtime";
import { useWorkspaces } from "../../store/workspaces";

// The attention contract: a BACKGROUND session that bursts output and goes quiet (or
// exits) gets a badge; the focused session never does; closed sessions never leak one.
describe("attention tracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useRuntime.setState({ status: {}, epoch: {}, attention: {} });
    useWorkspaces.getState().hydrate({
      workspaces: [{ id: "w1", name: "W1", sessionIds: ["a", "b"] }],
      sessions: {
        a: { id: "a", name: "a", shell: { kind: "powershell" } },
        b: { id: "b", name: "b", shell: { kind: "powershell" } },
      },
      activeWorkspaceId: "w1",
    });
    // hydrate deliberately restores with no focused session; focus one explicitly.
    useWorkspaces.getState().setActiveSession("a");
  });

  afterEach(() => {
    dropTracking("a");
    dropTracking("b");
    vi.useRealTimers();
  });

  it("background burst that goes quiet sets attention", () => {
    noteOutput("b", MIN_BURST_BYTES);
    vi.advanceTimersByTime(QUIET_MS);
    expect(useRuntime.getState().attention["b"]).toBe(true);
  });

  it("the active session never badges", () => {
    noteOutput("a", 10_000);
    vi.advanceTimersByTime(QUIET_MS);
    expect(useRuntime.getState().attention["a"]).toBeUndefined();
  });

  it("tiny bursts (cursor noise) are ignored", () => {
    noteOutput("b", MIN_BURST_BYTES - 1);
    vi.advanceTimersByTime(QUIET_MS);
    expect(useRuntime.getState().attention["b"]).toBeUndefined();
  });

  it("continuous output keeps the burst open until real silence", () => {
    noteOutput("b", 200);
    vi.advanceTimersByTime(QUIET_MS - 100);
    noteOutput("b", 200);
    vi.advanceTimersByTime(QUIET_MS - 100);
    expect(useRuntime.getState().attention["b"]).toBeUndefined();
    vi.advanceTimersByTime(100);
    expect(useRuntime.getState().attention["b"]).toBe(true);
  });

  it("switching TO the pane mid-burst suppresses the badge (decided at quiet time)", () => {
    useWorkspaces.getState().setActiveSession("b");
    noteOutput("b", 10_000);
    vi.advanceTimersByTime(QUIET_MS);
    expect(useRuntime.getState().attention["b"]).toBeUndefined();
  });

  it("exit badges a background session but not the active one", () => {
    noteExit("b");
    noteExit("a");
    expect(useRuntime.getState().attention["b"]).toBe(true);
    expect(useRuntime.getState().attention["a"]).toBeUndefined();
  });

  it("exit after the session was closed does not leak a zombie entry", () => {
    useWorkspaces.getState().removeSession("b");
    noteExit("b");
    expect(useRuntime.getState().attention["b"]).toBeUndefined();
  });

  it("dropTracking cancels a pending burst", () => {
    noteOutput("b", 10_000);
    dropTracking("b");
    vi.advanceTimersByTime(QUIET_MS * 2);
    expect(useRuntime.getState().attention["b"]).toBeUndefined();
  });

  it("clearStatus drops the attention entry with the session", () => {
    useRuntime.getState().setAttention("b");
    useRuntime.getState().clearStatus("b");
    expect(useRuntime.getState().attention["b"]).toBeUndefined();
  });
});
