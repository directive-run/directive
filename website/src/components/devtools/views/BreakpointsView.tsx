'use client'

import { useCallback, useState } from 'react'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { EVENT_LABELS } from '../constants'
import { EmptyState } from '../EmptyState'
import type { BreakpointDef, FactBreakpointDef, FactBreakpointHit, EventBreakpointDef, EventBreakpointHit } from '../types'

// ---------------------------------------------------------------------------
// Shared icons
// ---------------------------------------------------------------------------

function RemoveIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" className="h-full w-full">
      <path d="M3 6l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ToggleCheckbox({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      onClick={onToggle}
      className={`h-4 w-4 rounded border cursor-pointer transition ${
        enabled ? 'border-rose-500 bg-rose-500' : 'border-zinc-300 dark:border-zinc-600'
      }`}
      aria-label={label}
    >
      {enabled && <CheckIcon />}
    </button>
  )
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="cursor-pointer rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800 dark:hover:text-red-400"
      aria-label={label}
    >
      <RemoveIcon />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main BreakpointsView
// ---------------------------------------------------------------------------

export function BreakpointsView() {
  const system = useDevToolsSystem()

  // Runtime (fact + event) breakpoints
  const runtimeConnected = useSelector(system, (s) => s.facts.runtime.connected)
  const factBreakpoints = useSelector(system, (s) => s.facts.runtime.factBreakpoints) as FactBreakpointDef[]
  const factBreakpointHits = useSelector(system, (s) => s.facts.runtime.factBreakpointHits) as FactBreakpointHit[]
  const eventBreakpoints = useSelector(system, (s) => s.facts.runtime.eventBreakpoints) as EventBreakpointDef[]
  const eventBreakpointHits = useSelector(system, (s) => s.facts.runtime.eventBreakpointHits) as EventBreakpointHit[]
  const breakpointPaused = useSelector(system, (s) => s.facts.runtime.breakpointPaused) as boolean
  const pausedOnHit = useSelector(system, (s) => s.facts.runtime.pausedOnHit) as string | null

  // AI (SSE) breakpoints — from connection module
  const aiEnabled = useSelector(system, (s) => s.facts.connection.aiEnabled) as boolean
  const aiBreakpoints = useSelector(system, (s) => s.facts.connection.breakpoints) as BreakpointDef[]
  const aiIsPaused = useSelector(system, (s) => s.facts.connection.isPaused) as boolean
  const aiPausedOnEvent = useSelector(system, (s) => s.facts.connection.pausedOnEvent) as any

  const handleResumeRuntime = useCallback(() => {
    system.events.runtime.resumeFromBreakpoint()
  }, [system])

  const handleResumeAi = useCallback(() => {
    system.events.connection.resumeStream()
  }, [system])

  const hasAnything = runtimeConnected || (aiEnabled && aiBreakpoints.length > 0)

  if (!hasAnything) {
    return (
      <EmptyState message="Connect a Directive system to use breakpoints. Click the eye icon next to any fact in the Facts tab." />
    )
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto">
      {/* Paused banner — runtime breakpoints */}
      {breakpointPaused && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  Recording paused
                </span>
              </div>
              <div className="mt-1 font-mono text-xs text-amber-600 dark:text-amber-400">
                Triggered by: {pausedOnHit === 'fact' ? 'fact mutation breakpoint' : 'event breakpoint'}
              </div>
            </div>
            <button
              onClick={handleResumeRuntime}
              className="cursor-pointer rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              Resume
            </button>
          </div>
        </div>
      )}

      {/* Paused banner — AI SSE breakpoints */}
      {aiIsPaused && aiPausedOnEvent && !breakpointPaused && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  Paused on AI event
                </span>
              </div>
              <div className="mt-1 font-mono text-xs text-amber-600 dark:text-amber-400">
                Event: {EVENT_LABELS[aiPausedOnEvent.type] || aiPausedOnEvent.type}
                {aiPausedOnEvent.agentId && ` (${aiPausedOnEvent.agentId})`}
              </div>
            </div>
            <button
              onClick={handleResumeAi}
              className="cursor-pointer rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              Resume
            </button>
          </div>
        </div>
      )}

      {/* Section 1: Fact Breakpoints */}
      {runtimeConnected && (
        <FactBreakpointsSection
          breakpoints={factBreakpoints}
          hits={factBreakpointHits}
          system={system}
        />
      )}

      {/* Section 2: Event Breakpoints */}
      {runtimeConnected && (
        <EventBreakpointsSection
          breakpoints={eventBreakpoints}
          hits={eventBreakpointHits}
          system={system}
        />
      )}

      {/* Section 3: AI Event Breakpoints */}
      {aiEnabled && (
        <AiBreakpointsSection
          breakpoints={aiBreakpoints}
          system={system}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section 1: Fact Breakpoints
// ---------------------------------------------------------------------------

function FactBreakpointsSection({
  breakpoints,
  hits,
  system,
}: {
  breakpoints: FactBreakpointDef[]
  hits: FactBreakpointHit[]
  system: any
}) {
  const [editingCondition, setEditingCondition] = useState<string | null>(null)
  const [conditionInput, setConditionInput] = useState('')

  const handleSaveCondition = useCallback((bpId: string) => {
    const bp = breakpoints.find((b) => b.id === bpId)
    if (bp) {
      system.events.runtime.addFactBreakpoint({
        breakpoint: { ...bp, condition: conditionInput },
      })
    }
    setEditingCondition(null)
    setConditionInput('')
  }, [breakpoints, conditionInput, system])

  return (
    <div>
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Fact Breakpoints
          {breakpoints.length > 0 && (
            <span className="ml-2 font-mono font-normal text-zinc-400 dark:text-zinc-500">
              {breakpoints.length}
            </span>
          )}
        </h4>
        {hits.length > 0 && (
          <button
            onClick={() => system.events.runtime.clearFactBreakpointHits()}
            className="cursor-pointer font-mono text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Clear hits
          </button>
        )}
      </div>

      {breakpoints.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
          Click the eye icon next to any fact in the Facts tab to add a breakpoint.
        </p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {breakpoints.map((bp) => (
            <div
              key={bp.id}
              className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ToggleCheckbox
                    enabled={bp.enabled}
                    onToggle={() => system.events.runtime.toggleFactBreakpoint({ id: bp.id })}
                    label={bp.enabled ? `Disable breakpoint on ${bp.factKey}` : `Enable breakpoint on ${bp.factKey}`}
                  />
                  <span className="font-mono text-sm text-sky-600 dark:text-sky-400">{bp.factKey}</span>
                  {bp.condition && (
                    <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                      when: {bp.condition}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setEditingCondition(bp.id)
                      setConditionInput(bp.condition)
                    }}
                    className="cursor-pointer rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    aria-label={`Edit condition for ${bp.factKey}`}
                    title="Edit condition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                      <path d="M12.146.854a.5.5 0 0 1 .708 0l2.292 2.292a.5.5 0 0 1 0 .708l-9.5 9.5a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l9.5-9.5zM11.207 2.5 3.5 10.207 2.293 14.207l4-1.5L13.5 5.5 11.207 2.5z" />
                    </svg>
                  </button>
                  <RemoveButton
                    onClick={() => system.events.runtime.removeFactBreakpoint({ id: bp.id })}
                    label={`Remove breakpoint on ${bp.factKey}`}
                  />
                </div>
              </div>

              {/* Condition editor */}
              {editingCondition === bp.id && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={conditionInput}
                    onChange={(e) => setConditionInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSaveCondition(bp.id)
                      }
                      if (e.key === 'Escape') {
                        setEditingCondition(null)
                      }
                    }}
                    placeholder="newValue > 10"
                    className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-[11px] text-zinc-700 placeholder-zinc-400 outline-none focus:border-amber-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                    autoFocus
                  />
                  <button
                    onClick={() => handleSaveCondition(bp.id)}
                    className="cursor-pointer rounded bg-amber-500 px-2 py-1 text-[10px] font-medium text-white hover:bg-amber-600"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingCondition(null)}
                    className="cursor-pointer rounded px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Hit log */}
      {hits.length > 0 && (
        <div className="mt-3">
          <h5 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Mutation Log
            <span className="ml-1.5 font-mono font-normal">{hits.length}</span>
          </h5>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {[...hits].reverse().slice(0, 50).map((hit) => (
              <div
                key={hit.id}
                className={`rounded border px-2 py-1.5 font-mono text-[11px] ${
                  hit.conditionMet
                    ? 'border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/10'
                    : 'border-zinc-200 dark:border-zinc-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sky-600 dark:text-sky-400">{hit.factKey}</span>
                  <span className="text-zinc-400">:</span>
                  <span className="text-red-500">{JSON.stringify(hit.oldValue)}</span>
                  <span className="text-zinc-400">{'->'}</span>
                  <span className="text-emerald-500">{JSON.stringify(hit.newValue)}</span>
                  {hit.conditionMet && (
                    <span className="rounded bg-amber-100 px-1 py-px text-[9px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      PAUSED
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[9px] text-zinc-400">
                  {new Date(hit.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section 2: Event Breakpoints
// ---------------------------------------------------------------------------

function EventBreakpointsSection({
  breakpoints,
  hits,
  system,
}: {
  breakpoints: EventBreakpointDef[]
  hits: EventBreakpointHit[]
  system: any
}) {
  const [newEventType, setNewEventType] = useState('')
  const [newCondition, setNewCondition] = useState('')

  const handleAdd = useCallback(() => {
    if (!newEventType) {
      return
    }

    const bp: EventBreakpointDef = {
      id: `ebp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      eventType: newEventType,
      condition: newCondition,
      enabled: true,
      createdAt: Date.now(),
    }
    system.events.runtime.addEventBreakpoint({ breakpoint: bp })
    setNewEventType('')
    setNewCondition('')
  }, [newEventType, newCondition, system])

  return (
    <div>
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Event Breakpoints
          {breakpoints.length > 0 && (
            <span className="ml-2 font-mono font-normal text-zinc-400 dark:text-zinc-500">
              {breakpoints.length}
            </span>
          )}
        </h4>
        {hits.length > 0 && (
          <button
            onClick={() => system.events.runtime.clearEventBreakpointHits()}
            className="cursor-pointer font-mono text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Clear hits
          </button>
        )}
      </div>

      {/* Breakpoint list */}
      {breakpoints.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {breakpoints.map((bp) => (
            <div
              key={bp.id}
              className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700"
            >
              <div className="flex items-center gap-3">
                <ToggleCheckbox
                  enabled={bp.enabled}
                  onToggle={() => system.events.runtime.toggleEventBreakpoint({ id: bp.id })}
                  label={bp.enabled ? `Disable event breakpoint ${bp.eventType}` : `Enable event breakpoint ${bp.eventType}`}
                />
                <span className="font-mono text-sm text-violet-600 dark:text-violet-400">{bp.eventType}</span>
                {bp.condition && (
                  <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                    when: {bp.condition}
                  </span>
                )}
              </div>
              <RemoveButton
                onClick={() => system.events.runtime.removeEventBreakpoint({ id: bp.id })}
                label={`Remove event breakpoint ${bp.eventType}`}
              />
            </div>
          ))}
        </div>
      )}

      {/* Add event breakpoint form */}
      <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
        <div className="flex-1 min-w-[140px]">
          <label className="mb-1 block text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
            Event Type
          </label>
          <input
            type="text"
            value={newEventType}
            onChange={(e) => setNewEventType(e.target.value)}
            placeholder="e.g. fact.set, reconcile.start, * for all"
            className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 font-mono text-xs text-zinc-700 placeholder-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          />
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className="mb-1 block text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
            Condition (optional)
          </label>
          <input
            type="text"
            value={newCondition}
            onChange={(e) => setNewCondition(e.target.value)}
            placeholder="data.count > 10"
            className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 font-mono text-xs text-zinc-700 placeholder-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={!newEventType}
          className="cursor-pointer rounded bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>

      {breakpoints.length === 0 && (
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
          Add a trace event type to break on (e.g. fact.set, resolver.start, constraint.evaluate).
        </p>
      )}

      {/* Hit log */}
      {hits.length > 0 && (
        <div className="mt-3">
          <h5 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Event Log
            <span className="ml-1.5 font-mono font-normal">{hits.length}</span>
          </h5>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {[...hits].reverse().slice(0, 50).map((hit) => (
              <div
                key={hit.id}
                className={`rounded border px-2 py-1.5 font-mono text-[11px] ${
                  hit.conditionMet
                    ? 'border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/10'
                    : 'border-zinc-200 dark:border-zinc-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-violet-600 dark:text-violet-400">{hit.eventType}</span>
                  {hit.conditionMet && (
                    <span className="rounded bg-amber-100 px-1 py-px text-[9px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      PAUSED
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[9px] text-zinc-400">
                  {new Date(hit.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section 3: AI Event Breakpoints (existing SSE breakpoints)
// ---------------------------------------------------------------------------

function AiBreakpointsSection({
  breakpoints,
  system,
}: {
  breakpoints: BreakpointDef[]
  system: any
}) {
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

  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        AI Event Breakpoints
        {breakpoints.length > 0 && (
          <span className="ml-2 font-mono font-normal text-zinc-400 dark:text-zinc-500">
            {breakpoints.length}
          </span>
        )}
      </h4>

      {breakpoints.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {breakpoints.map((bp) => (
            <div
              key={bp.id}
              className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700"
            >
              <div className="flex items-center gap-3">
                <ToggleCheckbox
                  enabled={bp.enabled}
                  onToggle={() => system.events.connection.toggleBreakpoint({ id: bp.id })}
                  label={bp.enabled ? `Disable breakpoint ${bp.label}` : `Enable breakpoint ${bp.label}`}
                />
                <div>
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">{bp.label}</span>
                  <span className="ml-2 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                    {bp.eventType}
                  </span>
                </div>
              </div>
              <RemoveButton
                onClick={() => system.events.connection.removeBreakpoint({ id: bp.id })}
                label={`Remove breakpoint ${bp.label}`}
              />
            </div>
          ))}
        </div>
      )}

      {/* Add AI breakpoint form */}
      <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
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
          onClick={handleAdd}
          disabled={!newEventType}
          className="cursor-pointer rounded bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
    </div>
  )
}
