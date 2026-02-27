'use client'

import { DevToolsProvider, type DevToolsProviderProps } from '@/components/devtools/DevToolsProvider'
import { FloatingDevTools } from '@/components/FloatingDevTools'

type DevToolsWithProviderProps = DevToolsProviderProps

export function DevToolsWithProvider(props: DevToolsWithProviderProps) {
  const { children, ...providerProps } = props

  return (
    <DevToolsProvider {...providerProps}>
      {children}
      <FloatingDevTools />
    </DevToolsProvider>
  )
}
