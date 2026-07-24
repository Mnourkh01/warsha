import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Container,
  Globe,
  Layers,
  ListTree,
  Plug,
  Radar,
  RefreshCw,
  X,
} from "lucide-react";
import { useUI } from "../../store/ui";
import {
  useRadar,
  liveCount,
  ageLabel,
  isOld,
  groupSnapshot,
  type RadarSessionBucket,
} from "../../store/radar";
import { useWorkspaces } from "../../store/workspaces";
import {
  radarDockerStop,
  radarKillProcess,
  type RadarContainer,
  type RadarMcpProc,
  type RadarPortListener,
  type RadarProcEntry,
} from "../../lib/ipc";
import { DialogTrap } from "../../lib/dialog-trap";
import { useStrings } from "../../lib/i18n";

/** How long an armed Stop button waits for the confirming second click. */
const ARM_MS = 3000;

/** Radar: everything the sessions started and what is still running, grouped the
 *  way the app is organized - workspace, then session, then what that session
 *  started (local servers, MCP hosts, processes). Things owned by no session and
 *  docker (machine-wide, containers belong to the daemon) come after. Stopping
 *  anything is a two-click flow (arm, then confirm) instead of a modal. */
export function RadarDialog() {
  const open = useUI((s) => s.radarOpen);
  const setRadar = useUI((s) => s.setRadar);
  const snapshot = useRadar((s) => s.snapshot);
  const refresh = useRadar((s) => s.refresh);
  const sessions = useWorkspaces((s) => s.sessions);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const t = useStrings();
  const boxRef = useRef<HTMLDivElement>(null);
  /** Armed stop target: "pid:1234" or "docker:<id>". One at a time. */
  const [armed, setArmed] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** Folded group keys ("s:<sessionId>", "outside", "docker"). Default: open. */
  const [folded, setFolded] = useState<Record<string, boolean>>({});

  // A forgotten armed button quietly disarms; a misclick must not linger as a
  // one-click kill for the rest of the dialog's life.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  const grouping = useMemo(
    () => (snapshot ? groupSnapshot(snapshot, workspaces) : null),
    [snapshot, workspaces],
  );

  if (!open) return null;

  const toggleFold = (key: string) =>
    setFolded((f) => ({ ...f, [key]: !f[key] }));

  const runStop = async (key: string, action: () => Promise<void>) => {
    if (armed !== key) {
      setArmed(key);
      setFailure(null);
      return;
    }
    setArmed(null);
    setBusyKey(key);
    try {
      await action();
      setFailure(null);
    } catch (e) {
      setFailure(t.radarStopFailed(String(e)));
    } finally {
      setBusyKey(null);
      void refresh();
    }
  };
  const stopProcess = (pid: number) => runStop(`pid:${pid}`, () => radarKillProcess(pid));
  const stopContainer = (c: RadarContainer) =>
    runStop(`docker:${c.id}`, () => radarDockerStop(c.id));

  const stopButton = (key: string, title: string, onClick: () => void) => (
    <button
      className={armed === key ? "radar-stop armed" : "radar-stop"}
      disabled={busyKey === key}
      title={title}
      onClick={onClick}
    >
      {armed === key ? t.radarStopArmed : t.radarStop}
    </button>
  );

  // One clock per render; the poll loop re-renders every few seconds anyway.
  const now = Date.now();
  const ageChip = (startedAt: number) => {
    const label = ageLabel(startedAt, now);
    if (!label) return null;
    return (
      <span
        className={isOld(startedAt, now) ? "radar-age old" : "radar-age"}
        title={t.radarRunningSince(new Date(startedAt * 1000).toLocaleString())}
      >
        {label}
      </span>
    );
  };

  const portRow = (p: RadarPortListener) => (
    <div className="radar-row" key={`${p.port}:${p.pid}`}>
      <span className="radar-port">{t.radarPort(p.port)}</span>
      <span className="radar-name">{p.name}</span>
      {ageChip(p.startedAt)}
      <span className="radar-pid">{t.radarPid(p.pid)}</span>
      {stopButton(`pid:${p.pid}`, t.radarStopTree(p.name), () => void stopProcess(p.pid))}
    </div>
  );
  const mcpRow = (m: RadarMcpProc) => (
    <div className="radar-row" key={m.pid}>
      <span className="radar-name radar-mcp-label">{m.label}</span>
      <span className="radar-cmd" title={m.cmd}>
        {m.cmd}
      </span>
      {ageChip(m.startedAt)}
      <span className="radar-pid">{t.radarPid(m.pid)}</span>
      {stopButton(`pid:${m.pid}`, t.radarStopTree(m.label), () => void stopProcess(m.pid))}
    </div>
  );
  const procRow = (p: RadarProcEntry) => (
    <div className="radar-row" key={p.pid}>
      <span className="radar-name">{p.name}</span>
      <span className="radar-cmd" title={p.cmd}>
        {p.cmd}
      </span>
      {ageChip(p.startedAt)}
      <span className="radar-pid">{t.radarPid(p.pid)}</span>
      {stopButton(`pid:${p.pid}`, t.radarStopTree(p.name), () => void stopProcess(p.pid))}
    </div>
  );

  const subHead = (icon: ReactNode, label: string) => (
    <div className="radar-subhead">
      {icon}
      {label}
    </div>
  );

  const bucketSummary = (b: RadarSessionBucket) => {
    const parts: string[] = [];
    if (b.ports.length > 0) parts.push(t.radarSummaryServers(b.ports.length));
    if (b.mcp.length > 0) parts.push(t.radarSummaryMcp(b.mcp.length));
    if (b.procs.length > 0) parts.push(t.radarSummaryProcs(b.procs.length));
    return parts.join(" · ");
  };

  const sessionBlock = (b: RadarSessionBucket) => {
    const key = `s:${b.sessionId}`;
    const isOpen = !folded[key];
    const name = sessions[b.sessionId]?.name ?? t.radarClosedSession;
    return (
      <div className="radar-session" key={b.sessionId}>
        <button className="radar-fold" aria-expanded={isOpen} onClick={() => toggleFold(key)}>
          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="radar-session-name" dir="auto">
            {name}
          </span>
          <span className="radar-fold-sum">{bucketSummary(b)}</span>
        </button>
        {isOpen && (
          <div className="radar-session-body">
            {b.ports.length > 0 && (
              <>
                {subHead(<Globe size={12} />, t.radarPortsHeader)}
                {b.ports.map(portRow)}
              </>
            )}
            {b.mcp.length > 0 && (
              <>
                {subHead(<Plug size={12} />, t.radarMcpHeader)}
                {b.mcp.map(mcpRow)}
              </>
            )}
            {b.procs.length > 0 && (
              <>
                {subHead(<ListTree size={12} />, t.radarProcsHeader)}
                {b.procs.map(procRow)}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const sessionProcTotal = (snapshot?.sessions ?? []).reduce((n, s) => n + s.procs.length, 0);
  const allQuiet = snapshot !== null && liveCount(snapshot) === 0 && sessionProcTotal === 0;
  const docker = snapshot?.docker;

  const outsideCount =
    (grouping?.loosePorts.length ?? 0) +
    (grouping?.looseMcp.length ?? 0) +
    (grouping?.orphanBuckets.reduce((n, b) => n + b.ports.length + b.mcp.length + b.procs.length, 0) ??
      0);
  const outsideOpen = !folded["outside"];
  const dockerOpen = !folded["docker"];

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setRadar(false);
      }}
    >
      <div
        className="dialog radar-dialog"
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.radarTitle}
      >
        <DialogTrap containerRef={boxRef} />
        <div className="dialog-header">
          <Radar size={15} className="radar-header-icon" />
          {t.radarTitle}
          <span className="radar-sub">{t.radarSubtitle}</span>
          <button
            className="icon-btn sm"
            title={t.radarRefresh}
            aria-label={t.radarRefresh}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} />
          </button>
          <button
            className="icon-btn sm"
            title={t.closeRadar}
            aria-label={t.closeRadar}
            onClick={() => setRadar(false)}
          >
            <X size={15} />
          </button>
        </div>
        <div className="dialog-body radar-body">
          {failure && (
            <div className="radar-error" role="alert">
              {failure}
            </div>
          )}
          {snapshot === null && <div className="radar-hint">{t.radarLoading}</div>}
          {allQuiet && <div className="radar-hint">{t.radarEmpty}</div>}

          {grouping?.groups.map((g) => (
            <section className="radar-section" key={g.id}>
              <div className="radar-section-head">
                <Layers size={14} />
                <span dir="auto">{g.name}</span>
              </div>
              {g.buckets.map(sessionBlock)}
            </section>
          ))}

          {grouping !== null && outsideCount > 0 && (
            <section className="radar-section">
              <button
                className="radar-fold top"
                aria-expanded={outsideOpen}
                onClick={() => toggleFold("outside")}
              >
                {outsideOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <CircleDashed size={14} />
                {t.radarOutsideHeader}
                <span className="radar-fold-sum">{t.radarSummaryItems(outsideCount)}</span>
              </button>
              {outsideOpen && (
                <>
                  {grouping.loosePorts.length > 0 && (
                    <>
                      {subHead(<Globe size={12} />, t.radarPortsHeader)}
                      {grouping.loosePorts.map(portRow)}
                    </>
                  )}
                  {grouping.looseMcp.length > 0 && (
                    <>
                      {subHead(<Plug size={12} />, t.radarMcpHeader)}
                      {grouping.looseMcp.map(mcpRow)}
                    </>
                  )}
                  {grouping.orphanBuckets.map(sessionBlock)}
                </>
              )}
            </section>
          )}

          {docker &&
            docker.status !== "notInstalled" &&
            (docker.status !== "ok" || docker.containers.length > 0) && (
            <section className="radar-section">
              <button
                className="radar-fold top"
                aria-expanded={dockerOpen}
                onClick={() => toggleFold("docker")}
              >
                {dockerOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Container size={14} />
                {t.radarDockerHeader}
                {docker.status === "ok" && (
                  <span className="radar-fold-sum">
                    {t.radarSummaryContainers(docker.containers.length)}
                  </span>
                )}
              </button>
              {dockerOpen && (
                <>
                  {docker.status === "engineOff" && (
                    <div className="radar-hint">{t.radarDockerOff}</div>
                  )}
                  {docker.status === "error" && (
                    <div className="radar-hint">{t.radarDockerError}</div>
                  )}
                  {docker.containers.map((c) => (
                    <div className="radar-row" key={c.id}>
                      <span className="radar-name">{c.name}</span>
                      <span className="radar-cmd" title={`${c.image} ${c.ports}`.trim()}>
                        {c.image}
                        {c.ports ? ` · ${c.ports}` : ""}
                      </span>
                      <span className="radar-origin">{c.status}</span>
                      {stopButton(`docker:${c.id}`, t.radarDockerStop(c.name), () =>
                        void stopContainer(c),
                      )}
                    </div>
                  ))}
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
