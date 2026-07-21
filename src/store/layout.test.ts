import { beforeEach, describe, expect, it } from "vitest";
import { useLayout } from "./layout";

// Reset to a single empty leaf between tests.
const reset = () =>
  useLayout.getState().hydrate({
    root: { type: "leaf", id: "seed", sessionId: null },
    activePaneId: "seed",
  });

describe("layout store", () => {
  beforeEach(reset);

  it("assigns a session to the active pane", () => {
    const l = useLayout.getState();
    l.assignSession("seed", "sess-1");
    expect(useLayout.getState().paneIdWithSession("sess-1")).toBe("seed");
  });

  it("splits a pane into two leaves", () => {
    const l = useLayout.getState();
    const newLeaf = l.splitPane("seed", "row");
    expect(newLeaf).toBeTruthy();
    const root = useLayout.getState().root;
    expect(root.type).toBe("split");
    expect(useLayout.getState().activePaneId).toBe(newLeaf);
  });

  it("keeps a session in only one pane", () => {
    const l = useLayout.getState();
    l.assignSession("seed", "sess-1");
    const other = l.splitPane("seed", "row")!;
    l.assignSession(other, "sess-1"); // move the same session to the new pane
    expect(useLayout.getState().paneIdWithSession("sess-1")).toBe(other);
  });

  it("collapses the split back to the sibling when a pane closes", () => {
    const l = useLayout.getState();
    l.assignSession("seed", "keep");
    const other = l.splitPane("seed", "row")!;
    l.assignSession(other, "goes");

    const held = l.closePane(other);
    expect(held).toBe("goes");
    const root = useLayout.getState().root;
    expect(root.type).toBe("leaf");
    expect(useLayout.getState().paneIdWithSession("keep")).toBeTruthy();
  });

  it("never leaves zero panes", () => {
    const l = useLayout.getState();
    l.closePane("seed");
    expect(useLayout.getState().root.type).toBe("leaf");
  });
});
