import { useCallback, useEffect, useState } from "react";
import { useDevToolsConnection } from "./hooks/use-devtools-connection";
import { TimelineView } from "./views/TimelineView";
import { DagView } from "./views/DagView";
import { HealthView } from "./views/HealthView";
import { BreakpointView } from "./views/BreakpointView";
import { SessionPanel } from "./components/SessionPanel";
import type { ConnectionStatus } from "./lib/types";

type View = "timeline" | "dag" | "health" | "breakpoints";

const NAV_ITEMS: { id: View; label: string; icon: string }[] = [
  { id: "timeline", label: "Timeline", icon: "⏱" },
  { id: "dag", label: "DAG", icon: "⬡" },
  { id: "health", label: "Health", icon: "♥" },
  { id: "breakpoints", label: "Breakpoints", icon: "⏸" },
];

function StatusDot({ status }: { status: ConnectionStatus }) {
  const colors: Record<ConnectionStatus, string> = {
    connected: "bg-emerald-400",
    connecting: "bg-amber-400 animate-pulse",
    disconnected: "bg-zinc-500",
    error: "bg-red-400",
  };

  return <span className={`inline-block h-2 w-2 rounded-full ${colors[status]}`} />;
}

export function App() {
  const [view, setView] = useState<View>("timeline");
  const [wsUrl, setWsUrl] = useState("ws://localhost:4040");
  const conn = useDevToolsConnection();

  // Auto-connect on mount
  useEffect(() => {
    conn.connect(wsUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Request initial data on connection
  useEffect(() => {
    if (conn.status === "connected") {
      conn.requestEvents();
      conn.requestHealth();
      conn.requestBreakpoints();
      conn.requestSnapshot();
    }
  }, [conn.status, conn.requestEvents, conn.requestHealth, conn.requestBreakpoints, conn.requestSnapshot]);

  const handleConnect = useCallback(() => {
    conn.disconnect();
    conn.connect(wsUrl);
  }, [conn, wsUrl]);

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
              <span className="truncate text-zinc-600">
                {conn.sessionId.slice(0, 16)}
              </span>
            )}
          </div>
        </div>

        {/* Connection */}
        <div className="border-b border-zinc-800 px-4 py-3">
          <label className="mb-1 block text-xs text-zinc-500">Server URL</label>
          <div className="flex gap-1">
            <input
              type="text"
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-blue-500"
              placeholder="ws://localhost:4040"
            />
            <button
              onClick={handleConnect}
              className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500"
            >
              {conn.status === "connected" ? "↻" : "⚡"}
            </button>
          </div>
        </div>

        {/* Nav items */}
        <div className="flex-1 py-2">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors ${
                view === item.id
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === "breakpoints" && conn.breakpointState.pending.length > 0 && (
                <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-xs font-medium text-black">
                  {conn.breakpointState.pending.length}
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
        <div className="border-t border-zinc-800 px-4 py-3 text-xs text-zinc-500">
          <div>Events: {conn.events.length}</div>
          <div>Agents: {Object.keys(conn.healthMetrics).length}</div>
          {conn.error && (
            <div className="mt-1 text-red-400">{conn.error}</div>
          )}
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {conn.status !== "connected" ? (
          <div className="flex h-full items-center justify-center text-zinc-500">
            <div className="text-center">
              <div className="mb-2 text-4xl">⏳</div>
              <p>Waiting for connection...</p>
              <p className="mt-1 text-xs">
                Start your orchestrator with{" "}
                <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300">
                  devtools: {"{ port: 4040 }"}
                </code>
              </p>
            </div>
          </div>
        ) : (
          <>
            {view === "timeline" && <TimelineView events={conn.events} />}
            {view === "dag" && <DagView events={conn.events} snapshot={conn.snapshot} />}
            {view === "health" && <HealthView metrics={conn.healthMetrics} events={conn.events} />}
            {view === "breakpoints" && (
              <BreakpointView
                state={conn.breakpointState}
                onResume={conn.resumeBreakpoint}
                onCancel={conn.cancelBreakpoint}
                onRefresh={conn.requestBreakpoints}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
