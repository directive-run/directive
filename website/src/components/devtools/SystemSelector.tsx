'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem, useDevToolsLabel } from './DevToolsSystemContext'

/**
 * SystemSelector — dropdown to switch between Directive systems registered on
 * window.__DIRECTIVE__. Shows all available systems and the currently-attached
 * one. Selecting a different system fires detach → attach.
 */
export function SystemSelector() {
  const system = useDevToolsSystem()
  const label = useDevToolsLabel()
  const runtimeConnected = useSelector(system, (s) => s.facts.runtime.connected)
  const currentSystemName = useSelector(system, (s) => s.facts.runtime.systemName)
  const drawerOpen = useSelector(system, (s) => s.facts.shell.drawerOpen)

  const [availableSystems, setAvailableSystems] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const focusedIndexRef = useRef(-1)

  // Poll for available systems — only while visible (drawer open or standalone mode)
  // Uses document.hidden to pause when tab is backgrounded
  useEffect(() => {
    // AI-only pages provide a label — no runtime to poll for
    if (label) {
      setAvailableSystems([])

      return
    }

    if (!drawerOpen && typeof document !== 'undefined' && document.hidden) {
      return
    }

    function refresh() {
      if (typeof window !== 'undefined' && window.__DIRECTIVE__) {
        setAvailableSystems(window.__DIRECTIVE__.getSystems())
      }
    }

    refresh()
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) {
        refresh()
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [drawerOpen, label])

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) {
      return
    }

    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClick)

    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Reset focused index when dropdown opens/closes
  useEffect(() => {
    if (open) {
      const idx = availableSystems.indexOf(currentSystemName ?? '')
      focusedIndexRef.current = idx >= 0 ? idx : 0
    } else {
      focusedIndexRef.current = -1
    }
  }, [open, availableSystems, currentSystemName])

  const handleSelect = useCallback((name: string) => {
    setOpen(false)

    if (name === currentSystemName) {
      return
    }

    // Detach current, then attach new — both synchronous so the constraint
    // evaluates once with the final state (connected=false, systemName=name)
    system.events.runtime.detach()
    system.events.runtime.attach({ systemName: name })
  }, [currentSystemName, system])

  // Keyboard navigation for dropdown
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
      }

      return
    }

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const next = Math.min(focusedIndexRef.current + 1, availableSystems.length - 1)
        focusedIndexRef.current = next
        // Focus the option element
        const options = containerRef.current?.querySelectorAll<HTMLElement>('[role="option"]')
        options?.[next]?.focus()
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prev = Math.max(focusedIndexRef.current - 1, 0)
        focusedIndexRef.current = prev
        const options = containerRef.current?.querySelectorAll<HTMLElement>('[role="option"]')
        options?.[prev]?.focus()
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        const idx = focusedIndexRef.current
        if (idx >= 0 && idx < availableSystems.length) {
          handleSelect(availableSystems[idx])
        }
        break
      }
      case 'Escape': {
        e.preventDefault()
        setOpen(false)
        break
      }
      case 'Home': {
        e.preventDefault()
        focusedIndexRef.current = 0
        const options = containerRef.current?.querySelectorAll<HTMLElement>('[role="option"]')
        options?.[0]?.focus()
        break
      }
      case 'End': {
        e.preventDefault()
        focusedIndexRef.current = availableSystems.length - 1
        const options = containerRef.current?.querySelectorAll<HTMLElement>('[role="option"]')
        options?.[availableSystems.length - 1]?.focus()
        break
      }
    }
  }, [open, availableSystems, handleSelect])

  // No runtime systems — show label fallback if provided
  if (availableSystems.length === 0) {
    if (label) {
      return (
        <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
          {label}
        </span>
      )
    }

    return null
  }

  // Single system — just show the name, no dropdown needed
  if (availableSystems.length === 1) {
    return (
      <div className="flex items-center gap-1">
        <div
          className={`h-1.5 w-1.5 rounded-full ${
            runtimeConnected ? 'bg-emerald-500' : 'bg-zinc-400'
          }`}
          aria-hidden="true"
        />
        <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
          {availableSystems[0]}
        </span>
      </div>
    )
  }

  // Multiple systems — show dropdown
  return (
    <div
      ref={containerRef}
      className="relative"
      onKeyDown={handleKeyDown}
      onBlur={(e) => {
        // Close dropdown when focus leaves the container entirely
        if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
          setOpen(false)
        }
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 transition hover:bg-zinc-200 dark:hover:bg-zinc-700"
        aria-label="Select system to inspect"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <div
          className={`h-1.5 w-1.5 rounded-full ${
            runtimeConnected ? 'bg-emerald-500' : 'bg-zinc-400'
          }`}
          aria-hidden="true"
        />
        <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
          {currentSystemName ?? 'System'}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`h-2.5 w-2.5 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path
            fillRule="evenodd"
            d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Available systems"
          className="absolute left-0 top-full z-50 mt-1 min-w-[160px] overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-600 dark:bg-zinc-800"
        >
          {availableSystems.map((name) => {
            const isActive = name === currentSystemName

            return (
              <button
                key={name}
                role="option"
                aria-selected={isActive}
                tabIndex={-1}
                onClick={() => handleSelect(name)}
                className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] transition focus:outline-none focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-700 ${
                  isActive
                    ? 'bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700'
                }`}
              >
                <div
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    isActive && runtimeConnected ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
                  }`}
                />
                {name}
                {isActive && (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="ml-auto h-3 w-3">
                    <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
