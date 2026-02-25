'use client'

import { useCallback, useState } from 'react'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { EVENT_LABELS } from '../constants'
import { EmptyState } from '../EmptyState'
import type { BreakpointDef } from '../types'

export function BreakpointsView() {
  const system = useDevToolsSystem()
  const breakpoints = useSelector(system, (s) => s.facts.connection.breakpoints)
  const isPaused = useSelector(system, (s) => s.facts.connection.isPaused)
  const pausedOnEvent = useSelector(system, (s) => s.facts.connection.pausedOnEvent)

  const [newEventType, setNewEventType] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const eventTypes = Object.keys(EVENT_LABELS)

  const handleAdd = useCallback(() => {
    if (!newEventType) {
      return
    }

    const bp: BreakpointDef = {
      id: `bp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: newLabel || EVENT_LABELS[newEventType] || newEventType,
      eventType: newEventType,
      enabled: true,
    }
    system.events.connection.addBreakpoint({ breakpoint: bp })
    setNewEventType('')
    setNewLabel('')
  }, [newEventType, newLabel, system])

  const handleResume = useCallback(() => {
    system.events.connection.resumeStream()
  }, [system])

  if (breakpoints.length === 0 && !isPaused) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <EmptyState message="No breakpoints set." />
        <div className="max-w-sm text-center text-xs text-zinc-500 dark:text-zinc-400">
          Breakpoints pause the event stream when a matching event arrives.
          Add a breakpoint below to get started.
        </div>
        <AddBreakpointForm
          eventTypes={eventTypes}
          newEventType={newEventType}
          setNewEventType={setNewEventType}
          newLabel={newLabel}
          setNewLabel={setNewLabel}
          onAdd={handleAdd}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Paused banner */}
      {isPaused && pausedOnEvent && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  Paused on breakpoint
                </span>
              </div>
              <div className="mt-1 font-mono text-xs text-amber-600 dark:text-amber-400">
                Event: {EVENT_LABELS[pausedOnEvent.type] || pausedOnEvent.type}
                {pausedOnEvent.agentId && ` (${pausedOnEvent.agentId})`}
              </div>
            </div>
            <button
              onClick={handleResume}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              Resume
            </button>
          </div>
        </div>
      )}

      {/* Breakpoints list */}
      <div className="space-y-1">
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {breakpoints.length} breakpoint{breakpoints.length !== 1 ? 's' : ''}
        </div>
        {breakpoints.map((bp) => (
          <div
            key={bp.id}
            className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700"
          >
            <div className="flex items-center gap-3">
              <button
                onClick={() => system.events.connection.toggleBreakpoint({ id: bp.id })}
                className={`h-4 w-4 rounded border cursor-pointer transition ${
                  bp.enabled
                    ? 'border-rose-500 bg-rose-500'
                    : 'border-zinc-300 dark:border-zinc-600'
                }`}
                aria-label={bp.enabled ? `Disable breakpoint ${bp.label}` : `Enable breakpoint ${bp.label}`}
              >
                {bp.enabled && (
                  <svg viewBox="0 0 12 12" fill="none" className="h-full w-full">
                    <path d="M3 6l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <div>
                <span className="text-sm text-zinc-700 dark:text-zinc-300">{bp.label}</span>
                <span className="ml-2 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                  {bp.eventType}
                </span>
              </div>
            </div>
            <button
              onClick={() => system.events.connection.removeBreakpoint({ id: bp.id })}
              className="cursor-pointer rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800 dark:hover:text-red-400"
              aria-label={`Remove breakpoint ${bp.label}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Add breakpoint form */}
      <AddBreakpointForm
        eventTypes={eventTypes}
        newEventType={newEventType}
        setNewEventType={setNewEventType}
        newLabel={newLabel}
        setNewLabel={setNewLabel}
        onAdd={handleAdd}
      />
    </div>
  )
}

function AddBreakpointForm({
  eventTypes,
  newEventType,
  setNewEventType,
  newLabel,
  setNewLabel,
  onAdd,
}: {
  eventTypes: string[]
  newEventType: string
  setNewEventType: (v: string) => void
  newLabel: string
  setNewLabel: (v: string) => void
  onAdd: () => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
      <div className="flex-1 min-w-[140px]">
        <label className="mb-1 block text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
          Event Type
        </label>
        <select
          value={newEventType}
          onChange={(e) => setNewEventType(e.target.value)}
          className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 font-mono text-xs text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          <option value="">Select event...</option>
          {eventTypes.map((type) => (
            <option key={type} value={type}>
              {EVENT_LABELS[type] || type}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-w-[120px]">
        <label className="mb-1 block text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
          Label (optional)
        </label>
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Custom label"
          className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700 placeholder-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        />
      </div>
      <button
        onClick={onAdd}
        disabled={!newEventType}
        className="rounded bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Add
      </button>
    </div>
  )
}
