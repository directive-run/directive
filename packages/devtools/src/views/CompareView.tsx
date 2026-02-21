import { useEffect, useMemo, useState } from "react";
import type { SavedRun } from "../hooks/use-run-sessions";
import { EVENT_COLORS } from "../lib/colors";
import { extractAgentStats, computeEventTypeBreakdown, type AgentStats } from "../lib/compare-utils";
import type { DebugEventType } from "../lib/types";

interface CompareViewProps {
  runs: SavedRun[];
  onDeleteRun: (id: string) => void;
  onExportRun: (id: string) => void;
}

export function CompareView({ runs, onDeleteRun, onExportRun }: CompareViewProps) {
  const [leftId, setLeftId] = useState<string | null>(runs[0]?.id ?? null);
  const [rightId, setRightId] = useState<string | null>(runs[1]?.id ?? null);

  // M2: Clear stale selections when referenced run is deleted
  const runIds = useMemo(() => new Set(runs.map((r) => r.id)), [runs]);
  useEffect(() => {
    if (leftId && !runIds.has(leftId)) {
      setLeftId(null);
    }
    if (rightId && !runIds.has(rightId)) {
      setRightId(null);
    }
  }, [runIds, leftId, rightId]);

  const leftRun = useMemo(() => runs.find((r) => r.id === leftId) ?? null, [runs, leftId]);
  const rightRun = useMemo(() => runs.find((r) => r.id === rightId) ?? null, [runs, rightId]);

  // E11: Rich comparison data
  const leftStats = useMemo(() => leftRun ? extractAgentStats(leftRun.events) : [], [leftRun]);
  const rightStats = useMemo(() => rightRun ? extractAgentStats(rightRun.events) : [], [rightRun]);
  const eventTypeBreakdown = useMemo(
    () => leftRun && rightRun ? computeEventTypeBreakdown(leftRun.events, rightRun.events) : [],
    [leftRun, rightRun],
  );

  if (runs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <div className="text-center">
          <div className="mb-2 text-4xl" aria-hidden="true">🔀</div>
          <p>No saved runs to compare</p>
          <p className="mt-1 text-xs">Save a run from the Session panel to enable comparison</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      {/* Selector bar */}
      <div className="flex items-center gap-4 border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Left:</span>
          <select
            value={leftId ?? ""}
            onChange={(e) => setLeftId(e.target.value || null)}
            aria-label="Left run"
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
          >
            <option value="">Select run...</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.isAutoSave ? " (auto)" : ""}
              </option>
            ))}
          </select>
        </div>

        <span className="text-zinc-600">vs</span>

        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Right:</span>
          <select
            value={rightId ?? ""}
            onChange={(e) => setRightId(e.target.value || null)}
            aria-label="Right run"
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
          >
            <option value="">Select run...</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.isAutoSave ? " (auto)" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Saved runs management */}
        <div className="ml-auto text-xs text-zinc-500">
          {runs.length} saved run{runs.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Comparison */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="flex-1 border-r border-zinc-800 overflow-auto">
          {leftRun ? (
            <RunSummary run={leftRun} onDelete={onDeleteRun} onExport={onExportRun} />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-500 text-sm">
              Select a run
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="flex-1 overflow-auto">
          {rightRun ? (
            <RunSummary run={rightRun} onDelete={onDeleteRun} onExport={onExportRun} />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-500 text-sm">
              Select a run
            </div>
          )}
        </div>
      </div>

      {/* Diff summary */}
      {leftRun && rightRun && (
        <div className="border-t border-zinc-800 bg-zinc-900 px-6 py-3">
          <DiffSummary left={leftRun} right={rightRun} />
        </div>
      )}

      {/* E11: Agent-by-Agent comparison table */}
      {leftRun && rightRun && (leftStats.length > 0 || rightStats.length > 0) && (
        <div className="border-t border-zinc-800 px-6 py-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Agent Comparison</h3>
          <AgentComparisonTable leftStats={leftStats} rightStats={rightStats} />
        </div>
      )}

      {/* E11: Event type breakdown */}
      {leftRun && rightRun && eventTypeBreakdown.length > 0 && (
        <div className="border-t border-zinc-800 px-6 py-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Event Type Breakdown</h3>
          <EventTypeBreakdownChart breakdown={eventTypeBreakdown} />
        </div>
      )}
    </div>
  );
}

/** E11: Agent-by-agent comparison table */
function AgentComparisonTable({ leftStats, rightStats }: { leftStats: AgentStats[]; rightStats: AgentStats[] }) {
  // Merge agents from both sides
  const allAgents = useMemo(() => {
    const agents = new Map<string, { left?: AgentStats; right?: AgentStats }>();
    for (const s of leftStats) {
      agents.set(s.agentId, { left: s });
    }
    for (const s of rightStats) {
      const existing = agents.get(s.agentId) ?? {};
      agents.set(s.agentId, { ...existing, right: s });
    }

    return Array.from(agents).sort((a, b) => a[0].localeCompare(b[0]));
  }, [leftStats, rightStats]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-zinc-500">
            <th className="pb-2 text-left font-medium">Agent</th>
            <th className="pb-2 text-right font-medium">Tokens (A)</th>
            <th className="pb-2 text-right font-medium">Tokens (B)</th>
            <th className="pb-2 text-right font-medium">Delta</th>
            <th className="pb-2 text-right font-medium">Duration (A)</th>
            <th className="pb-2 text-right font-medium">Duration (B)</th>
            <th className="pb-2 text-right font-medium">Delta</th>
          </tr>
        </thead>
        <tbody>
          {allAgents.map(([agentId, { left, right }]) => {
            const tokenDelta = (right?.totalTokens ?? 0) - (left?.totalTokens ?? 0);
            const durationDelta = (right?.totalDurationMs ?? 0) - (left?.totalDurationMs ?? 0);

            return (
              <tr key={agentId} className="border-t border-zinc-800/50">
                <td className="py-1.5 font-mono text-zinc-200">{agentId}</td>
                <td className="py-1.5 text-right text-zinc-300">{(left?.totalTokens ?? 0).toLocaleString()}</td>
                <td className="py-1.5 text-right text-zinc-300">{(right?.totalTokens ?? 0).toLocaleString()}</td>
                <td className={`py-1.5 text-right font-medium ${tokenDelta > 0 ? "text-red-400" : tokenDelta < 0 ? "text-emerald-400" : "text-zinc-500"}`}>
                  {tokenDelta > 0 ? "+" : ""}{tokenDelta.toLocaleString()}
                </td>
                <td className="py-1.5 text-right text-zinc-300">{Math.round(left?.totalDurationMs ?? 0)}ms</td>
                <td className="py-1.5 text-right text-zinc-300">{Math.round(right?.totalDurationMs ?? 0)}ms</td>
                <td className={`py-1.5 text-right font-medium ${durationDelta > 0 ? "text-red-400" : durationDelta < 0 ? "text-emerald-400" : "text-zinc-500"}`}>
                  {durationDelta > 0 ? "+" : ""}{Math.round(durationDelta)}ms
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** E11: Event type breakdown stacked bars */
function EventTypeBreakdownChart({ breakdown }: { breakdown: { type: DebugEventType; countA: number; countB: number }[] }) {
  const maxCount = Math.max(1, ...breakdown.map((b) => Math.max(b.countA, b.countB)));

  return (
    <div className="space-y-2">
      {breakdown.slice(0, 15).map(({ type, countA, countB }) => (
        <div key={type} className="text-xs">
          <div className="mb-0.5 flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-sm shrink-0"
              style={{ backgroundColor: EVENT_COLORS[type] ?? "#666" }}
            />
            <span className="text-zinc-400">{type.replace(/_/g, " ")}</span>
            <span className="ml-auto text-zinc-500">{countA} / {countB}</span>
          </div>
          <div className="flex gap-1">
            <div className="h-2 rounded" style={{
              width: `${(countA / maxCount) * 100}%`,
              minWidth: countA > 0 ? "2px" : "0",
              backgroundColor: `${EVENT_COLORS[type] ?? "#666"}80`,
            }} />
            <div className="h-2 rounded" style={{
              width: `${(countB / maxCount) * 100}%`,
              minWidth: countB > 0 ? "2px" : "0",
              backgroundColor: EVENT_COLORS[type] ?? "#666",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RunSummary({ run, onDelete, onExport }: { run: SavedRun; onDelete: (id: string) => void; onExport: (id: string) => void }) {
  const eventTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of run.events) {
      counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    }

    return Array.from(counts).sort((a, b) => b[1] - a[1]);
  }, [run.events]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-200">{run.name}</h3>
          {run.isAutoSave && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">auto</span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onExport(run.id)}
            className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            Export
          </button>
          <button
            onClick={() => { if (window.confirm("Delete this saved run?")) { onDelete(run.id); } }}
            className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-1 text-[10px] text-zinc-500">
        Saved {new Date(run.savedAt).toLocaleString()}
      </div>

      {/* Stats */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="Events" value={run.metadata.eventCount.toLocaleString()} />
        <Stat label="Tokens" value={run.metadata.totalTokens.toLocaleString()} />
        <Stat label="Duration" value={`${Math.round(run.metadata.durationMs)}ms`} />
        <Stat label="Agents" value={run.metadata.agentCount.toString()} />
      </div>

      {/* Event type breakdown */}
      <div className="mt-4">
        <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Event Types</h4>
        <div className="space-y-1">
          {eventTypeCounts.slice(0, 10).map(([type, count]) => (
            <div key={type} className="flex items-center gap-2 text-xs">
              <span
                className="h-2 w-2 rounded-sm shrink-0"
                style={{ backgroundColor: EVENT_COLORS[type as keyof typeof EVENT_COLORS] ?? "#666" }}
              />
              <span className="text-zinc-400">{type.replace(/_/g, " ")}</span>
              <span className="ml-auto text-zinc-500">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Mini timeline bar */}
      <div className="mt-4">
        <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Timeline</h4>
        <div className="relative h-6 rounded bg-zinc-800" aria-hidden="true">
          {run.events.length > 0 && (() => {
            const start = run.events[0]!.timestamp;
            const end = run.events[run.events.length - 1]!.timestamp;
            const duration = Math.max(end - start, 1);

            return run.events.slice(0, 200).map((e) => (
              <div
                key={e.id}
                className="absolute top-0.5 h-5"
                style={{
                  left: `${((e.timestamp - start) / duration) * 100}%`,
                  width: "2px",
                  backgroundColor: EVENT_COLORS[e.type] ?? "#666",
                  opacity: 0.7,
                }}
              />
            ));
          })()}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-sm font-semibold text-zinc-200">{value}</div>
    </div>
  );
}

function DiffSummary({ left, right }: { left: SavedRun; right: SavedRun }) {
  const tokenDiff = right.metadata.totalTokens - left.metadata.totalTokens;
  const durationDiff = right.metadata.durationMs - left.metadata.durationMs;
  const eventDiff = right.metadata.eventCount - left.metadata.eventCount;

  const formatDiff = (value: number, suffix: string) => {
    const sign = value > 0 ? "+" : "";
    const color = value > 0 ? "text-red-400" : value < 0 ? "text-emerald-400" : "text-zinc-500";

    return <span className={color}>{sign}{Math.round(value).toLocaleString()}{suffix}</span>;
  };

  return (
    <div className="flex items-center gap-6 text-xs">
      <span className="text-zinc-500">Diff:</span>
      <div>
        <span className="text-zinc-500">Tokens: </span>
        {formatDiff(tokenDiff, "")}
      </div>
      <div>
        <span className="text-zinc-500">Duration: </span>
        {formatDiff(durationDiff, "ms")}
      </div>
      <div>
        <span className="text-zinc-500">Events: </span>
        {formatDiff(eventDiff, "")}
      </div>
    </div>
  );
}
