// Ported from packages/core/src/core/__tests__/l5-sources-oracle-production.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { afterEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("@directive-run/core");

// A namespaced source in production: a publish naming another module's event
// is dropped the same way, and nothing is logged. Public API only.

afterEach(() => {
  vi.restoreAllMocks();
});

type Publish = (eventName: string, payload?: unknown) => void;

describe("a namespaced source in production", () => {
  it("drops another module's event as cross-module without a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const drops: string[][] = [];
    let feed: Publish | undefined;
    const pokeModule = (id: string, sources: Record<string, unknown>) =>
      createModule(id, {
        schema: {
          facts: { hits: t.number() },
          derivations: {},
          events: { poke: {} },
        },
        init: (facts: any) => {
          facts.hits = 0;
        },
        events: {
          poke: (facts: any) => {
            facts.hits += 1;
          },
        },
        sources,
      } as any);
    const system: any = createSystem({
      modules: {
        loop: pokeModule("loop", {
          feed: {
            attach: (publish: Publish) => {
              feed = publish;

              return () => undefined;
            },
          },
        }),
        other: pokeModule("other", {}),
      },
      plugins: [
        {
          name: "drops",
          onSourceDrop: (
            id: string,
            _moduleId: string,
            eventName: string,
            reason: string,
          ) => {
            drops.push([id, eventName, reason]);
          },
        },
      ],
    } as any);
    system.start();

    feed!("other::poke");
    feed!("loop::poke");
    await system.settle();

    expect(system.facts.loop.hits).toBe(0);
    expect(system.facts.other.hits).toBe(0);
    expect(drops).toEqual([
      ["loop::feed", "other::poke", "cross-module-event"],
      ["loop::feed", "loop::poke", "cross-module-event"],
    ]);
    expect(warn).not.toHaveBeenCalled();
    system.destroy();
  });
});
