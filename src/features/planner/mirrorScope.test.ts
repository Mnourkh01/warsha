import { describe, expect, it } from "vitest";
import {
  mirrorCollisions,
  pathKey,
  resolveMirrorCwd,
  samePath,
  sessionsOffMirror,
} from "./mirrorScope";
import type { Session, Workspace } from "../../store/workspaces";

const shell = { kind: "powershell" } as Session["shell"];

function ws(id: string, name: string, defaultCwd?: string, sessionIds: string[] = []): Workspace {
  return { id, name, sessionIds, defaultCwd };
}

function session(id: string, name: string, cwd?: string): Session {
  return { id, name, shell, cwd };
}

describe("pathKey / samePath", () => {
  it("treats casing, slash direction and trailing separators as the same folder", () => {
    expect(pathKey("C:\\Warsha\\")).toBe(pathKey("c:/warsha"));
    expect(samePath("C:\\Projects\\App", "c:/projects/app/")).toBe(true);
  });

  it("different folders stay different, including subfolders", () => {
    expect(samePath("C:\\warsha", "C:\\warsha\\src")).toBe(false);
    expect(samePath("C:\\a", "C:\\b")).toBe(false);
  });

  it("empty or missing paths never match anything", () => {
    expect(samePath(undefined, "C:\\a")).toBe(false);
    expect(samePath("  ", "  ")).toBe(false);
  });
});

describe("resolveMirrorCwd", () => {
  it("prefers the workspace folder over the global default", () => {
    expect(resolveMirrorCwd({ defaultCwd: "C:\\app" }, "C:\\global")).toBe("C:\\app");
  });

  it("falls back to the global default when the workspace has none", () => {
    expect(resolveMirrorCwd({}, "C:\\global")).toBe("C:\\global");
    expect(resolveMirrorCwd(undefined, "C:\\global")).toBe("C:\\global");
  });

  it("returns undefined when neither is set (blank counts as unset)", () => {
    expect(resolveMirrorCwd({}, undefined)).toBeUndefined();
    expect(resolveMirrorCwd({ defaultCwd: undefined }, "  ")).toBeUndefined();
  });
});

describe("mirrorCollisions", () => {
  const hasAll = () => true;

  it("reports another workspace mirroring to the same folder", () => {
    const workspaces = [ws("a", "App", "C:\\proj"), ws("b", "Docs", "c:/PROJ/")];
    expect(
      mirrorCollisions({ workspaces, wsId: "a", globalCwd: undefined, hasPlan: hasAll }),
    ).toEqual(["Docs"]);
  });

  it("two workspaces without folders collide on the global default cwd", () => {
    const workspaces = [ws("a", "One"), ws("b", "Two")];
    expect(
      mirrorCollisions({ workspaces, wsId: "a", globalCwd: "C:\\global", hasPlan: hasAll }),
    ).toEqual(["Two"]);
  });

  it("no cwd anywhere means no collision (nothing mirrors)", () => {
    const workspaces = [ws("a", "One"), ws("b", "Two")];
    expect(
      mirrorCollisions({ workspaces, wsId: "a", globalCwd: undefined, hasPlan: hasAll }),
    ).toEqual([]);
  });

  it("skips workspaces whose plan is still empty (they never write the mirror)", () => {
    const workspaces = [ws("a", "App", "C:\\proj"), ws("b", "Docs", "C:\\proj")];
    expect(
      mirrorCollisions({
        workspaces,
        wsId: "a",
        globalCwd: undefined,
        hasPlan: (id) => id === "a",
      }),
    ).toEqual([]);
  });

  it("different folders never collide", () => {
    const workspaces = [ws("a", "App", "C:\\one"), ws("b", "Docs", "C:\\two")];
    expect(
      mirrorCollisions({ workspaces, wsId: "a", globalCwd: undefined, hasPlan: hasAll }),
    ).toEqual([]);
  });
});

describe("sessionsOffMirror", () => {
  it("flags sessions with an explicit cwd outside the mirror folder", () => {
    const w = ws("a", "App", "C:\\proj", ["s1", "s2", "s3"]);
    const sessions = {
      s1: session("s1", "Dev", "C:\\proj"),
      s2: session("s2", "Other", "C:\\elsewhere"),
      s3: session("s3", "Sub", "C:\\proj\\packages\\api"),
    };
    expect(sessionsOffMirror(w, sessions, "C:\\proj")).toEqual(["Other", "Sub"]);
  });

  it("sessions without an explicit cwd are trusted to start in the workspace folder", () => {
    const w = ws("a", "App", "C:\\proj", ["s1"]);
    const sessions = { s1: session("s1", "Dev") };
    expect(sessionsOffMirror(w, sessions, "C:\\proj")).toEqual([]);
  });

  it("no mirror folder means nothing to compare against", () => {
    const w = ws("a", "App", undefined, ["s1"]);
    const sessions = { s1: session("s1", "Dev", "C:\\anywhere") };
    expect(sessionsOffMirror(w, sessions, undefined)).toEqual([]);
  });
});
