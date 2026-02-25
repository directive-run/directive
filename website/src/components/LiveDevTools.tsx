'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSelector } from '@directive-run/react'
import type { ConnectionStatus } from './devtools/types'
import { SYSTEM_VIEWS, AI_VIEWS, VIEWS, SNAPSHOT_POLL_INTERVAL } from './devtools/constants'
import { useDevToolsSystem } from './devtools/DevToolsSystemContext'
import { DevToolsProvider } from './devtools/DevToolsProvider'
import { useDevToolsStream } from './devtools/hooks/useDevToolsStream'
import { TimelineView } from './devtools/views/TimelineView'
import { CostView } from './devtools/views/CostView'
import { StateView } from './devtools/views/StateView'
import { GuardrailsView } from './devtools/views/GuardrailsView'
import { EventsView } from './devtools/views/EventsView'
import { HealthView } from './devtools/views/HealthView'
import { BreakpointsView } from './devtools/views/BreakpointsView'
import { GraphView } from './devtools/views/GraphView'
import { MemoryView } from './devtools/views/MemoryView'
import { BudgetView } from './devtools/views/BudgetView'
import { ConfigView } from './devtools/views/ConfigView'
import { GoalView } from './devtools/views/GoalProgressView'
import { FactsView } from './devtools/views/FactsView'
import { DerivationsView } from './devtools/views/DerivationsView'
import { ConstraintsView } from './devtools/views/ConstraintsView'
import { SystemGraphView } from './devtools/views/SystemGraphView'
import { TimeTravelView } from './devtools/views/TimeTravelView'
import { DirectiveLogomark } from './devtools/DirectiveLogomark'
import { SystemSelector } from './devtools/SystemSelector'
import { DevToolsErrorBoundary } from './devtools/DevToolsErrorBoundary'
import { Z_FULLSCREEN } from './devtools/z-index'
import { encodeReplay } from './devtools/utils/replay-codec'
import type { DebugEvent } from './devtools/types'

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
// DevToolsContent — the tab bar + views + footer
// ---------------------------------------------------------------------------

interface DevToolsContentProps {
  /** 'standalone' renders full header/footer/border. 'drawer' hides header (drawer provides its own). */
  mode?: 'standalone' | 'drawer'
}

export function DevToolsContent({ mode = 'standalone' }: DevToolsContentProps) {
  const system = useDevToolsSystem()

  // Thin EventSource bridge — all state lives in the system
  const { reconnect } = useDevToolsStream()

  // C3: Periodic poll bump to make snapshot constraint reactive
  useEffect(() => {
    const interval = setInterval(() => {
      system.events.snapshot.bumpPoll()
    }, SNAPSHOT_POLL_INTERVAL)

    return () => clearInterval(interval)
  }, [system])

  // Read shell state from system
  const view = useSelector(system, (s) => s.facts.shell.activeView)
  const confirmClear = useSelector(system, (s) => s.facts.shell.confirmClear)
  const isFullscreen = useSelector(system, (s) => s.facts.shell.isFullscreen)

  // Read connection state from system
  const status = useSelector(system, (s) => s.facts.connection.status)
  const exhaustedRetries = useSelector(system, (s) => s.derive.connection.exhaustedRetries)
  const events = useSelector(system, (s) => s.facts.connection.events)
  const totalTokens = useSelector(system, (s) => s.derive.connection.totalTokens)
  const isPaused = useSelector(system, (s) => s.facts.connection.isPaused)
  const pausedOnEvent = useSelector(system, (s) => s.facts.connection.pausedOnEvent)

  // Read runtime state
  const runtimeConnected = useSelector(system, (s) => s.facts.runtime.connected)
  const runtimeSystemName = useSelector(system, (s) => s.facts.runtime.systemName)

  // Determine which tab groups to show
  // System tabs: when a Directive runtime is connected via devtoolsPlugin
  const showSystemTabs = runtimeConnected
  // AI tabs: only when there are actual AI events (not just an SSE connection attempt)
  const showAiTabs = events.length > 0

  // Visible views based on which groups are connected
  const visibleViews = useMemo(() => {
    const views: Array<typeof VIEWS[number]> = []
    if (showSystemTabs) {
      views.push(...SYSTEM_VIEWS)
    }
    if (showAiTabs) {
      views.push(...AI_VIEWS)
    }
    // Fallback: show system tabs if runtime is present, otherwise AI tabs
    if (views.length === 0) {
      views.push(...(runtimeConnected ? SYSTEM_VIEWS : AI_VIEWS))
    }

    return views
  }, [showSystemTabs, showAiTabs, runtimeConnected])

  // Auto-switch active view when it's not in the visible set
  useEffect(() => {
    if (visibleViews.length > 0 && !visibleViews.includes(view as typeof visibleViews[number])) {
      system.events.shell.setView({ view: visibleViews[0] })
    }
  }, [visibleViews, view, system])

  // Check if a view belongs to system group
  const isSystemView = (v: string) => (SYSTEM_VIEWS as readonly string[]).includes(v)

  // Share button toast state
  const [shareToast, setShareToast] = useState(false)

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

  // Arrow key navigation between visible tabs
  const handleTabKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    const idx = visibleViews.indexOf(view as typeof visibleViews[number])
    if (idx === -1) {
      return
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = visibleViews[(idx + 1) % visibleViews.length]
      system.events.shell.setView({ view: next })
      const container = e.currentTarget.parentElement
      const buttons = container?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      buttons?.[(idx + 1) % visibleViews.length]?.focus()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = visibleViews[(idx - 1 + visibleViews.length) % visibleViews.length]
      system.events.shell.setView({ view: prev })
      const container = e.currentTarget.parentElement
      const buttons = container?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      buttons?.[(idx - 1 + visibleViews.length) % visibleViews.length]?.focus()
    }
  }, [view, visibleViews, system])

  // Export events as JSON file
  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `devtools-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`
    a.click()
    // M7: Delay revocation so browsers can start the download
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }, [events])

  // Import events from JSON file
  const fileInputRef = useRef<HTMLInputElement>(null)
  const handleImport = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // C4: Use replaceEvents for atomic import (no intermediate empty state)
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
          system.events.connection.replaceEvents({ events: imported })
        }
      } catch {
        console.warn('[DevTools] Failed to parse import file')
      }
    }
    reader.readAsText(file)
    // Reset so same file can be re-imported
    e.target.value = ''
  }, [system])

  // Phase 4: Share replay URL
  const handleShare = useCallback(() => {
    if (events.length === 0) {
      return
    }

    try {
      const encoded = encodeReplay(events)
      const shareUrl = `${window.location.origin}${window.location.pathname}#replay=${encoded}`
      navigator.clipboard.writeText(shareUrl).then(
        () => {
          setShareToast(true)
          setTimeout(() => setShareToast(false), 2000)
        },
        () => {
          console.warn('[DevTools] Clipboard write failed')
        },
      )
    } catch {
      console.warn('[DevTools] Failed to encode replay URL')
    }
  }, [events])

  // Escape key exits fullscreen (standalone mode only)
  useEffect(() => {
    if (mode !== 'standalone' || !isFullscreen) {
      return
    }

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        system.events.shell.exitFullscreen()
      }
    }

    document.addEventListener('keydown', handleEsc)

    return () => document.removeEventListener('keydown', handleEsc)
  }, [mode, isFullscreen, system])

  const isDrawer = mode === 'drawer'

  return (
    <div
      className={`flex flex-col overflow-hidden ${
        isDrawer
          ? 'h-full bg-white dark:bg-zinc-900'
          : `border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900 ${
              isFullscreen
                ? 'fixed inset-0 rounded-none'
                : 'h-full rounded-lg'
            }`
      }`}
      style={isFullscreen && !isDrawer ? { zIndex: Z_FULLSCREEN } : undefined}
    >
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

      {/* Header — hidden in drawer mode (drawer provides its own) */}
      {!isDrawer && (
        <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="flex items-center gap-2">
            <DirectiveLogomark />
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              DevTools
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* System selector — switch between multiple Directive systems */}
            <SystemSelector />
            {/* AI stream status */}
            <StatusDot status={status} />
            {/* Phase 5: Paused badge */}
            {isPaused && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Paused
              </span>
            )}
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
            {/* Phase 4: Share replay URL button */}
            <div className="relative">
              <button
                onClick={handleShare}
                disabled={events.length === 0}
                aria-label="Share replay URL"
                title="Share"
                className="cursor-pointer rounded p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M11 2.5a2.5 2.5 0 1 1 .603 1.628l-6.718 3.12a2.5 2.5 0 0 1 0 1.504l6.718 3.12a2.5 2.5 0 1 1-.488.876l-6.718-3.12a2.5 2.5 0 1 1 0-3.256l6.718-3.12A2.5 2.5 0 0 1 11 2.5z" />
                </svg>
              </button>
              {shareToast && (
                <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-white dark:bg-zinc-200 dark:text-zinc-800">
                  Copied!
                </span>
              )}
            </div>
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
      )}

      {/* Tab bar with grouped sections and horizontal scroll */}
      <div className="relative border-b border-zinc-200 dark:border-zinc-700">
        {/* Gradient fade indicators for scroll overflow */}
        <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-6 bg-gradient-to-r from-white dark:from-zinc-900 sm:hidden" />
        <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-6 bg-gradient-to-l from-white dark:from-zinc-900 sm:hidden" />
        <div
          className="flex items-stretch gap-0 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="DevTools views"
        >
          {visibleViews.map((v, i) => {
            // Insert divider between system and AI groups
            const prevView = i > 0 ? visibleViews[i - 1] : null
            const needsDivider = prevView && isSystemView(prevView) && !isSystemView(v)

            return (
              <div key={v} className="flex items-stretch">
                {needsDivider && (
                  <div className="mx-1 my-2 w-px bg-zinc-300 dark:bg-zinc-600" />
                )}
                <button
                  role="tab"
                  aria-selected={v === view}
                  aria-controls={`devtools-tabpanel-${v.toLowerCase().replace(/\s+/g, '-')}`}
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
              </div>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div
        className="min-h-0 flex-1 overflow-y-auto p-4"
        role="tabpanel"
        id={`devtools-tabpanel-${view.toLowerCase().replace(/\s+/g, '-')}`}
        aria-label={`${view} view`}
      >
        {/* #14: Empty/welcome state when nothing is connected */}
        {!showSystemTabs && !showAiTabs && events.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <DirectiveLogomark className="h-8 w-8 opacity-30" />
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              No data sources connected
            </p>
            <div className="max-w-xs space-y-1 text-xs text-zinc-500 dark:text-zinc-500">
              <p>Connect a Directive runtime or AI stream to see live data.</p>
              <code className="mt-2 block rounded bg-zinc-100 px-2 py-1 font-mono text-[11px] dark:bg-zinc-800">
                {`import { devtoolsPlugin } from 'directive/plugins'`}
              </code>
            </div>
          </div>
        )}
        {/* System views */}
        {view === 'Facts' && <FactsView />}
        {view === 'Derivations' && <DerivationsView />}
        {view === 'Constraints' && <ConstraintsView />}
        {view === 'System Graph' && <SystemGraphView />}
        {view === 'Time Travel' && <TimeTravelView />}
        {/* AI views */}
        {view === 'Timeline' && <TimelineView />}
        {view === 'Cost' && <CostView />}
        {view === 'State' && <StateView />}
        {view === 'Guardrails' && <GuardrailsView />}
        {view === 'Events' && <EventsView />}
        {view === 'Health' && <HealthView />}
        {view === 'Breakpoints' && <BreakpointsView />}
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
          {runtimeConnected && ` | System: ${runtimeSystemName ?? 'connected'}`}
        </span>
        <span>
          {isPaused && pausedOnEvent
            ? `Paused on: ${pausedOnEvent.type}`
            : exhaustedRetries
              ? 'Connection lost — click Retry'
              : status === 'connected' ? 'Streaming' : status}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LiveDevTools — thin wrapper for standalone usage (e.g. /devtools page)
// ---------------------------------------------------------------------------

interface LiveDevToolsProps {
  streamUrl?: string
  snapshotUrl?: string
  replayData?: DebugEvent[]
  runtimeSystemName?: string | null
}

export function LiveDevTools({ streamUrl, snapshotUrl, replayData, runtimeSystemName }: LiveDevToolsProps = {}) {
  return (
    <DevToolsProvider
      streamUrl={streamUrl}
      snapshotUrl={snapshotUrl}
      replayData={replayData}
      runtimeSystemName={runtimeSystemName}
    >
      <DevToolsErrorBoundary>
        <DevToolsContent mode="standalone" />
      </DevToolsErrorBoundary>
    </DevToolsProvider>
  )
}
