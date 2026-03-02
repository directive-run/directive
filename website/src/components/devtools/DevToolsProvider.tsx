'use client'

import { useEffect, useMemo, useState } from 'react'
import { useDirectiveRef } from '@directive-run/react'
import { DevToolsSystemContext, DevToolsLabelContext } from './DevToolsSystemContext'
import { devtoolsShell } from './modules/devtools-shell'
import { devtoolsConnection } from './modules/devtools-connection'
import { devtoolsSnapshot } from './modules/devtools-snapshot'
import { devtoolsRuntime } from './modules/devtools-runtime'
import type { DebugEvent } from './types'

// ---------------------------------------------------------------------------
// Discriminated union props — mode determines which fields are valid
// ---------------------------------------------------------------------------

interface DevToolsBaseProps {
  runtimeSystemName?: string | null
  label?: string
  children: React.ReactNode
}

/** Runtime only — no AI stream connection. */
interface DevToolsSystemProps extends DevToolsBaseProps {
  mode: 'system'
  streamUrl?: never
  snapshotUrl?: never
  replayData?: never
}

/** AI stream + optional runtime. Requires stream URLs. */
interface DevToolsAiProps extends DevToolsBaseProps {
  mode: 'ai'
  streamUrl?: string
  snapshotUrl?: string
  replayData?: never
}

/** Preloaded events, no live connection. */
interface DevToolsReplayProps extends DevToolsBaseProps {
  mode: 'replay'
  replayData: DebugEvent[]
  streamUrl?: string
  snapshotUrl?: string
}

/** Legacy — infers mode from props (streamUrl → ai, replayData → replay, else system). */
interface DevToolsAutoProps extends DevToolsBaseProps {
  mode?: undefined
  streamUrl?: string
  snapshotUrl?: string
  replayData?: DebugEvent[]
}

export type DevToolsProviderProps =
  | DevToolsSystemProps
  | DevToolsAiProps
  | DevToolsReplayProps
  | DevToolsAutoProps

export type DevToolsMode = DevToolsProviderProps['mode']

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function DevToolsProvider(props: DevToolsProviderProps) {
  const { runtimeSystemName, label, children } = props

  // Resolve effective mode
  const effectiveMode = props.mode
    ?? (props.replayData ? 'replay' : props.streamUrl ? 'ai' : 'system')

  const hasAiStream = effectiveMode === 'ai'
  const replayData = effectiveMode === 'replay' ? props.replayData : undefined
  const streamUrl = effectiveMode !== 'system' ? props.streamUrl : undefined
  const snapshotUrl = effectiveMode !== 'system' ? props.snapshotUrl : undefined

  const urls = useMemo(() => ({
    streamUrl: streamUrl ?? '/api/devtools/stream',
    snapshotUrl: snapshotUrl ?? '/api/devtools/snapshot',
    resetUrl: (streamUrl ?? '/api/devtools/stream').replace(/\/stream$/, '/reset'),
  }), [streamUrl, snapshotUrl])

  // Auto-detect runtime: continuously poll window.__DIRECTIVE__ so we notice
  // when systems appear (async script load) or disappear (page navigation).
  // If the currently-attached system is no longer available, detach and
  // re-attach to whatever system is present.
  const [detectedRuntime, setDetectedRuntime] = useState<string | null>(null)

  useEffect(() => {
    if (runtimeSystemName !== undefined) {
      return
    }

    function check() {
      if (typeof window === 'undefined' || !window.__DIRECTIVE__) {
        return
      }

      const systems = window.__DIRECTIVE__.getSystems()

      setDetectedRuntime((prev) => {
        // Currently attached system vanished → pick first available
        if (prev !== null && !systems.includes(prev)) {
          return systems.length > 0 ? systems[0] : null
        }

        // No system attached yet → pick the first available
        if (prev === null && systems.length > 0) {
          return systems[0]
        }

        return prev
      })
    }

    check()
    const interval = setInterval(check, 1000)

    return () => clearInterval(interval)
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
        // System-only: start disconnected, no AI stream attempt
        ...(!hasAiStream && !replayData ? {
          status: 'disconnected' as const,
          aiEnabled: false,
        } : {}),
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

  // Attach runtime when system name is available
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
      <DevToolsLabelContext.Provider value={label ?? null}>
        {children}
      </DevToolsLabelContext.Provider>
    </DevToolsSystemContext.Provider>
  )
}
