import { describe, expect, it } from "vitest";
import { TINTS, isTint, nextTint, tintClasses } from "./tints";
import { useWorkspaces } from "../store/workspaces";

describe("tints", () => {
  it("cycles none through every tint and back to none", () => {
    let t: ReturnType<typeof nextTint> = undefined;
    const seen: (string | undefined)[] = [];
    for (let i = 0; i <= TINTS.length; i++) {
      t = nextTint(t);
      seen.push(t);
    }
    expect(seen).toEqual([...TINTS, undefined]);
  });

  it("maps tints to class pairs", () => {
    expect(tintClasses("red")).toBe(" tinted tint-red");
    expect(tintClasses(undefined)).toBe("");
  });

  it("rejects unknown ids at the persistence boundary", () => {
    expect(isTint("magenta")).toBe(false);
    useWorkspaces.getState().hydrate({
      workspaces: [{ id: "w", name: "W", sessionIds: ["a", "b"] }],
      sessions: {
        a: { id: "a", name: "A", shell: { kind: "cmd" }, tint: "green" },
        b: { id: "b", name: "B", shell: { kind: "cmd" }, tint: "hotdog" },
      } as never,
      activeWorkspaceId: "w",
    });
    expect(useWorkspaces.getState().sessions.a.tint).toBe("green");
    expect(useWorkspaces.getState().sessions.b.tint).toBeUndefined();
  });
});
