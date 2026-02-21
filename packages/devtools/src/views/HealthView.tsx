import { useMemo } from "react";
import { isAgentComplete, isReroute, type AgentHealthMetrics, type DebugEvent } from "../lib/types";
import { HealthCard } from "../components/HealthCard";
import { CostChart } from "../components/CostChart";

interface HealthViewProps {
  metrics: Record<string, AgentHealthMetrics>;
  events: DebugEvent[];
  onRequestHealth?: () => void;
}

/** Extract token cost data from events for chart */
function buildCostData(events: DebugEvent[]): { agentId: string; tokens: number; timestamp: number }[] {
  const data: { agentId: string; tokens: number; timestamp: number }[] = [];

  for (const event of events) {
    if (isAgentComplete(event) && event.totalTokens != null) {
      data.push({ agentId: event.agentId, tokens: event.totalTokens, timestamp: event.timestamp });
    }
  }

  return data;
}

/** Extract reroute events */
function extractReroutes(events: DebugEvent[]): { from: string; to: string; timestamp: number; reason: string }[] {
  const reroutes: { from: string; to: string; timestamp: number; reason: string }[] = [];

  for (const event of events) {
    if (isReroute(event)) {
      reroutes.push({
        from: event.from,
        to: event.to,
        timestamp: event.timestamp,
        reason: event.reason ?? "Unknown",
      });
    }
  }

  return reroutes;
}

export function HealthView({ metrics, events, onRequestHealth }: HealthViewProps) {
  const agents = useMemo(() => Object.values(metrics).sort((a, b) => a.agentId.localeCompare(b.agentId)), [metrics]);
  const costData = useMemo(() => buildCostData(events), [events]);
  const reroutes = useMemo(() => extractReroutes(events), [events]);

  if (agents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <div className="text-center">
          <div className="mb-2 text-4xl" aria-hidden="true">♥</div>
          <p>No health data available</p>
          <p className="mt-1 text-xs">Agent health metrics appear after runs</p>
        </div>
      </div>
    );
  }

  // Overall stats
  const totalTokens = costData.reduce((sum, d) => sum + d.tokens, 0);
  const avgHealth = Math.round(agents.reduce((sum, a) => sum + a.healthScore, 0) / agents.length);
  const openCircuits = agents.filter((a) => a.circuitState === "OPEN").length;

  return (
    <div className="flex h-full flex-col overflow-auto">
      {/* Summary bar */}
      <div className="flex items-center gap-6 border-b border-zinc-800 px-6 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Avg Health</div>
          <div className={`text-xl font-bold ${avgHealth >= 70 ? "text-emerald-400" : avgHealth >= 40 ? "text-amber-400" : "text-red-400"}`}>
            {avgHealth}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Total Tokens</div>
          <div className="text-xl font-bold text-zinc-100">{totalTokens.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Agents</div>
          <div className="text-xl font-bold text-zinc-100">{agents.length}</div>
        </div>
        {openCircuits > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Open Circuits</div>
            <div className="text-xl font-bold text-red-400">{openCircuits}</div>
          </div>
        )}
        {onRequestHealth && (
          <button
            onClick={onRequestHealth}
            className="ml-auto rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700"
          >
            Refresh
          </button>
        )}
      </div>

      <div className="flex-1 p-6">
        {/* Agent health cards */}
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Agent Health</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <HealthCard key={agent.agentId} metrics={agent} />
          ))}
        </div>

        {/* Cost chart */}
        {costData.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Token Usage</h2>
            <CostChart data={costData} />
          </div>
        )}

        {/* Reroute log */}
        {reroutes.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Reroute Events</h2>
            <div className="space-y-2">
              {reroutes.map((r) => (
                <div key={`${r.from}-${r.to}-${r.timestamp}`} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs">
                  <span className="text-red-400">{r.from}</span>
                  <span className="text-zinc-600" aria-hidden="true">→</span>
                  <span className="sr-only">rerouted to</span>
                  <span className="text-emerald-400">{r.to}</span>
                  <span className="ml-auto text-zinc-500">{r.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
