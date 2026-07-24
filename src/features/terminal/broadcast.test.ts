import { beforeEach, describe, expect, it } from "vitest";
import { inputTargets } from "./broadcast";
import { useUI } from "../../store/ui";
import { useWorkspaces } from "../../store/workspaces";
import { switchWorkspace } from "../../actions";

const seed = () =>
  useWorkspaces.getState().hydrate({
    workspaces: [
      { id: "w1", name: "A", sessionIds: ["s1", "s2", "s3"] },
      { id: "w2", name: "B", sessionIds: ["x1"] },
    ],
    sessions: {
      s1: { id: "s1", name: "1", shell: { kind: "cmd" } },
      s2: { id: "s2", name: "2", shell: { kind: "cmd" } },
      s3: { id: "s3", name: "3", shell: { kind: "cmd" } },
      x1: { id: "x1", name: "x", shell: { kind: "cmd" } },
    },
    activeWorkspaceId: "w1",
  });

describe("broadcast input targets", () => {
  beforeEach(() => {
    seed();
    useUI.getState().setBroadcast(false);
  });

  it("targets only the source while broadcast is off", () => {
    expect(inputTargets("s1")).toEqual(["s1"]);
  });

  it("targets the whole active workspace while broadcast is on", () => {
    useUI.getState().setBroadcast(true);
    expect(inputTargets("s2")).toEqual(["s1", "s2", "s3"]);
  });

  it("never fans out for a session outside the active workspace", () => {
    useUI.getState().setBroadcast(true);
    expect(inputTargets("x1")).toEqual(["x1"]);
  });

  it("switching workspaces turns broadcast off", () => {
    useUI.getState().setBroadcast(true);
    switchWorkspace("w2");
    expect(useUI.getState().broadcast).toBe(false);
    expect(inputTargets("x1")).toEqual(["x1"]);
  });
});
