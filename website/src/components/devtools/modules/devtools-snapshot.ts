// @ts-nocheck
import { createModule, t } from '@directive-run/core'
import type { SnapshotResponse } from '../types'
import { SNAPSHOT_POLL_INTERVAL } from '../constants'

export const devtoolsSnapshot = createModule('snapshot', {
  schema: {
    facts: {
      data: t.object<SnapshotResponse | null>(),
      error: t.string<string | null>(),
      lastUpdated: t.number<number | null>(),
      snapshotUrl: t.string(),
    },
    derivations: {
      hasData: t.boolean(),
      hasError: t.boolean(),
      isStale: t.boolean(),
    },
    events: {
      updateSnapshot: { snapshot: t.object<SnapshotResponse>() },
      snapshotError: { message: t.string() },
      clearSnapshot: {},
      setSnapshotUrl: { url: t.string() },
    },
  },

  init: (facts) => {
    facts.data = null
    facts.error = null
    facts.lastUpdated = null
    facts.snapshotUrl = '/api/devtools/snapshot'
  },

  derive: {
    hasData: (facts) => facts.data !== null,
    hasError: (facts) => facts.error !== null,
    isStale: (facts) => {
      if (!facts.lastUpdated) {
        return true
      }

      return Date.now() - facts.lastUpdated > SNAPSHOT_POLL_INTERVAL
    },
  },

  events: {
    updateSnapshot: (facts, { snapshot }) => {
      facts.data = snapshot
      facts.error = null
      facts.lastUpdated = Date.now()
    },
    snapshotError: (facts, { message }) => {
      facts.error = message
    },
    clearSnapshot: (facts) => {
      facts.data = null
      facts.error = null
      facts.lastUpdated = null
    },
    setSnapshotUrl: (facts, { url }) => {
      facts.snapshotUrl = url
    },
  },

  // When data is stale, require a refresh
  constraints: {
    staleData: {
      when: (facts) => {
        if (!facts.lastUpdated) {
          return true
        }

        return Date.now() - facts.lastUpdated > SNAPSHOT_POLL_INTERVAL
      },
      require: { type: 'REFRESH_SNAPSHOT' },
    },
  },

  // Fetches fresh snapshot from server
  resolvers: {
    refreshSnapshot: {
      requirement: 'REFRESH_SNAPSHOT',
      key: () => 'refresh-snapshot',
      resolve: async (req, context) => {
        const res = await fetch(context.facts.snapshotUrl)
        if (!res.ok) {
          context.facts.error = 'Orchestrator not initialized'

          return
        }
        const json: SnapshotResponse = await res.json()
        context.facts.data = json
        context.facts.error = null
        context.facts.lastUpdated = Date.now()
      },
    },
  },
})
