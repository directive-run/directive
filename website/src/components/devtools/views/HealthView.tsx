'use client'

import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { EmptyState } from '../EmptyState'
import { Skeleton } from '../Skeleton'

export function HealthView() {
  const system = useDevToolsSystem()
  const data = useSelector(system, (s) => s.facts.snapshot.data)
  const error = useSelector(system, (s) => s.facts.snapshot.error)

  if (error) {
    return <EmptyState message={error} />
  }

  if (!data) {
    return <Skeleton rows={5} />
  }

  const { orchestrator, guardrails, chatbot } = data

  const isHealthy = chatbot.isHealthy
  const consecutiveErrors = chatbot.consecutiveErrors
  const status = orchestrator.status
  const totalRuns = orchestrator.totalRuns
  const avgDurationMs = orchestrator.avgDurationMs
  const passRate = guardrails.passRate
  const guardrailBlocked = guardrails.blocked
  const activeIPs = chatbot.activeIPs
  const totalRequests = chatbot.totalRequests
  const totalTokensUsed = chatbot.totalTokensUsed

  type HealthStatus = 'healthy' | 'degraded' | 'unhealthy'
  const healthStatus: HealthStatus = isHealthy === false ? 'unhealthy' : consecutiveErrors > 0 ? 'degraded' : 'healthy'
  const healthColors: Record<HealthStatus, string> = {
    healthy: 'text-emerald-600 dark:text-emerald-400',
    degraded: 'text-amber-600 dark:text-amber-400',
    unhealthy: 'text-red-600 dark:text-red-400',
  }
  const healthBg: Record<HealthStatus, string> = {
    healthy: 'bg-emerald-500',
    degraded: 'bg-amber-500 animate-pulse',
    unhealthy: 'bg-red-500 animate-pulse',
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Overall health indicator */}
      <div className="flex items-center gap-3">
        <div className={`h-4 w-4 rounded-full ${healthBg[healthStatus]}`} />
        <div>
          <div className={`text-lg font-semibold capitalize ${healthColors[healthStatus]}`}>
            {healthStatus}
          </div>
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {healthStatus === 'healthy' && 'All systems operational'}
            {healthStatus === 'degraded' && `${consecutiveErrors} consecutive error${consecutiveErrors > 1 ? 's' : ''} detected`}
            {healthStatus === 'unhealthy' && 'System is unhealthy — check error logs'}
          </div>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Status</div>
          <div className="mt-1 font-mono text-sm font-semibold text-zinc-900 dark:text-white">{status}</div>
        </div>
        <div className="rounded border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Total Runs</div>
          <div className="mt-1 font-mono text-sm font-semibold text-zinc-900 dark:text-white">{totalRuns}</div>
        </div>
        <div className="rounded border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Avg Latency</div>
          <div className="mt-1 font-mono text-sm font-semibold text-zinc-900 dark:text-white">{avgDurationMs}ms</div>
        </div>
        <div className="rounded border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Requests</div>
          <div className="mt-1 font-mono text-sm font-semibold text-zinc-900 dark:text-white">{totalRequests}</div>
        </div>
        <div className="rounded border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Tokens Used</div>
          <div className="mt-1 font-mono text-sm font-semibold text-zinc-900 dark:text-white">{totalTokensUsed.toLocaleString()}</div>
        </div>
        <div className="rounded border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Active IPs</div>
          <div className="mt-1 font-mono text-sm font-semibold text-zinc-900 dark:text-white">{activeIPs}</div>
        </div>
      </div>

      {/* Guardrails + Errors */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Guardrail Pass Rate</div>
          <div className={`mt-1 font-mono text-sm font-semibold ${passRate === '100%' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
            {passRate}
          </div>
          {guardrailBlocked > 0 && (
            <div className="mt-0.5 text-[10px] text-red-500">{guardrailBlocked} blocked</div>
          )}
        </div>
        <div className="rounded border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Consecutive Errors</div>
          <div className={`mt-1 font-mono text-sm font-semibold ${consecutiveErrors > 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-white'}`}>
            {consecutiveErrors}
          </div>
          {consecutiveErrors > 2 && (
            <div className="mt-0.5 text-[10px] text-red-500">Circuit breaker may trip at 3</div>
          )}
        </div>
      </div>
    </div>
  )
}
