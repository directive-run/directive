/**
 * Debug Timeline — AI-specific event log with snapshot correlation.
 *
 * Records agent lifecycle events (start, complete, error, guardrail checks,
 * approvals, handoffs, patterns) and correlates them with core time-travel
 * snapshots for visual timeline UIs and fork-and-replay debugging.
 *
 * Zero-cost when debug=false — the timeline is simply `null`.
 *
 * @module
 */

import type { Plugin } from "@directive-run/core";
import type { DebugEvent, DebugEventType } from "./types.js";

/** A12: Known event types for import validation */
const KNOWN_EVENT_TYPES: Set<string> = new Set([
  "agent_start", "agent_complete", "agent_error", "agent_retry",
  "guardrail_check", "constraint_evaluate",
  "resolver_start", "resolver_complete", "resolver_error",
  "approval_request", "approval_response",
  "handoff_start", "handoff_complete",
  "pattern_start", "pattern_complete",
  "dag_node_update",
  "breakpoint_hit", "breakpoint_resumed",
  "derivation_update", "scratchpad_update",
  "reflection_iteration",
  "race_start", "race_winner", "race_cancelled",
  "debate_round", "reroute",
]);

// ============================================================================
// Types
// ============================================================================

/** Callback fired when a new event is recorded */
export type DebugTimelineListener = (event: DebugEvent) => void;

/** Debug timeline instance */
export interface DebugTimeline {
  /** Record a new event (id is auto-assigned) */
  record(event: Omit<DebugEvent, "id"> & Record<string, unknown>): DebugEvent;
  /** Get all events in order */
  getEvents(): DebugEvent[];
  /** Get events for a specific agent */
  getEventsForAgent(agentId: string): DebugEvent[];
  /** Get events by type with type narrowing */
  getEventsByType<T extends DebugEventType>(type: T): Extract<DebugEvent, { type: T }>[];
  /** Get events at a specific snapshot */
  getEventsAtSnapshot(snapshotId: number): DebugEvent[];
  /** Get events in a time range */
  getEventsInRange(startMs: number, endMs: number): DebugEvent[];
  /** Fork from a snapshot — truncates events after it and calls goTo */
  forkFrom(snapshotId: number): void;
  /** Export timeline as JSON */
  export(): string;
  /** Import timeline from JSON */
  import(json: string): void;
  /** Clear all events */
  clear(): void;
  /** Subscribe to new events. Returns unsubscribe function. */
  subscribe(listener: DebugTimelineListener): () => void;
  /** Current number of events */
  readonly length: number;
}

/** Options for creating a debug timeline */
export interface DebugTimelineOptions {
  /** Maximum events before eviction. @default 2000 */
  maxEvents?: number;
  /** Callback to get current snapshot ID from the system */
  getSnapshotId?: () => number | null;
  /** Callback to navigate to a snapshot (for forkFrom) */
  goToSnapshot?: (snapshotId: number) => void;
}

// ============================================================================
// Implementation
// ============================================================================

const BLOCKED_IMPORT_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
]);

/**
 * Create a debug timeline for recording and correlating AI events.
 *
 * @example
 * ```typescript
 * const timeline = createDebugTimeline({ maxEvents: 1000 });
 *
 * timeline.record({
 *   type: "agent_start",
 *   timestamp: Date.now(),
 *   agentId: "researcher",
 *   snapshotId: null,
 *   inputLength: 42,
 * });
 *
 * const agentEvents = timeline.getEventsForAgent("researcher");
 * ```
 */
export function createDebugTimeline(options: DebugTimelineOptions = {}): DebugTimeline {
  const maxEvents = options.maxEvents ?? 2000;
  const goToSnapshot = options.goToSnapshot;

  // Validate config
  if (!Number.isFinite(maxEvents) || maxEvents < 1) {
    throw new Error("[Directive DebugTimeline] maxEvents must be >= 1");
  }

  let events: DebugEvent[] = [];
  let nextId = 0;
  const listeners = new Set<DebugTimelineListener>();

  const timeline: DebugTimeline = {
    record(event: Omit<DebugEvent, "id">): DebugEvent {
      const fullEvent = { ...event, id: nextId++ } as DebugEvent;
      events.push(fullEvent);

      // Batch eviction — single splice instead of per-element shift
      const overflow = events.length - maxEvents;
      if (overflow > 0) {
        events.splice(0, overflow);
      }

      // Notify listeners
      for (const listener of listeners) {
        try {
          listener(fullEvent);
        } catch (err) {
          // A6: Log listener errors in dev mode instead of swallowing silently
          if (typeof process !== "undefined" && process.env?.["NODE_ENV"] !== "production") {
            console.error("[Directive DebugTimeline] Listener threw:", err instanceof Error ? err.message : err);
          }
        }
      }

      return fullEvent;
    },

    getEvents(): DebugEvent[] {
      return [...events];
    },

    getEventsForAgent(agentId: string): DebugEvent[] {
      return events.filter((e) => e.agentId === agentId);
    },

    getEventsByType<T extends DebugEventType>(type: T): Extract<DebugEvent, { type: T }>[] {
      return events.filter((e) => e.type === type) as Extract<DebugEvent, { type: T }>[];
    },

    getEventsAtSnapshot(snapshotId: number): DebugEvent[] {
      return events.filter((e) => e.snapshotId === snapshotId);
    },

    getEventsInRange(startMs: number, endMs: number): DebugEvent[] {
      return events.filter((e) => e.timestamp >= startMs && e.timestamp <= endMs);
    },

    forkFrom(snapshotId: number): void {
      // A8: Single reverse scan instead of two .filter() passes
      let cutoffId = -1;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i]!.snapshotId !== null && events[i]!.snapshotId! <= snapshotId) {
          cutoffId = events[i]!.id;
          break;
        }
      }

      if (cutoffId >= 0) {
        // Find the index to slice at (events are monotonic by id)
        let sliceEnd = events.length;
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i]!.id <= cutoffId) {
            sliceEnd = i + 1;
            break;
          }
        }
        events = events.slice(0, sliceEnd);
      } else {
        // No matching events — clear all
        events = [];
      }

      // Navigate the system to the snapshot
      if (goToSnapshot) {
        goToSnapshot(snapshotId);
      }
    },

    export(): string {
      return JSON.stringify({ version: 1, events, nextId });
    },

    import(json: string): void {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        throw new Error("[Directive DebugTimeline] Invalid JSON");
      }

      if (!parsed || typeof parsed !== "object") {
        throw new Error("[Directive DebugTimeline] Invalid timeline data");
      }

      // Prototype pollution defense
      for (const key of Object.keys(parsed)) {
        if (BLOCKED_IMPORT_KEYS.has(key)) {
          throw new Error(`[Directive DebugTimeline] Blocked key in import: ${key}`);
        }
      }

      const data = parsed as { version?: number; events?: unknown[]; nextId?: number };

      if (!Array.isArray(data.events)) {
        throw new Error("[Directive DebugTimeline] Missing events array");
      }

      // Validate each event has required fields
      const validated: DebugEvent[] = [];
      for (const evt of data.events) {
        if (!evt || typeof evt !== "object") {
          continue;
        }

        // Prototype pollution defense on event objects
        for (const key of Object.keys(evt)) {
          if (BLOCKED_IMPORT_KEYS.has(key)) {
            throw new Error(`[Directive DebugTimeline] Blocked key in event: ${key}`);
          }
        }

        const e = evt as Record<string, unknown>;
        // A12: Also validate that event type is a known DebugEventType
        if (typeof e.id === "number" && typeof e.type === "string" && KNOWN_EVENT_TYPES.has(e.type) && typeof e.timestamp === "number") {
          validated.push(evt as DebugEvent);
        }
      }

      // Enforce maxEvents cap on imported data
      events = validated.length > maxEvents ? validated.slice(-maxEvents) : validated;
      nextId = typeof data.nextId === "number" ? data.nextId : validated.length;
    },

    clear(): void {
      events = [];
      nextId = 0;
    },

    subscribe(listener: DebugTimelineListener): () => void {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    get length(): number {
      return events.length;
    },
  };

  return timeline;
}

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Create a Directive plugin that bridges core constraint/resolver events
 * to the debug timeline.
 *
 * @example
 * ```typescript
 * const timeline = createDebugTimeline();
 * const plugin = createDebugTimelinePlugin(timeline, () => system.debug?.currentIndex ?? null);
 * ```
 */
export function createDebugTimelinePlugin(
  timeline: DebugTimeline,
  getSnapshotId: () => number | null,
): Plugin {
  const resolverStartTimes = new Map<string, number>();

  return {
    name: "directive-ai-debug-timeline",

    onConstraintEvaluate(id: string, active: boolean) {
      timeline.record({
        type: "constraint_evaluate",
        timestamp: Date.now(),
        snapshotId: getSnapshotId(),
        constraintId: id,
        fired: active,
      });
    },

    onResolverStart(resolver: string, req) {
      resolverStartTimes.set(resolver, Date.now());
      timeline.record({
        type: "resolver_start",
        timestamp: Date.now(),
        snapshotId: getSnapshotId(),
        resolverId: resolver,
        requirementType: req.requirement.type,
      });
    },

    onResolverComplete(resolver: string) {
      const startTime = resolverStartTimes.get(resolver);
      resolverStartTimes.delete(resolver);
      timeline.record({
        type: "resolver_complete",
        timestamp: Date.now(),
        snapshotId: getSnapshotId(),
        resolverId: resolver,
        durationMs: startTime ? Date.now() - startTime : 0,
      });
    },

    onResolverError(resolver: string, _req, error) {
      const startTime = resolverStartTimes.get(resolver);
      resolverStartTimes.delete(resolver);
      const errorMessage = error instanceof Error ? error.message : String(error);
      timeline.record({
        type: "resolver_error",
        timestamp: Date.now(),
        snapshotId: getSnapshotId(),
        resolverId: resolver,
        errorMessage,
        durationMs: startTime ? Date.now() - startTime : 0,
      });
    },
  };
}
