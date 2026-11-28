/**
 * `system.events.<name>` for a name the module has no event for (flat).
 *
 * 1.35's events proxy (system.ts:1190) reads any name that is not blocked as
 * a dispatcher, and dispatching an unknown event is a development warning
 * and nothing else. 2.0 read an unknown name as undefined, so
 * `system.events.nope()` was a TypeError. `in` and the keys still list only
 * the module's events, as 1.35.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

type Any = any;
const load = async (development: boolean, events: boolean) => {
  vi.resetModules();
  vi.doMock("#is-development", () => ({ default: development }));
  const { createModule } = await import("../api/core.js");
  const { t } = await import("../api/schema-builders.js");
  const { createSystem } = await import("../api/system.js");

  return createSystem({
    module: createModule("a", {
      schema: {
        facts: { count: t.number() },
        ...(events && { events: { inc: {} } }),
      },
      init: (f: Any) => {
        f.count = 0;
      },
      ...(events && {
        events: {
          inc: (f: Any) => {
            f.count += 1;
          },
        },
      }),
    } as Any),
  } as Any) as Any;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("#is-development");
});

describe.each([
  ["development", true],
  ["production", false],
] as const)("an unknown event name (%s)", (_, development) => {
  describe.each([
    ["a module with events", true],
    ["a module with none", false],
  ] as const)("%s", (_, events) => {
    it.each([false, true])(
      "is a dispatcher that does nothing (started: %s)",
      async (started) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const system = await load(development, events);
        started && system.start();

        expect(typeof system.events.nope).toBe("function");
        expect(system.events.nope({ x: 1 })).toBeUndefined();
        expect(warn.mock.calls.map((call) => call[0])).toEqual(
          development
            ? [
                `[Directive] Unknown event type "nope". No handler is registered for this event. Available events: ${events ? "inc" : "(none)"}`,
              ]
            : [],
        );
        started && expect(system.facts.count).toBe(0);
        system.destroy();
      },
    );

    it("keeps `in`, the keys and the blocked names as they were", async () => {
      const system = await load(development, events);

      expect("nope" in system.events).toBe(false);
      expect("inc" in system.events).toBe(events);
      expect(Object.keys(system.events)).toEqual(events ? ["inc"] : []);
      expect(system.events.__proto__).toBeUndefined();
      expect(system.events.constructor).toBeUndefined();
      expect(system.events.prototype).toBeUndefined();
      expect(system.events[Symbol.iterator]).toBeUndefined();
      system.destroy();
    });
  });

  it("still dispatches a known event", async () => {
    const system = await load(development, true);
    system.start();
    system.events.inc();

    expect(system.facts.count).toBe(1);
    system.destroy();
  });
});
