'use client'

import { usePolledSnapshot } from '../hooks/usePolledSnapshot'
import { EmptyState } from '../EmptyState'
import { Skeleton } from '../Skeleton'

// C1: Uses shared usePolledSnapshot instead of independent fetch

export function StateView() {
  const { data, error, lastUpdated } = usePolledSnapshot()

  if (error) {
    return <EmptyState message={error} />
  }

  if (!data) {
    return <Skeleton rows={6} />
  }

  // Render sections from typed snapshot
  const sections: Record<string, Record<string, unknown>> = {
    orchestrator: data.orchestrator,
    guardrails: data.guardrails,
    chatbot: data.chatbot,
  }

  return (
    <div className="space-y-4">
      <div className="flex font-mono text-xs">
        <span className="w-40 shrink-0 text-sky-600 dark:text-sky-400">eventCount</span>
        <span className="text-zinc-700 dark:text-zinc-300">{data.eventCount}</span>
      </div>
      <div className="flex font-mono text-xs">
        <span className="w-40 shrink-0 text-sky-600 dark:text-sky-400">totalTokens</span>
        <span className="text-zinc-700 dark:text-zinc-300">{data.totalTokens}</span>
      </div>

      {Object.entries(sections).map(([section, value]) => (
        <div key={section}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {section}
          </h4>
          <div className="space-y-1">
            {Object.entries(value).map(([k, v]) => {
              const strVal = String(v)
              const isBoolean = typeof v === 'boolean'
              const highlight = isBoolean
                ? v ? 'text-emerald-500' : 'text-red-500'
                : undefined

              return (
                <div key={k} className="flex font-mono text-xs">
                  <span className="w-40 shrink-0 text-sky-600 dark:text-sky-400">{k}</span>
                  <span className={highlight ?? 'text-zinc-700 dark:text-zinc-300'}>{strVal}</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {lastUpdated && (
        <div className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
          Last updated: {new Date(lastUpdated).toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
