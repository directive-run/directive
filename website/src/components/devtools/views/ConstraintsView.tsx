'use client'

import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { EmptyState } from '../EmptyState'

export function ConstraintsView() {
  const system = useDevToolsSystem()
  const connected = useSelector(system, (s) => s.facts.runtime.connected)
  const constraints = useSelector(system, (s) => s.facts.runtime.constraints)
  const inflight = useSelector(system, (s) => s.facts.runtime.inflight)
  const unmet = useSelector(system, (s) => s.facts.runtime.unmet)

  if (!connected) {
    return <EmptyState message="No Directive system connected" />
  }

  if (constraints.length === 0 && inflight.length === 0 && unmet.length === 0) {
    return <EmptyState message="No constraints or requirements" />
  }

  return (
    <div className="flex h-full flex-col gap-6">
      {/* Constraints */}
      {constraints.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Constraints
            <span className="ml-2 font-mono font-normal text-zinc-400 dark:text-zinc-500">
              {constraints.length}
            </span>
          </h4>
          <div className="space-y-1">
            {constraints.map((c) => (
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
      {inflight.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            Inflight
            <span className="ml-2 font-mono font-normal text-amber-500 dark:text-amber-500">
              {inflight.length}
            </span>
          </h4>
          <div className="space-y-1">
            {inflight.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded bg-amber-50 px-2 py-1.5 font-mono text-xs dark:bg-amber-900/10"
              >
                <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
                <span className="text-amber-700 dark:text-amber-400">{r.type}</span>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                  from {r.fromConstraint}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unmet Requirements */}
      {unmet.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
            Unmet
            <span className="ml-2 font-mono font-normal text-red-500 dark:text-red-500">
              {unmet.length}
            </span>
          </h4>
          <div className="space-y-1">
            {unmet.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded bg-red-50 px-2 py-1.5 font-mono text-xs dark:bg-red-900/10"
              >
                <div className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                <span className="text-red-700 dark:text-red-400">{r.type}</span>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                  from {r.fromConstraint}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
