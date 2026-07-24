import { beforeEach, describe, expect, it } from "vitest";
import { useTemplates } from "./templates";
import { useWorkspaces } from "./workspaces";
import { openTemplate } from "../actions";

const resetAll = () => {
  useTemplates.getState().hydrate({ templates: [] });
  useWorkspaces.getState().hydrate({
    workspaces: [{ id: "w1", name: "warsha", sessionIds: [], defaultCwd: "C:\\warsha" }],
    sessions: {},
    activeWorkspaceId: "w1",
  });
};

const addSession = (name: string) =>
  useWorkspaces.getState().addSession(
    { name, shell: { kind: "powershell" }, cwd: "C:\\warsha", typeId: "claude" },
    "w1",
  );

describe("templates store", () => {
  beforeEach(resetAll);

  it("snapshots a workspace's sessions and folder", () => {
    addSession("Claude Code");
    addSession("PowerShell");
    const id = useTemplates.getState().saveFromWorkspace("w1");
    expect(id).toBeTruthy();
    const tpl = useTemplates.getState().templates[0];
    expect(tpl.name).toBe("warsha");
    expect(tpl.defaultCwd).toBe("C:\\warsha");
    expect(tpl.sessions.map((s) => s.name)).toEqual(["Claude Code", "PowerShell"]);
  });

  it("refuses to save an empty workspace", () => {
    expect(useTemplates.getState().saveFromWorkspace("w1")).toBeNull();
    expect(useTemplates.getState().templates).toHaveLength(0);
  });

  it("re-saving under the same name replaces the old recipe", () => {
    addSession("A");
    useTemplates.getState().saveFromWorkspace("w1");
    addSession("B");
    useTemplates.getState().saveFromWorkspace("w1");
    const list = useTemplates.getState().templates;
    expect(list).toHaveLength(1);
    expect(list[0].sessions.map((s) => s.name)).toEqual(["A", "B"]);
  });

  it("openTemplate creates a new workspace with all sessions and the folder", () => {
    addSession("Claude Code");
    addSession("Bash");
    const tplId = useTemplates.getState().saveFromWorkspace("w1")!;
    const wsId = openTemplate(tplId);
    expect(wsId).toBeTruthy();
    const st = useWorkspaces.getState();
    const ws = st.workspaces.find((w) => w.id === wsId)!;
    expect(ws.name).toBe("warsha");
    expect(ws.defaultCwd).toBe("C:\\warsha");
    expect(ws.sessionIds).toHaveLength(2);
    expect(ws.sessionIds.map((sid) => st.sessions[sid].name)).toEqual(["Claude Code", "Bash"]);
    // Fresh ids: the template never points at the original live sessions.
    expect(ws.sessionIds.some((sid) => st.workspaces[0].sessionIds.includes(sid))).toBe(false);
  });

  it("hydrate drops malformed templates and sessions", () => {
    useTemplates.getState().hydrate({
      templates: [
        { id: "ok", name: "Good", sessions: [{ name: "S", shell: { kind: "cmd" } }] },
        { id: "empty", name: "NoSessions", sessions: [] },
        { id: "bad", name: "BadShell", sessions: [{ name: "S", shell: { kind: "rocket" } }] },
        "junk",
      ],
    });
    const list = useTemplates.getState().templates;
    expect(list.map((t) => t.id)).toEqual(["ok"]);
  });
});
