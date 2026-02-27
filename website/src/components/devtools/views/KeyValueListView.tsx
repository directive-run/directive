'use client'

import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { EmptyState } from '../EmptyState'

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

export function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'object') {
    try {
      const str = JSON.stringify(value, null, 2)

      return str.length > 200 ? str.slice(0, 197) + '...' : str
    } catch {
      return '<error>'
    }
  }

  return String(value)
}

export function copyToClipboard(key: string, value: unknown) {
  const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
  navigator.clipboard.writeText(`${key}: ${text}`).catch(() => {})
}

// ---------------------------------------------------------------------------
// CopyIcon — shared inline SVG
// ---------------------------------------------------------------------------

function CopyButton({ keyName, value }: { keyName: string; value: unknown }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  const handleCopy = useCallback(() => {
    copyToClipboard(keyName, value)
    setCopied(true)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(() => setCopied(false), 1500)
  }, [keyName, value])

  return (
    <button
      onClick={handleCopy}
      aria-label={copied ? `Copied ${keyName}` : `Copy ${keyName}`}
      className="ml-2 shrink-0 cursor-pointer rounded p-0.5 text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-zinc-500 focus:opacity-100 dark:text-zinc-600 dark:hover:text-zinc-400"
    >
      {copied ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 text-emerald-500">
          <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
          <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z" />
          <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z" />
        </svg>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// KeyValueListView
// ---------------------------------------------------------------------------

interface KeyValueListViewProps {
  /** Label shown at top (e.g. "Facts", "Derivations") */
  title: string
  /** aria-label for the filter input */
  filterLabel: string
  /** Total count shown as badge */
  count: number
  /** The key-value data to display */
  data: Record<string, unknown>
  /** Tailwind color class for key names (e.g. "text-sky-600 dark:text-sky-400") */
  keyColorClass: string
  /** Empty state message when count is 0 */
  emptyMessage: string
  /** Empty state message when filter yields no results (receives filter string) */
  noMatchMessage: (filter: string) => string
  /** Optional footer element (e.g. FactRepl) */
  footer?: ReactNode
  /** Optional per-row action buttons (e.g. breakpoint toggle) */
  renderRowActions?: (key: string) => ReactNode
}

export function KeyValueListView({
  title,
  filterLabel,
  count,
  data,
  keyColorClass,
  emptyMessage,
  noMatchMessage,
  footer,
  renderRowActions,
}: KeyValueListViewProps) {
  const [filter, setFilter] = useState('')
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [changedKeys, setChangedKeys] = useState<Set<string>>(new Set())
  // Cache serialized values to avoid JSON.stringify on every render for unchanged keys
  const prevSerializedRef = useRef<Record<string, string>>({})

  // Detect changed entries and flash them
  useEffect(() => {
    const prevSerialized = prevSerializedRef.current
    const changed = new Set<string>()
    const nextSerialized: Record<string, string> = {}

    for (const [key, value] of Object.entries(data)) {
      const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value)
      nextSerialized[key] = serialized

      if (prevSerialized[key] !== undefined && prevSerialized[key] !== serialized) {
        changed.add(key)
      }
    }

    prevSerializedRef.current = nextSerialized

    if (changed.size > 0) {
      setChangedKeys(changed)
      const timer = setTimeout(() => setChangedKeys(new Set()), 800)

      return () => clearTimeout(timer)
    }
  }, [data])

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }

      return next
    })
  }, [])

  if (count === 0) {
    return <EmptyState message={emptyMessage} />
  }

  const entries = Object.entries(data)
  const filtered = filter
    ? entries.filter(([key]) => key.toLowerCase().includes(filter.toLowerCase()))
    : entries

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {title}
          <span className="ml-2 font-mono font-normal text-zinc-400 dark:text-zinc-500">
            {count}
          </span>
        </h4>
        <input
          type="text"
          placeholder="Filter..."
          aria-label={filterLabel}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-40 rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-[11px] text-zinc-700 placeholder-zinc-400 outline-none focus:border-sky-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:placeholder-zinc-500"
        />
      </div>

      <div className="space-y-0.5">
        {filtered.map(([key, value]) => {
          const isObject = value !== null && typeof value === 'object'
          const isExpanded = expandedKeys.has(key)
          const isChanged = changedKeys.has(key)

          return (
            <div
              key={key}
              className={`group flex items-start rounded px-2 py-1.5 font-mono text-xs transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                isChanged ? 'animate-[devtools-flash_0.8s_ease-out]' : ''
              }`}
            >
              <span className={`w-48 shrink-0 truncate ${keyColorClass}`}>
                {key}
              </span>
              <div className="min-w-0 flex-1">
                {isObject ? (
                  <>
                    <button
                      onClick={() => toggleExpand(key)}
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? `Collapse ${key}` : `Expand ${key}`}
                      className="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    >
                      {isExpanded ? '▼' : '▶'} {Array.isArray(value) ? `Array(${(value as unknown[]).length})` : 'Object'}
                    </button>
                    {isExpanded && (
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] leading-relaxed text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
                        {JSON.stringify(value, null, 2)}
                      </pre>
                    )}
                  </>
                ) : (
                  <span className={
                    typeof value === 'boolean'
                      ? value ? 'text-emerald-500' : 'text-red-500'
                      : typeof value === 'number'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-zinc-700 dark:text-zinc-300'
                  }>
                    {formatValue(value)}
                  </span>
                )}
              </div>
              {renderRowActions?.(key)}
              <CopyButton keyName={key} value={value} />
            </div>
          )
        })}
      </div>

      {filter && filtered.length === 0 && (
        <EmptyState message={noMatchMessage(filter)} />
      )}

      {footer}
    </div>
  )
}
