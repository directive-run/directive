'use client'

import { useState, useCallback, useRef, type FormEvent } from 'react'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { EmptyState } from '../EmptyState'
import { KeyValueListView } from './KeyValueListView'
import type { FactBreakpointDef } from '../types'

export function FactsView() {
  const system = useDevToolsSystem()
  const connected = useSelector(system, (s) => s.facts.runtime.connected)
  const facts = useSelector(system, (s) => s.facts.runtime.facts)
  const factCount = useSelector(system, (s) => s.derive.runtime.factCount)
  const factBreakpoints = useSelector(system, (s) => s.facts.runtime.factBreakpoints) as FactBreakpointDef[]

  const renderRowActions = useCallback((key: string) => {
    return <BreakpointButton factKey={key} breakpoints={factBreakpoints} system={system} />
  }, [factBreakpoints, system])

  if (!connected) {
    return <EmptyState message="No Directive system connected" />
  }

  return (
    <KeyValueListView
      title="Facts"
      filterLabel="Filter facts"
      count={factCount}
      data={facts}
      keyColorClass="text-sky-600 dark:text-sky-400"
      emptyMessage="No facts in system"
      noMatchMessage={(f) => `No facts matching "${f}"`}
      footer={<FactRepl />}
      renderRowActions={renderRowActions}
    />
  )
}

// ---------------------------------------------------------------------------
// BreakpointButton — eye icon to toggle fact breakpoints
// ---------------------------------------------------------------------------

function BreakpointButton({
  factKey,
  breakpoints,
  system,
}: {
  factKey: string
  breakpoints: FactBreakpointDef[]
  system: any
}) {
  const existing = breakpoints.find((bp) => bp.factKey === factKey)
  const isActive = existing?.enabled ?? false

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (existing) {
      if (existing.enabled) {
        system.events.runtime.removeFactBreakpoint({ id: existing.id })
      } else {
        system.events.runtime.toggleFactBreakpoint({ id: existing.id })
      }
    } else {
      const bp: FactBreakpointDef = {
        id: `fbp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        factKey,
        condition: '',
        enabled: true,
        createdAt: Date.now(),
      }
      system.events.runtime.addFactBreakpoint({ breakpoint: bp })
    }
  }, [factKey, existing, system])

  return (
    <button
      onClick={handleClick}
      aria-label={isActive ? `Remove breakpoint on ${factKey}` : `Add breakpoint on ${factKey}`}
      className={`ml-1 shrink-0 cursor-pointer rounded p-0.5 transition-opacity ${
        isActive
          ? 'text-amber-500 opacity-100'
          : 'text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-amber-400 dark:text-zinc-600 dark:hover:text-amber-400'
      }`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
        <path d="M8 2C4.69 2 2 4.69 2 8s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 11c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" />
        {isActive && <circle cx="8" cy="8" r="3" />}
      </svg>
    </button>
  )
}

// ---------------------------------------------------------------------------
// FactRepl — set fact values via window.__DIRECTIVE__
// ---------------------------------------------------------------------------

const BLOCKED_FACT_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'])

function FactRepl() {
  const system = useDevToolsSystem()
  const systemName = useSelector(system, (s) => s.facts.runtime.systemName)
  const [input, setInput] = useState('')
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'error'; message: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  const handleSubmit = useCallback((e: FormEvent) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed) {
      return
    }

    // Parse "key = value" syntax
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) {
      setFeedback({ type: 'error', message: 'Use format: factKey = value' })

      return
    }

    const key = trimmed.slice(0, eqIdx).trim()
    const valueStr = trimmed.slice(eqIdx + 1).trim()

    if (!key) {
      setFeedback({ type: 'error', message: 'Missing fact key' })

      return
    }

    if (BLOCKED_FACT_KEYS.has(key)) {
      setFeedback({ type: 'error', message: `Cannot set reserved key "${key}"` })

      return
    }

    try {
      // Parse value as JSON (supports numbers, booleans, strings, objects)
      let parsedValue: unknown
      try {
        parsedValue = JSON.parse(valueStr)
      } catch {
        // If not valid JSON, treat as string
        parsedValue = valueStr
      }

      // Set the fact on the runtime system
      if (typeof window !== 'undefined' && window.__DIRECTIVE__) {
        const sys = window.__DIRECTIVE__.getSystem(systemName ?? undefined)
        if (sys?.facts) {
          (sys.facts as Record<string, unknown>)[key] = parsedValue
          system.events.runtime.refresh()
          setFeedback({ type: 'ok', message: `${key} = ${JSON.stringify(parsedValue)}` })
          setInput('')
        } else {
          setFeedback({ type: 'error', message: 'System not found' })
        }
      }
    } catch (err) {
      setFeedback({ type: 'error', message: String(err) })
    }

    // Clear feedback after 3s — cancel previous timer to avoid stale clear
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current)
    }
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 3000)
  }, [input, systemName, system])

  return (
    <div className="mt-auto border-t border-zinc-200 pt-2 dark:border-zinc-700">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">{'>'}</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="factKey = value"
          aria-label="Set fact value (format: key = value)"
          className="flex-1 bg-transparent font-mono text-[11px] text-zinc-700 placeholder-zinc-400 outline-none dark:text-zinc-300 dark:placeholder-zinc-600"
        />
        <button
          type="submit"
          className="cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          Set
        </button>
      </form>
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`mt-1 font-mono text-[10px] ${
            feedback.type === 'ok'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-500 dark:text-red-400'
          }`}
        >
          {feedback.message}
        </div>
      )}
    </div>
  )
}
