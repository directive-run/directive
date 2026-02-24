'use client'

import { createContext, useContext } from 'react'
import type { NamespacedSystem } from '@directive-run/core'
import type { devtoolsShell } from './modules/devtools-shell'
import type { devtoolsConnection } from './modules/devtools-connection'
import type { devtoolsSnapshot } from './modules/devtools-snapshot'

export type DevToolsModules = {
  shell: typeof devtoolsShell
  connection: typeof devtoolsConnection
  snapshot: typeof devtoolsSnapshot
}

export type DevToolsSystem = NamespacedSystem<DevToolsModules>

export const DevToolsSystemContext = createContext<DevToolsSystem | null>(null)

export function useDevToolsSystem(): DevToolsSystem {
  const system = useContext(DevToolsSystemContext)
  if (!system) {
    throw new Error('useDevToolsSystem must be used within DevToolsSystemContext.Provider')
  }

  return system
}
