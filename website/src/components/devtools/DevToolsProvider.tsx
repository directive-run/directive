'use client'

import { useEffect, useMemo, useState } from 'react'
import { useDirectiveRef } from '@directive-run/react'
import { DevToolsSystemContext } from './DevToolsSystemContext'
import { devtoolsShell } from './modules/devtools-shell'
import { devtoolsConnection } from './modules/devtools-connection'
import { devtoolsSnapshot } from './modules/devtools-snapshot'
import { devtoolsRuntime } from './modules/devtools-runtime'
import type { DebugEvent } from './types'

interface DevToolsProviderProps {
  streamUrl?: string
  snapshotUrl?: string
  runtimeSystemName?: string | null
  replayData?: DebugEvent[]
  children: React.ReactNode
}

export function DevToolsProvider({
  streamUrl,
  snapshotUrl,
  runtimeSystemName,
  replayData,
  children,
}: DevToolsProviderProps) {
  const urls = useMemo(() => ({
    streamUrl: streamUrl ?? '/api/devtools/stream',
    snapshotUrl: snapshotUrl ?? '/api/devtools/snapshot',
    resetUrl: (streamUrl ?? '/api/devtools/stream').replace(/\/stream$/, '/reset'),
  }), [streamUrl, snapshotUrl])

  // Auto-detect runtime: check for window.__DIRECTIVE__ on mount
  const [detectedRuntime, setDetectedRuntime] = useState<string | null>(null)
  useEffect(() => {
    if (runtimeSystemName !== undefined) {
      return
    }

    if (typeof window !== 'undefined' && window.__DIRECTIVE__) {
      const systems = window.__DIRECTIVE__.getSystems()
      if (systems.length > 0) {
        setDetectedRuntime(systems[0])
      }
    }
  }, [runtimeSystemName])

  const effectiveRuntimeName = runtimeSystemName !== undefined ? runtimeSystemName : detectedRuntime

  const system = useDirectiveRef({
    modules: {
      shell: devtoolsShell,
      connection: devtoolsConnection,
      snapshot: devtoolsSnapshot,
      runtime: devtoolsRuntime,
    },
    initialFacts: {
      connection: {
        streamUrl: urls.streamUrl,
        resetUrl: urls.resetUrl,
        ...(replayData ? {
          events: replayData,
          status: 'disconnected' as const,
          replayMode: true,
        } : {}),
      },
      snapshot: {
        snapshotUrl: urls.snapshotUrl,
      },
    },
  })

  // Attach runtime when system name is available — #11: detach on unmount
  useEffect(() => {
    if (effectiveRuntimeName !== null && effectiveRuntimeName !== undefined) {
      system.events.runtime.attach({ systemName: effectiveRuntimeName })

      return () => {
        system.events.runtime.detach()
      }
    }
  }, [effectiveRuntimeName, system])

  return (
    <DevToolsSystemContext.Provider value={system}>
      {children}
    </DevToolsSystemContext.Provider>
  )
}
