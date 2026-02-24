'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DebugEvent } from '../types'
import { EVENT_COLORS, EVENT_LABELS, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from '../constants'
import { EmptyState } from '../EmptyState'

export function TimelineView({ events }: { events: DebugEvent[] }) {
  const [selected, setSelected] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const [tooltip, setTooltip] = useState<{
    x: number
    y: number
    events: DebugEvent[]
    laneId: string
  } | null>(null)

  const { agentIds, agentEventsMap, noAgentEvents, minTs, range } = useMemo(() => {
    if (events.length === 0) {
      return { agentIds: [], agentEventsMap: new Map<string, DebugEvent[]>(), noAgentEvents: [], minTs: 0, range: 1 }
    }

    const ids: string[] = []
    const map = new Map<string, DebugEvent[]>()
    const noAgent: DebugEvent[] = []

    for (const e of events) {
      if (e.agentId) {
        if (!map.has(e.agentId)) {
          ids.push(e.agentId)
          map.set(e.agentId, [])
        }
        map.get(e.agentId)!.push(e)
      } else {
        noAgent.push(e)
      }
    }

    const min = events[0].timestamp
    const max = events[events.length - 1].timestamp
    // 2% padding so the rightmost marker doesn't overflow the lane
    const raw = Math.max(max - min, 1)
    const padded = Math.ceil(raw * 1.02)

    return { agentIds: ids, agentEventsMap: map, noAgentEvents: noAgent, minTs: min, range: padded }
  }, [events])

  // Auto-scroll to right edge when new events arrive (if follow is on)
  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
    }
  }, [events, follow, zoom])

  // M2: Wheel zoom + touch support via CSS touch-action
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z - e.deltaY * ZOOM_STEP * 0.01)))
    }
  }, [])

  // Disable follow when user manually scrolls left
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 10
    if (!atEnd && follow) {
      setFollow(false)
    }
    if (atEnd && !follow) {
      setFollow(true)
    }
  }, [follow])

  // Hover tooltip: find events near cursor position in a lane
  const handleLaneMouseMove = useCallback((e: React.MouseEvent, laneEvents: DebugEvent[], laneId: string) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const xRatio = (e.clientX - rect.left) / rect.width
    const cursorTs = minTs + xRatio * range
    // Threshold: 1.5% of total range or 100ms, whichever is larger
    const threshold = Math.max(range * 0.015, 100)

    const nearby = laneEvents.filter((ev) => Math.abs(ev.timestamp - cursorTs) <= threshold)

    if (nearby.length > 0) {
      setTooltip({ x: e.clientX, y: e.clientY, events: nearby, laneId })
    } else {
      setTooltip(null)
    }
  }, [minTs, range])

  const handleLaneMouseLeave = useCallback(() => {
    setTooltip(null)
  }, [])

  if (events.length === 0) {
    return <EmptyState message="Waiting for first message..." />
  }

  // Visible time range ticks (computed from zoom-adjusted range)
  const visibleRange = range / zoom
  const tickCount = 5
  const _tickStep = visibleRange / (tickCount - 1)

  // Render a single lane of events
  const renderLane = (laneEvents: DebugEvent[], laneId: string) => {
    // Build runtime spans by pairing agent_start -> agent_complete/agent_error.
    // Each start is consumed by the NEXT complete or error, so a failed run
    // produces a short span ending at the error — not stretching to the next run.
    const runtimeSpans: { startTs: number; endTs: number; durationMs: number; error: boolean }[] = []
    const starts: number[] = []
    for (const e of laneEvents) {
      if (e.type === 'agent_start') {
        starts.push(e.timestamp)
      } else if ((e.type === 'agent_complete' || e.type === 'agent_error') && starts.length > 0) {
        const startTs = starts.shift()!
        runtimeSpans.push({ startTs, endTs: e.timestamp, durationMs: e.timestamp - startTs, error: e.type === 'agent_error' })
      }
    }

    return (
      <div
        className="relative h-7 w-full rounded bg-zinc-100 dark:bg-zinc-800/50"
        onMouseMove={(e) => handleLaneMouseMove(e, laneEvents, laneId)}
        onMouseLeave={handleLaneMouseLeave}
      >
        {/* Runtime spans */}
        {runtimeSpans.map((span, i) => {
          const left = ((span.startTs - minTs) / range) * 100
          const width = (span.durationMs / range) * 100

          return (
            <div
              key={`span-${i}`}
              className={`pointer-events-none absolute top-1 h-5 rounded-sm ${span.error ? 'bg-red-500/15 dark:bg-red-400/10' : 'bg-emerald-500/15 dark:bg-emerald-400/10'}`}
              style={{ left: `${left}%`, width: `${Math.max(width, 0.3)}%`, minWidth: '4px' }}
            />
          )
        })}

        {/* Event markers */}
        {laneEvents.map((e) => {
          const left = ((e.timestamp - minTs) / range) * 100
          const label = EVENT_LABELS[e.type] ?? e.type
          const isSelected = e.id === selected

          return (
            <button
              key={e.id}
              aria-label={`${label}: ${laneId}${e.durationMs ? `, ${e.durationMs}ms` : ''}${e.guardrailName ? `, ${e.guardrailName}` : ''}`}
              className={`absolute top-1 z-10 h-5 cursor-pointer rounded-sm ${EVENT_COLORS[e.type] ?? 'bg-zinc-400'} ${isSelected ? 'opacity-100 ring-2 ring-white' : 'opacity-80'} transition-opacity hover:opacity-100`}
              style={{ left: `${left}%`, width: '6px' }}
              onClick={() => setSelected(e.id === selected ? null : e.id)}
              title={`${e.type}${e.durationMs ? ` (${e.durationMs}ms)` : ''}${e.guardrailName ? `: ${e.guardrailName}` : ''}`}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Zoom controls — M2: dedicated +/- buttons for mobile */}
      <div className="flex items-center gap-2">
        <button
          className="cursor-pointer rounded px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / 1.5))}
          aria-label="Zoom out"
        >
          −
        </button>
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.1}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-1 w-20 cursor-pointer accent-sky-500"
          aria-label="Timeline zoom"
        />
        <button
          className="cursor-pointer rounded px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * 1.5))}
          aria-label="Zoom in"
        >
          +
        </button>
        <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">{zoom.toFixed(1)}x</span>
        <div className="flex-1" />
        {/* m2: Renamed "Following" to "Auto-scroll" for clarity */}
        <button
          className={`cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] transition ${follow ? 'bg-sky-500/20 text-sky-500' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
          onClick={() => { setFollow(!follow); if (!follow && scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth }}
          aria-label={follow ? 'Auto-scroll enabled' : 'Enable auto-scroll'}
        >
          {follow ? 'Auto-scroll' : 'Auto-scroll'}
        </button>
        {zoom > 1 && (
          <button
            className="cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            onClick={() => setZoom(1)}
          >
            Reset
          </button>
        )}
      </div>

      {/* Timeline area: fixed labels on left, scrollable lanes on right */}
      <div className="flex gap-3">
        {/* Fixed lane labels — m1: truncate class for long agent names */}
        <div className="w-28 shrink-0 space-y-2">
          {agentIds.map((agentId) => (
            <div key={agentId} className="flex h-7 items-center justify-end">
              <span className="max-w-full truncate font-mono text-xs text-zinc-400 dark:text-zinc-500" title={agentId}>
                {agentId}
              </span>
            </div>
          ))}
          {noAgentEvents.length > 0 && (
            <div className="flex h-7 items-center justify-end">
              <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
                system
              </span>
            </div>
          )}
          {/* Spacer for time axis row */}
          <div className="h-4" />
        </div>

        {/* Scrollable lanes + time axis below — M2: touch-pan-x for mobile */}
        <div className="min-w-0 flex-1">
          <div
            ref={scrollRef}
            className="overflow-x-auto devtools-timeline-scroll pb-2"
            style={{ touchAction: 'pan-x' }}
            onWheel={handleWheel}
            onScroll={handleScroll}
          >
            <div className="space-y-2" style={{ width: `${zoom * 100}%`, minWidth: '100%' }}>
              {agentIds.map((agentId) => (
                <div key={agentId}>
                  {renderLane(agentEventsMap.get(agentId) ?? [], agentId)}
                </div>
              ))}
              {noAgentEvents.length > 0 && renderLane(noAgentEvents, 'system')}

              {/* Time axis — inside scroll container so it scales with zoom */}
              <div className="relative h-4">
                {Array.from({ length: tickCount }).map((_, i) => {
                  const pct = (i / (tickCount - 1)) * 100
                  const timeS = ((range / 1000) * (i / (tickCount - 1))).toFixed(1)

                  return (
                    <span
                      key={i}
                      className="absolute font-mono text-[10px] text-zinc-400 dark:text-zinc-500"
                      style={{ left: `${pct}%`, transform: i === tickCount - 1 ? 'translateX(-100%)' : i > 0 ? 'translateX(-50%)' : undefined }}
                    >
                      {timeS}s
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Selected event detail */}
      {selected !== null && (() => {
        const idx = events.findIndex((ev) => ev.id === selected)
        if (idx === -1) {
          return null
        }
        const e = events[idx]

        return (
          <div className="mt-2 rounded border border-zinc-200 bg-white p-3 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-800">
            {/* Navigation header */}
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button
                  className="cursor-pointer rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:cursor-default disabled:opacity-30 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                  disabled={idx === 0}
                  onClick={() => setSelected(events[idx - 1].id)}
                  aria-label="Previous event"
                >
                  ◀
                </button>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                  {idx + 1} of {events.length}
                </span>
                <button
                  className="cursor-pointer rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:cursor-default disabled:opacity-30 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                  disabled={idx === events.length - 1}
                  onClick={() => setSelected(events[idx + 1].id)}
                  aria-label="Next event"
                >
                  ▶
                </button>
              </div>
              <button
                className="cursor-pointer rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                onClick={() => setSelected(null)}
                aria-label="Close detail panel"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1">
              <div>
                <span className="text-zinc-500">type:</span>{' '}
                <span className={`inline-block rounded px-1 py-0.5 text-white text-[10px] ${EVENT_COLORS[e.type] ?? 'bg-zinc-400'}`}>
                  {e.type}
                </span>
              </div>
              {e.agentId && (
                <div><span className="text-zinc-500">agent:</span> {e.agentId}</div>
              )}
              {e.modelId && (
                <div><span className="text-zinc-500">model:</span> {String(e.modelId)}</div>
              )}
              {e.guardrailName && (
                <div><span className="text-zinc-500">guardrail:</span> {e.guardrailName}</div>
              )}
              {e.guardrailType && (
                <div><span className="text-zinc-500">guardrailType:</span> {e.guardrailType}</div>
              )}
              {e.passed !== undefined && (
                <div>
                  <span className="text-zinc-500">passed:</span>{' '}
                  <span className={e.passed ? 'text-emerald-500' : 'text-red-500'}>
                    {String(e.passed)}
                  </span>
                </div>
              )}
              {e.reason && (
                <div><span className="text-zinc-500">reason:</span> <span className="text-red-400">{e.reason}</span></div>
              )}
              {e.totalTokens !== undefined && (
                <div><span className="text-zinc-500">tokens:</span> {e.totalTokens}{e.inputTokens ? ` (in: ${e.inputTokens}, out: ${e.outputTokens})` : ''}</div>
              )}
              {e.durationMs !== undefined && (
                <div><span className="text-zinc-500">duration:</span> {e.durationMs}ms</div>
              )}
              {e.inputLength !== undefined && (
                <div><span className="text-zinc-500">inputLength:</span> {e.inputLength}</div>
              )}
              {e.outputLength !== undefined && (
                <div><span className="text-zinc-500">outputLength:</span> {e.outputLength}</div>
              )}
              <div><span className="text-zinc-500">time:</span> {new Date(e.timestamp).toLocaleTimeString()}</div>
            </div>
          </div>
        )
      })()}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 pt-1">
        {Object.entries(EVENT_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className={`h-2.5 w-2.5 rounded-sm ${color}`} aria-hidden="true" />
            <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
              {EVENT_LABELS[type] ?? type}
            </span>
          </div>
        ))}
      </div>

      {/* Hover tooltip — shows all events near cursor position */}
      {tooltip && tooltip.events.length > 0 && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl"
          style={{
            left: `${tooltip.x + 12}px`,
            top: `${tooltip.y - 8}px`,
            transform: 'translateY(-100%)',
          }}
        >
          <div className="mb-1.5 font-mono text-[10px] font-medium text-zinc-400">
            {tooltip.laneId} · {tooltip.events.length} event{tooltip.events.length !== 1 ? 's' : ''}
          </div>
          <div className="space-y-1">
            {tooltip.events.slice(0, 8).map((e) => (
              <div key={e.id} className="flex items-center gap-2 font-mono text-[10px]">
                <div className={`h-2 w-2 shrink-0 rounded-sm ${EVENT_COLORS[e.type] ?? 'bg-zinc-400'}`} />
                <span className="text-zinc-300">{EVENT_LABELS[e.type] ?? e.type}</span>
                {e.guardrailName && (
                  <span className="text-zinc-500">({e.guardrailName})</span>
                )}
                {e.passed !== undefined && (
                  <span className={e.passed ? 'text-emerald-400' : 'text-red-400'}>
                    {e.passed ? '✓' : '✗'}
                  </span>
                )}
                {e.durationMs !== undefined && (
                  <span className="text-zinc-500">{e.durationMs}ms</span>
                )}
              </div>
            ))}
            {tooltip.events.length > 8 && (
              <div className="font-mono text-[10px] text-zinc-500">
                +{tooltip.events.length - 8} more
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
