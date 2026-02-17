'use client'

import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react'

import { STORAGE_KEYS, safeGetItem } from '@/lib/storage-keys'

/** Custom event name fired when any experiment assignment changes. */
export const EXPERIMENT_CHANGE_EVENT = 'directive-experiment-change'

/** useLayoutEffect on client, useEffect on server (avoids SSR warning). */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

interface ExperimentsContextValue {
  experiments: Record<string, string>
}

export const ExperimentsContext = createContext<ExperimentsContextValue>({
  experiments: {},
})

function readExperiments(): Record<string, string> {
  const raw = safeGetItem(STORAGE_KEYS.EXPERIMENTS)
  if (!raw) {
    return {}
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, string>
    }
  } catch {
    // fall through
  }

  return {}
}

/**
 * Reads all experiment assignments from localStorage on mount (before paint)
 * and re-reads whenever the labs panel fires a change event.
 *
 * Uses useLayoutEffect so experiments resolve before the browser paints —
 * child components never see the wrong values.
 */
export function ExperimentsProvider({ children }: { children: React.ReactNode }) {
  const [experiments, setExperiments] = useState<Record<string, string>>({})

  useIsomorphicLayoutEffect(() => {
    setExperiments(readExperiments())

    function onExperimentChange() {
      setExperiments(readExperiments())
    }

    window.addEventListener(EXPERIMENT_CHANGE_EVENT, onExperimentChange)

    return () => {
      window.removeEventListener(EXPERIMENT_CHANGE_EVENT, onExperimentChange)
    }
  }, [])

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
