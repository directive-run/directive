/**
 * `system.events.<name>` for a name the module has no event for (flat).
 *
 * 1.35's events proxy reads any name that is not blocked as a dispatcher, and
 * dispatching an unknown event is a development warning and nothing else:
 * `system.events.nope()` returns undefined. `in` and the keys list only the
 * module's events. Not pinned: `await system.events` (hangs on both engines).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

type Any = any;

afterEach(() => {
  vi.restoreAllMocks();
});

const make = (events: boolean) =>
  createSystem({
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

describe.each([
  ["a module with events", true],
  ["a module with none", false],
] as const)("an unknown event name, %s", (_, events) => {
  it.each([false, true])(
    "is a dispatcher that does nothing but warn (started: %s)",
    (started) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const system = make(events);
      started && system.start();

      expect(typeof system.events.nope).toBe("function");
      expect(system.events.nope({ x: 1 })).toBeUndefined();
      const texts = warn.mock.calls.map((call) => String(call[0]));
      expect(texts).toHaveLength(1);
      expect(texts[0]).toContain('Unknown event type "nope"');
      started && expect(system.facts.count).toBe(0);
      system.destroy();
    },
  );

  it("keeps `in` and the keys as they were", () => {
    const system = make(events);

    expect("nope" in system.events).toBe(false);
    expect("inc" in system.events).toBe(events);
    expect(Object.keys(system.events)).toEqual(events ? ["inc"] : []);
    system.destroy();
  });
});

it("still dispatches a known event", () => {
  const system = make(true);
  system.start();
  system.events.inc();

  expect(system.facts.count).toBe(1);
  system.destroy();
});
