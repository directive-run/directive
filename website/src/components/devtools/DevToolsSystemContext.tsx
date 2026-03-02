'use client'

import { createContext, useContext } from 'react'
import type { NamespacedSystem } from '@directive-run/core'
import type { devtoolsShell } from './modules/devtools-shell'
import type { devtoolsConnection } from './modules/devtools-connection'
import type { devtoolsSnapshot } from './modules/devtools-snapshot'
import type { devtoolsRuntime } from './modules/devtools-runtime'

export type DevToolsModules = {
  shell: typeof devtoolsShell
  connection: typeof devtoolsConnection
  snapshot: typeof devtoolsSnapshot
  runtime: typeof devtoolsRuntime
}

export type DevToolsSystem = NamespacedSystem<DevToolsModules>

export const DevToolsSystemContext = createContext<DevToolsSystem | null>(null)

export const DevToolsLabelContext = createContext<string | null>(null)

export function useDevToolsSystem(): DevToolsSystem {
  const system = useContext(DevToolsSystemContext)
  if (!system) {
    throw new Error('useDevToolsSystem must be used within DevToolsSystemContext.Provider')
  }

  return system
}

export function useDevToolsLabel(): string | null {
  return useContext(DevToolsLabelContext)
}
