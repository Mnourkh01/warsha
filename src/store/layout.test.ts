import { beforeEach, describe, expect, it } from "vitest";
import { MAX_PANES, useLayout } from "./layout";

const reset = () =>
  useLayout.getState().hydrate({ panes: [{ id: "seed", sessionId: null }], activePaneId: "seed" });

describe("layout store (grid)", () => {
  beforeEach(reset);

  it("assigns a session to the active pane", () => {
    useLayout.getState().assignSession("seed", "s1");
    expect(useLayout.getState().paneIdWithSession("s1")).toBe("seed");
  });

  it("adds panes up to the max, then refuses", () => {
    const l = useLayout.getState();
    for (let i = 0; i < MAX_PANES - 1; i++) expect(l.addPane()).toBeTruthy();
    expect(useLayout.getState().panes.length).toBe(MAX_PANES);
    expect(useLayout.getState().addPane()).toBeNull(); // full
  });

  it("keeps a session in only one pane", () => {
    const l = useLayout.getState();
    l.assignSession("seed", "s1");
    const p2 = l.addPane()!;
    l.assignSession(p2, "s1");
    expect(useLayout.getState().paneIdWithSession("s1")).toBe(p2);
  });

  it("closes a pane and returns its session; never leaves zero panes", () => {
    const l = useLayout.getState();
    const p2 = l.addPane()!;
    l.assignSession(p2, "s2");
    expect(l.closePane(p2)).toBe("s2");
    expect(useLayout.getState().panes.length).toBe(1);
    l.closePane(useLayout.getState().panes[0].id);
    expect(useLayout.getState().panes.length).toBe(1); // reseeded
  });

  it("finds the first empty pane, preferring the active one", () => {
    const l = useLayout.getState();
    l.assignSession("seed", "s1");
    const p2 = l.addPane()!;
    expect(useLayout.getState().firstEmptyPaneId()).toBe(p2);
  });
});
