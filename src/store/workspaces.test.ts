import { beforeEach, describe, expect, it } from "vitest";
import { MAX_PER_WS, useWorkspaces } from "./workspaces";

const reset = () =>
  useWorkspaces.getState().hydrate({
    workspaces: [{ id: "w1", name: "Workspace 1", sessionIds: [] }],
    sessions: {},
    activeWorkspaceId: "w1",
  });

const add = (name = "s") =>
  useWorkspaces.getState().addSession({ shell: { kind: "cmd" }, name });

describe("workspaces store", () => {
  beforeEach(reset);

  it("adds a session to the active workspace and focuses it", () => {
    const id = add("ps");
    expect(id).toBeTruthy();
    expect(useWorkspaces.getState().workspaces[0].sessionIds).toContain(id);
    expect(useWorkspaces.getState().activeSessionId).toBe(id);
  });

  it("caps a workspace at 6 sessions", () => {
    for (let i = 0; i < MAX_PER_WS; i++) expect(add()).toBeTruthy();
    expect(add()).toBeNull();
  });

  it("a new workspace is empty, becomes active, and old ones keep their sessions", () => {
    const s1 = add("keep");
    const w2 = useWorkspaces.getState().addWorkspace("W2");
    expect(useWorkspaces.getState().activeWorkspaceId).toBe(w2);
    expect(useWorkspaces.getState().workspaces.find((w) => w.id === w2)!.sessionIds).toEqual([]);
    expect(useWorkspaces.getState().workspaces.find((w) => w.id === "w1")!.sessionIds).toContain(s1);
  });

  it("removes a session", () => {
    const id = add()!;
    useWorkspaces.getState().removeSession(id);
    expect(useWorkspaces.getState().sessions[id]).toBeUndefined();
    expect(useWorkspaces.getState().workspaces[0].sessionIds).not.toContain(id);
  });

  it("moves a session to another workspace", () => {
    const id = add()!;
    const w2 = useWorkspaces.getState().addWorkspace("W2");
    expect(useWorkspaces.getState().moveSessionToWorkspace(id, w2)).toBe(true);
    expect(useWorkspaces.getState().workspaceOf(id)).toBe(w2);
  });
});
