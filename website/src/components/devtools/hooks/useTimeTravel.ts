'use client'

import { useCallback } from 'react'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'

/**
 * Shared time-travel hook — used by DrawerPanel (header arrows) and TimeTravelView.
 * Encapsulates undo/redo callbacks and reactive state selectors.
 */
export function useTimeTravel() {
  const system = useDevToolsSystem()

  const timeTravelEnabled = useSelector(system, (s) => s.facts.runtime.timeTravelEnabled)
  const snapshotIndex = useSelector(system, (s) => s.facts.runtime.snapshotIndex)
  const snapshotCount = useSelector(system, (s) => s.facts.runtime.snapshotCount)
  const canUndo = useSelector(system, (s) => s.derive.runtime.canUndo)
  const canRedo = useSelector(system, (s) => s.derive.runtime.canRedo)
  const systemName = useSelector(system, (s) => s.facts.runtime.systemName)

  const handleUndo = useCallback(() => {
    if (typeof window === 'undefined' || !window.__DIRECTIVE__) {
      return
    }

    const sys = window.__DIRECTIVE__.getSystem(systemName ?? undefined)
    if (sys?.debug?.goBack) {
      sys.debug.goBack(1)
      system.events.runtime.refresh()
    }
  }, [system, systemName])

  const handleRedo = useCallback(() => {
    if (typeof window === 'undefined' || !window.__DIRECTIVE__) {
      return
    }

    const sys = window.__DIRECTIVE__.getSystem(systemName ?? undefined)
    if (sys?.debug?.goForward) {
      sys.debug.goForward(1)
      system.events.runtime.refresh()
    }
  }, [system, systemName])

  return {
    timeTravelEnabled,
    snapshotIndex,
    snapshotCount,
    canUndo,
    canRedo,
    handleUndo,
    handleRedo,
  }
}
