// @ts-nocheck
import { createModule, t } from '@directive-run/core'
import type { DebugEvent, ConnectionStatus } from '../types'
import { MAX_EVENTS, MAX_RECONNECT_RETRIES, RECONNECT_DELAY } from '../constants'

export const devtoolsConnection = createModule('connection', {
  schema: {
    facts: {
      status: t.string<ConnectionStatus>(),
      retryCount: t.number(),
      events: t.array<DebugEvent>(),
      streamUrl: t.string(),
    },
    derivations: {
      exhaustedRetries: t.boolean(),
      eventCount: t.number(),
      totalTokens: t.number(),
    },
    events: {
      connected: {},
      connecting: {},
      disconnected: {},
      incrementRetry: {},
      resetRetries: {},
      pushEvents: { batch: t.array<DebugEvent>() },
      clearEvents: {},
      importEvents: { imported: t.array<DebugEvent>() },
      setStreamUrl: { url: t.string() },
    },
  },

  init: (facts) => {
    facts.status = 'connecting'
    facts.retryCount = 0
    facts.events = []
    facts.streamUrl = '/api/devtools/stream'
  },

  derive: {
    exhaustedRetries: (facts) =>
      facts.retryCount >= MAX_RECONNECT_RETRIES && facts.status === 'disconnected',
    eventCount: (facts) => (facts.events ?? []).length,
    totalTokens: (facts) =>
      (facts.events ?? [])
        .filter((e) => e.type === 'agent_complete')
        .reduce((s, e) => s + (e.totalTokens ?? 0), 0),
  },

  events: {
    connected: (facts) => {
      facts.status = 'connected'
      facts.retryCount = 0
    },
    connecting: (facts) => {
      facts.status = 'connecting'
    },
    disconnected: (facts) => {
      facts.status = 'disconnected'
    },
    incrementRetry: (facts) => {
      facts.retryCount++
    },
    resetRetries: (facts) => {
      facts.retryCount = 0
    },
    pushEvents: (facts, { batch }) => {
      const next = [...facts.events, ...batch]
      facts.events = next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
    },
    clearEvents: (facts) => {
      facts.events = []
    },
    importEvents: (facts, { imported }) => {
      facts.events = imported
    },
    setStreamUrl: (facts, { url }) => {
      facts.streamUrl = url
    },
  },

  // When disconnected and retries remain, reconnect
  constraints: {
    reconnectNeeded: {
      when: (facts) =>
        facts.status === 'disconnected' && facts.retryCount < MAX_RECONNECT_RETRIES,
      require: { type: 'RECONNECT' },
    },
  },

  // Waits RECONNECT_DELAY then sets status to 'connecting'
  // The actual EventSource creation is handled by the React hook
  resolvers: {
    reconnect: {
      requirement: 'RECONNECT',
      key: () => 'reconnect',
      resolve: async (req, context) => {
        await new Promise((r) => setTimeout(r, RECONNECT_DELAY))
        context.facts.status = 'connecting'
      },
    },
  },

  // POST to server reset when events are cleared
  effects: {
    serverReset: {
      run: (facts, prev) => {
        if (prev && prev.events.length > 0 && facts.events.length === 0) {
          const resetUrl = facts.streamUrl.replace(/\/stream$/, '/reset')
          fetch(resetUrl, { method: 'POST' }).catch(() => {})
        }
      },
    },
  },
})
