import { describe, expect, it } from "vitest";
import { ageLabel, groupSnapshot, isOld, liveCount, OLD_AFTER_SECONDS } from "./radar";
import type { RadarSnapshot } from "../lib/ipc";

function snap(over: Partial<RadarSnapshot>): RadarSnapshot {
  return {
    sessions: [],
    ports: [],
    mcp: [],
    docker: { status: "notInstalled", containers: [] },
    ...over,
  };
}

describe("liveCount", () => {
  it("is zero with no snapshot", () => {
    expect(liveCount(null)).toBe(0);
  });

  it("counts ports, mcp hosts and containers but not session procs", () => {
    const s = snap({
      sessions: [
        {
          sessionId: "s1",
          shellPid: 10,
          procs: [{ pid: 20, name: "node.exe", cmd: "node vite", startedAt: 100 }],
        },
      ],
      ports: [
        { port: 5173, pid: 20, name: "node.exe", sessionId: "s1", startedAt: 100 },
        { port: 8000, pid: 60, name: "python.exe", sessionId: null, startedAt: 90 },
      ],
      mcp: [
        {
          pid: 70,
          name: "node.exe",
          label: "firecrawl",
          cmd: "npx firecrawl-mcp",
          sessionId: null,
          startedAt: 80,
        },
      ],
      docker: {
        status: "ok",
        containers: [
          { id: "abc", name: "web", image: "nginx", status: "Up 2 hours", ports: "" },
        ],
      },
    });
    expect(liveCount(s)).toBe(4);
  });
});

describe("groupSnapshot", () => {
  const proc = (pid: number) => ({ pid, name: "node.exe", cmd: "node x", startedAt: 100 });
  const port = (port: number, sessionId: string | null) => ({
    port,
    pid: port,
    name: "node.exe",
    sessionId,
    startedAt: 100,
  });
  const mcp = (pid: number, sessionId: string | null) => ({
    pid,
    name: "node.exe",
    label: "firecrawl",
    cmd: "npx firecrawl-mcp",
    sessionId,
    startedAt: 100,
  });

  it("nests session work under its workspace and keeps loose things apart", () => {
    const s = snap({
      sessions: [
        { sessionId: "s1", shellPid: 10, procs: [proc(20)] },
        { sessionId: "s2", shellPid: 11, procs: [] },
        { sessionId: "gone", shellPid: 12, procs: [proc(30)] },
      ],
      ports: [port(5173, "s1"), port(8000, null)],
      mcp: [mcp(70, "s1"), mcp(80, null)],
    });
    const workspaces = [
      { id: "w1", name: "Work", sessionIds: ["s1", "s2"] },
      { id: "w2", name: "Empty", sessionIds: [] },
    ];
    const g = groupSnapshot(s, workspaces);

    // w1 keeps only the busy session; the quiet one and the empty workspace vanish.
    expect(g.groups.map((x) => x.id)).toEqual(["w1"]);
    expect(g.groups[0].buckets.map((b) => b.sessionId)).toEqual(["s1"]);
    expect(g.groups[0].buckets[0].ports.map((p) => p.port)).toEqual([5173]);
    expect(g.groups[0].buckets[0].mcp.map((m) => m.pid)).toEqual([70]);
    expect(g.groups[0].buckets[0].procs.map((p) => p.pid)).toEqual([20]);

    // Unclaimed live session and unattributed things fall to the outside group.
    expect(g.orphanBuckets.map((b) => b.sessionId)).toEqual(["gone"]);
    expect(g.loosePorts.map((p) => p.port)).toEqual([8000]);
    expect(g.looseMcp.map((m) => m.pid)).toEqual([80]);
  });

  it("is empty all around for an empty snapshot", () => {
    const g = groupSnapshot(snap({}), [{ id: "w1", name: "Work", sessionIds: ["s1"] }]);
    expect(g.groups).toEqual([]);
    expect(g.orphanBuckets).toEqual([]);
    expect(g.loosePorts).toEqual([]);
    expect(g.looseMcp).toEqual([]);
  });

  it("keeps a port whose dead-session id no longer matches a live shell visible", () => {
    // Attribution said "s9" but that session's shell is gone from the snapshot:
    // the listener must not disappear with it.
    const g = groupSnapshot(snap({ ports: [port(3000, "s9")] }), []);
    expect(g.loosePorts.map((p) => p.port)).toEqual([3000]);
  });
});

describe("ageLabel / isOld", () => {
  const nowMs = 1_000_000 * 1000;

  it("formats compact ages and hides unknown or future starts", () => {
    expect(ageLabel(0, nowMs)).toBe("");
    expect(ageLabel(1_000_000 + 100, nowMs)).toBe("");
    expect(ageLabel(1_000_000 - 30, nowMs)).toBe("now");
    expect(ageLabel(1_000_000 - 5 * 60, nowMs)).toBe("5m");
    expect(ageLabel(1_000_000 - 3 * 3600, nowMs)).toBe("3h");
    expect(ageLabel(1_000_000 - 2 * 86400, nowMs)).toBe("2d");
  });

  it("flags only genuinely old processes", () => {
    expect(isOld(0, nowMs)).toBe(false);
    expect(isOld(1_000_000 - 60, nowMs)).toBe(false);
    expect(isOld(1_000_000 - OLD_AFTER_SECONDS, nowMs)).toBe(true);
  });
});
