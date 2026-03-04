/**
 * OpenTelemetry Integration — AI-specific observability spans.
 *
 * Auto-instruments agent orchestrators with OpenTelemetry spans for
 * agent runs, guardrail checks, constraint evaluations, and DAG execution.
 * Works with any OTEL-compatible collector (Jaeger, Zipkin, Honeycomb, etc.).
 *
 * Uses OpenTelemetry GenAI semantic conventions (`gen_ai.*`) for
 * AI-specific attributes alongside Directive-specific attributes.
 *
 * @example
 * ```typescript
 * import { createOtelPlugin } from "@directive-run/ai";
 *
 * const orchestrator = createAgentOrchestrator({
 *   runner,
 *   plugins: [createOtelPlugin({ serviceName: "my-ai-app" })],
 * });
 * // Every run() creates spans with: agent name, model, tokens, cost, duration
 * ```
 *
 * @module
 */

import type { DebugTimeline } from "./debug-timeline.js";
import type {
  AgentCompleteEvent,
  AgentErrorEvent,
  AgentStartEvent,
  ConstraintEvaluateEvent,
  DebugEvent,
  GuardrailCheckEvent,
  PatternCompleteEvent,
  PatternStartEvent,
  ResolverCompleteEvent,
  ResolverErrorEvent,
  ResolverStartEvent,
} from "./types.js";

// ============================================================================
// Constants
// ============================================================================

/** Default TTL for active spans (5 minutes). Spans older than this are cleaned up. */
const DEFAULT_SPAN_TTL_MS = 300_000;

/** Maximum active spans before triggering cleanup */
const MAX_ACTIVE_SPANS = 10_000;

/** Maximum depth of the pattern span stack */
const MAX_PATTERN_STACK = 100;

// ============================================================================
// Types
// ============================================================================

/** Minimal span interface compatible with OpenTelemetry API */
export interface OtelSpan {
  /** Set an attribute on the span */
  setAttribute(key: string, value: string | number | boolean): void;
  /** Add an event to the span */
  addEvent(
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): void;
  /** Set the span status */
  setStatus(status: { code: number; message?: string }): void;
  /** End the span */
  end(): void;
}

/** OTEL status codes as a const object (no enum overhead) */
export const OtelStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;

export type OtelStatusCode =
  (typeof OtelStatusCode)[keyof typeof OtelStatusCode];

/** Tracer interface compatible with OpenTelemetry API */
export interface OtelTracer {
  /** Start a new span */
  startSpan(
    name: string,
    options?: { attributes?: Record<string, string | number | boolean> },
  ): OtelSpan;
}

/** Configuration for the OTEL plugin */
export interface OtelPluginConfig {
  /** Service name for span attribution */
  serviceName: string;
  /** Custom tracer instance. If not provided, uses a no-op tracer for standalone span collection. */
  tracer?: OtelTracer;
  /** Span prefix. Default: "directive.ai" */
  spanPrefix?: string;
  /** Span processor callback — called for every completed span. Useful for custom exporters. */
  onSpanEnd?: (spanData: SpanData) => void;
  /** Event types to instrument. Default: all */
  instrumentEvents?: Set<string>;
  /** TTL for active spans in ms. Spans older than this are cleaned up. Default: 300000 (5 min) */
  spanTtlMs?: number;
}

/** Serializable span data for export */
export interface SpanData {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  attributes: Record<string, string | number | boolean>;
  events: Array<{
    name: string;
    attributes?: Record<string, string | number | boolean>;
    timestamp: number;
  }>;
  status: { code: OtelStatusCode; message?: string };
  startTime: number;
  endTime: number;
  durationMs: number;
}

/** OTEL Plugin instance */
export interface OtelPlugin {
  /** Attach to a debug timeline to auto-instrument */
  attach(timeline: DebugTimeline): () => void;
  /** Get all collected spans (when using built-in collector) */
  getSpans(): SpanData[];
  /** Clear collected spans */
  clearSpans(): void;
  /** Get the underlying tracer */
  getTracer(): OtelTracer;
  /** Get count of currently active (in-flight) spans */
  getActiveSpanCount(): number;
}

// ============================================================================
// No-Op Tracer (for standalone span collection)
// ============================================================================

class CollectedSpan implements OtelSpan {
  readonly attributes: Record<string, string | number | boolean> =
    Object.create(null);
  readonly spanEvents: Array<{
    name: string;
    attributes?: Record<string, string | number | boolean>;
    timestamp: number;
  }> = [];
  status: { code: OtelStatusCode; message?: string } = {
    code: OtelStatusCode.UNSET,
  };
  readonly startTime: number;
  endTime = 0;

  constructor(
    readonly name: string,
    readonly spanId: string,
    readonly traceId: string,
    readonly parentSpanId: string | undefined,
    initialAttributes?: Record<string, string | number | boolean>,
    private readonly onEnd?: (span: CollectedSpan) => void,
  ) {
    this.startTime = Date.now();
    if (initialAttributes) {
      for (const [key, value] of Object.entries(initialAttributes)) {
        this.attributes[key] = value;
      }
    }
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes[key] = value;
  }

  addEvent(
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    this.spanEvents.push({ name, attributes, timestamp: Date.now() });
  }

  setStatus(status: { code: OtelStatusCode; message?: string }): void {
    this.status = status;
  }

  end(): void {
    this.endTime = Date.now();
    this.onEnd?.(this);
  }

  toSpanData(): SpanData {
    return {
      name: this.name,
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      attributes: { ...this.attributes },
      events: [...this.spanEvents],
      status: { ...this.status },
      startTime: this.startTime,
      endTime: this.endTime,
      durationMs: this.endTime - this.startTime,
    };
  }
}

class CollectorTracer implements OtelTracer {
  readonly spans: SpanData[] = [];

  startSpan(
    name: string,
    options?: {
      attributes?: Record<string, string | number | boolean>;
      spanId?: string;
      traceId?: string;
      parentSpanId?: string;
    },
  ): OtelSpan {
    const spanId = options?.spanId ?? `fallback-${crypto.randomUUID()}`;
    const traceId = options?.traceId ?? `fallback-${crypto.randomUUID()}`;
    const parentSpanId = options?.parentSpanId;

    return new CollectedSpan(
      name,
      spanId,
      traceId,
      parentSpanId,
      options?.attributes,
      (span) => {
        this.spans.push(span.toSpanData());
      },
    );
  }

  clear(): void {
    this.spans.length = 0;
  }
}

// ============================================================================
// External Tracer Shadow Data
// ============================================================================

/**
 * When using an external tracer, we track span metadata alongside
 * the external span so `onSpanEnd` can provide meaningful SpanData.
 */
interface ExternalSpanShadow {
  span: OtelSpan;
  name: string;
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  attributes: Record<string, string | number | boolean>;
  events: Array<{
    name: string;
    attributes?: Record<string, string | number | boolean>;
    timestamp: number;
  }>;
  status: { code: OtelStatusCode; message?: string };
  startTime: number;
}

// ============================================================================
// Active Span Entry
// ============================================================================

interface ActiveSpanEntry {
  span: OtelSpan;
  shadow?: ExternalSpanShadow;
  spanId: string;
  traceId: string;
  startTime: number;
  /** A13: Pre-computed index key to avoid parsing from span key */
  indexKey?: string;
}

// ============================================================================
// Plugin Implementation
// ============================================================================

/**
 * Create an OpenTelemetry plugin for AI observability.
 *
 * Subscribes to a DebugTimeline and creates spans for agent runs,
 * guardrail checks, constraint evaluations, resolver executions,
 * and execution patterns (DAG, parallel, sequential, etc.).
 *
 * Parent-child relationships:
 * - Pattern spans are roots
 * - Agent spans are children of the active pattern span (if any)
 * - Guardrail/resolver spans within an agent run are children of the agent span
 * - Constraint evaluations within an agent run are recorded as span events
 *
 * @example
 * ```typescript
 * // With built-in span collection:
 * const otel = createOtelPlugin({ serviceName: "my-app" });
 * const unsub = otel.attach(orchestrator.timeline);
 * await orchestrator.run(agent, input);
 * console.log(otel.getSpans()); // All spans from the run
 *
 * // With custom OTEL tracer:
 * import { trace } from "@opentelemetry/api";
 * const otel = createOtelPlugin({
 *   serviceName: "my-app",
 *   tracer: trace.getTracer("directive-ai"),
 * });
 * ```
 */
export function createOtelPlugin(config: OtelPluginConfig): OtelPlugin {
  const prefix = config.spanPrefix ?? "directive.ai";
  const instrumentEvents = config.instrumentEvents;
  const spanTtlMs = config.spanTtlMs ?? DEFAULT_SPAN_TTL_MS;

  // Use provided tracer or built-in collector
  const isCollector = !config.tracer;
  const collectorTracer = isCollector ? new CollectorTracer() : null;
  const tracer = config.tracer ?? collectorTracer!;

  // Instance-scoped ID generation (prevents cross-test leakage)
  let spanCounter = 0;

  function generateId(): string {
    return `${Date.now().toString(36)}-${(spanCounter++).toString(36)}`;
  }

  function generateTraceId(): string {
    return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  }

  // Track active spans by unique key for correlation
  // Key format: "type:id:counter" to prevent collisions
  const activeSpans = new Map<string, ActiveSpanEntry>();
  let keyCounter = 0;

  // Secondary index for O(1) span lookup by "type:id" prefix
  const spanKeyIndex = new Map<string, string[]>();

  /**
   * Pattern span stack for proper nesting (inner patterns don't clobber outer).
   *
   * WARNING: A single OtelPlugin instance must NOT be attached to more than one
   * timeline simultaneously. The patternStack is local to this closure and is
   * shared across all events emitted through it. Concurrent use across multiple
   * timelines will interleave push/pop operations, producing incorrect span
   * hierarchies and potentially orphaned spans.
   */
  const patternStack: ActiveSpanEntry[] = [];

  // A7: Track attached timeline to prevent double-attach
  let attachedTimeline: DebugTimeline | null = null;

  // Dev warning dedup
  let warnedExternalGetSpans = false;

  function shouldInstrument(type: string): boolean {
    if (!instrumentEvents) {
      return true;
    }

    return instrumentEvents.has(type);
  }

  function makeSpanKey(type: string, id: string): string {
    return `${type}:${id}:${keyCounter++}`;
  }

  function findActiveSpan(
    type: string,
    id: string,
  ): { key: string; entry: ActiveSpanEntry } | null {
    const indexKey = `${type}:${id}`;
    const keys = spanKeyIndex.get(indexKey);
    if (keys) {
      // Walk from end to find latest active span
      for (let i = keys.length - 1; i >= 0; i--) {
        const entry = activeSpans.get(keys[i]!);
        if (entry) {
          return { key: keys[i]!, entry };
        }
      }

      // All stale
      spanKeyIndex.delete(indexKey);
    }

    return null;
  }

  function registerSpan(
    type: string,
    id: string,
    key: string,
    entry: ActiveSpanEntry,
  ): void {
    // A13: Store indexKey explicitly to avoid parsing from key later
    const indexKey = `${type}:${id}`;
    entry.indexKey = indexKey;
    activeSpans.set(key, entry);
    const existing = spanKeyIndex.get(indexKey);
    if (existing) {
      existing.push(key);
    } else {
      spanKeyIndex.set(indexKey, [key]);
    }
  }

  function removeSpan(key: string): void {
    // A13: Use stored indexKey instead of parsing from key string
    const entry = activeSpans.get(key);
    activeSpans.delete(key);

    const indexKey = entry?.indexKey;
    if (indexKey) {
      const keys = spanKeyIndex.get(indexKey);
      if (keys) {
        const idx = keys.indexOf(key);
        if (idx !== -1) {
          keys.splice(idx, 1);
        }
        if (keys.length === 0) {
          spanKeyIndex.delete(indexKey);
        }
      }
    }
  }

  function cleanupStaleSpans(): void {
    // A3: Always run TTL-based pruning (not gated behind size check)
    const now = Date.now();
    if (activeSpans.size < MAX_ACTIVE_SPANS) {
      // Below hard cap: only prune spans that exceeded TTL
      let hasPruned = false;
      for (const [key, entry] of activeSpans) {
        if (now - entry.startTime > spanTtlMs) {
          setAttributeTracked(entry, "directive.stale", true);
          setStatusTracked(entry, {
            code: OtelStatusCode.ERROR,
            message: "Span TTL exceeded — cleaned up",
          });
          endSpan(entry);
          removeSpan(key);
          hasPruned = true;
        }
      }

      if (hasPruned) {
        return;
      }

      return;
    }

    for (const [key, entry] of activeSpans) {
      if (now - entry.startTime > spanTtlMs) {
        setAttributeTracked(entry, "directive.stale", true);
        setStatusTracked(entry, {
          code: OtelStatusCode.ERROR,
          message: "Span TTL exceeded — cleaned up",
        });
        endSpan(entry);
        removeSpan(key);
      }
    }
  }

  function startSpan(
    name: string,
    attributes: Record<string, string | number | boolean>,
    parentEntry?: ActiveSpanEntry | null,
  ): { span: OtelSpan; entry: ActiveSpanEntry } {
    const spanId = generateId();
    const traceId = parentEntry?.traceId ?? generateTraceId();
    const parentSpanId = parentEntry?.spanId;

    let span: OtelSpan;

    if (isCollector) {
      span = (tracer as CollectorTracer).startSpan(name, {
        attributes,
        spanId,
        traceId,
        parentSpanId,
      });
    } else {
      span = tracer.startSpan(name, { attributes });
    }

    const entry: ActiveSpanEntry = {
      span,
      spanId,
      traceId,
      startTime: Date.now(),
    };

    // Track shadow data for external tracers
    if (!isCollector) {
      entry.shadow = {
        span,
        name,
        spanId,
        traceId,
        parentSpanId,
        attributes: { ...attributes },
        events: [],
        status: { code: OtelStatusCode.UNSET },
        startTime: entry.startTime,
      };
    }

    return { span, entry };
  }

  function endSpan(entry: ActiveSpanEntry): void {
    entry.span.end();

    if (config.onSpanEnd) {
      config.onSpanEnd(spanToData(entry));
    }
  }

  function spanToData(entry: ActiveSpanEntry): SpanData {
    if (entry.span instanceof CollectedSpan) {
      return entry.span.toSpanData();
    }

    // For external tracers, use shadow data
    if (entry.shadow) {
      const now = Date.now();

      return {
        name: entry.shadow.name,
        traceId: entry.shadow.traceId,
        spanId: entry.shadow.spanId,
        parentSpanId: entry.shadow.parentSpanId,
        attributes: { ...entry.shadow.attributes },
        events: [...entry.shadow.events],
        status: { ...entry.shadow.status },
        startTime: entry.shadow.startTime,
        endTime: now,
        durationMs: now - entry.shadow.startTime,
      };
    }

    // Fallback — should not happen
    const now = Date.now();

    return {
      name: "unknown",
      traceId: entry.traceId,
      spanId: entry.spanId,
      attributes: {},
      events: [],
      status: { code: OtelStatusCode.UNSET },
      startTime: entry.startTime,
      endTime: now,
      durationMs: now - entry.startTime,
    };
  }

  function setAttributeTracked(
    entry: ActiveSpanEntry,
    key: string,
    value: string | number | boolean,
  ): void {
    entry.span.setAttribute(key, value);
    if (entry.shadow) {
      entry.shadow.attributes[key] = value;
    }
  }

  function addEventTracked(
    entry: ActiveSpanEntry,
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    entry.span.addEvent(name, attributes);
    if (entry.shadow) {
      entry.shadow.events.push({ name, attributes, timestamp: Date.now() });
    }
  }

  function setStatusTracked(
    entry: ActiveSpanEntry,
    status: { code: OtelStatusCode; message?: string },
  ): void {
    entry.span.setStatus(status);
    if (entry.shadow) {
      entry.shadow.status = { ...status };
    }
  }

  function handleEvent(event: DebugEvent): void {
    if (!shouldInstrument(event.type)) {
      return;
    }

    cleanupStaleSpans();

    switch (event.type) {
      case "agent_start":
        handleAgentStart(event);
        break;
      case "agent_complete":
        handleAgentComplete(event);
        break;
      case "agent_error":
        handleAgentError(event);
        break;
      case "guardrail_check":
        handleGuardrailCheck(event);
        break;
      case "constraint_evaluate":
        handleConstraintEvaluate(event);
        break;
      case "resolver_start":
        handleResolverStart(event);
        break;
      case "resolver_complete":
        handleResolverComplete(event);
        break;
      case "resolver_error":
        handleResolverError(event);
        break;
      case "pattern_start":
        handlePatternStart(event);
        break;
      case "pattern_complete":
        handlePatternComplete(event);
        break;
      default:
        // Other events are recorded as span events on the active agent span
        if (event.agentId) {
          const found = findActiveSpan("agent", event.agentId);
          if (found) {
            addEventTracked(found.entry, event.type, {
              "event.id": event.id,
              "event.timestamp": event.timestamp,
            });
          }
        }
    }
  }

  function handleAgentStart(event: AgentStartEvent): void {
    // Agent span is a child of the active pattern span (top of stack)
    const parentEntry =
      patternStack.length > 0 ? patternStack[patternStack.length - 1]! : null;

    const { entry } = startSpan(
      `${prefix}.agent.run`,
      {
        "directive.service": config.serviceName,
        "directive.agent.name": event.agentId,
        "directive.agent.input_length": event.inputLength,
        // GenAI semantic conventions
        "gen_ai.operation.name": "agent.run",
        "gen_ai.agent.name": event.agentId,
      },
      parentEntry,
    );

    const key = makeSpanKey("agent", event.agentId);
    registerSpan("agent", event.agentId, key, entry);
  }

  function handleAgentComplete(event: AgentCompleteEvent): void {
    const found = findActiveSpan("agent", event.agentId);
    if (found) {
      setAttributeTracked(
        found.entry,
        "directive.agent.output_length",
        event.outputLength,
      );
      setAttributeTracked(
        found.entry,
        "directive.agent.total_tokens",
        event.totalTokens,
      );
      setAttributeTracked(
        found.entry,
        "directive.agent.duration_ms",
        event.durationMs,
      );
      // GenAI semantic conventions
      setAttributeTracked(
        found.entry,
        "gen_ai.usage.total_tokens",
        event.totalTokens,
      );

      setStatusTracked(found.entry, { code: OtelStatusCode.OK });
      endSpan(found.entry);
      removeSpan(found.key);
    }
  }

  function handleAgentError(event: AgentErrorEvent): void {
    const found = findActiveSpan("agent", event.agentId);
    if (found) {
      setAttributeTracked(
        found.entry,
        "directive.agent.duration_ms",
        event.durationMs,
      );
      setAttributeTracked(
        found.entry,
        "directive.agent.error",
        event.errorMessage,
      );
      // GenAI semantic conventions
      setAttributeTracked(
        found.entry,
        "gen_ai.error.message",
        event.errorMessage,
      );

      setStatusTracked(found.entry, {
        code: OtelStatusCode.ERROR,
        message: event.errorMessage,
      });
      endSpan(found.entry);
      removeSpan(found.key);
    }
  }

  function handleGuardrailCheck(event: GuardrailCheckEvent): void {
    // Guardrail span is a child of the active agent span for this event's agent
    const parentEntry = event.agentId
      ? (findActiveSpan("agent", event.agentId)?.entry ?? null)
      : null;

    const { entry } = startSpan(
      `${prefix}.guardrail.check`,
      {
        "directive.service": config.serviceName,
        "directive.guardrail.name": event.guardrailName,
        "directive.guardrail.type": event.guardrailType,
        "directive.guardrail.passed": event.passed,
        "directive.guardrail.duration_ms": event.durationMs,
        // GenAI semantic conventions
        "gen_ai.guardrail.name": event.guardrailName,
        "gen_ai.guardrail.type": event.guardrailType,
        "gen_ai.guardrail.passed": event.passed,
      },
      parentEntry,
    );

    if (event.reason) {
      setAttributeTracked(entry, "directive.guardrail.reason", event.reason);
    }

    setStatusTracked(entry, {
      code: event.passed ? OtelStatusCode.OK : OtelStatusCode.ERROR,
      message: event.passed ? undefined : event.reason,
    });
    endSpan(entry);
  }

  function handleConstraintEvaluate(event: ConstraintEvaluateEvent): void {
    // Constraints are lightweight — record as events on the active agent span
    if (event.agentId) {
      const found = findActiveSpan("agent", event.agentId);
      if (found) {
        addEventTracked(found.entry, "constraint_evaluate", {
          "directive.constraint.id": event.constraintId,
          "directive.constraint.fired": event.fired,
        });

        return;
      }
    }

    // No parent span — create a standalone span
    const { entry } = startSpan(
      `${prefix}.constraint.evaluate`,
      {
        "directive.service": config.serviceName,
        "directive.constraint.id": event.constraintId,
        "directive.constraint.fired": event.fired,
      },
      null,
    );
    setStatusTracked(entry, { code: OtelStatusCode.OK });
    endSpan(entry);
  }

  function handleResolverStart(event: ResolverStartEvent): void {
    // Resolver spans can be children of the active agent span
    const agentParent = event.agentId
      ? (findActiveSpan("agent", event.agentId)?.entry ?? null)
      : null;
    // Or fall back to pattern span (top of stack)
    const parentEntry =
      agentParent ??
      (patternStack.length > 0 ? patternStack[patternStack.length - 1]! : null);

    const { entry } = startSpan(
      `${prefix}.resolver.execute`,
      {
        "directive.service": config.serviceName,
        "directive.resolver.id": event.resolverId,
        "directive.resolver.requirement_type": event.requirementType,
      },
      parentEntry,
    );

    const key = makeSpanKey("resolver", event.resolverId);
    registerSpan("resolver", event.resolverId, key, entry);
  }

  function handleResolverComplete(event: ResolverCompleteEvent): void {
    const found = findActiveSpan("resolver", event.resolverId);
    if (found) {
      setAttributeTracked(
        found.entry,
        "directive.resolver.duration_ms",
        event.durationMs,
      );
      setStatusTracked(found.entry, { code: OtelStatusCode.OK });
      endSpan(found.entry);
      removeSpan(found.key);
    }
  }

  function handleResolverError(event: ResolverErrorEvent): void {
    const found = findActiveSpan("resolver", event.resolverId);
    if (found) {
      setAttributeTracked(
        found.entry,
        "directive.resolver.duration_ms",
        event.durationMs,
      );
      setAttributeTracked(
        found.entry,
        "directive.resolver.error",
        event.errorMessage,
      );
      setStatusTracked(found.entry, {
        code: OtelStatusCode.ERROR,
        message: event.errorMessage,
      });
      endSpan(found.entry);
      removeSpan(found.key);
    }
  }

  function handlePatternStart(event: PatternStartEvent): void {
    const parentEntry =
      patternStack.length > 0 ? patternStack[patternStack.length - 1]! : null;
    const { entry } = startSpan(
      `${prefix}.pattern.${event.patternType}`,
      {
        "directive.service": config.serviceName,
        "directive.pattern.id": event.patternId,
        "directive.pattern.type": event.patternType,
      },
      parentEntry,
    );

    const key = makeSpanKey("pattern", event.patternId);
    registerSpan("pattern", event.patternId, key, entry);
    // A3: Cap pattern stack to prevent overflow
    if (patternStack.length < MAX_PATTERN_STACK) {
      patternStack.push(entry);
    }
  }

  function handlePatternComplete(event: PatternCompleteEvent): void {
    const found = findActiveSpan("pattern", event.patternId);
    if (found) {
      setAttributeTracked(
        found.entry,
        "directive.pattern.duration_ms",
        event.durationMs,
      );
      if (event.error) {
        setAttributeTracked(
          found.entry,
          "directive.pattern.error",
          event.error,
        );
        setStatusTracked(found.entry, {
          code: OtelStatusCode.ERROR,
          message: event.error,
        });
      } else {
        setStatusTracked(found.entry, { code: OtelStatusCode.OK });
      }
      endSpan(found.entry);
      removeSpan(found.key);

      // Remove from pattern stack
      const idx = patternStack.indexOf(found.entry);
      if (idx !== -1) {
        patternStack.splice(idx, 1);
      }
    }
  }

  return {
    attach(timeline: DebugTimeline): () => void {
      // A7: Prevent attaching to multiple timelines simultaneously
      if (attachedTimeline && attachedTimeline !== timeline) {
        throw new Error(
          "[Directive OTEL] Plugin already attached to a different timeline. Create a new plugin instance.",
        );
      }

      attachedTimeline = timeline;
      const unsub = timeline.subscribe(handleEvent);
      const cleanupInterval = setInterval(
        cleanupStaleSpans,
        Math.min(spanTtlMs, 60_000),
      );

      return () => {
        unsub();
        clearInterval(cleanupInterval);
        attachedTimeline = null;

        // Cleanup: end all active spans on detach
        for (const [_key, entry] of activeSpans) {
          setAttributeTracked(entry, "directive.detached", true);
          setStatusTracked(entry, {
            code: OtelStatusCode.ERROR,
            message: "Plugin detached while span was active",
          });
          endSpan(entry);
        }
        activeSpans.clear();
        spanKeyIndex.clear();
        patternStack.length = 0;
      };
    },

    getSpans(): SpanData[] {
      if (collectorTracer) {
        return [...collectorTracer.spans];
      }

      if (!warnedExternalGetSpans) {
        warnedExternalGetSpans = true;
        if (
          typeof process !== "undefined" &&
          process.env?.NODE_ENV !== "production"
        ) {
          console.warn(
            "[Directive OTEL] getSpans() returns [] when using an external tracer. " +
              "Use the onSpanEnd callback to collect span data instead.",
          );
        }
      }

      return [];
    },

    clearSpans(): void {
      collectorTracer?.clear();
    },

    getTracer(): OtelTracer {
      return tracer;
    },

    getActiveSpanCount(): number {
      return activeSpans.size;
    },
  };
}
