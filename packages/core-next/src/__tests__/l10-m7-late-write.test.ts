/**
 * Row (cd), owner-approved 2026-11-17 ("Approve all as recommended
 * (Recommended)"): after unregisterModule, a write from one of the retired
 * module's resolvers never lands in a fact of a module registered later
 * with the same key, whether the run ended inside the 10 s drain or
 * outlived it. 1.35 lets it land once the key is declared again (the L10
 * gate's l10-gate-pins-oracle pin, now 1.35-only); this file pins 2.0's
 * side. Writes to the host's keys land, as on 1.35. Development warns once
 * per retired resolver; production is silent (dynamic.ts retire_,
 * facts.ts late).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

type Any = any;

// The run's own `pending = false`, at 15 s, is the first dropped write.
const WARN =
  '[Directive] Dropped a write to "leaky::pending" from a resolver of unregistered module "leaky": a module registered later declares that fact.';

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const host = () =>
  createModule("m", {
    schema: { facts: { n: t.number() } },
    init: (facts: Any) => {
      facts.n = 1;
    },
  } as never);

/**
 * marker 1 starts a run that waits `ms` (ignoring its signal), then hands
 * back its context so the test writes when it likes. A replacement
 * (marker 2) starts a run only if `again`.
 */
const leaky = (marker: number, ms: number, out: { ctx?: Any }, again = false) =>
  createModule("leaky", {
    schema: {
      facts: { pending: t.boolean(), written: t.number() },
      requirements: { WORK: {} },
    },
    init: (facts: Any) => {
      facts.pending = marker === 1 || again;
      facts.written = 0;
    },
    constraints: {
      needsWork: { when: (f: Any) => f.pending, require: { type: "WORK" } },
    },
    resolvers: {
      work: {
        requirement: "WORK",
        resolve: async (_req: Any, context: Any) => {
          await new Promise((resolve) => setTimeout(resolve, ms));
          out.ctx = context;
          context.facts.pending = false;
        },
      },
    },
  } as never);

const setup = async (ms: number) => {
  vi.useFakeTimers();
  const out: { ctx?: Any } = {};
  const system = createSystem({
    modules: { m: host(), leaky: leaky(1, ms, out) },
  } as never) as Any;
  system.start();
  await vi.advanceTimersByTimeAsync(0);
  let done = false;
  const going = system.unregisterModule("leaky").then(() => {
    done = true;
  });

  return { system, out, going, done: () => done };
};

describe("row (cd): a retired resolver's write never reaches a same-key replacement", () => {
  it("a run that ended inside the drain: its later write to its own key is dropped", async () => {
    const { system, out, going, done } = await setup(30);
    await vi.advanceTimersByTimeAsync(40);
    await going;
    expect(done()).toBe(true);
    system.registerModule("leaky", leaky(2, 0, {}));
    await vi.advanceTimersByTimeAsync(0);
    out.ctx.facts.written = 1;
    expect(system.facts.leaky.written).toBe(0);
    delete out.ctx.facts.written;
    expect(system.facts.leaky.written).toBe(0);
    system.destroy();
  });

  it("a run that outlived the 10 s drain: its write is dropped, warned once in development", async () => {
    const { system, out, going, done } = await setup(15_000);
    await vi.advanceTimersByTimeAsync(9_990);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    await going;
    system.registerModule("leaky", leaky(2, 0, {}));
    await vi.advanceTimersByTimeAsync(0);
    warn.mockClear();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(out.ctx).toBeDefined();
    expect(system.facts.leaky.pending).toBe(false);
    out.ctx.facts.pending = true;
    out.ctx.facts.written = 1;
    out.ctx.facts.written = 3;
    expect(system.facts.leaky.written).toBe(0);
    expect(warn.mock.calls).toEqual([[WARN]]);
    system.destroy();
  });

  it("the replacement's own resolver writes its keys", async () => {
    const { system, going } = await setup(30);
    await vi.advanceTimersByTimeAsync(40);
    await going;
    const fresh: { ctx?: Any } = {};
    system.registerModule("leaky", leaky(2, 5, fresh, true));
    await vi.advanceTimersByTimeAsync(10);
    expect(system.facts.leaky.pending).toBe(false);
    fresh.ctx.facts.written = 2;
    expect(system.facts.leaky.written).toBe(2);
    system.destroy();
  });

  it("with no replacement the write is dropped with no warning, as before", async () => {
    const { system, out, going } = await setup(15_000);
    await vi.advanceTimersByTimeAsync(10_010);
    await going;
    warn.mockClear();
    await vi.advanceTimersByTimeAsync(5_000);
    out.ctx.facts.written = 1;
    expect(system.facts.leaky).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    system.destroy();
  });
});

describe("row (cd): a retired resolver's write to a host key is unchanged", () => {
  it("lands, inside the drain and after it, as on 1.35", async () => {
    vi.useFakeTimers();
    let ctx: Any;
    const system = createSystem({ module: host() } as never) as Any;
    system.start();
    system.registerModule({
      id: "w",
      schema: { facts: { go: t.boolean() } },
      init: (facts: Any) => {
        facts.go = true;
      },
      constraints: { work: { when: (f: Any) => f.go, require: { type: "W" } } },
      resolvers: {
        work: {
          requirement: "W",
          resolve: async (_r: Any, context: Any) => {
            ctx = context;
            await new Promise((resolve) => setTimeout(resolve, 15_000));
            context.facts.n = 7;
          },
        },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    const going = system.unregisterModule("w");
    await vi.advanceTimersByTimeAsync(5);
    ctx.facts.n = 4;
    expect(system.facts.n).toBe(4);
    await vi.advanceTimersByTimeAsync(10_010);
    await going;
    system.registerModule({
      id: "w2",
      schema: { facts: { go: t.boolean() } },
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(system.facts.n).toBe(7);
    system.destroy();
  });
});
