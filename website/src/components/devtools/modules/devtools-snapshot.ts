// @ts-nocheck -- TODO: fix createModule generic inference in @directive-run/core for complex schemas
import { createModule, t } from '@directive-run/core'
import type { SnapshotResponse } from '../types'
import { SNAPSHOT_POLL_INTERVAL } from '../constants'

export const devtoolsSnapshot = createModule('snapshot', {
  schema: {
    facts: {
      data: t.nullable(t.object<SnapshotResponse>()),
      error: t.nullable(t.string()),
      lastUpdated: t.nullable(t.number()),
      snapshotUrl: t.string(),
      // Reactive polling generation — bumped periodically to trigger re-evaluation
      pollGeneration: t.number(),
    },
    derivations: {
      hasData: t.boolean(),
      hasError: t.boolean(),
      // isStale derivation reads pollGeneration for reactivity
      isStale: t.boolean(),
    },
    events: {
      updateSnapshot: { snapshot: t.object<SnapshotResponse>() },
      snapshotError: { message: t.string() },
      clearSnapshot: {},
      setSnapshotUrl: { url: t.string() },
      // Periodic poll bump to make staleData constraint reactive
      bumpPoll: {},
    },
  },

  init: (facts) => {
    facts.data = null
    facts.error = null
    facts.lastUpdated = null
    facts.snapshotUrl = '/api/devtools/snapshot'
    facts.pollGeneration = 0
  },

  derive: {
    hasData: (facts) => facts.data !== null,
    hasError: (facts) => facts.error !== null,
    // Single source of truth for staleness — reads pollGeneration for reactivity
    isStale: (facts) => {
      // Touch pollGeneration so this derivation re-evaluates on each bump
      void facts.pollGeneration
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
      // Update lastUpdated on error so poll interval applies to errors too
      facts.lastUpdated = Date.now()
    },
    clearSnapshot: (facts) => {
      facts.data = null
      facts.error = null
      facts.lastUpdated = null
    },
    setSnapshotUrl: (facts, { url }) => {
      facts.snapshotUrl = url
    },
    bumpPoll: (facts) => {
      facts.pollGeneration++
    },
  },

  // Constraint reads pollGeneration via facts to become reactive
  constraints: {
    staleData: {
      when: (facts) => {
        // Touch pollGeneration so constraint re-evaluates on each bump
        void facts.pollGeneration
        if (!facts.lastUpdated) {
          return true
        }

        return Date.now() - facts.lastUpdated > SNAPSHOT_POLL_INTERVAL
      },
      require: { type: 'REFRESH_SNAPSHOT' },
    },
  },

  resolvers: {
    refreshSnapshot: {
      requirement: 'REFRESH_SNAPSHOT',
      key: () => 'refresh-snapshot',
      resolve: async (req, context) => {
        const res = await fetch(context.facts.snapshotUrl)
        if (!res.ok) {
          // Set lastUpdated on error to prevent tight re-trigger loop
          context.facts.error = 'Orchestrator not initialized'
          context.facts.lastUpdated = Date.now()

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
