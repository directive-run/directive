'use client'

import { createContext, useContext } from 'react'

export interface DevToolsUrls {
  streamUrl: string
  snapshotUrl: string
}

const defaultUrls: DevToolsUrls = {
  streamUrl: '/api/devtools/stream',
  snapshotUrl: '/api/devtools/snapshot',
}

export const DevToolsUrlContext = createContext<DevToolsUrls>(defaultUrls)

export function useDevToolsUrls(): DevToolsUrls {
  return useContext(DevToolsUrlContext)
}
