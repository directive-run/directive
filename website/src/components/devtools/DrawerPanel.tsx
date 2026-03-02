'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from './DevToolsSystemContext'
import { DirectiveLogomark } from './DirectiveLogomark'
import { SystemSelector } from './SystemSelector'
import { useTimeTravel } from './hooks/useTimeTravel'
import { Z_DRAWER, DRAWER_OPEN_MS, DRAWER_CLOSE_MS } from './z-index'
import type { ConnectionStatus } from './types'

// ---------------------------------------------------------------------------
// useMediaQuery — SSR-safe reactive media query hook
// ---------------------------------------------------------------------------

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      if (typeof window === 'undefined') {
        return () => {}
      }

      const mql = window.matchMedia(query)
      mql.addEventListener('change', callback)

      return () => mql.removeEventListener('change', callback)
    },
    [query],
  )

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.matchMedia(query).matches
  }, [query])

  const getServerSnapshot = useCallback(() => false, [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

interface DrawerPanelProps {
  children: React.ReactNode
}

export function DrawerPanel({ children }: DrawerPanelProps) {
  const system = useDevToolsSystem()
  const drawerOpen = useSelector(system, (s) => s.facts.shell.drawerOpen)
  const position = useSelector(system, (s) => s.facts.shell.drawerPosition) as 'bottom' | 'right'
  const height = useSelector(system, (s) => s.facts.shell.drawerHeight)
  const width = useSelector(system, (s) => s.facts.shell.drawerWidth)
  const aiStatus = useSelector(system, (s) => s.facts.connection.status) as ConnectionStatus
  const aiEnabled = useSelector(system, (s) => s.facts.connection.aiEnabled) as boolean
  const isFullscreen = useSelector(system, (s) => s.facts.shell.isFullscreen)
  const { timeTravelEnabled, snapshotIndex, snapshotCount, canUndo, canRedo, handleUndo, handleRedo } = useTimeTravel()

  // Portal mount target
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setPortalTarget(document.body)
  }, [])

  // Track animation state for unmounting content after close
  const [isVisible, setIsVisible] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const rafRef = useRef(0)

  // #3: Cancel rAF IDs on cleanup to prevent race conditions
  useEffect(() => {
    if (drawerOpen) {
      setIsVisible(true)
      cancelAnimationFrame(rafRef.current)
      const id1 = requestAnimationFrame(() => {
        const id2 = requestAnimationFrame(() => {
          setIsAnimating(true)
        })
        rafRef.current = id2
      })
      rafRef.current = id1
    } else {
      setIsAnimating(false)
      const timer = setTimeout(() => setIsVisible(false), DRAWER_CLOSE_MS)

      return () => clearTimeout(timer)
    }

    return () => cancelAnimationFrame(rafRef.current)
  }, [drawerOpen])

  // #7: Focus management — ref for close button, focus on open, restore on close
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (drawerOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement
      // Focus close button after animation starts
      const timer = setTimeout(() => closeButtonRef.current?.focus(), DRAWER_OPEN_MS + 50)

      return () => clearTimeout(timer)
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus()
      previousFocusRef.current = null
    }
  }, [drawerOpen])

  // Focus trap — Tab/Shift+Tab cycle within the drawer when open
  useEffect(() => {
    if (!drawerOpen || !dialogRef.current) {
      return
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !dialogRef.current) {
        return
      }

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )

      if (focusable.length === 0) {
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [drawerOpen])

  // Escape key exits fullscreen
  useEffect(() => {
    if (!isFullscreen || !drawerOpen) {
      return
    }

    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        system.events.shell.exitFullscreen()
      }
    }

    document.addEventListener('keydown', handleEsc)

    return () => document.removeEventListener('keydown', handleEsc)
  }, [isFullscreen, drawerOpen, system])

  const isMobile = useMediaQuery('(max-width: 639px)')

  if (!portalTarget || !isVisible) {
    return null
  }

  const isBottom = position === 'bottom'

  // #4: Mobile breakpoints — cap size on small screens
  const effectiveHeight = isMobile
    ? Math.min(height, typeof window !== 'undefined' ? window.innerHeight * 0.7 : height)
    : height
  const effectiveWidth = isMobile
    ? (typeof window !== 'undefined' ? window.innerWidth : width)
    : width

  // #17: Use animation constants, #5 remove willChange when not animating
  const panelStyle: React.CSSProperties = isFullscreen
    ? {
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        transform: isAnimating ? 'none' : (isBottom ? 'translateY(100%)' : 'translateX(100%)'),
        transition: isAnimating
          ? `transform ${DRAWER_OPEN_MS}ms ease-out`
          : `transform ${DRAWER_CLOSE_MS}ms ease-in`,
      }
    : isBottom
      ? {
          bottom: 0,
          left: 0,
          right: 0,
          height: effectiveHeight,
          transform: isAnimating ? 'translateY(0)' : 'translateY(100%)',
          transition: isAnimating
            ? `transform ${DRAWER_OPEN_MS}ms ease-out`
            : `transform ${DRAWER_CLOSE_MS}ms ease-in`,
          ...(isAnimating || !isVisible ? {} : { willChange: 'transform' }),
        }
      : {
          top: 0,
          right: 0,
          bottom: 0,
          width: effectiveWidth,
          transform: isAnimating ? 'translateX(0)' : 'translateX(100%)',
          transition: isAnimating
            ? `transform ${DRAWER_OPEN_MS}ms ease-out`
            : `transform ${DRAWER_CLOSE_MS}ms ease-in`,
          ...(isAnimating || !isVisible ? {} : { willChange: 'transform' }),
        }

  return createPortal(
    // #7: role="dialog" + aria-label + aria-modal for screen readers
    <div
      ref={dialogRef}
      role="dialog"
      aria-label="DevTools panel"
      aria-modal="false"
      className="devtools-panel fixed flex flex-col border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
      style={{ ...panelStyle, zIndex: Z_DRAWER }}
    >
      {/* #5: Resize handle — expanded hit area (16px transparent zone, 2px visible line) */}
      {!isFullscreen && <ResizeHandle position={position} />}

      {/* Drawer header */}
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800/50">
        <div className="flex items-center gap-2">
          {/* #13: Shared logomark component */}
          <DirectiveLogomark />
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            DevTools
          </span>
          {/* Connection status — system selector + AI indicator */}
          <div className="flex items-center gap-2 ml-2">
            <SystemSelector />
            {aiEnabled && aiStatus !== 'disconnected' && (
              <div className="flex items-center gap-1">
                <div className={`h-1.5 w-1.5 rounded-full ${
                  aiStatus === 'connected' ? 'bg-emerald-500'
                    : aiStatus === 'connecting' ? 'bg-amber-500 animate-pulse'
                      : 'bg-zinc-400'
                }`} aria-hidden="true" />
                <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                  AI
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Snapshot back/forward — only when time-travel is enabled */}
          {timeTravelEnabled && (
            <>
              {snapshotCount > 0 && (
                <span className="mr-0.5 font-mono text-[10px] text-zinc-400 dark:text-zinc-500" role="status" aria-label={`Snapshot ${snapshotIndex + 1} of ${snapshotCount}`} title="Snapshot position">
                  {snapshotIndex + 1}/{snapshotCount}
                </span>
              )}
              <button
                onClick={handleUndo}
                disabled={!canUndo}
                aria-label="Go back one snapshot"
                title="Back"
                className="cursor-pointer rounded p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path fillRule="evenodd" d="M11.354 3.646a.5.5 0 0 1 0 .708L7.707 8l3.647 3.646a.5.5 0 0 1-.708.708l-4-4a.5.5 0 0 1 0-.708l4-4a.5.5 0 0 1 .708 0z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                onClick={handleRedo}
                disabled={!canRedo}
                aria-label="Go forward one snapshot"
                title="Forward"
                className="cursor-pointer rounded p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path fillRule="evenodd" d="M4.646 3.646a.5.5 0 0 1 .708 0l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L8.293 8 4.646 4.354a.5.5 0 0 1 0-.708z" clipRule="evenodd" />
                </svg>
              </button>
              <div className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
            </>
          )}

          {/* #4: Position toggle — hidden on mobile */}
          {!isMobile && (
            <button
              onClick={() => {
                system.events.shell.setDrawerPosition({
                  position: isBottom ? 'right' : 'bottom',
                })
              }}
              aria-label={isBottom ? 'Move to right side' : 'Move to bottom'}
              title={isBottom ? 'Dock right' : 'Dock bottom'}
              className="cursor-pointer rounded p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
            >
              {isBottom ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-11zM3.5 2a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5H9V2H3.5zM10 2v12h2.5a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5H10z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-11zM3.5 2a.5.5 0 0 0-.5.5V10h10V2.5a.5.5 0 0 0-.5-.5h-9zM3 11v2.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V11H3z" />
                </svg>
              )}
            </button>
          )}

          {/* Fullscreen toggle */}
          <button
            onClick={() => system.events.shell.toggleFullscreen()}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="cursor-pointer rounded p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
          >
            {isFullscreen ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M5.5 1a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1 0-1H4.3L1.15 1.15a.5.5 0 1 1 .7-.7L5 3.7V1.5a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v2.2l3.15-3.15a.5.5 0 1 1 .7.7L11.7 4.5h2.3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5zM1 10.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0v-2.3l-3.15 3.15a.5.5 0 0 1-.7-.7L3.3 11H1.5a.5.5 0 0 1-.5-.5zm9 0a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-2.3l3.15 3.15a.5.5 0 0 1-.7.7L10.5 11.7v2.3a.5.5 0 0 1-1 0v-3a.5.5 0 0 1 .5-.5z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M1.5 1a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 1 0V2.707l3.146 3.147a.5.5 0 1 0 .708-.708L2.707 2H4.5a.5.5 0 0 0 0-1h-3zm13 0a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0V2.707l-3.146 3.147a.5.5 0 1 1-.708-.708L13.293 2H11.5a.5.5 0 0 1 0-1h3zM1.5 15a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 1 0v1.793l3.146-3.147a.5.5 0 1 1 .708.708L2.707 14H4.5a.5.5 0 0 1 0 1h-3zm13 0a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-1 0v1.793l-3.146-3.147a.5.5 0 0 0-.708.708L13.293 14H11.5a.5.5 0 0 0 0 1h3z" />
              </svg>
            )}
          </button>

          {/* Close button — #7: receives focus on open */}
          <button
            ref={closeButtonRef}
            onClick={() => system.events.shell.closeDrawer()}
            aria-label="Close DevTools"
            className="cursor-pointer rounded p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content area with overscroll containment */}
      <div className="min-h-0 flex-1 overflow-hidden overscroll-contain">
        {children}
      </div>
    </div>,
    portalTarget,
  )
}

// ---------------------------------------------------------------------------
// ResizeHandle — drag to resize drawer
// #5: 16px hit area (transparent zone) with 2px visible indicator
// #9: isDragging as ref instead of state to avoid stale closures
// #10: onPointerCancel + onLostPointerCapture + releasePointerCapture
// ---------------------------------------------------------------------------

function ResizeHandle({ position }: { position: 'bottom' | 'right' }) {
  const system = useDevToolsSystem()
  const isDraggingRef = useRef(false)
  const [dragActive, setDragActive] = useState(false)
  const startRef = useRef({ pos: 0, size: 0 })
  const elementRef = useRef<HTMLDivElement>(null)

  const isBottom = position === 'bottom'

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    isDraggingRef.current = true
    setDragActive(true)

    const currentHeight = system.facts.shell.drawerHeight
    const currentWidth = system.facts.shell.drawerWidth
    startRef.current = {
      pos: isBottom ? e.clientY : e.clientX,
      size: isBottom ? currentHeight : currentWidth,
    }
  }, [system, isBottom])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) {
      return
    }

    const delta = startRef.current.pos - (isBottom ? e.clientY : e.clientX)
    const newSize = Math.max(
      isBottom ? 200 : 320,
      Math.min(
        startRef.current.size + delta,
        isBottom ? window.innerHeight * 0.8 : window.innerWidth * 0.8,
      ),
    )

    if (isBottom) {
      system.events.shell.setDrawerSize({ height: Math.round(newSize), width: system.facts.shell.drawerWidth })
    } else {
      system.events.shell.setDrawerSize({ height: system.facts.shell.drawerHeight, width: Math.round(newSize) })
    }
  }, [isBottom, system])

  const handlePointerEnd = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) {
      return
    }

    isDraggingRef.current = false
    setDragActive(false)
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // Already released
    }
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10
    const currentHeight = system.facts.shell.drawerHeight
    const currentWidth = system.facts.shell.drawerWidth

    if (isBottom && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const delta = e.key === 'ArrowUp' ? step : -step
      const newHeight = Math.max(200, Math.min(currentHeight + delta, window.innerHeight * 0.8))
      system.events.shell.setDrawerSize({ height: Math.round(newHeight), width: currentWidth })
    } else if (!isBottom && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      const delta = e.key === 'ArrowLeft' ? step : -step
      const newWidth = Math.max(320, Math.min(currentWidth + delta, window.innerWidth * 0.8))
      system.events.shell.setDrawerSize({ height: currentHeight, width: Math.round(newWidth) })
    }
  }, [isBottom, system])

  return (
    <div
      ref={elementRef}
      role="separator"
      aria-orientation={isBottom ? 'horizontal' : 'vertical'}
      aria-label={isBottom ? 'Resize panel height' : 'Resize panel width'}
      aria-valuenow={isBottom ? system.facts.shell.drawerHeight : system.facts.shell.drawerWidth}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onKeyDown={handleKeyDown}
      className={`shrink-0 group ${
        isBottom
          ? 'h-4 w-full cursor-row-resize'
          : 'w-4 h-full absolute left-0 top-0 cursor-col-resize'
      } focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500`}
      style={!isBottom ? { zIndex: 1 } : undefined}
    >
      {/* Visible indicator line (2px) centered in the 16px hit area */}
      <div className={`${
        isBottom
          ? 'mx-auto mt-1.5 h-0.5 w-10 rounded-full'
          : 'my-auto ml-0.5 w-0.5 h-10 rounded-full absolute top-1/2 -translate-y-1/2'
      } ${
        dragActive
          ? 'bg-sky-500'
          : 'bg-zinc-300 group-hover:bg-sky-400 dark:bg-zinc-600 dark:group-hover:bg-sky-500'
      } transition-colors`} />
    </div>
  )
}
