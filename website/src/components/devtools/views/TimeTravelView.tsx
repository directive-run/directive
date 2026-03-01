'use client'

import { useEffect, useRef, useState } from 'react'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { useTimeTravel } from '../hooks/useTimeTravel'
import { EmptyState } from '../EmptyState'

interface DiffEntry {
  key: string
  type: 'added' | 'removed' | 'changed'
  oldValue?: unknown
  newValue?: unknown
}

function computeDiff(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): DiffEntry[] {
  const diffs: DiffEntry[] = []
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)])

  for (const key of allKeys) {
    const hadKey = key in prev
    const hasKey = key in next

    if (!hadKey && hasKey) {
      diffs.push({ key, type: 'added', newValue: next[key] })
    } else if (hadKey && !hasKey) {
      diffs.push({ key, type: 'removed', oldValue: prev[key] })
    } else if (hadKey && hasKey) {
      const oldStr = JSON.stringify(prev[key])
      const newStr = JSON.stringify(next[key])
      if (oldStr !== newStr) {
        diffs.push({ key, type: 'changed', oldValue: prev[key], newValue: next[key] })
      }
    }
  }

  return diffs
}

function DiffValue({ value }: { value: unknown }) {
  if (value === undefined) {
    return <span className="text-zinc-400 italic">undefined</span>
  }
  if (value === null) {
    return <span className="text-zinc-400 italic">null</span>
  }
  if (typeof value === 'boolean') {
    return <span className={value ? 'text-emerald-500' : 'text-red-500'}>{String(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className="text-amber-600 dark:text-amber-400">{String(value)}</span>
  }
  if (typeof value === 'object') {
    return (
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  }

  return <span className="text-zinc-700 dark:text-zinc-300">{String(value)}</span>
}

export function TimeTravelView() {
  const system = useDevToolsSystem()
  const connected = useSelector(system, (s) => s.facts.runtime.connected)
  const facts = useSelector(system, (s) => s.facts.runtime.facts)
  const { timeTravelEnabled, snapshotIndex, snapshotCount, canUndo, canRedo, handleUndo, handleRedo } = useTimeTravel()

  const [diff, setDiff] = useState<DiffEntry[]>([])
  const prevFactsRef = useRef<Record<string, unknown>>({})

  // Compute diff when facts change after a time-travel operation
  useEffect(() => {
    if (!timeTravelEnabled) {
      return
    }

    const prev = prevFactsRef.current
    if (Object.keys(prev).length > 0) {
      const newDiff = computeDiff(prev, facts)
      if (newDiff.length > 0) {
        setDiff(newDiff)
      }
    } else if (Object.keys(facts).length > 0) {
      // Initial load — show current facts as the baseline
      setDiff(Object.entries(facts).map(([key, value]) => ({
        key, type: 'added' as const, newValue: value,
      })))
    }

    prevFactsRef.current = { ...facts }
  }, [facts, timeTravelEnabled])

  // Wrap shared hook callbacks with local diff tracking
  const onUndo = () => {
    prevFactsRef.current = { ...facts }
    handleUndo()
  }

  const onRedo = () => {
    prevFactsRef.current = { ...facts }
    handleRedo()
  }

  if (!connected) {
    return <EmptyState message="No Directive system connected" />
  }

  if (!timeTravelEnabled) {
    return (
      <div className="flex h-48 flex-col items-center justify-center">
        <div className="rounded border border-dashed border-zinc-200 px-3 py-2 text-center font-mono text-[10px] text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
          Enable <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">timeTravel: true</code> in debug config for time-travel debugging
        </div>
      </div>
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
          <div className="flex flex-col items-center gap-0.5">
            <div className="flex items-center gap-2 font-mono text-sm">
              <span className="text-xs text-zinc-400 dark:text-zinc-500">Step</span>
              <span className="text-sky-600 dark:text-sky-400">
                {snapshotIndex + 1}
              </span>
              <span className="text-zinc-400">/</span>
              <span className="text-zinc-500 dark:text-zinc-400">
                {snapshotCount}
              </span>
            </div>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
              Step through state snapshots
            </span>
          </div>

          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="cursor-pointer rounded border border-zinc-200 px-3 py-1.5 font-mono text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            ← Undo
          </button>

          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="cursor-pointer rounded border border-zinc-200 px-3 py-1.5 font-mono text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Redo →
          </button>
        </div>
      </div>

      {/* State diff */}
      {diff.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Changes
            <span className="ml-2 font-mono font-normal text-zinc-400 dark:text-zinc-500">
              {diff.length}
            </span>
          </h4>
          <div className="space-y-1">
            {diff.map((d) => (
              <div
                key={d.key}
                className="rounded border border-zinc-200 font-mono text-[11px] dark:border-zinc-700"
              >
                <div className="flex items-center gap-2">
                  <span className={`inline-block rounded px-1 py-px text-[9px] font-semibold uppercase leading-none ${
                    d.type === 'added'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : d.type === 'removed'
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  }`}>
                    {d.type}
                  </span>
                  <span className="text-sky-600 dark:text-sky-400">{d.key}</span>
                </div>
                {d.type === 'changed' && (
                  <div className="mt-2 space-y-1.5 overflow-x-auto">
                    <div className="rounded border border-red-200 bg-red-50 px-3 py-2 font-mono text-[11px] dark:border-red-800/50 dark:bg-red-900/30">
                      <DiffValue value={d.oldValue} />
                    </div>
                    <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 font-mono text-[11px] dark:border-emerald-800/50 dark:bg-emerald-900/30">
                      <DiffValue value={d.newValue} />
                    </div>
                  </div>
                )}
                {d.type === 'added' && (
                  <div className="mt-2 overflow-x-auto rounded border border-emerald-200 bg-emerald-50 px-3 py-2 font-mono text-[11px] dark:border-emerald-800/50 dark:bg-emerald-900/30">
                    <DiffValue value={d.newValue} />
                  </div>
                )}
                {d.type === 'removed' && (
                  <div className="mt-2 overflow-x-auto rounded border border-red-200 bg-red-50 px-3 py-2 font-mono text-[11px] dark:border-red-800/50 dark:bg-red-900/30">
                    <DiffValue value={d.oldValue} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
