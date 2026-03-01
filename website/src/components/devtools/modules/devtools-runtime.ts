// @ts-nocheck — createModule inference collapses with complex object/array schema types (t.array<T>, t.object<T>).
// All errors below cascade from the same root cause. Fix by improving InferSchema for nested generics in core.
import { createModule, t } from '@directive-run/core'
import type { RunChangelogEntry } from '@directive-run/core'
import type { FactBreakpointDef, FactBreakpointHit, EventBreakpointDef, EventBreakpointHit } from '../types'

// ---------------------------------------------------------------------------
// Types for runtime bridge data
// ---------------------------------------------------------------------------

export interface RuntimeConstraintInfo {
  id: string
  active: boolean
  disabled: boolean
  priority: number | undefined
  hitCount: number
  lastActiveAt: number | null
}

export interface RuntimeResolverStats {
  count: number
  totalMs: number
  errors: number
}

export interface RuntimeRequirementInfo {
  id: string
  type: string
  fromConstraint: string
  status: 'inflight' | 'unmet'
}

export interface RuntimeResolverDef {
  id: string
  requirement: string
}

/** Shape returned by window.__DIRECTIVE__.inspect() */
interface InspectionResult {
  facts?: Record<string, unknown>
  derivations?: Record<string, unknown>
  constraints?: Array<{ id?: string; active?: boolean; disabled?: boolean; priority?: number; hitCount?: number; lastActiveAt?: number | null }>
  inflight?: Array<{ id?: string; requirement?: { type?: string }; type?: string; fromConstraint?: string }>
  unmet?: Array<{ id?: string; requirement?: { type?: string }; type?: string; fromConstraint?: string }>
  resolverStats?: Record<string, RuntimeResolverStats>
  resolverDefs?: Array<{ id?: string; requirement?: string }>
  runHistoryEnabled?: boolean
  runHistory?: RunChangelogEntry[]
  timeTravel?: { currentIndex?: number; snapshotCount?: number }
}

/** Subset of a Directive system instance used for direct proxy reads */
interface DirectiveSystemRef {
  facts?: Record<string, unknown>
  derive?: Record<string, unknown>
  debug?: {
    isEnabled?: boolean
    currentIndex?: number
    snapshots?: unknown[]
    goBack?: (steps: number) => void
    goForward?: (steps: number) => void
  }
}

// ---------------------------------------------------------------------------
// Module-level cleanup registry
// Uses WeakMap keyed by context to avoid singleton corruption on HMR/dual-mount
// ---------------------------------------------------------------------------

const _runtimeUnsubs = new WeakMap<object, () => void>()
const _breakpointUnsubs = new WeakMap<object, Map<string, { unsub: () => void; condition: string }>>()

const MAX_BREAKPOINT_HITS = 500

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const devtoolsRuntime = createModule('runtime', {
  schema: {
    facts: {
      connected: t.boolean(),
      systemName: t.nullable(t.string()),
      facts: t.object<Record<string, unknown>>(),
      derivations: t.object<Record<string, unknown>>(),
      constraints: t.array<RuntimeConstraintInfo>(),
      inflight: t.array<RuntimeRequirementInfo>(),
      unmet: t.array<RuntimeRequirementInfo>(),
      resolverStats: t.object<Record<string, RuntimeResolverStats>>(),
      resolverDefs: t.array<RuntimeResolverDef>(),
      timeTravelEnabled: t.boolean(),
      snapshotIndex: t.number(),
      snapshotCount: t.number(),
      lastEventType: t.nullable(t.string()),
      // Per-run changelog from the connected system
      runHistory: t.array<RunChangelogEntry>(),
      // Whether the connected system has runHistory enabled
      runHistoryEnabled: t.boolean(),
      // Tick counter bumped on each subscription callback — drives reactivity
      tick: t.number(),
      // Breakpoint state
      factBreakpoints: t.array<FactBreakpointDef>(),
      factBreakpointHits: t.array<FactBreakpointHit>(),
      eventBreakpoints: t.array<EventBreakpointDef>(),
      eventBreakpointHits: t.array<EventBreakpointHit>(),
      breakpointPaused: t.boolean(),
      pausedOnHit: t.nullable(t.string()),
    },
    derivations: {
      hasTimeTravel: t.boolean(),
      canUndo: t.boolean(),
      canRedo: t.boolean(),
      factCount: t.number(),
      derivationCount: t.number(),
      activeConstraintCount: t.number(),
      inflightCount: t.number(),
      unmetCount: t.number(),
      latestRun: t.nullable(t.object<RunChangelogEntry>()),
      runCount: t.number(),
      factBreakpointHitCount: t.number(),
      eventBreakpointHitCount: t.number(),
      totalBreakpointHitCount: t.number(),
      activeFactBreakpointCount: t.number(),
      activeEventBreakpointCount: t.number(),
    },
    events: {
      attach: { systemName: t.nullable(t.string()) },
      detach: {},
      refresh: {},
      forceSync: {},
      addFactBreakpoint: { breakpoint: t.object<FactBreakpointDef>() },
      removeFactBreakpoint: { id: t.string() },
      toggleFactBreakpoint: { id: t.string() },
      clearFactBreakpointHits: {},
      addEventBreakpoint: { breakpoint: t.object<EventBreakpointDef>() },
      removeEventBreakpoint: { id: t.string() },
      toggleEventBreakpoint: { id: t.string() },
      clearEventBreakpointHits: {},
      resumeFromBreakpoint: {},
    },
  },

  init: (facts) => {
    facts.connected = false
    facts.systemName = null
    facts.facts = {}
    facts.derivations = {}
    facts.constraints = []
    facts.inflight = []
    facts.unmet = []
    facts.resolverStats = {}
    facts.resolverDefs = []
    facts.timeTravelEnabled = false
    facts.snapshotIndex = -1
    facts.snapshotCount = 0
    facts.lastEventType = null
    facts.runHistory = []
    facts.runHistoryEnabled = false
    facts.tick = 0
    facts.factBreakpoints = []
    facts.factBreakpointHits = []
    facts.eventBreakpoints = []
    facts.eventBreakpointHits = []
    facts.breakpointPaused = false
    facts.pausedOnHit = null
  },

  derive: {
    hasTimeTravel: (facts) => facts.timeTravelEnabled && facts.snapshotCount > 0,
    canUndo: (facts) => facts.timeTravelEnabled && facts.snapshotIndex > 0,
    canRedo: (facts) => facts.timeTravelEnabled && facts.snapshotIndex < facts.snapshotCount - 1,
    factCount: (facts) => Object.keys(facts.facts).length,
    derivationCount: (facts) => Object.keys(facts.derivations).length,
    activeConstraintCount: (facts) => facts.constraints.filter((c) => c.active).length,
    inflightCount: (facts) => facts.inflight.length,
    unmetCount: (facts) => facts.unmet.length,
    latestRun: (facts) => {
      const h = facts.runHistory
      return h && h.length > 0 ? h[h.length - 1] : null
    },
    runCount: (facts) => facts.runHistory?.length ?? 0,
    factBreakpointHitCount: (facts) => facts.factBreakpointHits.length,
    eventBreakpointHitCount: (facts) => facts.eventBreakpointHits.length,
    totalBreakpointHitCount: (facts) => facts.factBreakpointHits.length + facts.eventBreakpointHits.length,
    activeFactBreakpointCount: (facts) => facts.factBreakpoints.filter((bp) => bp.enabled).length,
    activeEventBreakpointCount: (facts) => facts.eventBreakpoints.filter((bp) => bp.enabled).length,
  },

  events: {
    attach: (facts, { systemName }) => {
      facts.systemName = systemName
    },
    detach: (facts) => {
      // Clean up runtime subscription via WeakMap keyed on facts proxy
      _runtimeUnsubs.get(facts)?.()
      _runtimeUnsubs.delete(facts)

      // Clean up breakpoint watchers
      const bpMap = _breakpointUnsubs.get(facts)
      if (bpMap) {
        for (const entry of bpMap.values()) {
          entry.unsub()
        }
        bpMap.clear()
      }
      _breakpointUnsubs.delete(facts)

      facts.connected = false
      facts.systemName = null
      facts.facts = {}
      facts.derivations = {}
      facts.constraints = []
      facts.inflight = []
      facts.unmet = []
      facts.resolverStats = {}
      facts.resolverDefs = []
      facts.timeTravelEnabled = false
      facts.snapshotIndex = -1
      facts.snapshotCount = 0
      facts.lastEventType = null
      facts.runHistory = []
      facts.runHistoryEnabled = false
      facts.tick = 0
      facts.factBreakpoints = []
      facts.factBreakpointHits = []
      facts.eventBreakpoints = []
      facts.eventBreakpointHits = []
      facts.breakpointPaused = false
      facts.pausedOnHit = null
    },
    refresh: () => {
      // No-op event — triggers constraint re-evaluation
    },
    forceSync: (facts) => {
      facts.tick++
    },
    addFactBreakpoint: (facts, { breakpoint }) => {
      const idx = facts.factBreakpoints.findIndex((bp) => bp.id === breakpoint.id)
      if (idx >= 0) {
        facts.factBreakpoints = facts.factBreakpoints.map((bp) => bp.id === breakpoint.id ? breakpoint : bp)
      } else {
        facts.factBreakpoints = [...facts.factBreakpoints, breakpoint]
      }
    },
    removeFactBreakpoint: (facts, { id }) => {
      facts.factBreakpoints = facts.factBreakpoints.filter((bp) => bp.id !== id)
    },
    toggleFactBreakpoint: (facts, { id }) => {
      facts.factBreakpoints = facts.factBreakpoints.map((bp) =>
        bp.id === id ? { ...bp, enabled: !bp.enabled } : bp,
      )
    },
    clearFactBreakpointHits: (facts) => {
      facts.factBreakpointHits = []
    },
    addEventBreakpoint: (facts, { breakpoint }) => {
      const idx = facts.eventBreakpoints.findIndex((bp) => bp.id === breakpoint.id)
      if (idx >= 0) {
        facts.eventBreakpoints = facts.eventBreakpoints.map((bp) => bp.id === breakpoint.id ? breakpoint : bp)
      } else {
        facts.eventBreakpoints = [...facts.eventBreakpoints, breakpoint]
      }
    },
    removeEventBreakpoint: (facts, { id }) => {
      facts.eventBreakpoints = facts.eventBreakpoints.filter((bp) => bp.id !== id)
    },
    toggleEventBreakpoint: (facts, { id }) => {
      facts.eventBreakpoints = facts.eventBreakpoints.map((bp) =>
        bp.id === id ? { ...bp, enabled: !bp.enabled } : bp,
      )
    },
    clearEventBreakpointHits: (facts) => {
      facts.eventBreakpointHits = []
    },
    resumeFromBreakpoint: (facts) => {
      if (!facts.breakpointPaused) {
        return
      }

      facts.breakpointPaused = false
      facts.pausedOnHit = null

      // Resume time-travel recording if paused
      if (typeof window !== 'undefined' && window.__DIRECTIVE__) {
        const sys = window.__DIRECTIVE__.getSystem(facts.systemName ?? undefined)
        if (sys?.debug && typeof (sys.debug as any).resume === 'function') {
          ;(sys.debug as any).resume()
        }
      }
    },
  },

  // Constraint: when attached but not connected, try to connect
  constraints: {
    needsConnection: {
      when: (facts) => !facts.connected && facts.systemName !== null,
      require: { type: 'CONNECT_RUNTIME' },
    },
  },

  // Resolver: connect to window.__DIRECTIVE__ and set up subscription
  resolvers: {
    connectRuntime: {
      requirement: 'CONNECT_RUNTIME',
      key: () => 'connect-runtime',
      resolve: async (req, context) => {
        const maxAttempts = 20
        const baseDelay = 100

        for (let i = 0; i < maxAttempts; i++) {
          if (typeof window !== 'undefined' && window.__DIRECTIVE__) {
            const directive = window.__DIRECTIVE__
            const systemName = context.facts.systemName ?? undefined

            // Verify the system exists
            const system = directive.getSystem(systemName)
            if (!system) {
              await new Promise((r) => setTimeout(r, Math.min(baseDelay * (i + 1), 2000)))
              continue
            }

            // Do initial inspection (augmented with facts + derivations from the system)
            try {
              const inspection = directive.inspect(systemName)
              if (inspection) {
                applyInspection(context.facts, inspection, system)
              }
            } catch (err) {
              if (process.env.NODE_ENV === 'development') {
                console.warn('[DevTools] inspect() failed during initial connection:', err)
              }
            }

            context.facts.connected = true

            // Subscribe to events
            const unsub = directive.subscribe((event) => {
              context.facts.lastEventType = event.type
              context.facts.tick++

              // Check event breakpoints
              checkEventBreakpoints(context.facts, event)

              // Debounced re-inspection happens via effect
            }, systemName)

            // Store unsubscribe keyed by facts proxy for cleanup on detach
            _runtimeUnsubs.get(context.facts)?.()
            _runtimeUnsubs.set(context.facts, unsub)

            return
          }

          await new Promise((r) => setTimeout(r, Math.min(baseDelay * (i + 1), 2000)))
        }
      },
    },
  },

  // Effect: re-inspect on tick changes (debounced by Directive's batching)
  effects: {
    syncInspection: {
      run: (facts, prev) => {
        if (!facts.connected || facts.tick === prev?.tick) {
          return
        }

        if (typeof window === 'undefined' || !window.__DIRECTIVE__) {
          return
        }

        const systemName = facts.systemName ?? undefined
        try {
          const inspection = window.__DIRECTIVE__.inspect(systemName)
          const system = window.__DIRECTIVE__.getSystem(systemName)
          if (inspection) {
            applyInspection(facts, inspection, system)
          }
        } catch (err) {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[DevTools] inspect() failed during sync:', err)
          }
        }
      },
    },

    // Sync fact breakpoint watchers — subscribe/unsubscribe based on breakpoint list
    syncFactBreakpoints: {
      deps: ['factBreakpoints', 'connected', 'systemName'],
      run: (facts) => {
        if (typeof window === 'undefined' || !window.__DIRECTIVE__) {
          return
        }

        if (!facts.connected) {
          return
        }

        const sys = window.__DIRECTIVE__.getSystem(facts.systemName ?? undefined)
        if (!sys || typeof (sys as any).watch !== 'function') {
          return
        }

        // Get or create the unsub map for this facts proxy
        if (!_breakpointUnsubs.has(facts)) {
          _breakpointUnsubs.set(facts, new Map())
        }
        const unsubMap = _breakpointUnsubs.get(facts)!

        // Build map of active breakpoint ID → condition
        const activeMap = new Map<string, string>()
        for (const bp of facts.factBreakpoints) {
          if (bp.enabled) {
            activeMap.set(bp.id, bp.condition)
          }
        }

        // Unsubscribe removed/disabled breakpoints AND those with changed conditions
        for (const [id, entry] of unsubMap) {
          const newCondition = activeMap.get(id)
          if (newCondition === undefined || newCondition !== entry.condition) {
            entry.unsub()
            unsubMap.delete(id)
          }
        }

        // Subscribe new/enabled breakpoints (including re-subscriptions for changed conditions)
        for (const bp of facts.factBreakpoints) {
          if (!bp.enabled || unsubMap.has(bp.id)) {
            continue
          }

          const bpId = bp.id
          const bpFactKey = bp.factKey
          const bpCondition = bp.condition

          try {
            const unsub = (sys as any).watch(bpFactKey, (newValue: unknown, oldValue: unknown) => {
              let conditionMet = true
              if (bpCondition) {
                try {
                  conditionMet = evaluateBreakpointCondition(bpCondition, { newValue, oldValue })
                } catch {
                  conditionMet = false
                }
              }

              const hit: FactBreakpointHit = {
                id: `fbh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                breakpointId: bpId,
                factKey: bpFactKey,
                oldValue,
                newValue,
                timestamp: Date.now(),
                conditionMet,
              }

              // Append hit (capped at MAX_BREAKPOINT_HITS)
              const hits = [...facts.factBreakpointHits, hit]
              facts.factBreakpointHits = hits.length > MAX_BREAKPOINT_HITS
                ? hits.slice(hits.length - MAX_BREAKPOINT_HITS)
                : hits

              // Pause if condition met
              if (conditionMet && !facts.breakpointPaused) {
                facts.breakpointPaused = true
                facts.pausedOnHit = 'fact'
                if (sys?.debug && typeof (sys.debug as any).pause === 'function') {
                  ;(sys.debug as any).pause()
                }
              }
            })

            unsubMap.set(bpId, { unsub, condition: bpCondition })
          } catch {
            // watch() may not be available
          }
        }
      },
    },
  },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkEventBreakpoints(facts: Record<string, any>, event: { type: string; [key: string]: unknown }) {
  const breakpoints = facts.eventBreakpoints as EventBreakpointDef[]
  if (!breakpoints || breakpoints.length === 0) {
    return
  }

  for (const bp of breakpoints) {
    if (!bp.enabled) {
      continue
    }

    // Match event type — "*" is wildcard for all events
    if (bp.eventType !== '*' && bp.eventType !== event.type) {
      continue
    }

    let conditionMet = true
    if (bp.condition) {
      try {
        conditionMet = evaluateBreakpointCondition(bp.condition, { data: event, type: event.type })
      } catch {
        conditionMet = false
      }
    }

    const hit: EventBreakpointHit = {
      id: `ebh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      breakpointId: bp.id,
      eventType: event.type,
      eventData: event,
      timestamp: Date.now(),
      conditionMet,
    }

    // Append hit (capped)
    const hits = [...(facts.eventBreakpointHits as EventBreakpointHit[]), hit]
    facts.eventBreakpointHits = hits.length > MAX_BREAKPOINT_HITS
      ? hits.slice(hits.length - MAX_BREAKPOINT_HITS)
      : hits

    // Pause if condition met
    if (conditionMet && !facts.breakpointPaused) {
      facts.breakpointPaused = true
      facts.pausedOnHit = 'event'
      if (typeof window !== 'undefined' && window.__DIRECTIVE__) {
        const sys = window.__DIRECTIVE__.getSystem(facts.systemName ?? undefined)
        if (sys?.debug && typeof (sys.debug as any).pause === 'function') {
          ;(sys.debug as any).pause()
        }
      }
    }
  }
}

/**
 * Safe expression evaluator for breakpoint conditions.
 * Only allows simple comparisons and property access — no function calls,
 * assignments, or arbitrary code execution.
 */
const SAFE_CONDITION_RE = /^[\w\s.!<>=&|?:'"()\-+*/\[\],%]+$/
function evaluateBreakpointCondition(
  condition: string,
  vars: Record<string, unknown>,
): boolean {
  // Block anything that could execute arbitrary code
  if (
    !SAFE_CONDITION_RE.test(condition) ||
    /\b(function|=>|import|require|eval|new |class |delete |void |typeof |with |yield )\b/.test(condition)
  ) {
    return false
  }
  // Cap length to prevent abuse
  if (condition.length > 200) {
    return false
  }
  try {
    const keys = Object.keys(vars)
    const values = keys.map((k) => vars[k])
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `"use strict"; return (${condition})`)
    return !!fn(...values)
  } catch {
    return false
  }
}

function applyInspection(facts: Record<string, unknown>, inspection: InspectionResult, system?: DirectiveSystemRef) {
  // Facts — read directly from the system (inspect() doesn't include them)
  if (system?.facts && typeof system.facts === 'object') {
    try {
      const snapshot: Record<string, unknown> = {}
      for (const key of Object.keys(system.facts)) {
        snapshot[key] = system.facts[key]
      }
      facts.facts = snapshot
    } catch {
      // Proxy access may fail
    }
  } else if (inspection.facts && typeof inspection.facts === 'object') {
    facts.facts = { ...inspection.facts }
  }

  // Derivations — read directly from the system
  if (system?.derive && typeof system.derive === 'object') {
    try {
      const snapshot: Record<string, unknown> = {}
      for (const key of Object.keys(system.derive)) {
        snapshot[key] = system.derive[key]
      }
      facts.derivations = snapshot
    } catch {
      // Proxy access may fail
    }
  } else if (inspection.derivations && typeof inspection.derivations === 'object') {
    facts.derivations = { ...inspection.derivations }
  }

  // Constraints
  if (Array.isArray(inspection.constraints)) {
    facts.constraints = inspection.constraints.map((c: any) => ({
      id: c.id ?? '',
      active: c.active ?? false,
      disabled: c.disabled ?? false,
      priority: c.priority,
      hitCount: c.hitCount ?? 0,
      lastActiveAt: c.lastActiveAt ?? null,
    }))
  }

  // Requirements (inflight + unmet)
  if (Array.isArray(inspection.inflight)) {
    facts.inflight = inspection.inflight.map((r: any) => ({
      id: r.id ?? '',
      type: r.requirement?.type ?? r.type ?? '',
      fromConstraint: r.fromConstraint ?? '',
      status: 'inflight' as const,
    }))
  }
  if (Array.isArray(inspection.unmet)) {
    facts.unmet = inspection.unmet.map((r: any) => ({
      id: r.id ?? '',
      type: r.requirement?.type ?? r.type ?? '',
      fromConstraint: r.fromConstraint ?? '',
      status: 'unmet' as const,
    }))
  }

  // Resolver stats
  if (inspection.resolverStats && typeof inspection.resolverStats === 'object') {
    facts.resolverStats = { ...inspection.resolverStats }
  }

  // Resolver definitions
  if (Array.isArray(inspection.resolverDefs)) {
    facts.resolverDefs = inspection.resolverDefs.map((d: any) => ({
      id: d.id ?? '',
      requirement: d.requirement ?? '',
    }))
  }

  // Run history
  facts.runHistoryEnabled = inspection.runHistoryEnabled ?? false
  if (Array.isArray(inspection.runHistory)) {
    facts.runHistory = inspection.runHistory
  }

  // Time-travel — prefer inspect() data, fall back to system.debug
  if (inspection.timeTravel) {
    facts.timeTravelEnabled = true
    facts.snapshotIndex = inspection.timeTravel.currentIndex ?? -1
    facts.snapshotCount = inspection.timeTravel.snapshotCount ?? 0
  } else if (system?.debug?.isEnabled) {
    const debug = system.debug
    facts.timeTravelEnabled = true
    facts.snapshotIndex = typeof debug.currentIndex === 'number' ? debug.currentIndex : -1
    facts.snapshotCount = Array.isArray(debug.snapshots) ? debug.snapshots.length : 0
  }
}
