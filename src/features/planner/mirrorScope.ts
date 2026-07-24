import type { Session, Workspace } from "../../store/workspaces";

/** Where a workspace's plan mirrors on disk, and who else touches that folder.
 *  Pure functions so the collision rules are unit-testable without the stores. */

/** Case- and separator-insensitive key for comparing Windows paths: casing, slash
 *  direction, and a trailing separator never make two folders "different". */
export function pathKey(p: string): string {
  return p
    .trim()
    .replace(/[\\/]+/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function samePath(a: string | undefined, b: string | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  return pathKey(a) === pathKey(b);
}

/** The folder this workspace's plan mirrors to (.warsha/plan.md lives under it).
 *  A workspace without its own folder falls back to the global default cwd. */
export function resolveMirrorCwd(
  ws: Pick<Workspace, "defaultCwd"> | undefined,
  globalCwd: string | undefined,
): string | undefined {
  const own = ws?.defaultCwd?.trim();
  if (own) return ws?.defaultCwd;
  const global = globalCwd?.trim();
  return global ? globalCwd : undefined;
}

/** Names of OTHER workspaces whose plans mirror to the same folder as `wsId`'s.
 *  Two plans in one folder overwrite each other's .warsha/plan.md, so this is a
 *  misconfiguration the user must see. Workspaces whose plan is still empty are
 *  skipped: an empty plan never writes the mirror, so there is no fight yet. */
export function mirrorCollisions(opts: {
  workspaces: Workspace[];
  wsId: string;
  globalCwd: string | undefined;
  /** True when that workspace has a plan with at least one block. */
  hasPlan: (wsId: string) => boolean;
}): string[] {
  const { workspaces, wsId, globalCwd, hasPlan } = opts;
  const self = workspaces.find((w) => w.id === wsId);
  const cwd = resolveMirrorCwd(self, globalCwd);
  if (!cwd) return [];
  const key = pathKey(cwd);
  return workspaces
    .filter((w) => w.id !== wsId && hasPlan(w.id))
    .filter((w) => {
      const other = resolveMirrorCwd(w, globalCwd);
      return !!other && pathKey(other) === key;
    })
    .map((w) => w.name);
}

/** Names of this workspace's sessions that run in a different folder than the plan
 *  mirror: an AI CLI started there looks for .warsha in its own cwd and never sees
 *  this plan. Sessions without an explicit cwd are skipped (they start in the
 *  workspace folder). */
export function sessionsOffMirror(
  ws: Workspace | undefined,
  sessions: Record<string, Session>,
  mirrorCwd: string | undefined,
): string[] {
  if (!ws || !mirrorCwd?.trim()) return [];
  return ws.sessionIds
    .map((id) => sessions[id])
    .filter((s): s is Session => !!s?.cwd && !samePath(s.cwd, mirrorCwd))
    .map((s) => s.name);
}
