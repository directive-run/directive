'use client'

import { useMemo } from 'react'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { EmptyState } from '../EmptyState'
import { Skeleton } from '../Skeleton'

export function StateView() {
  const system = useDevToolsSystem()
  const data = useSelector(system, (s) => s.facts.snapshot.data)
  const error = useSelector(system, (s) => s.facts.snapshot.error)
  const lastUpdated = useSelector(system, (s) => s.facts.snapshot.lastUpdated)
  const events = useSelector(system, (s) => s.facts.connection.events)

  // Compute input/output token breakdown from events
  const { inputTokens, outputTokens } = useMemo(() => {
    let inp = 0
    let out = 0
    for (const e of events) {
      if (e.type === 'agent_complete') {
        inp += e.inputTokens ?? 0
        out += e.outputTokens ?? 0
      }
    }

    return { inputTokens: inp, outputTokens: out }
  }, [events])

  if (error) {
    return <EmptyState message={error} />
  }

  if (!data) {
    return <Skeleton rows={6} />
  }

  // Dynamically render all namespaced sections from the snapshot
  const topLevelScalars = new Set(['timestamp', 'eventCount', 'totalTokens'])
  const sections: Record<string, Record<string, unknown>> = {}
  for (const [key, value] of Object.entries(data)) {
    if (topLevelScalars.has(key)) continue
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      sections[key] = value as Record<string, unknown>
    }
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Overview
        </h4>
        <div className="space-y-2">
          <div className="flex font-mono text-xs">
            <span className="w-40 shrink-0 text-sky-600 dark:text-sky-400">eventCount</span>
            <span className="text-zinc-700 dark:text-zinc-300">{data.eventCount}</span>
          </div>
          <div className="flex font-mono text-xs">
            <span className="w-40 shrink-0 text-sky-600 dark:text-sky-400">totalTokens</span>
            <span className="text-zinc-700 dark:text-zinc-300">{data.totalTokens}</span>
          </div>
          <div className="flex font-mono text-xs">
            <span className="w-40 shrink-0 text-sky-600 dark:text-sky-400">inputTokens</span>
            <span className="text-zinc-700 dark:text-zinc-300">{inputTokens}</span>
          </div>
          <div className="flex font-mono text-xs">
            <span className="w-40 shrink-0 text-sky-600 dark:text-sky-400">outputTokens</span>
            <span className="text-zinc-700 dark:text-zinc-300">{outputTokens}</span>
          </div>
        </div>
      </div>

      {Object.entries(sections).map(([section, value]) => (
        <div key={section}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {section}
          </h4>
          <div className="space-y-2">
            {Object.entries(value).map(([k, v]) => {
              const isObject = v !== null && typeof v === 'object'
              const isBoolean = typeof v === 'boolean'
              const highlight = isBoolean
                ? v ? 'text-emerald-500' : 'text-red-500'
                : undefined

              return (
                <div key={k} className="flex font-mono text-xs">
                  <span className="w-40 shrink-0 text-sky-600 dark:text-sky-400">{k}</span>
                  {isObject ? (
                    <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-100 px-3 py-2 text-xs leading-relaxed text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{JSON.stringify(v, null, 2)}</pre>
                  ) : (
                    <span className={highlight ?? 'text-zinc-700 dark:text-zinc-300'}>{String(v)}</span>
                  )}
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
