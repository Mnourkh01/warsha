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

  it("hydrate keeps a duplicated session id in the FIRST workspace only", () => {
    useWorkspaces.getState().hydrate({
      workspaces: [
        { id: "a", name: "A", sessionIds: ["s1"] },
        { id: "b", name: "B", sessionIds: ["s1"] },
      ],
      sessions: { s1: { id: "s1", name: "S", shell: { kind: "cmd" } } },
      activeWorkspaceId: "b",
    });
    const st = useWorkspaces.getState();
    expect(st.workspaces.find((w) => w.id === "a")!.sessionIds).toEqual(["s1"]);
    expect(st.workspaces.find((w) => w.id === "b")!.sessionIds).toEqual([]);
  });

  it("hydrate discards workspaces with non-string ids and repairs bad names", () => {
    useWorkspaces.getState().hydrate({
      workspaces: [
        { id: 7 as unknown as string, name: "Bad", sessionIds: [] },
        { id: "ok", name: 42 as unknown as string, sessionIds: [3 as unknown as string] },
      ],
      sessions: {},
      activeWorkspaceId: "ok",
    });
    const st = useWorkspaces.getState();
    expect(st.workspaces).toHaveLength(1);
    expect(st.workspaces[0]).toMatchObject({ id: "ok", name: "Workspace", sessionIds: [] });
  });

  it("hydrate falls back to a fresh workspace when every entry is invalid", () => {
    useWorkspaces.getState().hydrate({
      workspaces: [{ id: null as unknown as string, name: "x", sessionIds: [] }],
      sessions: {},
      activeWorkspaceId: "nope",
    });
    const st = useWorkspaces.getState();
    expect(st.workspaces).toHaveLength(1);
    expect(st.workspaces[0].name).toBe("Workspace 1");
  });

  it("deleting a background workspace does not steal focus", () => {
    const s1 = add("focused")!;
    const w2 = useWorkspaces.getState().addWorkspace("W2");
    useWorkspaces.getState().setActiveWorkspace("w1");
    useWorkspaces.getState().setActiveSession(s1);
    useWorkspaces.getState().removeWorkspace(w2);
    expect(useWorkspaces.getState().activeWorkspaceId).toBe("w1");
    expect(useWorkspaces.getState().activeSessionId).toBe(s1);
  });

  it("deleting the active workspace re-points focus to the survivor", () => {
    const s1 = add("in-w1")!;
    const w2 = useWorkspaces.getState().addWorkspace("W2");
    expect(useWorkspaces.getState().activeWorkspaceId).toBe(w2);
    useWorkspaces.getState().removeWorkspace(w2);
    expect(useWorkspaces.getState().activeWorkspaceId).toBe("w1");
    expect(useWorkspaces.getState().activeSessionId).toBe(s1);
  });

  it("deleting the last workspace regenerates a fresh one", () => {
    add();
    useWorkspaces.getState().removeWorkspace("w1");
    const s = useWorkspaces.getState();
    expect(s.workspaces).toHaveLength(1);
    expect(s.workspaces[0].sessionIds).toEqual([]);
    expect(s.activeWorkspaceId).toBe(s.workspaces[0].id);
  });

  it("moving the focused session out re-points focus inside the visible workspace", () => {
    const s1 = add("stays")!;
    const s2 = add("moves")!;
    const w2 = useWorkspaces.getState().addWorkspace("W2");
    useWorkspaces.getState().setActiveWorkspace("w1");
    useWorkspaces.getState().setActiveSession(s2);
    expect(useWorkspaces.getState().moveSessionToWorkspace(s2, w2)).toBe(true);
    expect(useWorkspaces.getState().activeWorkspaceId).toBe("w1");
    expect(useWorkspaces.getState().activeSessionId).toBe(s1);
  });

  it("hydrate restores the saved active workspace", () => {
    useWorkspaces.getState().hydrate({
      workspaces: [
        { id: "a", name: "A", sessionIds: [] },
        { id: "b", name: "B", sessionIds: [] },
      ],
      sessions: {},
      activeWorkspaceId: "b",
    });
    expect(useWorkspaces.getState().activeWorkspaceId).toBe("b");
  });

  it("hydrate survives corrupt blobs and prunes orphans", () => {
    // Unknown active id falls back to the first workspace.
    useWorkspaces.getState().hydrate({
      workspaces: [{ id: "a", name: "A", sessionIds: [] }],
      sessions: {},
      activeWorkspaceId: "ghost",
    });
    expect(useWorkspaces.getState().activeWorkspaceId).toBe("a");

    // Orphan session (in the map, in no workspace) is dropped; dangling ids skipped;
    // a missing sessionIds array is tolerated.
    useWorkspaces.getState().hydrate({
      workspaces: [
        { id: "a", name: "A", sessionIds: ["s1", "dangling"] },
        { id: "b", name: "B" } as never,
      ],
      sessions: {
        s1: { id: "s1", name: "one", shell: { kind: "cmd" } },
        orphan: { id: "orphan", name: "leak", shell: { kind: "cmd" } },
      },
      activeWorkspaceId: "a",
    });
    const s = useWorkspaces.getState();
    expect(s.workspaces[0].sessionIds).toEqual(["s1"]);
    expect(s.workspaces[1].sessionIds).toEqual([]);
    expect(Object.keys(s.sessions)).toEqual(["s1"]);

    // Fully broken blob resets to a fresh workspace instead of crashing.
    useWorkspaces.getState().hydrate({ workspaces: "junk", sessions: null } as never);
    expect(useWorkspaces.getState().workspaces).toHaveLength(1);
    expect(useWorkspaces.getState().sessions).toEqual({});
  });
});
