'use client'

import { useState } from 'react'
import type { DebugEvent } from '../types'
import { EVENT_COLORS } from '../constants'
import { EmptyState } from '../EmptyState'

export function EventsView({ events }: { events: DebugEvent[] }) {
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  if (events.length === 0) {
    return <EmptyState message="No events recorded yet." />
  }

  // Unique event types for filter chips
  const eventTypes = [...new Set(events.map((e) => e.type))]

  const filtered = events.filter((e) => {
    if (typeFilter && e.type !== typeFilter) {
      return false
    }
    if (filter) {
      const q = filter.toLowerCase()
      const searchable = `${e.type} ${e.agentId ?? ''} ${e.guardrailName ?? ''} ${e.modelId ?? ''} ${e.reason ?? ''}`.toLowerCase()

      return searchable.includes(q)
    }

    return true
  })

  const baseTs = events[0]?.timestamp ?? 0

  return (
    <div className="space-y-3">
      {/* Search + type filter */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Filter events..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-xs text-zinc-900 placeholder-zinc-400 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white dark:placeholder-zinc-500"
        />
        <span className="shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
          {filtered.length}/{events.length}
        </span>
      </div>

      {/* Type filter chips */}
      <div className="flex flex-wrap gap-1">
        <button
          className={`cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] transition ${
            typeFilter === null
              ? 'bg-sky-500/20 text-sky-500'
              : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
          }`}
          onClick={() => setTypeFilter(null)}
        >
          All
        </button>
        {eventTypes.map((t) => (
          <button
            key={t}
            className={`cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] transition ${
              typeFilter === t
                ? 'bg-sky-500/20 text-sky-500'
                : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
            }`}
            onClick={() => setTypeFilter(typeFilter === t ? null : t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Event list — M8: sticky header with border+shadow */}
      <div className="max-h-[400px] overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 border-b border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <tr className="text-zinc-500 dark:text-zinc-400">
              <th className="py-1 text-left font-medium">Time</th>
              <th className="py-1 text-left font-medium">Type</th>
              <th className="py-1 text-left font-medium">Agent</th>
              <th className="py-1 text-right font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="font-mono text-zinc-700 dark:text-zinc-300">
            {[...filtered].reverse().map((e) => {
              const relMs = e.timestamp - baseTs
              const relS = (relMs / 1000).toFixed(2)

              // Build detail string
              let detail = ''
              if (e.totalTokens) {
                detail = `${e.totalTokens.toLocaleString()} tokens`
              }
              if (e.guardrailName) {
                detail = `${e.guardrailName}${e.passed === false ? ' (blocked)' : ''}`
              }
              if (e.durationMs) {
                detail += detail ? ` · ${e.durationMs}ms` : `${e.durationMs}ms`
              }
              if (e.reason) {
                detail = e.reason
              }

              return (
                <tr key={e.id} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-1 text-zinc-400 dark:text-zinc-500">{relS}s</td>
                  <td className="py-1">
                    <span className={`inline-block rounded px-1 py-0.5 text-[10px] text-white ${EVENT_COLORS[e.type] ?? 'bg-zinc-400'}`}>
                      {e.type}
                    </span>
                  </td>
                  <td className="py-1 text-zinc-500 dark:text-zinc-400">{e.agentId ?? '—'}</td>
                  <td className="max-w-[200px] truncate py-1 text-right text-zinc-400 dark:text-zinc-500" title={detail}>
                    {detail || '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
