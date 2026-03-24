/**
 * Devtools Plugin - Browser devtools integration
 *
 * Exposes the system to browser devtools via window.__DIRECTIVE__
 * and optionally renders a floating debug panel with:
 * - Facts & derivations tables (live updates with flash animation)
 * - Inflight/unmet requirements
 * - Performance metrics (reconcile time, resolver latency)
 * - Time-travel controls (undo/redo/snapshot index)
 * - Full dependency graph (facts→derivations→constraints→requirements→resolvers)
 * - Timeline/flamechart waterfall of resolver execution
 * - Event log (when trace: true)
 * - Record & replay sessions (export/import JSON)
 *
 * Split into submodules:
 * - devtools-types.ts — types, constants, pure helpers
 * - devtools-panel.ts — floating panel DOM creation and update helpers
 * - devtools-graph.ts — dependency graph and timeline SVG rendering
 */

import type {
  FactChange,
  ModuleSchema,
  Plugin,
  ReconcileResult,
  System,
} from "../core/types.js";

// Re-export public types
export type { DevtoolsPluginOptions, TraceEvent } from "./devtools-types.js";

import {
  CircularBuffer,
  type DevtoolsPluginOptions,
  type DevtoolsState,
  type DevtoolsSubscriber,
  MAX_RECORDED_EVENTS,
  MAX_RECORDED_SNAPSHOTS,
  MAX_RESOLVER_STATS,
  S,
  type TraceEvent,
  cloneViaJSON,
  createDepGraph,
  createPerfMetrics,
  createRecordingState,
  createTimelineState,
  isDevMode,
  safeInspect,
  validateMaxEvents,
} from "./devtools-types.js";

import {
  addEventRow,
  createPanel,
  removeTableRow,
  renderRequirements,
  renderStatus,
  setupHistoryButtons,
  updateDerivations,
  updateHistoryControls,
  updatePerfSection,
  upsertTableRow,
} from "./devtools-panel.js";

import {
  scheduleAnimationClear,
  updateDependencyGraph,
  updateTimeline,
} from "./devtools-graph.js";

// ============================================================================
// Global Devtools Object
// ============================================================================

function initDevtools(): NonNullable<Window["__DIRECTIVE__"]> {
  if (typeof window === "undefined") {
    return {
      systems: new Map(),
      getSystem: () => null,
      getSystems: () => [],
      inspect: () => null,
      getEvents: () => [],
      explain: () => null,
      exportSession: () => null,
      importSession: () => false,
      clearEvents: () => {},
      subscribe: () => () => {},
    };
  }

  if (!window.__DIRECTIVE__) {
    const systems = new Map<string, DevtoolsState>();

    const api: NonNullable<Window["__DIRECTIVE__"]> = {
      systems,
      getSystem(name) {
        if (name) {
          return systems.get(name)?.system ?? null;
        }
        const first = systems.values().next().value;

        return first?.system ?? null;
      },
      getSystems() {
        return [...systems.keys()];
      },
      inspect(name) {
        const system = this.getSystem(name);
        const s = name ? systems.get(name) : systems.values().next().value;
        const inspection = system?.inspect() ?? null;
        if (inspection && s) {
          (inspection as unknown as Record<string, unknown>).resolverStats =
            s.resolverStats ? Object.fromEntries(s.resolverStats) : {};
        }

        return inspection;
      },
      getEvents(name) {
        if (name) {
          return systems.get(name)?.events.toArray() ?? [];
        }
        const first = systems.values().next().value;

        return first?.events.toArray() ?? [];
      },
      explain(requirementId, name) {
        const system = this.getSystem(name);

        return system?.explain(requirementId) ?? null;
      },
      subscribe(callback: DevtoolsSubscriber, systemName?: string) {
        const target = systemName
          ? systems.get(systemName)
          : systems.values().next().value;
        if (!target) {
          // System not registered yet — register a global subscriber
          // that attaches to the first system that appears
          let attached = false;
          const check = () => {
            const t = systemName
              ? systems.get(systemName)
              : systems.values().next().value;
            if (t && !attached) {
              attached = true;
              t.subscribers.add(callback);
            }
          };
          // Poll briefly for system registration
          const timer = setInterval(check, 100);
          const stop = setTimeout(() => clearInterval(timer), 10_000);

          return () => {
            clearInterval(timer);
            clearTimeout(stop);
            // Remove from any system that may have been attached
            for (const s of systems.values()) {
              s.subscribers.delete(callback);
            }
          };
        }
        target.subscribers.add(callback);

        return () => {
          target.subscribers.delete(callback);
        };
      },
      exportSession(name) {
        const target = name ? systems.get(name) : systems.values().next().value;
        if (!target) {
          return null;
        }

        return JSON.stringify({
          version: 1,
          name:
            name ??
            (systems.keys().next().value as string | undefined) ??
            "default",
          exportedAt: Date.now(),
          events: target.events.toArray(),
        });
      },
      importSession(json, name) {
        try {
          // Size cap — reject payloads over 10MB
          if (json.length > 10 * 1024 * 1024) {
            return false;
          }
          const data = JSON.parse(json);
          if (!data || typeof data !== "object" || Array.isArray(data)) {
            return false;
          }
          if (!Array.isArray(data.events)) {
            return false;
          }
          // Cap imported events at target's maxEvents
          const target = name
            ? systems.get(name)
            : systems.values().next().value;
          if (!target) {
            return false;
          }
          const maxImport = target.maxEvents;
          const events = data.events as unknown[];
          // Only import the last maxImport events
          const start =
            events.length > maxImport ? events.length - maxImport : 0;
          target.events.clear();
          for (let i = start; i < events.length; i++) {
            const evt = events[i];
            if (
              evt &&
              typeof evt === "object" &&
              !Array.isArray(evt) &&
              typeof (evt as Record<string, unknown>).timestamp === "number" &&
              typeof (evt as Record<string, unknown>).type === "string" &&
              (evt as Record<string, unknown>).type !== "__proto__" &&
              (evt as Record<string, unknown>).type !== "constructor" &&
              (evt as Record<string, unknown>).type !== "prototype"
            ) {
              // Sanitize — only copy known fields
              target.events.push({
                timestamp: (evt as Record<string, unknown>).timestamp as number,
                type: (evt as Record<string, unknown>).type as string,
                data: (evt as Record<string, unknown>).data ?? null,
              });
            }
          }

          return true;
        } catch {
          return false;
        }
      },
      clearEvents(name) {
        const target = name ? systems.get(name) : systems.values().next().value;
        if (!target) {
          return;
        }
        target.events.clear();
      },
    };

    // Non-writable global — prevent casual script overwriting
    // configurable in dev mode for test cleanup and plugin re-initialization
    Object.defineProperty(window, "__DIRECTIVE__", {
      value: api,
      writable: false,
      configurable: isDevMode(),
      enumerable: true,
    });

    return api;
  }

  return window.__DIRECTIVE__!;
}

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Create a devtools plugin.
 *
 * @example
 * ```ts
 * const system = createSystem({
 *   module: myModule,
 *   plugins: [devtoolsPlugin({ name: "my-app", panel: true, trace: true })],
 * });
 *
 * // In browser console:
 * // __DIRECTIVE__.inspect()
 * // __DIRECTIVE__.getEvents()
 * // __DIRECTIVE__.exportSession()
 * ```
 */
export function devtoolsPlugin<M extends ModuleSchema = ModuleSchema>(
  options: DevtoolsPluginOptions = {},
): Plugin<M> {
  const {
    name = "default",
    trace = false,
    maxEvents: maxEventsRaw,
    panel: panelEnabled = false,
    position = "bottom-right",
    defaultOpen = false,
  } = options;

  const maxEventsOpt = validateMaxEvents(maxEventsRaw);
  const devtools = initDevtools();
  const state: DevtoolsState = {
    system: null,
    events: new CircularBuffer<TraceEvent>(maxEventsOpt),
    maxEvents: maxEventsOpt,
    subscribers: new Set(),
    resolverStats: new Map(),
  };

  devtools.systems.set(name, state);

  const addEvent = (type: string, data: unknown) => {
    const event: TraceEvent = { timestamp: Date.now(), type, data };
    if (trace) {
      state.events.push(event);
    }
    // Always notify subscribers (even when trace is off — subscribers want all events)
    for (const sub of state.subscribers) {
      try {
        sub(event);
      } catch {
        // subscriber errors must not crash the plugin
      }
    }
  };

  // Panel state — initialized lazily in onInit
  let panel: ReturnType<typeof createPanel> | null = null;
  const factsRowMap = new Map<string, HTMLTableRowElement>();
  const derivRowMap = new Map<string, HTMLTableRowElement>();
  const perf = createPerfMetrics();
  const depGraph = createDepGraph();
  const recording = createRecordingState();
  const timeline = createTimelineState();

  const shouldCreatePanel =
    panelEnabled &&
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    isDevMode();

  // requestAnimationFrame coalescing for all DOM updates
  let rafId: number | null = null;
  let dirty = 0;
  const D_FACTS = 1;
  const D_DERIV = 2;
  const D_REQS = 4;
  const D_STATUS = 8;
  const D_PERF = 16;
  const D_FLOW = 32;
  const D_TT = 64;
  const D_TIMELINE = 128;

  // Pending fact changes for batched rAF rendering
  const pendingFactUpdates = new Map<
    string,
    { value: unknown; flash: boolean }
  >();
  const pendingFactDeletes = new Set<string>();

  // Cache last reconcile result for deferred rendering
  let lastResult: ReconcileResult | null = null;

  function schedulePanelUpdate(bits: number) {
    dirty |= bits;
    if (rafId === null && typeof requestAnimationFrame !== "undefined") {
      rafId = requestAnimationFrame(flushPanelUpdates);
    }
  }

  function flushPanelUpdates() {
    rafId = null;
    if (!panel || !state.system) {
      dirty = 0;

      return;
    }
    const refs = panel.refs;
    const sys = state.system;
    const flags = dirty;
    dirty = 0;

    // Flush batched fact updates
    if (flags & D_FACTS) {
      for (const key of pendingFactDeletes) {
        removeTableRow(factsRowMap, key);
      }
      pendingFactDeletes.clear();
      for (const [key, { value, flash }] of pendingFactUpdates) {
        upsertTableRow(
          factsRowMap,
          refs.factsBody,
          key,
          value,
          flash,
          panel.flashTimers,
        );
      }
      pendingFactUpdates.clear();
      refs.factsCount.textContent = String(factsRowMap.size);
    }
    if (flags & D_DERIV) {
      updateDerivations(refs, derivRowMap, sys, panel.flashTimers);
    }
    if (flags & D_STATUS) {
      if (lastResult) {
        renderStatus(refs, lastResult.inflight.length, lastResult.unmet.length);
      } else {
        const inspection = safeInspect(sys);
        if (inspection) {
          renderStatus(
            refs,
            inspection.inflight.length,
            inspection.unmet.length,
          );
        }
      }
    }
    if (flags & D_REQS) {
      if (lastResult) {
        renderRequirements(
          refs,
          lastResult.inflight,
          lastResult.unmet as Array<{
            id: string;
            requirement: { type: string };
            fromConstraint: string;
          }>,
        );
      } else {
        const inspection = safeInspect(sys);
        if (inspection) {
          renderRequirements(
            refs,
            inspection.inflight,
            inspection.unmet as Array<{
              id: string;
              requirement: { type: string };
              fromConstraint: string;
            }>,
          );
        }
      }
    }
    if (flags & D_PERF) {
      updatePerfSection(refs, perf);
    }
    if (flags & D_FLOW) {
      updateDependencyGraph(refs, sys, depGraph);
    }
    if (flags & D_TT) {
      updateHistoryControls(refs, sys);
    }
    if (flags & D_TIMELINE) {
      updateTimeline(refs, timeline);
    }
  }

  // Helper: emit panel event only if trace is on and panel exists
  function panelEvent(type: string, data: unknown) {
    if (panel && trace) {
      addEventRow(panel.refs, type, data, state.events.size);
    }
  }

  // Record event if recording (C3: capped)
  function recordEvent(type: string, data: unknown) {
    if (
      recording.isRecording &&
      recording.recordedEvents.length < MAX_RECORDED_EVENTS
    ) {
      recording.recordedEvents.push({
        timestamp: Date.now(),
        type,
        data: cloneViaJSON(data),
      });
    }
  }

  return {
    name: "devtools",

    onInit: (system) => {
      state.system = system as unknown as System<ModuleSchema>;
      addEvent("init", {});

      if (typeof window !== "undefined") {
        console.log(
          `%c[Directive Devtools]%c System "${name}" initialized. Access via window.__DIRECTIVE__`,
          "color: #7c3aed; font-weight: bold",
          "color: inherit",
        );
      }

      if (shouldCreatePanel) {
        const sys = state.system;
        panel = createPanel(name, position, defaultOpen, trace);
        const refs = panel.refs;

        // Initial render of facts
        try {
          const facts = sys.facts.$store.toObject();
          for (const [key, value] of Object.entries(facts)) {
            upsertTableRow(factsRowMap, refs.factsBody, key, value, false);
          }
          refs.factsCount.textContent = String(Object.keys(facts).length);
        } catch {
          // System not ready yet
        }

        // Initial render of other sections
        updateDerivations(refs, derivRowMap, sys);
        const inspection = safeInspect(sys);
        if (inspection) {
          renderStatus(
            refs,
            inspection.inflight.length,
            inspection.unmet.length,
          );
          renderRequirements(
            refs,
            inspection.inflight,
            inspection.unmet as Array<{
              id: string;
              requirement: { type: string };
              fromConstraint: string;
            }>,
          );
        }
        updateHistoryControls(refs, sys);
        setupHistoryButtons(refs, sys);
        updateDependencyGraph(refs, sys, depGraph);

        // Wire record & export buttons
        refs.recordBtn.addEventListener("click", () => {
          recording.isRecording = !recording.isRecording;
          refs.recordBtn.textContent = recording.isRecording
            ? "\u23F9 Stop"
            : "\u23FA Record";
          refs.recordBtn.style.color = recording.isRecording ? S.red : S.text;
          if (recording.isRecording) {
            recording.recordedEvents = [];
            recording.snapshots = [];
            // Capture initial snapshot
            try {
              recording.snapshots.push({
                timestamp: Date.now(),
                facts: sys.facts.$store.toObject(),
              });
            } catch {
              // ignore
            }
          }
        });

        refs.exportBtn.addEventListener("click", () => {
          const events =
            recording.recordedEvents.length > 0
              ? recording.recordedEvents
              : state.events.toArray();

          const payload = JSON.stringify(
            {
              version: 1,
              name,
              exportedAt: Date.now(),
              events,
              snapshots: recording.snapshots,
            },
            null,
            2,
          );

          // Download as file
          const blob = new Blob([payload], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `directive-session-${name}-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
        });
      }
    },

    onStart: (_system) => {
      addEvent("start", {});
      panelEvent("start", {});
      recordEvent("start", {});
    },

    onStop: (_system) => {
      addEvent("stop", {});
      panelEvent("stop", {});
      recordEvent("stop", {});
    },

    onDestroy: (_system) => {
      addEvent("destroy", {});
      devtools.systems.delete(name);
      if (rafId !== null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (depGraph.animationTimer) {
        clearTimeout(depGraph.animationTimer);
      }
      if (panel) {
        panel.destroy();
        panel = null;
        factsRowMap.clear();
        derivRowMap.clear();
      }
    },

    onFactSet: (key, value, prev) => {
      addEvent("fact.set", { key, value, prev });
      recordEvent("fact.set", { key, value, prev });
      depGraph.recentlyChangedFacts.add(key as string);
      if (panel && state.system) {
        // Defer DOM update to rAF
        pendingFactUpdates.set(key as string, { value, flash: true });
        pendingFactDeletes.delete(key as string);
        schedulePanelUpdate(D_FACTS);
        panelEvent("fact.set", { key, value });
      }
    },

    onFactDelete: (key, prev) => {
      addEvent("fact.delete", { key, prev });
      recordEvent("fact.delete", { key, prev });
      if (panel) {
        // Defer DOM update to rAF
        pendingFactDeletes.add(key as string);
        pendingFactUpdates.delete(key as string);
        schedulePanelUpdate(D_FACTS);
        panelEvent("fact.delete", { key });
      }
    },

    onFactsBatch: (changes: FactChange[]) => {
      addEvent("facts.batch", { changes });
      recordEvent("facts.batch", { count: changes.length });
      if (panel && state.system) {
        // Defer all DOM updates to rAF
        for (const change of changes) {
          if (change.type === "delete") {
            pendingFactDeletes.add(change.key);
            pendingFactUpdates.delete(change.key);
          } else {
            depGraph.recentlyChangedFacts.add(change.key);
            pendingFactUpdates.set(change.key, {
              value: change.value,
              flash: true,
            });
            pendingFactDeletes.delete(change.key);
          }
        }
        schedulePanelUpdate(D_FACTS);
        panelEvent("facts.batch", { count: changes.length });
      }
    },

    onDerivationCompute: (id, value, deps) => {
      addEvent("derivation.compute", { id, value, deps });
      recordEvent("derivation.compute", { id, deps });
      depGraph.derivationDeps.set(id, deps);
      depGraph.recentlyComputedDerivations.add(id);
      panelEvent("derivation.compute", { id, deps });
    },

    onDerivationInvalidate: (id) => {
      addEvent("derivation.invalidate", { id });
      panelEvent("derivation.invalidate", { id });
    },

    onReconcileStart: (_snapshot) => {
      addEvent("reconcile.start", {});
      perf.lastReconcileStartMs = performance.now();
      panelEvent("reconcile.start", {});
      recordEvent("reconcile.start", {});
    },

    onReconcileEnd: (result: ReconcileResult) => {
      addEvent("reconcile.end", result);
      recordEvent("reconcile.end", {
        unmet: result.unmet.length,
        inflight: result.inflight.length,
        completed: result.completed.length,
      });

      // Track reconcile performance
      if (perf.lastReconcileStartMs > 0) {
        const duration = performance.now() - perf.lastReconcileStartMs;
        perf.reconcileCount++;
        perf.reconcileTotalMs += duration;
        perf.lastReconcileStartMs = 0;
      }

      // Capture snapshot during recording (C3: capped)
      if (
        recording.isRecording &&
        state.system &&
        recording.snapshots.length < MAX_RECORDED_SNAPSHOTS
      ) {
        try {
          recording.snapshots.push({
            timestamp: Date.now(),
            facts: state.system.facts.$store.toObject(),
          });
        } catch {
          // ignore
        }
      }

      if (panel && state.system) {
        lastResult = result;
        scheduleAnimationClear(depGraph);
        schedulePanelUpdate(
          D_DERIV | D_STATUS | D_REQS | D_PERF | D_FLOW | D_TT,
        );
        panelEvent("reconcile.end", {
          unmet: result.unmet.length,
          inflight: result.inflight.length,
        });
      }
    },

    onConstraintEvaluate: (id, active) => {
      addEvent("constraint.evaluate", { id, active });
      recordEvent("constraint.evaluate", { id, active });
      if (active) {
        depGraph.activeConstraints.add(id);
        depGraph.recentlyActiveConstraints.add(id);
      } else {
        depGraph.activeConstraints.delete(id);
      }
      panelEvent("constraint.evaluate", { id, active });
    },

    onConstraintError: (id, error) => {
      addEvent("constraint.error", { id, error: String(error) });
      panelEvent("constraint.error", { id, error: String(error) });
    },

    onRequirementCreated: (req) => {
      addEvent("requirement.created", {
        id: req.id,
        type: req.requirement.type,
      });
      recordEvent("requirement.created", {
        id: req.id,
        type: req.requirement.type,
      });
      panelEvent("requirement.created", {
        id: req.id,
        type: req.requirement.type,
      });
    },

    onRequirementMet: (req, byResolver) => {
      addEvent("requirement.met", { id: req.id, byResolver });
      recordEvent("requirement.met", { id: req.id, byResolver });
      panelEvent("requirement.met", { id: req.id, byResolver });
    },

    onRequirementCanceled: (req) => {
      addEvent("requirement.canceled", { id: req.id });
      recordEvent("requirement.canceled", { id: req.id });
      panelEvent("requirement.canceled", { id: req.id });
    },

    onResolverStart: (resolver, req) => {
      addEvent("resolver.start", { resolver, requirementId: req.id });
      recordEvent("resolver.start", { resolver, requirementId: req.id });
      // Track timeline
      timeline.inflight.set(resolver, performance.now());
      if (panel && state.system) {
        schedulePanelUpdate(D_REQS | D_STATUS | D_TIMELINE);
        panelEvent("resolver.start", { resolver, requirementId: req.id });
      }
    },

    onResolverComplete: (resolver, req, duration) => {
      addEvent("resolver.complete", {
        resolver,
        requirementId: req.id,
        duration,
      });
      recordEvent("resolver.complete", {
        resolver,
        requirementId: req.id,
        duration,
      });

      const stats = state.resolverStats.get(resolver) ?? {
        count: 0,
        totalMs: 0,
        errors: 0,
      };
      stats.count++;
      stats.totalMs += duration;
      state.resolverStats.set(resolver, stats);
      if (state.resolverStats.size > MAX_RESOLVER_STATS) {
        const oldest = state.resolverStats.keys().next().value;
        if (oldest !== undefined) state.resolverStats.delete(oldest);
      }
      // Mirror to perf for floating panel
      perf.resolverStats.set(resolver, { ...stats });

      // Complete timeline entry
      const startMs = timeline.inflight.get(resolver);
      timeline.inflight.delete(resolver);
      if (startMs !== undefined) {
        timeline.entries.push({
          resolver,
          startMs,
          endMs: performance.now(),
          error: false,
        });
      }

      if (panel && state.system) {
        schedulePanelUpdate(D_REQS | D_STATUS | D_PERF | D_TIMELINE);
        panelEvent("resolver.complete", { resolver, duration });
      }
    },

    onResolverError: (resolver, req, error) => {
      addEvent("resolver.error", {
        resolver,
        requirementId: req.id,
        error: String(error),
      });
      recordEvent("resolver.error", {
        resolver,
        requirementId: req.id,
        error: String(error),
      });

      const stats = state.resolverStats.get(resolver) ?? {
        count: 0,
        totalMs: 0,
        errors: 0,
      };
      stats.errors++;
      state.resolverStats.set(resolver, stats);
      if (state.resolverStats.size > MAX_RESOLVER_STATS) {
        const oldest = state.resolverStats.keys().next().value;
        if (oldest !== undefined) state.resolverStats.delete(oldest);
      }
      // Mirror to perf for floating panel
      perf.resolverStats.set(resolver, { ...stats });

      // Complete timeline entry as error
      const startMs = timeline.inflight.get(resolver);
      timeline.inflight.delete(resolver);
      if (startMs !== undefined) {
        timeline.entries.push({
          resolver,
          startMs,
          endMs: performance.now(),
          error: true,
        });
      }

      if (panel && state.system) {
        schedulePanelUpdate(D_REQS | D_STATUS | D_PERF | D_TIMELINE);
        panelEvent("resolver.error", { resolver, error: String(error) });
      }
    },

    onResolverRetry: (resolver, req, attempt) => {
      addEvent("resolver.retry", { resolver, requirementId: req.id, attempt });
      recordEvent("resolver.retry", {
        resolver,
        requirementId: req.id,
        attempt,
      });
      panelEvent("resolver.retry", { resolver, attempt });
    },

    onResolverCancel: (resolver, req) => {
      addEvent("resolver.cancel", { resolver, requirementId: req.id });
      recordEvent("resolver.cancel", { resolver, requirementId: req.id });
      // Remove from inflight
      timeline.inflight.delete(resolver);
      panelEvent("resolver.cancel", { resolver });
    },

    onEffectRun: (id) => {
      addEvent("effect.run", { id });
      recordEvent("effect.run", { id });
      perf.effectRunCount++;
      panelEvent("effect.run", { id });
    },

    onEffectError: (id, error) => {
      addEvent("effect.error", { id, error: String(error) });
      perf.effectErrorCount++;
      panelEvent("effect.error", { id, error: String(error) });
    },

    onSnapshot: (snapshot) => {
      addEvent("timetravel.snapshot", {
        id: snapshot.id,
        trigger: snapshot.trigger,
      });
      if (panel && state.system) {
        schedulePanelUpdate(D_TT);
      }
      panelEvent("timetravel.snapshot", {
        id: snapshot.id,
        trigger: snapshot.trigger,
      });
    },

    onHistoryNavigate: (from, to) => {
      addEvent("timetravel.jump", { from, to });
      recordEvent("timetravel.jump", { from, to });
      if (panel && state.system) {
        const sys = state.system;
        // After time-travel, full refresh
        try {
          const facts = sys.facts.$store.toObject();
          factsRowMap.clear();
          panel.refs.factsBody.replaceChildren();
          for (const [key, value] of Object.entries(facts)) {
            upsertTableRow(
              factsRowMap,
              panel.refs.factsBody,
              key,
              value,
              false,
            );
          }
          panel.refs.factsCount.textContent = String(Object.keys(facts).length);
        } catch {
          // ignore
        }
        derivRowMap.clear();
        depGraph.derivationDeps.clear();
        panel.refs.derivBody.replaceChildren();
        lastResult = null;
        schedulePanelUpdate(D_DERIV | D_STATUS | D_REQS | D_FLOW | D_TT);
        panelEvent("timetravel.jump", { from, to });
      }
    },

    onError: (error) => {
      addEvent("error", {
        source: error.source,
        sourceId: error.sourceId,
        message: error.message,
      });
      recordEvent("error", { source: error.source, message: error.message });
      panelEvent("error", { source: error.source, message: error.message });
    },

    onErrorRecovery: (error, strategy) => {
      addEvent("error.recovery", {
        source: error.source,
        sourceId: error.sourceId,
        strategy,
      });
      panelEvent("error.recovery", { source: error.source, strategy });
    },

    onTraceComplete: (entry) => {
      addEvent("trace.complete", {
        id: entry.id,
        status: entry.status,
        facts: entry.factChanges.length,
        constraints: entry.constraintsHit.length,
        requirements: entry.requirementsAdded.length,
        resolvers: entry.resolversStarted.length,
        effects: entry.effectsRun.length,
      });
      panelEvent("trace.complete", { id: entry.id });
    },

    onDefinitionRegister: (type, id) => {
      addEvent("definition.register", { type, id });
      recordEvent("definition.register", { type, id });
      panelEvent("definition.register", { type, id });
    },

    onDefinitionAssign: (type, id) => {
      addEvent("definition.assign", { type, id });
      recordEvent("definition.assign", { type, id });
      panelEvent("definition.assign", { type, id });
    },

    onDefinitionUnregister: (type, id) => {
      addEvent("definition.unregister", { type, id });
      recordEvent("definition.unregister", { type, id });
      panelEvent("definition.unregister", { type, id });
    },

    onDefinitionCall: (type, id, props) => {
      addEvent("definition.call", { type, id, props });
      recordEvent("definition.call", { type, id, props });
      panelEvent("definition.call", { type, id, props });
    },
  };
}
