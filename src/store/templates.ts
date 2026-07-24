import { create } from "zustand";
import { uid } from "../lib/id";
import {
  MAX_PER_WS,
  sanitizeSessionSpec,
  useWorkspaces,
  type SessionSpec,
} from "./workspaces";

// Workspace templates: a saved recipe (name, project folder, session list) that reopens
// a full working layout in one click. Templates snapshot session DEFINITIONS only -
// never live PTY state - so applying one always spawns fresh shells.

export interface WorkspaceTemplate {
  id: string;
  name: string;
  /** The workspace's project folder at save time. */
  defaultCwd?: string;
  sessions: SessionSpec[];
}

interface TemplatesPersist {
  templates: WorkspaceTemplate[];
}

interface TemplatesState extends TemplatesPersist {
  /** Snapshot a workspace as a template. Re-saving under the same name replaces the old
   *  recipe (predictable, no duplicate rows). Returns the template id, or null for an
   *  empty/unknown workspace (nothing worth saving). */
  saveFromWorkspace: (workspaceId: string) => string | null;
  remove: (id: string) => void;
  hydrate: (data: unknown) => void;
  serialize: () => TemplatesPersist;
}

export const useTemplates = create<TemplatesState>((set, get) => ({
  templates: [],

  saveFromWorkspace: (workspaceId) => {
    const ws = useWorkspaces.getState();
    const w = ws.workspaces.find((x) => x.id === workspaceId);
    if (!w || w.sessionIds.length === 0) return null;
    const sessions: SessionSpec[] = w.sessionIds
      .map((sid) => ws.sessions[sid])
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({ name: s.name, shell: s.shell, cwd: s.cwd, typeId: s.typeId, tint: s.tint }))
      .slice(0, MAX_PER_WS);
    if (sessions.length === 0) return null;
    const tpl: WorkspaceTemplate = {
      id: uid(),
      name: w.name,
      defaultCwd: w.defaultCwd,
      sessions,
    };
    set((s) => ({
      templates: [...s.templates.filter((t) => t.name !== tpl.name), tpl],
    }));
    return tpl.id;
  },

  remove: (id) => set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),

  hydrate: (data) => {
    // Same boundary discipline as the other stores: the blob is untrusted.
    const d = data as Partial<TemplatesPersist> | undefined;
    const list = Array.isArray(d?.templates) ? d.templates : [];
    const templates: WorkspaceTemplate[] = [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Partial<WorkspaceTemplate>;
      if (typeof r.id !== "string" || r.id.length === 0) continue;
      const sessions = (Array.isArray(r.sessions) ? r.sessions : [])
        .map(sanitizeSessionSpec)
        .filter((s): s is SessionSpec => s !== null)
        .slice(0, MAX_PER_WS);
      if (sessions.length === 0) continue; // an empty template opens nothing; drop it
      templates.push({
        id: r.id,
        name: typeof r.name === "string" && r.name.trim() ? r.name : "Template",
        defaultCwd:
          typeof r.defaultCwd === "string" && r.defaultCwd.trim() ? r.defaultCwd : undefined,
        sessions,
      });
    }
    set({ templates });
  },

  serialize: () => ({ templates: get().templates }),
}));
