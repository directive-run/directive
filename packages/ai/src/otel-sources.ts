/**
 * OTel × Sources — emit source-lifecycle spans from `system.observe()`
 *
 * The R5 observability reviewer found `@directive-run/ai/otel.ts`
 * subscribes only to the AI `DebugTimeline` event stream — so the four
 * `ObservationEvent.source.*` variants (`source.attach`,
 * `source.publish`, `source.detach`, `source.error`) shipped by the
 * source primitive never reach the OTel exporter. SREs running with
 * `createOtelPlugin` see agent spans but cannot answer "which source
 * is publishing?" or "did source `mcp` error attach?" from their
 * tracing backend.
 *
 * This module closes the gap as a focused helper (NOT a second OTel
 * plugin) so a single `OtelTracer` can carry both AI and core source
 * spans. Wire it once at `createSystem` time:
 *
 * @example Wire source events into the same OTel tracer as the AI plugin
 * ```ts
 * import { trace } from "@opentelemetry/api";
 * import { createSystem } from "@directive-run/core";
 * import { createOtelPlugin, attachSourcesToOtel } from "@directive-run/ai";
 *
 * const tracer = trace.getTracer("directive-app");
 * const otel = createOtelPlugin({ serviceName: "my-app", tracer });
 *
 * const system = createSystem({ module });
 * otel.attach(orchestrator.timeline);            // existing AI wiring
 * const unsub = attachSourcesToOtel(system, {    // NEW — source.* spans
 *   tracer,
 *   serviceName: "my-app",
 * });
 *
 * system.start();
 *
 * // Later
 * unsub();
 * ```
 *
 * Spans emitted:
 *
 * - `directive.source.attach` — short-duration (start → end same tick)
 *   span with attributes `source.id`, `source.module_id`, plus
 *   `attached_at` timestamp.
 * - `directive.source.publish` — short-duration counter span (NOT a
 *   per-publish full span; events of this kind are emitted as
 *   span EVENTS on a long-lived per-source "active" span so cardinality
 *   stays bounded).
 * - `directive.source.detach` — short-duration span, ends the matching
 *   "active" parent.
 * - `directive.source.error` — error-status span carrying the phase
 *   (`attach`/`cleanup`/`runtime` per RFC 0008) and the truncated
 *   message from R6/R7.
 *
 * Cardinality budget: ONE active span per (sourceId, moduleId) at a
 * time. Publishes attach as span events (cheap), not as new spans. At
 * 10 sources × 100 publishes/sec the exporter sees 1000 events/sec on
 * 10 long-lived spans — well within typical OTel collector budgets.
 */

import type { OtelTracer, OtelSpan } from "./otel.js";
import { OtelStatusCode as StatusCodeValues } from "./otel.js";

interface ObservableLike {
  observe(observer: (event: ObservationEventCompat) => void): () => void;
}

// Mirror the subset of ObservationEvent we read. Cast to this from any
// System<...> so the helper works regardless of the system's generic
// schema shape.
type ObservationEventCompat =
  | { type: "source.attach"; id: string; moduleId: string }
  | { type: "source.publish"; id: string; moduleId: string; eventName: string }
  | { type: "source.detach"; id: string; moduleId: string }
  | {
      type: "source.error";
      id: string;
      moduleId: string;
      phase: "attach" | "cleanup" | "runtime";
      error: unknown;
    }
  | { type: string; [key: string]: unknown };

export interface SourcesOtelOptions {
  /** Tracer to emit spans through. */
  tracer: OtelTracer;
  /** Service name attribute for every span. */
  serviceName: string;
  /** Span name prefix. Default: `"directive.source"`. */
  spanPrefix?: string;
  /**
   * Optional sampling for publish events. Sources at very high publish
   * rate (price ticks, cursor moves) may want to drop most publish
   * events from the trace. Default: `1.0` (every publish recorded as
   * an event on the active span).
   */
  publishSampleRate?: number;
}

interface ActiveSpan {
  span: OtelSpan;
  startedAt: number;
}

/**
 * Subscribe to a system's source-lifecycle events and emit OTel spans
 * for each. Returns an unsubscribe to detach.
 *
 * @returns a function that detaches the OTel wiring without affecting
 *   other observers.
 */
export function attachSourcesToOtel(
  system: unknown,
  options: SourcesOtelOptions,
): () => void {
  const {
    tracer,
    serviceName,
    spanPrefix = "directive.source",
    publishSampleRate = 1.0,
  } = options;

  const activeByKey = new Map<string, ActiveSpan>();

  function keyOf(id: string, moduleId: string): string {
    return `${moduleId}::${id}`;
  }

  function commonAttrs(
    id: string,
    moduleId: string,
  ): Record<string, string | number | boolean> {
    return {
      "service.name": serviceName,
      "source.id": id,
      "source.module_id": moduleId,
    };
  }

  function handle(event: ObservationEventCompat): void {
    switch (event.type) {
      case "source.attach": {
        const id = event.id as string;
        const moduleId = event.moduleId as string;
        const span = tracer.startSpan(`${spanPrefix}.attached`, {
          attributes: { ...commonAttrs(id, moduleId), "directive.attached": true },
        });
        activeByKey.set(keyOf(id, moduleId), { span, startedAt: Date.now() });
        break;
      }

      case "source.publish": {
        if (publishSampleRate < 1.0 && Math.random() > publishSampleRate) {
          break;
        }
        const id = event.id as string;
        const moduleId = event.moduleId as string;
        const eventName = (event as { eventName: string }).eventName;
        const active = activeByKey.get(keyOf(id, moduleId));
        if (!active) break;
        active.span.addEvent("publish", {
          "source.event_name": eventName,
          "timestamp.ms": Date.now(),
        });
        break;
      }

      case "source.detach": {
        const id = event.id as string;
        const moduleId = event.moduleId as string;
        const active = activeByKey.get(keyOf(id, moduleId));
        if (!active) break;
        active.span.setStatus({ code: StatusCodeValues.OK });
        active.span.end();
        activeByKey.delete(keyOf(id, moduleId));
        break;
      }

      case "source.error": {
        const id = event.id as string;
        const moduleId = event.moduleId as string;
        const phase = (event as { phase: string }).phase;
        const errVal = (event as { error: unknown }).error;
        const message =
          errVal instanceof Error
            ? errVal.message
            : typeof errVal === "string"
              ? errVal
              : String(errVal);
        const errorSpan = tracer.startSpan(`${spanPrefix}.error`, {
          attributes: {
            ...commonAttrs(id, moduleId),
            "directive.phase": phase,
            "error.message": message,
          },
        });
        errorSpan.setStatus({
          code: StatusCodeValues.ERROR,
          message,
        });
        errorSpan.end();
        // Also surface the error as an event on the active span (if any)
        // so a viewer correlating attach→error→detach can see them
        // linked in one trace.
        const active = activeByKey.get(keyOf(id, moduleId));
        if (active) {
          active.span.addEvent("error", {
            "directive.phase": phase,
            "error.message": message,
          });
        }
        break;
      }

      default:
        break;
    }
  }

  return (system as ObservableLike).observe(handle);
}
