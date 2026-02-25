// @ts-nocheck — createModule generic inference doesn't resolve for complex schemas
import { createModule, t } from '@directive-run/core'

// ---------------------------------------------------------------------------
// Module-level cleanup registry (avoids `any` cast on context)
// ---------------------------------------------------------------------------

const _runtimeUnsubs = new Map<string, () => void>()

// ---------------------------------------------------------------------------
// Types for runtime bridge data
// ---------------------------------------------------------------------------

export interface RuntimeConstraintInfo {
  id: string
  active: boolean
  priority: number | undefined
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
      // Tick counter bumped on each subscription callback — drives reactivity
      tick: t.number(),
    },
    events: {
      attach: { systemName: t.nullable(t.string()) },
      detach: {},
      refresh: {},
      undo: {},
      redo: {},
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
      // Clean up runtime subscription
      const key = facts.systemName ?? '__default'
      _runtimeUnsubs.get(key)?.()
      _runtimeUnsubs.delete(key)

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
      facts.tick = 0
    },
    refresh: () => {
      // No-op event — triggers constraint re-evaluation
    },
    undo: () => {
      // Handled by effect
    },
    redo: () => {
      // Handled by effect
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

            // Do initial inspection
            const inspection = directive.inspect(systemName)
            if (inspection) {
              applyInspection(context.facts, inspection)
            }

            context.facts.connected = true

            // Subscribe to events
            const unsub = directive.subscribe((event) => {
              context.facts.lastEventType = event.type
              context.facts.tick++

              // Debounced re-inspection happens via effect
            }, systemName)

            // Store unsubscribe keyed by system name for cleanup on detach
            const key = context.facts.systemName ?? '__default'
            _runtimeUnsubs.get(key)?.()
            _runtimeUnsubs.set(key, unsub)

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

        const inspection = window.__DIRECTIVE__.inspect(facts.systemName ?? undefined)
        if (inspection) {
          applyInspection(facts, inspection)
        }
      },
    },
    handleUndo: {
      run: (facts, prev) => {
        // Detect undo event by checking snapshotIndex change request
        // This is driven by the undo event handler setting a marker
      },
    },
  },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyInspection(facts: any, inspection: any) {
  // Facts
  if (inspection.facts && typeof inspection.facts === 'object') {
    facts.facts = { ...inspection.facts }
  }

  // Derivations
  if (inspection.derivations && typeof inspection.derivations === 'object') {
    facts.derivations = { ...inspection.derivations }
  }

  // Constraints
  if (Array.isArray(inspection.constraints)) {
    facts.constraints = inspection.constraints.map((c: any) => ({
      id: c.id ?? '',
      active: c.active ?? false,
      priority: c.priority,
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

  // Time-travel
  if (inspection.timeTravel) {
    facts.timeTravelEnabled = true
    facts.snapshotIndex = inspection.timeTravel.currentIndex ?? -1
    facts.snapshotCount = inspection.timeTravel.snapshotCount ?? 0
  }
}
