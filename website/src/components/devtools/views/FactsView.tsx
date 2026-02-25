'use client'

import { useState, useCallback } from 'react'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { EmptyState } from '../EmptyState'

function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'object') {
    try {
      const str = JSON.stringify(value, null, 2)

      return str.length > 200 ? str.slice(0, 197) + '...' : str
    } catch {
      return '<error>'
    }
  }

  return String(value)
}

export function FactsView() {
  const system = useDevToolsSystem()
  const connected = useSelector(system, (s) => s.facts.runtime.connected)
  const facts = useSelector(system, (s) => s.facts.runtime.facts)
  const factCount = useSelector(system, (s) => s.derive.runtime.factCount)

  const [filter, setFilter] = useState('')
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }

      return next
    })
  }, [])

  if (!connected) {
    return <EmptyState message="No Directive system connected" />
  }

  if (factCount === 0) {
    return <EmptyState message="No facts in system" />
  }

  const entries = Object.entries(facts)
  const filtered = filter
    ? entries.filter(([key]) => key.toLowerCase().includes(filter.toLowerCase()))
    : entries

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Facts
          <span className="ml-2 font-mono font-normal text-zinc-400 dark:text-zinc-500">
            {factCount}
          </span>
        </h4>
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-40 rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-[11px] text-zinc-700 placeholder-zinc-400 outline-none focus:border-sky-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:placeholder-zinc-500"
        />
      </div>

      <div className="space-y-0.5">
        {filtered.map(([key, value]) => {
          const isObject = value !== null && typeof value === 'object'
          const isExpanded = expandedKeys.has(key)

          return (
            <div
              key={key}
              className="flex rounded px-2 py-1.5 font-mono text-xs transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <span className="w-48 shrink-0 truncate text-sky-600 dark:text-sky-400">
                {key}
              </span>
              {isObject ? (
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => toggleExpand(key)}
                    className="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    {isExpanded ? '▼' : '▶'} {Array.isArray(value) ? `Array(${(value as unknown[]).length})` : 'Object'}
                  </button>
                  {isExpanded && (
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] leading-relaxed text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
                      {formatValue(value)}
                    </pre>
                  )}
                </div>
              ) : (
                <span className={
                  typeof value === 'boolean'
                    ? value ? 'text-emerald-500' : 'text-red-500'
                    : typeof value === 'number'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-zinc-700 dark:text-zinc-300'
                }>
                  {formatValue(value)}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {filter && filtered.length === 0 && (
        <EmptyState message={`No facts matching "${filter}"`} />
      )}
    </div>
  )
}
