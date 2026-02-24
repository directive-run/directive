'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useDirectiveRef, useSelector } from '@directive-run/react'
import type { ConnectionStatus } from './devtools/types'
import { VIEWS } from './devtools/constants'
import { DevToolsUrlContext, type DevToolsUrls } from './devtools/DevToolsUrlContext'
import { DevToolsSystemContext, useDevToolsSystem } from './devtools/DevToolsSystemContext'
import { devtoolsShell } from './devtools/modules/devtools-shell'
import { devtoolsConnection } from './devtools/modules/devtools-connection'
import { devtoolsSnapshot } from './devtools/modules/devtools-snapshot'
import { useDevToolsStream } from './devtools/hooks/useDevToolsStream'
import { TimelineView } from './devtools/views/TimelineView'
import { CostView } from './devtools/views/CostView'
import { StateView } from './devtools/views/StateView'
import { GuardrailsView } from './devtools/views/GuardrailsView'
import { EventsView } from './devtools/views/EventsView'
import { HealthView } from './devtools/views/HealthView'
import { FlamechartView } from './devtools/views/FlamechartView'
import { GraphView } from './devtools/views/GraphView'
import { MemoryView } from './devtools/views/MemoryView'
import { BudgetView } from './devtools/views/BudgetView'
import { ConfigView } from './devtools/views/ConfigView'
import { GoalView } from './devtools/views/GoalProgressView'

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

  // One namespaced Directive system for all DevTools state
  const system = useDirectiveRef({
    modules: {
      shell: devtoolsShell,
      connection: devtoolsConnection,
      snapshot: devtoolsSnapshot,
    },
  })

  // Initialize URLs into system facts
  useEffect(() => {
    system.events.connection.setStreamUrl({ url: urls.streamUrl })
    system.events.snapshot.setSnapshotUrl({ url: urls.snapshotUrl })
  }, [system, urls])

  return (
    <DevToolsUrlContext.Provider value={urls}>
      <DevToolsSystemContext.Provider value={system}>
        <LiveDevToolsInner />
      </DevToolsSystemContext.Provider>
    </DevToolsUrlContext.Provider>
  )
}

function LiveDevToolsInner() {
  const system = useDevToolsSystem()

  // Thin EventSource bridge — all state lives in the system
  const { reconnect } = useDevToolsStream()

  // Read shell state from system (defaults for pre-init render)
  const view = useSelector(system, (s) => s.facts.shell.activeView) ?? 'Timeline'
  const confirmClear = useSelector(system, (s) => s.facts.shell.confirmClear) ?? false
  const isFullscreen = useSelector(system, (s) => s.facts.shell.isFullscreen) ?? false

  // Read connection state from system
  const status = useSelector(system, (s) => s.facts.connection.status) ?? 'connecting'
  const exhaustedRetries = useSelector(system, (s) => s.derive.connection.exhaustedRetries) ?? false
  const events = useSelector(system, (s) => s.facts.connection.events) ?? []
  const totalTokens = useSelector(system, (s) => s.derive.connection.totalTokens) ?? 0

  // m4: extended clear confirmation from 3s to 5s (now handled by constraint + resolver)
  const handleClear = useCallback(() => {
    if (!confirmClear) {
      system.events.shell.startClear()

      return
    }
    system.events.shell.executeClear()
    system.events.connection.clearEvents()
    system.events.snapshot.clearSnapshot()
  }, [confirmClear, system])

  // Arrow key navigation between tabs
  const handleTabKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    const idx = VIEWS.indexOf(view)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = VIEWS[(idx + 1) % VIEWS.length]
      system.events.shell.setView({ view: next })
      const container = e.currentTarget.parentElement
      const buttons = container?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      buttons?.[(idx + 1) % VIEWS.length]?.focus()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = VIEWS[(idx - 1 + VIEWS.length) % VIEWS.length]
      system.events.shell.setView({ view: prev })
      const container = e.currentTarget.parentElement
      const buttons = container?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      buttons?.[(idx - 1 + VIEWS.length) % VIEWS.length]?.focus()
    }
  }, [view, system])

  // Export events as JSON file
  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `devtools-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [events])

  // Import events from JSON file
  const fileInputRef = useRef<HTMLInputElement>(null)
  const handleImport = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result as string)
        if (Array.isArray(imported)) {
          system.events.connection.clearEvents()
          // Small delay so clear finishes first
          setTimeout(() => {
            system.events.connection.importEvents({ imported })
          }, 50)
        }
      } catch {
        console.warn('[DevTools] Failed to parse import file')
      }
    }
    reader.readAsText(file)
    // Reset so same file can be re-imported
    e.target.value = ''
  }, [system])

  // Escape key exits fullscreen
  useEffect(() => {
    if (!isFullscreen) {
      return
    }

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        system.events.shell.exitFullscreen()
      }
    }

    document.addEventListener('keydown', handleEsc)

    return () => document.removeEventListener('keydown', handleEsc)
  }, [isFullscreen, system])

  return (
    <div className={`flex flex-col overflow-hidden border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900 ${
      isFullscreen
        ? 'fixed inset-0 z-50 rounded-none'
        : 'h-full rounded-lg'
    }`}>
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
          <button
            onClick={handleExport}
            aria-label="Export events"
            title="Export"
            className="cursor-pointer rounded p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M8 1a.5.5 0 0 1 .5.5v9.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 1 1 .708-.708L7.5 11.293V1.5A.5.5 0 0 1 8 1z" />
              <path d="M2 13.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z" />
            </svg>
          </button>
          <button
            onClick={handleImport}
            aria-label="Import events"
            title="Import"
            className="cursor-pointer rounded p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M8 15a.5.5 0 0 1-.5-.5V4.707L5.354 6.854a.5.5 0 1 1-.708-.708l3-3a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 4.707V14.5A.5.5 0 0 1 8 15z" />
              <path d="M2 2.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => system.events.shell.toggleFullscreen()}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="cursor-pointer rounded p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M5.5 1a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1 0-1H4.3L1.15 1.15a.5.5 0 1 1 .7-.7L5 3.7V1.5a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v2.2l3.15-3.15a.5.5 0 1 1 .7.7L11.7 4.5h2.3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5zM1 10.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0v-2.3l-3.15 3.15a.5.5 0 0 1-.7-.7L3.3 11H1.5a.5.5 0 0 1-.5-.5zm9 0a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-2.3l3.15 3.15a.5.5 0 0 1-.7.7L10.5 11.7v2.3a.5.5 0 0 1-1 0v-3a.5.5 0 0 1 .5-.5z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M1.5 1a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 1 0V2.707l3.146 3.147a.5.5 0 1 0 .708-.708L2.707 2H4.5a.5.5 0 0 0 0-1h-3zm13 0a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0V2.707l-3.146 3.147a.5.5 0 1 1-.708-.708L13.293 2H11.5a.5.5 0 0 1 0-1h3zM1.5 15a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 1 0v1.793l3.146-3.147a.5.5 0 1 1 .708.708L2.707 14H4.5a.5.5 0 0 1 0 1h-3zm13 0a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-1 0v1.793l-3.146-3.147a.5.5 0 0 0-.708.708L13.293 14H11.5a.5.5 0 0 0 0 1h3z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* C2: Tab bar with horizontal scroll for mobile overflow */}
      <div className="relative border-b border-zinc-200 dark:border-zinc-700">
        {/* Gradient fade indicators for scroll overflow */}
        <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-6 bg-gradient-to-r from-white dark:from-zinc-900 sm:hidden" />
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
              onClick={() => system.events.shell.setView({ view: v })}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div
        className="min-h-0 flex-1 overflow-y-auto p-4"
        role="tabpanel"
        id={`devtools-tabpanel-${view.toLowerCase()}`}
        aria-label={`${view} view`}
      >
        {view === 'Timeline' && <TimelineView />}
        {view === 'Cost' && <CostView />}
        {view === 'State' && <StateView />}
        {view === 'Guardrails' && <GuardrailsView />}
        {view === 'Events' && <EventsView />}
        {view === 'Health' && <HealthView />}
        {view === 'Flamechart' && <FlamechartView />}
        {view === 'Graph' && <GraphView />}
        {view === 'Goal' && <GoalView />}
        {view === 'Memory' && <MemoryView />}
        {view === 'Budget' && <BudgetView />}
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
