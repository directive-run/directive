'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from './DevToolsSystemContext'
import { DirectiveLogomark } from './DirectiveLogomark'
import { Z_FAB } from './z-index'
import type { ConnectionStatus } from './types'

const FAB_SEEN_KEY = 'directive-devtools-fab-seen'

interface FloatingFabProps {
  offset?: { bottom?: number; right?: number }
}

export function FloatingFab({ offset }: FloatingFabProps) {
  const system = useDevToolsSystem()
  const drawerOpen = useSelector(system, (s) => s.facts.shell.drawerOpen)
  const aiStatus = useSelector(system, (s) => s.facts.connection.status) as ConnectionStatus
  const aiEnabled = useSelector(system, (s) => s.facts.connection.aiEnabled) as boolean
  const runtimeConnected = useSelector(system, (s) => s.facts.runtime.connected)

  // All hooks MUST be called before any conditional returns
  const shortcutHint = useMemo(() => {
    if (typeof navigator === 'undefined') {
      return 'Ctrl+Shift+D'
    }

    return navigator.platform?.includes('Mac') ? 'Cmd+Shift+D' : 'Ctrl+Shift+D'
  }, [])

  // First-visit pulse hint — show once per browser
  const [showPulse, setShowPulse] = useState(false)
  useEffect(() => {
    try {
      if (!localStorage.getItem(FAB_SEEN_KEY)) {
        setShowPulse(true)
        localStorage.setItem(FAB_SEEN_KEY, '1')
        const timer = setTimeout(() => setShowPulse(false), 4000)

        return () => clearTimeout(timer)
      }
    } catch {
      // localStorage unavailable (SSR, private mode)
    }
  }, [])

  // Hide FAB when drawer is open — after all hooks
  if (drawerOpen) {
    return null
  }

  const isConnected = runtimeConnected || (aiEnabled && aiStatus === 'connected')
  const isConnecting = aiEnabled && aiStatus === 'connecting'

  const badgeClass = isConnected
    ? 'bg-emerald-500'
    : isConnecting
      ? 'bg-amber-500 animate-pulse'
      : 'bg-zinc-500'

  const statusLabel = isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'

  // Next.js dev indicator sits at bottom-left — bump FAB up to avoid overlap
  const isDev = process.env.NODE_ENV === 'development'
  const defaultBottom = isDev ? 72 : 24

  return (
    <button
      onClick={() => system.events.shell.toggleDrawer()}
      aria-label={`Open DevTools (${statusLabel})`}
      title={`DevTools (${shortcutHint})`}
      className="fixed flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-brand-primary shadow-lg ring-1 ring-brand-primary-700 transition hover:scale-105 hover:bg-brand-primary-500 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-brand-primary-400 focus:ring-offset-2 dark:bg-brand-primary-600 dark:ring-brand-primary-500 dark:hover:bg-brand-primary-500"
      style={{
        bottom: offset?.bottom ?? defaultBottom,
        right: offset?.right ?? 24,
        zIndex: Z_FAB,
      }}
    >
      <DirectiveLogomark className="h-5 w-5 brightness-0 invert" />

      {/* Status badge */}
      <span
        className={`absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white transition-colors duration-300 dark:border-zinc-900 ${badgeClass}`}
        aria-hidden="true"
      />

      {/* First-visit pulse ring */}
      {showPulse && (
        <span
          className="absolute inset-0 animate-ping rounded-full bg-brand-primary-400 opacity-75"
          aria-hidden="true"
          style={{ animationDuration: '1.5s', animationIterationCount: 3 }}
        />
      )}
    </button>
  )
}
