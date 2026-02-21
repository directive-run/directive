import type { AgentHealthMetrics } from "../lib/types";
import { CIRCUIT_STATE_COLORS } from "../lib/colors";

interface HealthCardProps {
  metrics: AgentHealthMetrics;
}

function HealthBar({ score }: { score: number }) {
  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <div
      className="h-1.5 w-full rounded-full bg-zinc-800"
      role="progressbar"
      aria-valuenow={score}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Health score: ${score} out of 100`}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${score}%`, backgroundColor: color }}
      />
    </div>
  );
}

export function HealthCard({ metrics }: HealthCardProps) {
  const circuit = CIRCUIT_STATE_COLORS[metrics.circuitState];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-100">{metrics.agentId}</h3>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${circuit.bg} ${circuit.text}`}>
          {circuit.label}
        </span>
      </div>

      {/* Health score */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-bold text-zinc-100">{metrics.healthScore}</span>
          <span className="text-xs text-zinc-500">/ 100</span>
        </div>
        <HealthBar score={metrics.healthScore} />
      </div>

      {/* Stats grid */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-zinc-500">Success Rate</div>
          <div className="text-zinc-200">{(metrics.successRate * 100).toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-zinc-500">Avg Latency</div>
          <div className="text-zinc-200">{Math.round(metrics.avgLatencyMs)}ms</div>
        </div>
        <div>
          <div className="text-zinc-500">Successes</div>
          <div className="text-emerald-400">{metrics.recentSuccesses}</div>
        </div>
        <div>
          <div className="text-zinc-500">Failures</div>
          <div className={metrics.recentFailures > 0 ? "text-red-400" : "text-zinc-400"}>
            {metrics.recentFailures}
          </div>
        </div>
      </div>

      {/* Recent errors */}
      {metrics.lastErrors.length > 0 && (
        <div className="mt-3 border-t border-zinc-800 pt-2">
          <div className="text-[10px] text-zinc-500">Recent Errors</div>
          <div className="mt-1 space-y-1">
            {metrics.lastErrors.map((err, i) => (
              <div key={i} className="truncate text-[10px] text-red-400/70">
                {err}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
