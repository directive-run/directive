'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Types (local — avoids importing server-only @directive-run/ai into client)
// ---------------------------------------------------------------------------

interface DebugEvent {
  id: number
  type: string
  timestamp: number
  agentId?: string
  snapshotId: number | null
  totalTokens?: number
  durationMs?: number
  guardrailName?: string
  guardrailType?: string
  passed?: boolean
  reason?: string
  inputLength?: number
  outputLength?: number
  [key: string]: unknown
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'waiting'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EVENTS = 2000
const RECONNECT_DELAY = 3000

const EVENT_COLORS: Record<string, string> = {
  agent_start: 'bg-sky-500',
  agent_complete: 'bg-emerald-500',
  agent_error: 'bg-red-500',
  agent_retry: 'bg-red-400',
  guardrail_check: 'bg-amber-500',
  constraint_evaluate: 'bg-violet-500',
  resolver_start: 'bg-indigo-500',
  resolver_complete: 'bg-indigo-500',
  resolver_error: 'bg-red-500',
  reroute: 'bg-orange-500',
}

const EVENT_LABELS: Record<string, string> = {
  agent_start: 'Agent Start',
  agent_complete: 'Agent Complete',
  agent_error: 'Agent Error',
  agent_retry: 'Agent Retry',
  guardrail_check: 'Guardrail',
  constraint_evaluate: 'Constraint',
  resolver_start: 'Resolver Start',
  resolver_complete: 'Resolver Done',
  resolver_error: 'Resolver Error',
  reroute: 'Reroute',
}

const VIEWS = ['Timeline', 'Cost', 'State'] as const

// ---------------------------------------------------------------------------
// Hook: useDevToolsStream
// ---------------------------------------------------------------------------

function useDevToolsStream() {
  const [events, setEvents] = useState<DebugEvent[]>([])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const maxIdRef = useRef(-1)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
    }

    setStatus('connecting')
    const es = new EventSource('/api/devtools/stream')
    esRef.current = es

    es.onopen = () => {
      setStatus('connected')
    }

    es.onmessage = (msg) => {
      try {
        const event: DebugEvent = JSON.parse(msg.data)
        // Deduplicate on reconnect
        if (event.id <= maxIdRef.current) return
        maxIdRef.current = event.id

        setEvents((prev) => {
          const next = [...prev, event]
          if (next.length > MAX_EVENTS) {
            return next.slice(next.length - MAX_EVENTS)
          }

          return next
        })
      } catch {
        // Ignore malformed messages
      }
    }

    es.onerror = () => {
      es.close()
      esRef.current = null
      setStatus('disconnected')

      // Auto-reconnect
      retryTimerRef.current = setTimeout(() => {
        connect()
      }, RECONNECT_DELAY)
    }
  }, [])

  useEffect(() => {
    connect()

    return () => {
      esRef.current?.close()
      esRef.current = null
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
      }
    }
  }, [connect])

  const clear = useCallback(() => {
    setEvents([])
    maxIdRef.current = 0
  }, [])

  return { events, status, clear }
}

// ---------------------------------------------------------------------------
// Timeline View
// ---------------------------------------------------------------------------

function TimelineView({ events }: { events: DebugEvent[] }) {
  const [selected, setSelected] = useState<number | null>(null)

  if (events.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
        Waiting for first message...
      </div>
    )
  }

  // Extract unique agent IDs (preserve order)
  const agentIds: string[] = []
  for (const e of events) {
    if (e.agentId && !agentIds.includes(e.agentId)) {
      agentIds.push(e.agentId)
    }
  }

  const minTs = events[0].timestamp
  const maxTs = events[events.length - 1].timestamp
  const range = Math.max(maxTs - minTs, 1)

  return (
    <div className="space-y-3">
      {/* Agent lanes */}
      {agentIds.map((agentId) => {
        const agentEvents = events.filter((e) => e.agentId === agentId)

        return (
          <div key={agentId} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-right font-mono text-xs text-zinc-400 dark:text-zinc-500">
              {agentId}
            </span>
            <div className="relative h-7 flex-1 rounded bg-zinc-100 dark:bg-zinc-800/50">
              {agentEvents.map((e) => {
                const left = ((e.timestamp - minTs) / range) * 100
                const duration = e.durationMs ?? 0
                const width = Math.max((duration / range) * 100, 1.5)

                return (
                  <button
                    key={e.id}
                    className={`absolute top-1 h-5 rounded-sm ${EVENT_COLORS[e.type] ?? 'bg-zinc-400'} opacity-80 transition-opacity hover:opacity-100`}
                    style={{
                      left: `${Math.min(left, 98)}%`,
                      width: `${Math.max(width, 0.8)}%`,
                      minWidth: '6px',
                    }}
                    onClick={() => setSelected(e.id === selected ? null : e.id)}
                    title={`${e.type}${e.guardrailName ? `: ${e.guardrailName}` : ''}`}
                  />
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Non-agent events (constraints, resolvers without agentId) */}
      {(() => {
        const noAgent = events.filter((e) => !e.agentId)
        if (noAgent.length === 0) return null

        return (
          <div className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-right font-mono text-xs text-zinc-400 dark:text-zinc-500">
              system
            </span>
            <div className="relative h-7 flex-1 rounded bg-zinc-100 dark:bg-zinc-800/50">
              {noAgent.map((e) => {
                const left = ((e.timestamp - minTs) / range) * 100

                return (
                  <button
                    key={e.id}
                    className={`absolute top-1 h-5 rounded-sm ${EVENT_COLORS[e.type] ?? 'bg-zinc-400'} opacity-80 transition-opacity hover:opacity-100`}
                    style={{
                      left: `${Math.min(left, 98)}%`,
                      minWidth: '6px',
                      width: '1%',
                    }}
                    onClick={() => setSelected(e.id === selected ? null : e.id)}
                    title={e.type}
                  />
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Time axis */}
      <div className="flex items-center gap-3">
        <span className="w-28 shrink-0" />
        <div className="flex flex-1 justify-between font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
          <span>0s</span>
          <span>{((range / 1000) * 0.25).toFixed(1)}s</span>
          <span>{((range / 1000) * 0.5).toFixed(1)}s</span>
          <span>{((range / 1000) * 0.75).toFixed(1)}s</span>
          <span>{(range / 1000).toFixed(1)}s</span>
        </div>
      </div>

      {/* Selected event detail */}
      {selected && (() => {
        const e = events.find((ev) => ev.id === selected)
        if (!e) return null

        return (
          <div className="mt-2 rounded border border-zinc-200 bg-white p-3 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-800">
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
                <div><span className="text-zinc-500">reason:</span> {e.reason}</div>
              )}
              {e.totalTokens !== undefined && (
                <div><span className="text-zinc-500">tokens:</span> {e.totalTokens}</div>
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
            <div className={`h-2.5 w-2.5 rounded-sm ${color}`} />
            <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
              {EVENT_LABELS[type] ?? type}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cost View
// ---------------------------------------------------------------------------

function CostView({ events }: { events: DebugEvent[] }) {
  const completeEvents = events.filter((e) => e.type === 'agent_complete')

  if (completeEvents.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
        No completed agent runs yet.
      </div>
    )
  }

  // Group by agentId
  const agentMap = new Map<string, { runs: number; tokens: number }>()
  for (const e of completeEvents) {
    const id = e.agentId ?? 'unknown'
    const prev = agentMap.get(id) ?? { runs: 0, tokens: 0 }
    agentMap.set(id, {
      runs: prev.runs + 1,
      tokens: prev.tokens + (e.totalTokens ?? 0),
    })
  }

  const agents = Array.from(agentMap.entries()).map(([agent, data]) => ({
    agent,
    ...data,
  }))

  const totalTokens = agents.reduce((s, a) => s + a.tokens, 0)

  // Stacked bar colors
  const BAR_COLORS = ['bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-indigo-500']

  return (
    <div className="space-y-4">
      <div className="flex gap-6 text-xs">
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Total tokens</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">{totalTokens.toLocaleString()}</div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Est. cost</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">
            ${(totalTokens * 0.00001).toFixed(4)}
          </div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Runs</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">
            {completeEvents.length}
          </div>
        </div>
      </div>

      {/* Stacked bar */}
      {totalTokens > 0 && (
        <div className="flex h-6 overflow-hidden rounded">
          {agents.map((a, i) => {
            const pct = (a.tokens / totalTokens) * 100

            return (
              <div
                key={a.agent}
                className={BAR_COLORS[i % BAR_COLORS.length]}
                style={{ width: `${pct}%` }}
                title={`${a.agent}: ${a.tokens} tokens (${pct.toFixed(0)}%)`}
              />
            )
          })}
        </div>
      )}

      {/* Table */}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            <th className="py-1 text-left font-medium">Agent</th>
            <th className="py-1 text-right font-medium">Runs</th>
            <th className="py-1 text-right font-medium">Tokens</th>
            <th className="py-1 text-right font-medium">%</th>
          </tr>
        </thead>
        <tbody className="text-zinc-700 dark:text-zinc-300">
          {agents.map((a) => (
            <tr key={a.agent} className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5 font-mono">{a.agent}</td>
              <td className="py-1.5 text-right">{a.runs}</td>
              <td className="py-1.5 text-right">{a.tokens.toLocaleString()}</td>
              <td className="py-1.5 text-right">
                {totalTokens > 0 ? ((a.tokens / totalTokens) * 100).toFixed(0) : 0}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// State View
// ---------------------------------------------------------------------------

interface SnapshotData {
  timestamp: number
  eventCount: number
  totalTokens: number
  chatbot: {
    totalRequests: number
    totalTokensUsed: number
    consecutiveErrors: number
    isHealthy: boolean
    activeIPs: number
  }
}

function StateView() {
  const [data, setData] = useState<SnapshotData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const fetchSnapshot = async () => {
      try {
        const res = await fetch('/api/devtools/snapshot')
        if (!res.ok) {
          setError('Orchestrator not initialized')

          return
        }
        const json = await res.json()
        if (mounted) {
          setData(json)
          setError(null)
        }
      } catch {
        if (mounted) {
          setError('Failed to fetch snapshot')
        }
      }
    }

    fetchSnapshot()
    const interval = setInterval(fetchSnapshot, 5000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  if (error) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
        {error}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
        Loading...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Timeline
        </h4>
        <div className="space-y-1">
          <KV label="eventCount" value={String(data.eventCount)} color="sky" />
          <KV label="totalTokens" value={String(data.totalTokens)} color="sky" />
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Chatbot System
        </h4>
        <div className="space-y-1">
          <KV label="totalRequests" value={String(data.chatbot.totalRequests)} color="violet" />
          <KV label="totalTokensUsed" value={String(data.chatbot.totalTokensUsed)} color="violet" />
          <KV label="consecutiveErrors" value={String(data.chatbot.consecutiveErrors)} color="violet" />
          <KV
            label="isHealthy"
            value={String(data.chatbot.isHealthy)}
            color="violet"
            highlight={data.chatbot.isHealthy ? 'text-emerald-500' : 'text-red-500'}
          />
          <KV label="activeIPs" value={String(data.chatbot.activeIPs)} color="violet" />
        </div>
      </div>

      <div className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
        Last updated: {new Date(data.timestamp).toLocaleTimeString()}
      </div>
    </div>
  )
}

function KV({ label, value, color, highlight }: { label: string; value: string; color: 'sky' | 'violet'; highlight?: string }) {
  const labelColor = color === 'sky' ? 'text-sky-600 dark:text-sky-400' : 'text-violet-600 dark:text-violet-400'

  return (
    <div className="flex font-mono text-xs">
      <span className={`w-40 shrink-0 ${labelColor}`}>{label}</span>
      <span className={highlight ?? 'text-zinc-700 dark:text-zinc-300'}>{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status Indicator
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: ConnectionStatus }) {
  const colors: Record<ConnectionStatus, string> = {
    connected: 'bg-emerald-500',
    connecting: 'bg-amber-400 animate-pulse',
    disconnected: 'bg-red-500',
    waiting: 'bg-zinc-400 animate-pulse',
  }

  const labels: Record<ConnectionStatus, string> = {
    connected: 'Live',
    connecting: 'Connecting',
    disconnected: 'Disconnected',
    waiting: 'Waiting',
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className={`h-2 w-2 rounded-full ${colors[status]}`} />
      <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
        {labels[status]}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function LiveDevTools() {
  const { events, status, clear } = useDevToolsStream()
  const [view, setView] = useState<(typeof VIEWS)[number]>('Timeline')

  const totalTokens = events
    .filter((e) => e.type === 'agent_complete')
    .reduce((s, e) => s + (e.totalTokens ?? 0), 0)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800/50">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="h-3 w-3 rounded-full bg-red-400" />
            <div className="h-3 w-3 rounded-full bg-amber-400" />
            <div className="h-3 w-3 rounded-full bg-emerald-400" />
          </div>
          <span className="ml-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Directive DevTools
          </span>
        </div>
        <div className="flex items-center gap-3">
          <StatusDot status={status} />
          <button
            onClick={clear}
            className="rounded px-2 py-0.5 font-mono text-[10px] text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
          >
            Clear
          </button>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex gap-0 border-b border-zinc-200 px-4 dark:border-zinc-700">
        {VIEWS.map((v) => (
          <button
            key={v}
            className={`border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
              v === view
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300'
            }`}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {view === 'Timeline' && <TimelineView events={events} />}
        {view === 'Cost' && <CostView events={events} />}
        {view === 'State' && <StateView />}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-4 py-1.5 font-mono text-[10px] text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-500">
        <span>
          {events.length} events | {totalTokens.toLocaleString()} tokens
        </span>
        <span>{status === 'connected' ? 'Streaming' : status}</span>
      </div>
    </div>
  )
}
