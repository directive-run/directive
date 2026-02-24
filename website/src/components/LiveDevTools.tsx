'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type { ConnectionStatus } from './devtools/types'
import { VIEWS } from './devtools/constants'
import { DevToolsUrlContext, type DevToolsUrls } from './devtools/DevToolsUrlContext'
import { useDevToolsStream } from './devtools/hooks/useDevToolsStream'
import { TimelineView } from './devtools/views/TimelineView'
import { CostView } from './devtools/views/CostView'
import { StateView } from './devtools/views/StateView'
import { GuardrailsView } from './devtools/views/GuardrailsView'
import { EventsView } from './devtools/views/EventsView'
import { HealthView } from './devtools/views/HealthView'
import { FlamechartView } from './devtools/views/FlamechartView'
import { DAGView } from './devtools/views/DAGView'
import { MemoryView } from './devtools/views/MemoryView'
import { BudgetView } from './devtools/views/BudgetView'
import { ConfigView } from './devtools/views/ConfigView'

// ---------------------------------------------------------------------------
// StatusDot — m6: amber-500 for WCAG contrast (was amber-400)
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: ConnectionStatus }) {
  const colors: Record<ConnectionStatus, string> = {
    connected: 'bg-emerald-500',
    connecting: 'bg-amber-500 animate-pulse',
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
      <div className={`h-2 w-2 rounded-full ${colors[status]}`} aria-hidden="true" />
      <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
        {labels[status]}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface LiveDevToolsProps {
  streamUrl?: string
  snapshotUrl?: string
}

export function LiveDevTools({ streamUrl, snapshotUrl }: LiveDevToolsProps = {}) {
  const urls = useMemo<DevToolsUrls>(() => ({
    streamUrl: streamUrl ?? '/api/devtools/stream',
    snapshotUrl: snapshotUrl ?? '/api/devtools/snapshot',
  }), [streamUrl, snapshotUrl])

  return (
    <DevToolsUrlContext.Provider value={urls}>
      <LiveDevToolsInner />
    </DevToolsUrlContext.Provider>
  )
}

function LiveDevToolsInner() {
  const { events, status, clear, reconnect, exhaustedRetries } = useDevToolsStream()
  const [view, setView] = useState<(typeof VIEWS)[number]>('Timeline')
  const [confirmClear, setConfirmClear] = useState(false)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const totalTokens = events
    .filter((e) => e.type === 'agent_complete')
    .reduce((s, e) => s + (e.totalTokens ?? 0), 0)

  // m4: extended clear confirmation from 3s to 5s
  const handleClear = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true)
      clearTimerRef.current = setTimeout(() => setConfirmClear(false), 5000)

      return
    }
    clear()
    setConfirmClear(false)
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current)
    }
  }, [confirmClear, clear])

  // Arrow key navigation between tabs
  const handleTabKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    const idx = VIEWS.indexOf(view)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = VIEWS[(idx + 1) % VIEWS.length]
      setView(next)
      const container = e.currentTarget.parentElement
      const buttons = container?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      buttons?.[(idx + 1) % VIEWS.length]?.focus()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = VIEWS[(idx - 1 + VIEWS.length) % VIEWS.length]
      setView(prev)
      const container = e.currentTarget.parentElement
      const buttons = container?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      buttons?.[(idx - 1 + VIEWS.length) % VIEWS.length]?.focus()
    }
  }, [view])

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <style>{`
        .devtools-timeline-scroll::-webkit-scrollbar {
          height: 6px;
        }
        .devtools-timeline-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .devtools-timeline-scroll::-webkit-scrollbar-thumb {
          background: rgba(161, 161, 170, 0.15);
          border-radius: 3px;
        }
        .devtools-timeline-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(161, 161, 170, 0.3);
        }
        @media (prefers-color-scheme: dark) {
          .devtools-timeline-scroll::-webkit-scrollbar-thumb {
            background: rgba(161, 161, 170, 0.1);
          }
          .devtools-timeline-scroll::-webkit-scrollbar-thumb:hover {
            background: rgba(161, 161, 170, 0.25);
          }
        }
        .devtools-timeline-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(161, 161, 170, 0.15) transparent;
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800/50">
        <div className="flex items-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 36 36" fill="none" className="h-5 w-5">
            <g fill="none" strokeLinejoin="round" strokeLinecap="round">
              <path d="M6 8 L16 18 L6 28" stroke="var(--brand-primary)" strokeWidth={3} />
              <path d="M24 8 L24 28" stroke="var(--brand-accent)" strokeWidth={3} />
            </g>
          </svg>
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            DevTools
          </span>
        </div>
        <div className="flex items-center gap-3">
          <StatusDot status={status} />
          {/* M1: Show retry button when max retries exhausted */}
          {exhaustedRetries && (
            <button
              onClick={reconnect}
              className="cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/30"
            >
              Retry
            </button>
          )}
          <button
            onClick={handleClear}
            aria-label={confirmClear ? 'Confirm clear all events' : 'Clear all events'}
            className={`cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] transition ${
              confirmClear
                ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                : 'text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {confirmClear ? 'Confirm?' : 'Clear'}
          </button>
        </div>
      </div>

      {/* C2: Tab bar with horizontal scroll for mobile overflow */}
      <div className="relative border-b border-zinc-200 dark:border-zinc-700">
        {/* Gradient fade indicators for scroll overflow */}
        <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-6 bg-gradient-to-l from-white dark:from-zinc-900 sm:hidden" />
        <div
          className="flex gap-0 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="DevTools views"
        >
          {VIEWS.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={v === view}
              aria-controls={`devtools-tabpanel-${v.toLowerCase()}`}
              tabIndex={v === view ? 0 : -1}
              onKeyDown={handleTabKeyDown}
              className={`shrink-0 cursor-pointer border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
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
      </div>

      {/* Content */}
      <div
        className="flex-1 overflow-y-auto p-4"
        role="tabpanel"
        id={`devtools-tabpanel-${view.toLowerCase()}`}
        aria-label={`${view} view`}
      >
        {view === 'Timeline' && <TimelineView events={events} />}
        {view === 'Cost' && <CostView events={events} />}
        {view === 'State' && <StateView />}
        {view === 'Guardrails' && <GuardrailsView events={events} />}
        {view === 'Events' && <EventsView events={events} />}
        {view === 'Health' && <HealthView />}
        {view === 'Flamechart' && <FlamechartView events={events} />}
        {view === 'DAG' && <DAGView events={events} />}
        {view === 'Memory' && <MemoryView />}
        {view === 'Budget' && <BudgetView events={events} />}
        {view === 'Config' && <ConfigView />}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-4 py-1.5 font-mono text-[10px] text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-500">
        <span>
          {events.length} events | {totalTokens.toLocaleString()} tokens
        </span>
        <span>
          {exhaustedRetries
            ? 'Connection lost — click Retry'
            : status === 'connected' ? 'Streaming' : status}
        </span>
      </div>
    </div>
  )
}
