'use client'

import { useCallback, useEffect, useState } from 'react'

import { STORAGE_KEYS, safeGetItem } from '@/lib/storage-keys'

/** Custom event name fired when any experiment assignment changes. */
export const EXPERIMENT_CHANGE_EVENT = 'directive-experiment-change'

/**
 * Reads a single experiment assignment from localStorage and re-renders
 * whenever it changes (via the custom `directive-experiment-change` event).
 */
export function useExperiment(experimentId: string, defaultValue: string): string {
  const read = useCallback(() => {
    const raw = safeGetItem(STORAGE_KEYS.EXPERIMENTS)
    if (!raw) {
      return defaultValue
    }

    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const value = (parsed as Record<string, string>)[experimentId]

        return typeof value === 'string' ? value : defaultValue
      }
    } catch {
      // fall through
    }

    return defaultValue
  }, [experimentId, defaultValue])

  const [value, setValue] = useState(defaultValue)

  useEffect(() => {
    setValue(read())

    function onExperimentChange() {
      setValue(read())
    }

    window.addEventListener(EXPERIMENT_CHANGE_EVENT, onExperimentChange)

    return () => {
      window.removeEventListener(EXPERIMENT_CHANGE_EVENT, onExperimentChange)
    }
  }, [read])

  return value
}
