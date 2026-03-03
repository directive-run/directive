import React, { useCallback, useEffect, useState } from "react";
import { useDevToolsConnection } from "./hooks/use-devtools-connection";
import { useReplay } from "./hooks/use-replay";

import { useAnomalies } from "./hooks/use-anomalies";
import { TimelineView } from "./views/TimelineView";
import { DagView } from "./views/DagView";

import { BreakpointView } from "./views/BreakpointView";
import { StateView } from "./views/StateView";
import { CostView } from "./views/CostView";
import { SessionPanel } from "./components/SessionPanel";
import { ReplayControls } from "./components/ReplayControls";
import { TimeTravelEditor } from "./components/TimeTravelEditor";
import type { ConnectionStatus, DevToolsSnapshot } from "./lib/types";
import type { TimeFormat } from "./lib/time-format";

type View = "timeline" | "dag" | "breakpoints" | "state" | "cost";

const NAV_ITEMS: { id: View; label: string; icon: string }[] = [
  { id: "timeline", label: "Timeline", icon: "⏱" },
  { id: "dag", label: "DAG", icon: "⬡" },
  { id: "cost", label: "Cost", icon: "💰" },
  { id: "breakpoints", label: "Breakpoints", icon: "⏸" },
  { id: "state", label: "State", icon: "📋" },
];

const STATUS_DOT_COLORS: Record<ConnectionStatus, string> = {
  connected: "bg-emerald-400",
  connecting: "bg-amber-400 motion-safe:animate-pulse",
  disconnected: "bg-zinc-500",
  error: "bg-red-400",
};

function StatusDot({ status }: { status: ConnectionStatus }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT_COLORS[status]}`} role="status" aria-label={`Connection ${status}`} />;
}

class ViewErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  // D6: Log view crashes for debugging
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[DevTools] View crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center text-zinc-500" role="alert">
          <div className="text-center">
            <div className="mb-2 text-4xl" aria-hidden="true">⚠</div>
            <p className="text-red-400">View crashed</p>
            <p className="mt-1 text-xs text-zinc-400">{this.state.error.message}</p>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              autoFocus
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function App() {
  const [view, setView] = useState<View>("timeline");
  const [wsUrl, setWsUrl] = useState("ws://localhost:4040");
  const [authToken, setAuthToken] = useState(() => {
    try {
      return localStorage.getItem("directive-devtools-auth-token") ?? "";
    } catch {
      return "";
    }
  });
  const conn = useDevToolsConnection();
  const replay = useReplay(conn.events);
  // E7: Time format state — D13: persist to localStorage
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(() => {
    try {
      const saved = localStorage.getItem("directive-devtools-time-format");
      if (saved === "clock" || saved === "elapsed" || saved === "ms") {
        return saved as TimeFormat;
      }
    } catch {
      // Ignore storage errors
    }

    return "elapsed" as TimeFormat;
  });

  // D13: Persist time format changes to localStorage
  const handleTimeFormatChange = useCallback((fmt: TimeFormat) => {
    setTimeFormat(fmt);
    try {
      localStorage.setItem("directive-devtools-time-format", fmt);
    } catch {
      // Ignore storage errors
    }
  }, []);

  // I2: Time-travel editor state
  const [editingSnapshot, setEditingSnapshot] = useState<DevToolsSnapshot | null>(null);

  // Events visible to downstream views (replay-filtered or live)
  const visibleEvents = replay.visibleEvents;

  // Anomaly detection runs against full events (not replay-filtered)
  // to avoid recomputing on every rAF frame during replay playback
  const anomalyResult = useAnomalies(conn.events);

  // Auto-connect on mount
  useEffect(() => {
    conn.connect(wsUrl, authToken || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Request initial data on connection
  useEffect(() => {
    if (conn.status === "connected") {
      conn.requestEvents();
      conn.requestBreakpoints();
      conn.requestSnapshot();
      conn.requestScratchpad();
      conn.requestDerived();
    }
  }, [conn.status, conn.requestEvents, conn.requestBreakpoints, conn.requestSnapshot, conn.requestScratchpad, conn.requestDerived]);

  const handleConnect = useCallback(() => {
    // Persist token to localStorage
    try {
      if (authToken) {
        localStorage.setItem("directive-devtools-auth-token", authToken);
      } else {
        localStorage.removeItem("directive-devtools-auth-token");
      }
    } catch {
      // Ignore storage errors
    }
    conn.disconnect();
    conn.connect(wsUrl, authToken || undefined);
  }, [conn.disconnect, conn.connect, wsUrl, authToken]);

  // E9: Replay from event handler
  const handleReplayFromEvent = useCallback((eventId: number) => {
    const index = conn.events.findIndex((e) => e.id === eventId);
    if (index !== -1) {
      replay.replayFromIndex(index);
    }
  }, [conn.events, replay.replayFromIndex]);

  // I2: Time-travel editor handlers
  const handleEditSnapshot = useCallback(() => {
    setEditingSnapshot(conn.snapshot);
  }, [conn.snapshot]);

  const handleForkFromEditor = useCallback((snapshot: DevToolsSnapshot) => {
    // Send modified snapshot to server via fork mechanism
    conn.send({ type: "fork_from_snapshot", eventId: snapshot.eventCount });
    setEditingSnapshot(null);
  }, [conn.send]);

  const handleCloseEditor = useCallback(() => {
    setEditingSnapshot(null);
  }, []);

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {/* Sidebar */}
      <nav className="flex w-56 flex-col border-r border-zinc-800 bg-zinc-900">
        {/* Header */}
        <div className="border-b border-zinc-800 px-4 py-3">
          <h1 className="text-sm font-semibold tracking-wide text-zinc-300">
            Directive DevTools
          </h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
            <StatusDot status={conn.status} />
            <span>{conn.status}</span>
            {conn.sessionId && (
              <span className="truncate text-zinc-500">
                {conn.sessionId.slice(0, 16)}
              </span>
            )}
          </div>
        </div>

        {/* Connection */}
        <div className="border-b border-zinc-800 px-4 py-3">
          <label htmlFor="ws-url-input" className="mb-1 block text-xs text-zinc-500">Server URL</label>
          <div className="flex gap-1">
            <input
              id="ws-url-input"
              type="text"
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/50"
              placeholder="ws://localhost:4040"
            />
            <button
              onClick={handleConnect}
              aria-label={conn.status === "connected" ? "Reconnect" : "Connect"}
              className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500"
            >
              {conn.status === "connected" ? "↻" : "⚡"}
            </button>
          </div>
          <label htmlFor="auth-token-input" className="mb-1 mt-2 block text-xs text-zinc-500">Auth Token (optional)</label>
          <div className="flex gap-1">
            <input
              id="auth-token-input"
              type="password"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/50"
              placeholder="Token for remote servers"
            />
            {authToken && (
              <button
                onClick={() => {
                  setAuthToken("");
                  try { localStorage.removeItem("directive-devtools-auth-token"); } catch { /* ignore */ }
                }}
                aria-label="Clear auth token"
                className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-600 hover:text-zinc-200"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Nav items */}
        <div className="flex-1 py-2" role="navigation" aria-label="DevTools views">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              aria-current={view === item.id ? "page" : undefined}
              className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors ${
                view === item.id
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <span className="text-base" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === "breakpoints" && conn.breakpointState.pending.length > 0 && (
                <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-xs font-medium text-black">
                  {conn.breakpointState.pending.length}
                </span>
              )}
              {item.id === "state" && (Object.keys(conn.scratchpadState).length + Object.keys(conn.derivedState).length) > 0 && (
                <span className="ml-auto rounded-full bg-fuchsia-500/30 px-1.5 text-[10px] text-fuchsia-400">
                  {Object.keys(conn.scratchpadState).length + Object.keys(conn.derivedState).length}
                </span>
              )}
              {item.id === "timeline" && anomalyResult.severityCounts.critical > 0 && (
                <span
                  className="ml-auto rounded-full bg-red-500 px-1.5 text-[10px] font-medium text-white"
                  title={`${anomalyResult.severityCounts.critical} critical anomal${anomalyResult.severityCounts.critical === 1 ? "y" : "ies"} detected`}
                >
                  {anomalyResult.severityCounts.critical}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Session management */}
        <SessionPanel
          events={conn.events}
          onImport={conn.importSession}
          onClear={conn.clearEvents}
        />

        {/* Stats footer */}
        <div className="overflow-y-auto border-t border-zinc-800 px-4 py-3 text-xs text-zinc-500" style={{ maxHeight: "120px" }} aria-live="polite">
          <div>Events: {replay.state.active ? `${visibleEvents.length}/${conn.events.length}` : conn.events.length}</div>
          <div>Agents: {new Set(conn.events.filter((e) => e.agentId).map((e) => e.agentId)).size}</div>
          {replay.state.active && (
            <div className="text-blue-400">Replay: {replay.state.cursorIndex + 1}/{conn.events.length}</div>
          )}
          {/* E12: Pause indicator */}
          {conn.isPaused && (
            <div className="text-amber-400">Paused ({conn.pendingCount} pending)</div>
          )}
          {anomalyResult.anomalies.length > 0 && (
            <div className="text-amber-400">
              Anomalies: {anomalyResult.severityCounts.critical > 0 && <span className="text-red-400">{anomalyResult.severityCounts.critical} critical</span>}
              {anomalyResult.severityCounts.critical > 0 && anomalyResult.severityCounts.warning > 0 && ", "}
              {anomalyResult.severityCounts.warning > 0 && `${anomalyResult.severityCounts.warning} warn`}
            </div>
          )}
          {conn.error && (
            <div className="mt-1 text-red-400">{conn.error.length > 200 ? `${conn.error.slice(0, 200)}...` : conn.error}</div>
          )}
        </div>
      </nav>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Replay controls bar (when on timeline view) */}
        {view === "timeline" && conn.status === "connected" && (
          <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/50 px-4 py-1.5">
            <ReplayControls replay={replay} totalEvents={conn.events.length} />
          </div>
        )}

        {conn.status !== "connected" ? (
          <div className="flex h-full items-center justify-center text-zinc-500" role={conn.status === "error" ? "alert" : undefined}>
            <div className="text-center">
              {conn.status === "error" ? (
                <>
                  <div className="mb-2 text-4xl" aria-hidden="true">⚠</div>
                  <p className="text-red-400">Connection failed</p>
                  {conn.error && <p className="mt-1 text-xs text-red-400/70">{conn.error}</p>}
                  <div className="mt-3 rounded border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-left text-xs text-zinc-400">
                    <p className="mb-1 font-medium text-zinc-300">Troubleshooting:</p>
                    <ul className="list-inside list-disc space-y-0.5">
                      <li>Is the orchestrator running?</li>
                      <li>Check the port matches (current: <code className="text-zinc-300">{wsUrl}</code>)</li>
                      <li>Ensure <code className="text-zinc-300">connectDevTools()</code> is called before agent runs</li>
                    </ul>
                  </div>
                  <button
                    onClick={handleConnect}
                    className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                  >
                    Retry
                  </button>
                </>
              ) : conn.status === "connecting" ? (
                <>
                  <div className="mb-2 text-4xl motion-safe:animate-pulse" aria-hidden="true">⏳</div>
                  <p>Connecting to {wsUrl}...</p>
                  <p className="mt-1 text-xs">Attempting to establish connection</p>
                </>
              ) : (
                <>
                  <div className="mb-2 text-4xl" aria-hidden="true">⏳</div>
                  <p>Not connected</p>
                  <p className="mt-1 text-xs">
                    Start your orchestrator with{" "}
                    <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300">
                      await connectDevTools(orchestrator, {"{ port: 4040 }"})
                    </code>
                  </p>
                  <p className="mt-2 text-[10px] text-zinc-500">
                    Default port is 4040. Change the Server URL in the sidebar if needed.
                  </p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* I2: Time-travel editor panel */}
            {editingSnapshot ? (
              <div className="w-full">
                <TimeTravelEditor
                  snapshot={editingSnapshot}
                  onFork={handleForkFromEditor}
                  onClose={handleCloseEditor}
                />
              </div>
            ) : (
              <ViewErrorBoundary key={view}>
                {view === "timeline" && (
                  <TimelineView
                    events={visibleEvents}
                    replayCursor={replay.state.cursorTimestamp}
                    onForkFromSnapshot={conn.forkFromSnapshot}
                    streamingTokens={conn.streamingTokens}
                    anomalies={anomalyResult.anomalies}
                    timeFormat={timeFormat}
                    onTimeFormatChange={handleTimeFormatChange}
                    isPaused={conn.isPaused}
                    pendingCount={conn.pendingCount}
                    onTogglePause={conn.togglePause}
                    onReplayFromHere={handleReplayFromEvent}
                  />
                )}
                {view === "dag" && <DagView events={visibleEvents} snapshot={conn.snapshot} />}
                {view === "cost" && <CostView events={visibleEvents} />}
                {view === "breakpoints" && (
                  <BreakpointView
                    state={conn.breakpointState}
                    onResume={conn.resumeBreakpoint}
                    onCancel={conn.cancelBreakpoint}
                    onRefresh={conn.requestBreakpoints}
                  />
                )}
                {view === "state" && (
                  <StateView
                    scratchpadState={conn.scratchpadState}
                    derivedState={conn.derivedState}
                    onRequestScratchpad={conn.requestScratchpad}
                    onRequestDerived={conn.requestDerived}
                    snapshot={conn.snapshot}
                    onEditSnapshot={handleEditSnapshot}
                  />
                )}
              </ViewErrorBoundary>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
