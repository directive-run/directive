/**
 * Tests for `attachSourcesToOtel` — pipes core source.* observation
 * events into an OTel tracer.
 *
 * Uses a fake tracer + span recorder so the OpenTelemetry SDK doesn't
 * need to be installed at test time.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import { attachSourcesToOtel } from "../otel-sources.js";
import { OtelStatusCode, type OtelSpan, type OtelTracer } from "../otel.js";

interface RecordedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
  events: Array<{
    name: string;
    attributes?: Record<string, string | number | boolean>;
  }>;
  status?: { code: number; message?: string };
  ended: boolean;
}

function makeFakeTracer(): { tracer: OtelTracer; spans: RecordedSpan[] } {
  const spans: RecordedSpan[] = [];
  const tracer: OtelTracer = {
    startSpan(name, options) {
      const span: RecordedSpan = {
        name,
        attributes: { ...(options?.attributes ?? {}) },
        events: [],
        ended: false,
      };
      spans.push(span);
      const handle: OtelSpan = {
        setAttribute(key, value) {
          span.attributes[key] = value;
        },
        addEvent(name, attributes) {
          span.events.push({ name, attributes });
        },
        setStatus(status) {
          span.status = status;
        },
        end() {
          span.ended = true;
        },
      };
      return handle;
    },
  };
  return { tracer, spans };
}

describe("attachSourcesToOtel", () => {
  it("emits a span at source.attach + ends it at source.detach", () => {
    const { tracer, spans } = makeFakeTracer();
    const module = createModule("m", {
      schema: {
        facts: { v: t.number() },
        events: { TICK: {} },
      },
      init: (f) => { f.v = 0; },
      events: { TICK: (f) => { f.v += 1; } },
      sources: {
        s: { attach: () => () => undefined },
      },
    });
    const system = createSystem({ module });
    const unsub = attachSourcesToOtel(system, {
      tracer,
      serviceName: "test",
    });
    system.start();
    expect(spans.length).toBe(1);
    expect(spans[0]?.name).toBe("directive.source.attached");
    expect(spans[0]?.attributes["source.id"]).toBe("s");
    expect(spans[0]?.attributes["source.module_id"]).toBe("m");
    expect(spans[0]?.ended).toBe(false);
    system.stop();
    expect(spans[0]?.ended).toBe(true);
    expect(spans[0]?.status?.code).toBe(OtelStatusCode.OK);
    unsub();
    system.destroy();
  });

  it("publishes attach as span events on the active span, not new spans", () => {
    const { tracer, spans } = makeFakeTracer();
    const captured: { publish: ((event: string, payload?: unknown) => void) | null } = {
      publish: null,
    };
    const module = createModule("ticker", {
      schema: {
        facts: { ticks: t.number() },
        events: { TICK: {} },
      },
      init: (f) => { f.ticks = 0; },
      events: { TICK: (f) => { f.ticks += 1; } },
      sources: {
        beat: {
          attach: (publish) => {
            captured.publish = publish;
            return () => undefined;
          },
        },
      },
    });
    const system = createSystem({ module });
    const unsub = attachSourcesToOtel(system, {
      tracer,
      serviceName: "test",
    });
    system.start();
    captured.publish?.("TICK", {});
    captured.publish?.("TICK", {});
    captured.publish?.("TICK", {});
    // ONE span per source. Publishes accumulate as events on it.
    expect(spans.length).toBe(1);
    expect(spans[0]?.events.length).toBe(3);
    expect(spans[0]?.events[0]?.name).toBe("publish");
    expect(spans[0]?.events[0]?.attributes?.["source.event_name"]).toBe("TICK");
    unsub();
    system.destroy();
  });

  it("emits an error span on source.error", () => {
    const { tracer, spans } = makeFakeTracer();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const module = createModule("m", {
      schema: { facts: { v: t.number() }, events: {} },
      init: (f) => { f.v = 0; },
      sources: {
        boom: {
          attach: () => {
            throw new Error("attach failed");
          },
        },
      },
    });
    const system = createSystem({ module });
    const unsub = attachSourcesToOtel(system, {
      tracer,
      serviceName: "test",
    });
    system.start();
    // No attach succeeded → no active span. Error becomes a one-shot
    // error span.
    const errorSpan = spans.find((s) => s.name === "directive.source.error");
    expect(errorSpan).toBeDefined();
    expect(errorSpan?.status?.code).toBe(OtelStatusCode.ERROR);
    expect(errorSpan?.attributes["directive.phase"]).toBe("attach");
    expect(errorSpan?.attributes["error.message"]).toContain("attach failed");
    expect(errorSpan?.ended).toBe(true);
    unsub();
    consoleErrorSpy.mockRestore();
    system.destroy();
  });

  it("unsubscribe stops new spans from being recorded", () => {
    const { tracer, spans } = makeFakeTracer();
    const module = createModule("m", {
      schema: { facts: { v: t.number() }, events: { TICK: {} } },
      init: (f) => { f.v = 0; },
      events: { TICK: (f) => { f.v += 1; } },
      sources: {
        a: { attach: () => () => undefined },
        b: { attach: () => () => undefined },
      },
    });
    const system = createSystem({ module });
    const unsub = attachSourcesToOtel(system, {
      tracer,
      serviceName: "test",
    });
    system.start();
    expect(spans.length).toBe(2); // attach for a + b
    unsub();
    system.stop(); // would have ended both spans, but we already unsubscribed
    const stillOpen = spans.filter((s) => !s.ended);
    expect(stillOpen.length).toBe(2);
    system.destroy();
  });
});
