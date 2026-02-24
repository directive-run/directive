'use client'

import { useMemo } from 'react'
import type { DebugEvent } from '../types'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { FLAMECHART_COLORS } from '../constants'
import { EmptyState } from '../EmptyState'

// C3: Span building and row assignment wrapped in useMemo

interface Span {
  agentId: string
  startTs: number
  endTs: number
  durationMs: number
  tokens: number
  modelId: string | null
}

export function FlamechartView() {
  const system = useDevToolsSystem()
  const events = useSelector(system, (s) => s.facts.connection.events)
  // C3: Memoize span building, sorting, and row assignment
  const { spans, agentIds, colorMap, rows, totalDuration, range, baseTs } = useMemo(() => {
    if (events.length === 0) {
      return { spans: [], agentIds: [], colorMap: new Map<string, string>(), rows: [] as Span[][], totalDuration: 0, range: 1, baseTs: 0 }
    }

    const base = events[0].timestamp
    const maxTs = events[events.length - 1].timestamp
    // 2% padding so rightmost span doesn't clip
    const r = Math.max(maxTs - base, 1) * 1.02

    // Build spans: pair agent_start -> agent_complete per agent
    const builtSpans: Span[] = []
    const openStarts = new Map<string, DebugEvent>()

    for (const e of events) {
      const agent = e.agentId ?? 'system'
      if (e.type === 'agent_start') {
        openStarts.set(agent, e)
      } else if (e.type === 'agent_complete') {
        const start = openStarts.get(agent)
        if (start) {
          builtSpans.push({
            agentId: agent,
            startTs: start.timestamp,
            endTs: e.timestamp,
            durationMs: e.timestamp - start.timestamp,
            tokens: e.totalTokens ?? 0,
            modelId: (e.modelId as string) ?? null,
          })
          openStarts.delete(agent)
        }
      }
    }

    // Add guardrail spans (short but visible)
    for (const e of events) {
      if (e.type === 'guardrail_check' && e.durationMs) {
        builtSpans.push({
          agentId: e.guardrailName ?? 'guardrail',
          startTs: e.timestamp - e.durationMs,
          endTs: e.timestamp,
          durationMs: e.durationMs,
          tokens: 0,
          modelId: null,
        })
      }
    }

    // Sort by start time, then by duration (longest first for nesting)
    builtSpans.sort((a, b) => a.startTs - b.startTs || b.durationMs - a.durationMs)

    // Assign color per unique agent
    const ids = [...new Set(builtSpans.map((s) => s.agentId))]
    const cMap = new Map(ids.map((id, i) => [id, FLAMECHART_COLORS[i % FLAMECHART_COLORS.length]]))

    // Row assignment: each span gets a row based on overlap
    const builtRows: Span[][] = []
    for (const span of builtSpans) {
      let placed = false
      for (const row of builtRows) {
        const last = row[row.length - 1]
        if (span.startTs >= last.endTs) {
          row.push(span)
          placed = true
          break
        }
      }
      if (!placed) {
        builtRows.push([span])
      }
    }

    return { spans: builtSpans, agentIds: ids, colorMap: cMap, rows: builtRows, totalDuration: r / 1000, range: r, baseTs: base }
  }, [events])

  if (events.length === 0) {
    return <EmptyState message="No events recorded yet." />
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">{spans.length} spans across {agentIds.length} agents</span>
        <span className="font-mono text-zinc-400 dark:text-zinc-500">{totalDuration.toFixed(1)}s total</span>
      </div>

      {/* Flamechart rows */}
      <div className="space-y-0.5">
        {rows.map((row, rowIdx) => (
          <div key={rowIdx} className="relative h-6">
            {row.map((span, spanIdx) => {
              const left = ((span.startTs - baseTs) / range) * 100
              const width = (span.durationMs / range) * 100

              return (
                <div
                  key={spanIdx}
                  className={`absolute top-0 h-full rounded-sm ${colorMap.get(span.agentId)} opacity-85 hover:opacity-100 transition-opacity`}
                  style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%`, minWidth: '3px' }}
                  title={`${span.agentId}${span.modelId ? ` (${span.modelId})` : ''} — ${span.durationMs}ms${span.tokens ? `, ${span.tokens} tokens` : ''}`}
                >
                  {/* m3: drop-shadow for readability on light colored bars */}
                  {width > 8 && (
                    <span className="absolute inset-0 flex items-center truncate px-1 text-[9px] font-medium text-white drop-shadow-sm">
                      {span.agentId} {span.durationMs}ms
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Time axis */}
      <div className="relative h-4">
        {Array.from({ length: 5 }).map((_, i) => {
          const pct = (i / 4) * 100
          const timeS = (totalDuration * (i / 4)).toFixed(1)

          return (
            <span
              key={i}
              className="absolute font-mono text-[10px] text-zinc-400 dark:text-zinc-500"
              style={{ left: `${pct}%`, transform: i === 4 ? 'translateX(-100%)' : i > 0 ? 'translateX(-50%)' : undefined }}
            >
              {timeS}s
            </span>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {agentIds.map((id) => (
          <div key={id} className="flex items-center gap-1.5">
            <div className={`h-2.5 w-2.5 rounded-sm ${colorMap.get(id)}`} />
            <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{id}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
