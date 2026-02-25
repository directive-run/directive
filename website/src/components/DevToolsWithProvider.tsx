'use client'

import { DevToolsProvider } from '@/components/devtools/DevToolsProvider'
import { FloatingDevTools } from '@/components/FloatingDevTools'
import type { DebugEvent } from '@/components/devtools/types'

interface DevToolsWithProviderProps {
  streamUrl?: string
  snapshotUrl?: string
  replayData?: DebugEvent[]
  children: React.ReactNode
}

export function DevToolsWithProvider({
  children,
  streamUrl,
  snapshotUrl,
  replayData,
}: DevToolsWithProviderProps) {
  return (
    <DevToolsProvider streamUrl={streamUrl} snapshotUrl={snapshotUrl} replayData={replayData}>
      {children}
      <FloatingDevTools />
    </DevToolsProvider>
  )
}
