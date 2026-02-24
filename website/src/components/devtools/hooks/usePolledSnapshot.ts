'use client'

import { useEffect, useRef, useState } from 'react'
import type { SnapshotResponse } from '../types'
import { SNAPSHOT_POLL_INTERVAL } from '../constants'
import { useDevToolsUrls } from '../DevToolsUrlContext'

// C1: Shared polling hook — replaces 5 independent fetch cycles
// All views (State, Health, Memory, Budget, Config) share one fetch.

export function usePolledSnapshot(intervalMs: number = SNAPSHOT_POLL_INTERVAL) {
  const { snapshotUrl } = useDevToolsUrls()
  const [data, setData] = useState<SnapshotResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    const fetchSnapshot = async () => {
      try {
        const res = await fetch(snapshotUrl)
        if (!res.ok) {
          if (mountedRef.current) {
            setError('Orchestrator not initialized')
          }

          return
        }
        const json: SnapshotResponse = await res.json()
        if (mountedRef.current) {
          setData(json)
          setError(null)
          setLastUpdated(Date.now())
        }
      } catch {
        if (mountedRef.current) {
          setError('Failed to fetch snapshot')
        }
      }
    }

    fetchSnapshot()
    const interval = setInterval(fetchSnapshot, intervalMs)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [intervalMs, snapshotUrl])

  return { data, error, lastUpdated }
}
