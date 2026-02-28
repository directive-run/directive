// @ts-nocheck -- TODO: fix createModule generic inference in @directive-run/core for complex schemas
import { createModule, t } from '@directive-run/core'
import type { DebugEvent, ConnectionStatus, BreakpointDef } from '../types'
import { MAX_EVENTS, MAX_RECONNECT_RETRIES, RECONNECT_DELAY } from '../constants'

export const devtoolsConnection = createModule('connection', {
  schema: {
    facts: {
      status: t.string<ConnectionStatus>(),
      retryCount: t.number(),
      events: t.array<DebugEvent>(),
      streamUrl: t.string(),
      // M8: Dedicated resetUrl fact instead of fragile regex replacement
      resetUrl: t.string(),
      // Phase 4: Replay mode disables reconnection
      replayMode: t.boolean(),
      // When false, no AI stream connection is attempted (system-only mode)
      aiEnabled: t.boolean(),
      // When true, AI events come from client-side bridge only (no SSE reconnection)
      clientOnly: t.boolean(),
      // Phase 5: Breakpoint-driven pause
      isPaused: t.boolean(),
      breakpoints: t.array<BreakpointDef>(),
      pausedOnEvent: t.nullable(t.object<DebugEvent>()),
    },
    derivations: {
      exhaustedRetries: t.boolean(),
      eventCount: t.number(),
      totalTokens: t.number(),
      // Phase 5: Active (enabled) breakpoints
      activeBreakpoints: t.array<BreakpointDef>(),
    },
    events: {
      connected: {},
      connecting: {},
      disconnected: {},
      incrementRetry: {},
      resetRetries: {},
      pushEvents: { batch: t.array<DebugEvent>() },
      clearEvents: {},
      // Client-side AI bridge: auto-enable AI tabs without SSE
      enableAi: {},
      importEvents: { imported: t.array<DebugEvent>() },
      // C4: Atomic event replacement — no intermediate empty state
      replaceEvents: { events: t.array<DebugEvent>() },
      setStreamUrl: { url: t.string() },
      // Phase 4: Replay mode
      enterReplayMode: {},
      // Phase 5: Breakpoint events
      addBreakpoint: { breakpoint: t.object<BreakpointDef>() },
      removeBreakpoint: { id: t.string() },
      toggleBreakpoint: { id: t.string() },
      pauseStream: { event: t.object<DebugEvent>() },
      resumeStream: {},
    },
  },

  init: (facts) => {
    facts.status = 'connecting'
    facts.retryCount = 0
    facts.events = []
    facts.streamUrl = '/api/devtools/stream'
    facts.resetUrl = '/api/devtools/reset'
    facts.replayMode = false
    facts.aiEnabled = true
    facts.clientOnly = false
    facts.isPaused = false
    facts.breakpoints = []
    facts.pausedOnEvent = null
  },

  derive: {
    exhaustedRetries: (facts) =>
      facts.retryCount >= MAX_RECONNECT_RETRIES && facts.status === 'disconnected',
    eventCount: (facts) => facts.events.length,
    totalTokens: (facts) =>
      facts.events
        .filter((e) => e.type === 'agent_complete')
        .reduce((s, e) => s + (e.totalTokens ?? 0), 0),
    activeBreakpoints: (facts) => facts.breakpoints.filter((b) => b.enabled),
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
      // Deduplicate: skip events already in the list (handles SSE replay on remount)
      const maxId = facts.events.length > 0
        ? facts.events[facts.events.length - 1].id
        : -1
      const fresh = batch.filter((e) => e.id > maxId)
      if (fresh.length === 0) {
        return
      }

      const next = [...facts.events, ...fresh]
      facts.events = next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
    },
    clearEvents: (facts) => {
      facts.events = []
    },
    enableAi: (facts) => {
      facts.aiEnabled = true
      facts.clientOnly = true
    },
    importEvents: (facts, { imported }) => {
      facts.events = imported
    },
    // C4: Atomic replacement — avoids intermediate empty state that triggers serverReset
    replaceEvents: (facts, { events }) => {
      facts.events = events
    },
    setStreamUrl: (facts, { url }) => {
      facts.streamUrl = url
      // M8: Derive resetUrl from streamUrl
      facts.resetUrl = url.replace(/\/stream$/, '/reset')
    },
    enterReplayMode: (facts) => {
      facts.replayMode = true
    },
    addBreakpoint: (facts, { breakpoint }) => {
      facts.breakpoints = [...facts.breakpoints, breakpoint]
    },
    removeBreakpoint: (facts, { id }) => {
      facts.breakpoints = facts.breakpoints.filter((b) => b.id !== id)
    },
    toggleBreakpoint: (facts, { id }) => {
      facts.breakpoints = facts.breakpoints.map((b) =>
        b.id === id ? { ...b, enabled: !b.enabled } : b,
      )
    },
    pauseStream: (facts, { event }) => {
      facts.isPaused = true
      facts.pausedOnEvent = event
    },
    resumeStream: (facts) => {
      facts.isPaused = false
      facts.pausedOnEvent = null
    },
  },

  // When disconnected and retries remain, reconnect (unless in replay mode)
  constraints: {
    reconnectNeeded: {
      when: (facts) =>
        facts.aiEnabled &&
        !facts.clientOnly &&
        !facts.replayMode &&
        facts.status === 'disconnected' &&
        facts.retryCount < MAX_RECONNECT_RETRIES,
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
        // M3: Guard against overwriting a manual reconnect that already succeeded
        if (context.facts.status === 'disconnected') {
          context.facts.status = 'connecting'
        }
      },
    },
  },

  // POST to server reset when events are cleared
  effects: {
    serverReset: {
      run: (facts, prev) => {
        if (facts.clientOnly) {
          return
        }

        if (prev && prev.events.length > 0 && facts.events.length === 0) {
          // M8: Use dedicated resetUrl fact
          fetch(facts.resetUrl, { method: 'POST' }).catch(() => {})
        }
      },
    },
  },
})
