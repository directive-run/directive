'use client'

import { useState, useCallback, useEffect } from 'react'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { EmptyState } from '../EmptyState'

// ---------------------------------------------------------------------------
// RequirementRow — shared between inflight and unmet sections
// ---------------------------------------------------------------------------

interface Requirement {
  id: string
  type: string
  fromConstraint: string
  status: string
}

interface Constraint {
  id: string
  active: boolean
  priority?: number
  hitCount: number
  lastActiveAt: number | null
}

function RequirementRow({
  r,
  variant,
  constraints,
  resolverStats,
  isExpanded,
  onToggle,
}: {
  r: Requirement
  variant: 'inflight' | 'unmet'
  constraints: Constraint[]
  resolverStats: Record<string, { count: number; errors: number }>
  isExpanded: boolean
  onToggle: (id: string) => void
}) {
  const constraint = constraints.find((c) => c.id === r.fromConstraint)

  const isInflight = variant === 'inflight'
  const bgClass = isInflight ? 'bg-amber-50 dark:bg-amber-900/10' : 'bg-red-50 dark:bg-red-900/10'
  const dotClass = isInflight ? 'animate-pulse bg-amber-500' : 'bg-red-500'
  const textClass = isInflight ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400'
  const btnClass = isInflight
    ? 'text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-800/30'
    : 'text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-800/30'
  const borderClass = isInflight ? 'border-amber-200 dark:border-amber-800/30' : 'border-red-200 dark:border-red-800/30'
  const typeBadgeClass = isInflight
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'

  // Find resolver match (heuristic: normalized name matching)
  const resolverMatch = isInflight
    ? Object.keys(resolverStats).find((key) => {
        const norm = key.toLowerCase().replace(/[_-]/g, '')
        const typeNorm = r.type.toLowerCase().replace(/[_-]/g, '')

        return norm === typeNorm || norm.includes(typeNorm) || typeNorm.includes(norm)
      })
    : undefined

  return (
    <div className={`rounded font-mono text-xs ${bgClass}`}>
      <div className="flex items-center gap-3 px-2 py-1.5">
        <div className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
        <span className={textClass}>{r.type}</span>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          from {r.fromConstraint}
        </span>
        <button
          onClick={() => onToggle(r.id)}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? `Hide trace for ${r.type}` : `Show trace for ${r.type}`}
          className={`ml-auto cursor-pointer rounded px-1.5 py-0.5 text-[10px] ${btnClass}`}
        >
          {isExpanded ? 'Hide' : 'Why?'}
        </button>
      </div>
      {isExpanded && (
        <div className={`border-t px-3 py-2 text-[10px] ${borderClass}`}>
          <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
            <span className="rounded bg-emerald-100 px-1 py-px text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              {r.fromConstraint}
            </span>
            {constraint && (
              <span className="text-zinc-400">
                (p{constraint.priority ?? '—'}, {constraint.active ? 'active' : 'inactive'})
              </span>
            )}
            <span className="text-zinc-300 dark:text-zinc-600">→</span>
            <span className={`rounded px-1 py-px ${typeBadgeClass}`}>
              {r.type}
            </span>
            {resolverMatch && (
              <>
                <span className="text-zinc-300 dark:text-zinc-600">→</span>
                <span className="rounded bg-indigo-100 px-1 py-px text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                  {resolverMatch}
                </span>
                {resolverStats[resolverMatch] && (
                  <span className="text-zinc-400">
                    ({resolverStats[resolverMatch].count} runs, {resolverStats[resolverMatch].errors} errors)
                  </span>
                )}
              </>
            )}
            {!isInflight && !resolverMatch && (
              <span className="text-red-400 dark:text-red-500">
                (no resolver matched)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(timestamp: number, now: number): string {
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) {
    return ''
  }

  const delta = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (delta < 2) return 'just now'
  if (delta < 60) return `${delta}s ago`
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`

  return `${Math.floor(delta / 3600)}h ago`
}

// ---------------------------------------------------------------------------
// ConstraintsView
// ---------------------------------------------------------------------------

export function ConstraintsView() {
  const system = useDevToolsSystem()
  const connected = useSelector(system, (s) => s.facts.runtime.connected)
  const constraints = useSelector(system, (s) => s.facts.runtime.constraints)
  const inflight = useSelector(system, (s) => s.facts.runtime.inflight)
  const unmet = useSelector(system, (s) => s.facts.runtime.unmet)
  const resolverStats = useSelector(system, (s) => s.facts.runtime.resolverStats)

  const [expandedTraces, setExpandedTraces] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [now, setNow] = useState(Date.now)

  // Tick every second so relative timestamps stay fresh
  const hasAnyLastActiveAt = constraints.some((c) => c.lastActiveAt != null && c.lastActiveAt > 0)
  useEffect(() => {
    if (!hasAnyLastActiveAt) return

    const id = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(id)
  }, [hasAnyLastActiveAt])

  const toggleTrace = useCallback((id: string) => {
    setExpandedTraces((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }

      return next
    })
  }, [])

  if (!connected) {
    return <EmptyState message="No Directive system connected" />
  }

  if (constraints.length === 0 && inflight.length === 0 && unmet.length === 0) {
    return <EmptyState message="No constraints or requirements" />
  }

  const lowerFilter = filter.toLowerCase()
  const filteredConstraints = filter
    ? constraints.filter((c) => c.id.toLowerCase().includes(lowerFilter))
    : constraints
  const filteredInflight = filter
    ? inflight.filter((r) => r.type.toLowerCase().includes(lowerFilter) || r.fromConstraint.toLowerCase().includes(lowerFilter))
    : inflight
  const filteredUnmet = filter
    ? unmet.filter((r) => r.type.toLowerCase().includes(lowerFilter) || r.fromConstraint.toLowerCase().includes(lowerFilter))
    : unmet

  const resolverEntries = Object.entries(resolverStats)
  const filteredResolvers = filter
    ? resolverEntries.filter(([name]) => name.toLowerCase().includes(lowerFilter))
    : resolverEntries

  const hasResults = filteredConstraints.length > 0 || filteredInflight.length > 0 || filteredUnmet.length > 0 || filteredResolvers.length > 0

  return (
    <div className="flex h-full flex-col gap-6">
      {/* Header + filter */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Constraints
          <span className="ml-2 font-mono font-normal text-zinc-400 dark:text-zinc-500">
            {constraints.length}
          </span>
        </h4>
        <input
          type="text"
          placeholder="Filter..."
          aria-label="Filter constraints and requirements"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-40 rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-[11px] text-zinc-700 placeholder-zinc-400 outline-none focus:border-sky-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:placeholder-zinc-500"
        />
      </div>

      {!hasResults && filter && (
        <EmptyState message={`No results matching "${filter}"`} />
      )}

      {/* Constraints list */}
      {filteredConstraints.length > 0 && (
        <div>
          <div className="space-y-1">
            {filteredConstraints.map((c) => (
              <div
                key={c.id}
                className={`flex items-center gap-3 rounded px-2 py-1.5 font-mono text-xs ${
                  c.active
                    ? 'bg-emerald-50 dark:bg-emerald-900/10'
                    : 'opacity-60'
                }`}
              >
                <div
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    c.active ? 'bg-emerald-500' : 'bg-zinc-400'
                  }`}
                  aria-hidden="true"
                />
                <span className={
                  c.active
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-zinc-500 dark:text-zinc-500'
                }>
                  {c.id}
                </span>
                {c.priority !== undefined && (
                  <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400">
                    p{c.priority}
                  </span>
                )}
                {c.hitCount > 0 && (
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
                    &times;{c.hitCount}
                  </span>
                )}
                {c.lastActiveAt != null && c.lastActiveAt > 0 && (
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                    {formatRelativeTime(c.lastActiveAt, now)}
                  </span>
                )}
                <span className={`ml-auto text-[10px] ${
                  c.active
                    ? 'text-emerald-600 dark:text-emerald-500'
                    : 'text-zinc-400 dark:text-zinc-600'
                }`}>
                  {c.active ? 'active' : 'inactive'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inflight Requirements */}
      {filteredInflight.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            Inflight
            <span className="ml-2 font-mono font-normal text-amber-500 dark:text-amber-500">
              {filteredInflight.length}
            </span>
          </h4>
          <div className="space-y-1">
            {filteredInflight.map((r) => (
              <RequirementRow
                key={r.id}
                r={r}
                variant="inflight"
                constraints={constraints}
                resolverStats={resolverStats}
                isExpanded={expandedTraces.has(r.id)}
                onToggle={toggleTrace}
              />
            ))}
          </div>
        </div>
      )}

      {/* Unmet Requirements */}
      {filteredUnmet.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
            Unmet
            <span className="ml-2 font-mono font-normal text-red-500 dark:text-red-500">
              {filteredUnmet.length}
            </span>
          </h4>
          <div className="space-y-1">
            {filteredUnmet.map((r) => (
              <RequirementRow
                key={r.id}
                r={r}
                variant="unmet"
                constraints={constraints}
                resolverStats={resolverStats}
                isExpanded={expandedTraces.has(r.id)}
                onToggle={toggleTrace}
              />
            ))}
          </div>
        </div>
      )}

      {/* Resolvers */}
      {filteredResolvers.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
            Resolvers
            <span className="ml-2 font-mono font-normal text-indigo-500 dark:text-indigo-500">
              {filteredResolvers.length}
            </span>
          </h4>
          <div className="space-y-1">
            {filteredResolvers.map(([name, stats]) => (
              <div
                key={name}
                className="flex items-center gap-3 rounded bg-indigo-50 px-2 py-1.5 font-mono text-xs dark:bg-indigo-900/10"
              >
                <div className="h-2 w-2 shrink-0 rounded-full bg-indigo-500" aria-hidden="true" />
                <span className="text-indigo-700 dark:text-indigo-400">{name}</span>
                {stats.count > 0 && (
                  <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                    {stats.count}x
                  </span>
                )}
                {stats.count > 0 && 'avgMs' in stats && typeof (stats as Record<string, unknown>).avgMs === 'number' && (
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                    avg {((stats as Record<string, unknown>).avgMs as number).toFixed(1)}ms
                  </span>
                )}
                {stats.errors > 0 && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    {stats.errors} error{stats.errors !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
