// @ts-nocheck -- TODO: fix createModule generic inference in @directive-run/core for complex schemas
import { createModule, t } from '@directive-run/core'
import type { RunChangelogEntry } from '@directive-run/core'

// ---------------------------------------------------------------------------
// Types for runtime bridge data
// ---------------------------------------------------------------------------

export interface RuntimeConstraintInfo {
  id: string
  active: boolean
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

/** Shape returned by window.__DIRECTIVE__.inspect() */
interface InspectionResult {
  facts?: Record<string, unknown>
  derivations?: Record<string, unknown>
  constraints?: Array<{ id?: string; active?: boolean; priority?: number; hitCount?: number; lastActiveAt?: number | null }>
  inflight?: Array<{ id?: string; requirement?: { type?: string }; type?: string; fromConstraint?: string }>
  unmet?: Array<{ id?: string; requirement?: { type?: string }; type?: string; fromConstraint?: string }>
  resolverStats?: Record<string, RuntimeResolverStats>
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
      timeTravelEnabled: t.boolean(),
      snapshotIndex: t.number(),
      snapshotCount: t.number(),
      lastEventType: t.nullable(t.string()),
      // Per-run changelog from the connected system
      runHistory: t.array<RunChangelogEntry>(),
      // Tick counter bumped on each subscription callback — drives reactivity
      tick: t.number(),
    },
    events: {
      attach: { systemName: t.nullable(t.string()) },
      detach: {},
      refresh: {},
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
    facts.timeTravelEnabled = false
    facts.snapshotIndex = -1
    facts.snapshotCount = 0
    facts.lastEventType = null
    facts.runHistory = []
    facts.tick = 0
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
  },

  events: {
    attach: (facts, { systemName }) => {
      facts.systemName = systemName
    },
    detach: (facts) => {
      // Clean up runtime subscription via WeakMap keyed on facts proxy
      _runtimeUnsubs.get(facts)?.()
      _runtimeUnsubs.delete(facts)

      facts.connected = false
      facts.systemName = null
      facts.facts = {}
      facts.derivations = {}
      facts.constraints = []
      facts.inflight = []
      facts.unmet = []
      facts.resolverStats = {}
      facts.timeTravelEnabled = false
      facts.snapshotIndex = -1
      facts.snapshotCount = 0
      facts.lastEventType = null
      facts.runHistory = []
      facts.tick = 0
    },
    refresh: () => {
      // No-op event — triggers constraint re-evaluation
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
            const inspection = directive.inspect(systemName)
            if (inspection) {
              applyInspection(context.facts, inspection, system)
            }

            context.facts.connected = true

            // Subscribe to events
            const unsub = directive.subscribe((event) => {
              context.facts.lastEventType = event.type
              context.facts.tick++

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
        const inspection = window.__DIRECTIVE__.inspect(systemName)
        const system = window.__DIRECTIVE__.getSystem(systemName)
        if (inspection) {
          applyInspection(facts, inspection, system)
        }
      },
    },
  },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

  // Run history
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
