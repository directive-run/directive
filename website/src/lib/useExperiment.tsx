'use client'

import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react'

import { STORAGE_KEYS, safeGetItem } from '@/lib/storage-keys'

/** Custom event name fired when any experiment assignment changes. */
export const EXPERIMENT_CHANGE_EVENT = 'directive-experiment-change'

interface ExperimentsContextValue {
  experiments: Record<string, string>
}

export const ExperimentsContext = createContext<ExperimentsContextValue>({
  experiments: {},
})

/* ── Module-level snapshot cache ── */

const SAFE_KEY_RE = /^[a-z0-9-]+$/i
const emptyExperiments: Record<string, string> = Object.freeze({})
let cachedRaw: string | null = null
let cachedExperiments: Record<string, string> = emptyExperiments

function getSnapshot(): Record<string, string> {
  const raw = safeGetItem(STORAGE_KEYS.EXPERIMENTS)

  if (!raw) {
    cachedRaw = null
    cachedExperiments = emptyExperiments

    return emptyExperiments
  }

  // Same raw string → return stable reference (avoids re-renders)
  if (raw === cachedRaw) {
    return cachedExperiments
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      cachedRaw = raw
      cachedExperiments = parsed as Record<string, string>

      return cachedExperiments
    }
  } catch {
    // fall through
  }

  cachedRaw = null
  cachedExperiments = emptyExperiments

  return emptyExperiments
}

function getServerSnapshot(): Record<string, string> {
  return emptyExperiments
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(EXPERIMENT_CHANGE_EVENT, callback)

  return () => {
    window.removeEventListener(EXPERIMENT_CHANGE_EVENT, callback)
  }
}

/**
 * Reads all experiment assignments from localStorage synchronously during
 * render via useSyncExternalStore — first client render has real values.
 *
 * Also syncs experiment values to <html> data attributes so CSS selectors
 * and the pre-hydration inline script can read them.
 */
export function ExperimentsProvider({ children }: { children: React.ReactNode }) {
  const experiments = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Sync experiments to <html> data attributes for CSS / inline script
  const prevKeysRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const el = document.documentElement
    const nextKeys = new Set<string>()

    for (const key of Object.keys(experiments)) {
      if (!SAFE_KEY_RE.test(key)) {
        continue
      }

      const value = experiments[key]
      if (value) {
        el.setAttribute(`data-${key}`, value.slice(0, 100))
        nextKeys.add(key)
      }
    }

    // Remove attributes for experiments that were removed
    for (const key of prevKeysRef.current) {
      if (!nextKeys.has(key)) {
        el.removeAttribute(`data-${key}`)
      }
    }

    prevKeysRef.current = nextKeys
  }, [experiments])

  return (
    <ExperimentsContext.Provider value={{ experiments }}>
      {children}
    </ExperimentsContext.Provider>
  )
}

/**
 * Returns a single experiment's value (or defaultValue if unset).
 * Must be used inside an `ExperimentsProvider`.
 */
export function useExperiment(experimentId: string, defaultValue: string): string {
  const { experiments } = useContext(ExperimentsContext)
  const value = experiments[experimentId]

  return typeof value === 'string' ? value : defaultValue
}
