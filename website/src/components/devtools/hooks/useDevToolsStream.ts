'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DebugEvent, ConnectionStatus } from '../types'
import { MAX_EVENTS, RECONNECT_DELAY, MAX_RECONNECT_RETRIES, FLUSH_INTERVAL_MS } from '../constants'
import { useDevToolsUrls } from '../DevToolsUrlContext'

export function useDevToolsStream() {
  const { streamUrl } = useDevToolsUrls()
  const [events, setEvents] = useState<DebugEvent[]>([])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const maxIdRef = useRef(-1)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const pendingRef = useRef<DebugEvent[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // M1: Track reconnect attempts to avoid infinite loop
  const retryCountRef = useRef(0)

  const flushPending = useCallback(() => {
    flushTimerRef.current = null
    const batch = pendingRef.current
    if (batch.length === 0) {
      return
    }
    pendingRef.current = []

    setEvents((prev) => {
      const next = [...prev, ...batch]
      if (next.length > MAX_EVENTS) {
        return next.slice(next.length - MAX_EVENTS)
      }

      return next
    })
  }, [])

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
    }

    setStatus('connecting')
    const es = new EventSource(streamUrl)
    esRef.current = es

    es.onopen = () => {
      setStatus('connected')
      retryCountRef.current = 0 // Reset on successful connection
    }

    es.onmessage = (msg) => {
      try {
        const event: DebugEvent = JSON.parse(msg.data)
        // Deduplicate on reconnect
        if (event.id <= maxIdRef.current) return
        maxIdRef.current = event.id

        pendingRef.current.push(event)
        if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(flushPending, FLUSH_INTERVAL_MS)
        }
      } catch {
        // m9: Log malformed SSE messages in development
        if (process.env.NODE_ENV === 'development') {
          console.warn('[DevTools] Failed to parse SSE message:', msg.data)
        }
      }
    }

    es.onerror = () => {
      es.close()
      esRef.current = null
      setStatus('disconnected')

      // M1: Stop retrying after max attempts
      if (retryCountRef.current >= MAX_RECONNECT_RETRIES) {
        return
      }

      retryCountRef.current++
      retryTimerRef.current = setTimeout(() => {
        connect()
      }, RECONNECT_DELAY)
    }
  }, [flushPending, streamUrl])

  // M1: Manual reconnect (exposed for "click to retry" after max retries)
  const reconnect = useCallback(() => {
    retryCountRef.current = 0
    connect()
  }, [connect])

  useEffect(() => {
    connect()

    return () => {
      esRef.current?.close()
      esRef.current = null
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
      }
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
      }
    }
  }, [connect])

  const clear = useCallback(() => {
    setEvents([])
    maxIdRef.current = -1
    pendingRef.current = []

    // Also clear server-side timeline + memory
    const resetUrl = streamUrl.replace(/\/stream$/, '/reset')
    fetch(resetUrl, { method: 'POST' }).catch(() => {})
  }, [streamUrl])

  // Listen for imported events
  useEffect(() => {
    const handler = (e: Event) => {
      const imported = (e as CustomEvent).detail as DebugEvent[]
      if (Array.isArray(imported) && imported.length > 0) {
        setEvents(imported)
        maxIdRef.current = Math.max(...imported.map((ev) => ev.id))
      }
    }

    window.addEventListener('devtools-import', handler)

    return () => window.removeEventListener('devtools-import', handler)
  }, [])

  const exhaustedRetries = retryCountRef.current >= MAX_RECONNECT_RETRIES && status === 'disconnected'

  return { events, status, clear, reconnect, exhaustedRetries }
}
