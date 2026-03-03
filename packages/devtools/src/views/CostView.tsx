import { useMemo } from "react";
import { type DebugEvent, isAgentComplete } from "../lib/types";

interface CostViewProps {
  events: DebugEvent[];
}

interface AgentCostRow {
  agentId: string;
  runs: number;
  totalTokens: number;
  avgTokens: number;
  totalDurationMs: number;
  pctOfTotal: number;
}

/** M13: Generate distinct HSL colors for any number of agents */
function getAgentColor(index: number, total: number): string {
  // Golden angle distribution for maximal hue separation
  const hue = (index * 137.508) % 360;
  const saturation = 65 + (index % 3) * 10; // 65-85%
  const lightness = total > 7 ? 55 + (index % 2) * 10 : 55;

  return `hsl(${Math.round(hue)}, ${saturation}%, ${lightness}%)`;
}

const COST_PER_1K = 0.01;

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

function buildCostRows(events: DebugEvent[]): AgentCostRow[] {
  const agentMap = new Map<
    string,
    { tokens: number; runs: number; durationMs: number }
  >();

  for (const event of events) {
    let agentId: string | undefined;
    let tokens: number | undefined;
    let duration = 0;

    if (isAgentComplete(event) && event.totalTokens != null) {
      agentId = event.agentId;
      tokens = event.totalTokens;
      duration = typeof event.durationMs === "number" ? event.durationMs : 0;
    } else if (
      event.type === "resolver_complete" &&
      typeof event.totalTokens === "number"
    ) {
      agentId =
        typeof event.agentId === "string"
          ? event.agentId
          : typeof event.requirement === "string"
            ? event.requirement
            : "resolver";
      tokens = event.totalTokens;
      duration = typeof event.durationMs === "number" ? event.durationMs : 0;
    }

    if (agentId && tokens != null) {
      const existing = agentMap.get(agentId);
      if (existing) {
        existing.tokens += tokens;
        existing.runs += 1;
        existing.durationMs += duration;
      } else {
        agentMap.set(agentId, { tokens, runs: 1, durationMs: duration });
      }
    }
  }

  const grandTotal = Array.from(agentMap.values()).reduce(
    (sum, v) => sum + v.tokens,
    0,
  );

  const rows: AgentCostRow[] = Array.from(agentMap.entries()).map(
    ([agentId, data]) => ({
      agentId,
      runs: data.runs,
      totalTokens: data.tokens,
      avgTokens: Math.round(data.tokens / data.runs),
      totalDurationMs: data.durationMs,
      pctOfTotal: grandTotal > 0 ? (data.tokens / grandTotal) * 100 : 0,
    }),
  );

  rows.sort((a, b) => b.totalTokens - a.totalTokens);

  return rows;
}

export function CostView({ events }: CostViewProps) {
  const rows = useMemo(() => buildCostRows(events), [events]);

  const totals = useMemo(() => {
    const totalTokens = rows.reduce((sum, r) => sum + r.totalTokens, 0);

    return {
      totalTokens,
      totalCost: (totalTokens / 1000) * COST_PER_1K,
      totalAgents: rows.length,
    };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <div className="text-center">
          <div className="mb-2 text-4xl" aria-hidden="true">
            $
          </div>
          <p>No token usage data available</p>
          <p className="mt-1 text-xs">
            Cost data appears after agent runs with token tracking
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      {/* Summary bar */}
      <div className="flex items-center gap-6 border-b border-zinc-800 px-6 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Total Tokens
          </div>
          <div className="text-xl font-bold text-zinc-100">
            {totals.totalTokens.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Est. Cost
          </div>
          <div className="text-xl font-bold text-emerald-400">
            ${totals.totalCost.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Agents
          </div>
          <div className="text-xl font-bold text-zinc-100">
            {totals.totalAgents}
          </div>
        </div>
      </div>

      <div className="flex-1 p-6">
        {/* Stacked bar chart */}
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Token Distribution
        </h2>
        <div
          className="mb-2 flex h-8 w-full overflow-hidden rounded"
          aria-hidden="true"
        >
          {rows.map((row, i) => (
            <div
              key={row.agentId}
              className="relative h-full transition-all"
              style={{
                width: `${row.pctOfTotal}%`,
                backgroundColor: getAgentColor(i, rows.length),
              }}
              title={`${row.agentId}: ${row.totalTokens.toLocaleString()} tokens (${row.pctOfTotal.toFixed(1)}%)`}
            />
          ))}
        </div>
        <span className="sr-only">
          Token distribution chart. See Cost Breakdown table below for details.
        </span>
        {/* Legend */}
        <div className="mb-6 flex flex-wrap gap-3">
          {rows.map((row, i) => (
            <div
              key={row.agentId}
              className="flex items-center gap-1.5 text-xs text-zinc-400"
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: getAgentColor(i, rows.length) }}
              />
              <span>{row.agentId}</span>
            </div>
          ))}
        </div>

        {/* Table */}
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Cost Breakdown
        </h2>
        <div className="overflow-hidden rounded border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900 text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-2 font-medium">Agent</th>
                <th className="px-4 py-2 text-right font-medium">Runs</th>
                <th className="px-4 py-2 text-right font-medium">
                  Total Tokens
                </th>
                <th className="px-4 py-2 text-right font-medium">Avg Tokens</th>
                <th className="px-4 py-2 text-right font-medium">
                  Total Duration
                </th>
                <th className="px-4 py-2 text-right font-medium">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.agentId}
                  className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-900/50"
                >
                  <td className="px-4 py-2 text-zinc-200">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: getAgentColor(i, rows.length),
                        }}
                      />
                      {row.agentId}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-400">
                    {row.runs}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-zinc-200">
                    {row.totalTokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-zinc-400">
                    {row.avgTokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-400">
                    {formatDuration(row.totalDurationMs)}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-400">
                    {row.pctOfTotal.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
