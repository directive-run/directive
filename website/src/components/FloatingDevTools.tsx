'use client'

import { useEffect } from 'react'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from './devtools/DevToolsSystemContext'
import { DevToolsErrorBoundary } from './devtools/DevToolsErrorBoundary'
import { FloatingFab } from './devtools/FloatingFab'
import { DrawerPanel } from './devtools/DrawerPanel'
import { DevToolsContent } from './LiveDevTools'

interface FloatingDevToolsProps {
  offset?: { bottom?: number; left?: number }
}

export function FloatingDevTools({ offset }: FloatingDevToolsProps) {
  const system = useDevToolsSystem()
  const drawerOpen = useSelector(system, (s) => s.facts.shell.drawerOpen)

  // Keyboard shortcuts — Escape checks fullscreen first, uses stopPropagation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when focus is in input/textarea/contenteditable/select
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return
      }

      // Ctrl+Shift+D / Cmd+Shift+D — toggle drawer
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        system.events.shell.toggleDrawer()
      }

      // Escape — close drawer (but let fullscreen exit first if active)
      if (e.key === 'Escape' && system.facts.shell.drawerOpen) {
        if (system.facts.shell.isFullscreen) {
          return
        }

        e.preventDefault()
        e.stopPropagation()
        system.events.shell.closeDrawer()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [system])

  return (
    <>
      <FloatingFab offset={offset} />
      <DrawerPanel>
        {drawerOpen && (
          <DevToolsErrorBoundary>
            <DevToolsContent mode="drawer" />
          </DevToolsErrorBoundary>
        )}
      </DrawerPanel>
    </>
  )
}
