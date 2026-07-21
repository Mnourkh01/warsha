import { beforeEach, describe, expect, it } from "vitest";
import { useTree } from "./tree";
import type { GroupNode, SessionNode } from "../lib/types";

const reset = () => useTree.getState().hydrate({ nodes: {}, rootIds: [] });

describe("tree store", () => {
  beforeEach(reset);

  it("adds a session into a group and tracks parent + children", () => {
    const t = useTree.getState();
    const gid = t.addGroup(null, "Backend");
    const sid = t.addSession(gid, { kind: "powershell" }, "api");

    const group = useTree.getState().nodes[gid] as GroupNode;
    const session = useTree.getState().nodes[sid] as SessionNode;
    expect(group.children).toContain(sid);
    expect(session.parentId).toBe(gid);
    expect(useTree.getState().rootIds).toEqual([gid]);
  });

  it("renames a node", () => {
    const t = useTree.getState();
    const sid = t.addSession(null, { kind: "cmd" }, "old");
    t.rename(sid, "new name");
    expect(useTree.getState().nodes[sid].name).toBe("new name");
  });

  it("moves a session between groups", () => {
    const t = useTree.getState();
    const a = t.addGroup(null, "A");
    const b = t.addGroup(null, "B");
    const sid = t.addSession(a, { kind: "wsl" }, "s");

    t.move(sid, b, 0);
    const ga = useTree.getState().nodes[a] as GroupNode;
    const gb = useTree.getState().nodes[b] as GroupNode;
    expect(ga.children).not.toContain(sid);
    expect(gb.children).toContain(sid);
    expect((useTree.getState().nodes[sid] as SessionNode).parentId).toBe(b);
  });

  it("refuses to move a group into its own descendant (no cycle)", () => {
    const t = useTree.getState();
    const parent = t.addGroup(null, "parent");
    const child = t.addGroup(parent, "child");
    t.move(parent, child, 0);
    // parent must still be at root, not nested under its own child
    expect(useTree.getState().rootIds).toContain(parent);
    expect((useTree.getState().nodes[parent] as GroupNode).parentId).toBe(null);
  });

  it("removes a group and reports the removed session ids", () => {
    const t = useTree.getState();
    const g = t.addGroup(null, "G");
    const s1 = t.addSession(g, { kind: "powershell" }, "s1");
    const s2 = t.addSession(g, { kind: "powershell" }, "s2");

    const removed = t.remove(g);
    expect(removed.sort()).toEqual([s1, s2].sort());
    expect(useTree.getState().nodes[g]).toBeUndefined();
    expect(useTree.getState().nodes[s1]).toBeUndefined();
    expect(useTree.getState().rootIds).not.toContain(g);
  });
});
