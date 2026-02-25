'use client'

import { useCallback } from 'react'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { EmptyState } from '../EmptyState'

export function TimeTravelView() {
  const system = useDevToolsSystem()
  const connected = useSelector(system, (s) => s.facts.runtime.connected)
  const timeTravelEnabled = useSelector(system, (s) => s.facts.runtime.timeTravelEnabled)
  const snapshotIndex = useSelector(system, (s) => s.facts.runtime.snapshotIndex)
  const snapshotCount = useSelector(system, (s) => s.facts.runtime.snapshotCount)
  const canUndo = useSelector(system, (s) => s.derive.runtime.canUndo)
  const canRedo = useSelector(system, (s) => s.derive.runtime.canRedo)
  const systemName = useSelector(system, (s) => s.facts.runtime.systemName)

  const handleUndo = useCallback(() => {
    if (typeof window === 'undefined' || !window.__DIRECTIVE__) {
      return
    }

    const sys = window.__DIRECTIVE__.getSystem(systemName ?? undefined)
    if (sys?.debug?.goBack) {
      sys.debug.goBack(1)
      // Trigger re-inspection
      system.events.runtime.refresh()
    }
  }, [system, systemName])

  const handleRedo = useCallback(() => {
    if (typeof window === 'undefined' || !window.__DIRECTIVE__) {
      return
    }

    const sys = window.__DIRECTIVE__.getSystem(systemName ?? undefined)
    if (sys?.debug?.goForward) {
      sys.debug.goForward(1)
      // Trigger re-inspection
      system.events.runtime.refresh()
    }
  }, [system, systemName])

  if (!connected) {
    return <EmptyState message="No Directive system connected" />
  }

  if (!timeTravelEnabled) {
    return (
      <EmptyState message="Time-travel not enabled. Add debug: { timeTravel: true } to your system config." />
    )
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <div>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Time Travel
        </h4>

        {/* Controls */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className="cursor-pointer rounded border border-zinc-200 px-3 py-1.5 font-mono text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            ← Undo
          </button>

          <div className="flex items-center gap-2 font-mono text-sm">
            <span className="text-sky-600 dark:text-sky-400">
              {snapshotIndex + 1}
            </span>
            <span className="text-zinc-400">/</span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {snapshotCount}
            </span>
          </div>

          <button
            onClick={handleRedo}
            disabled={!canRedo}
            className="cursor-pointer rounded border border-zinc-200 px-3 py-1.5 font-mono text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Redo →
          </button>
        </div>
      </div>

      {/* Snapshot info */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Current Snapshot
        </h4>
        <div className="rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="flex gap-6 font-mono text-xs">
            <div>
              <span className="text-zinc-400 dark:text-zinc-500">Index: </span>
              <span className="text-zinc-700 dark:text-zinc-300">{snapshotIndex}</span>
            </div>
            <div>
              <span className="text-zinc-400 dark:text-zinc-500">Total: </span>
              <span className="text-zinc-700 dark:text-zinc-300">{snapshotCount}</span>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-zinc-400 dark:text-zinc-500">
            Use Undo/Redo to step through state snapshots
          </div>
        </div>
      </div>
    </div>
  )
}
