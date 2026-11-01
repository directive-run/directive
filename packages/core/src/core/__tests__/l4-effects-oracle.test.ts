import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box pins for three effect behaviours no other test holds (RFC L4, the
// untested-behaviours table: U3, U4 and U7). They run on 1.35 and on core-next
// and must give the same answers; they exist so that a later change to how an
// effect's dependencies are recorded, or to when a pass settles, fails a test
// instead of a user. Public API only; auto-tracked effects, no deps, no on.

/** Lets any promise-returning effect and its follow-up microtasks finish. */
async function drain(system: any) {
  await system.settle();
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

describe("an auto-tracked effect's dependencies", () => {
  it("stay those of the last good run when a run throws", async () => {
    // The throwing run read `a`, then threw; the last good run read `b`. The
    // effect keeps waiting for `b`, not `a`. (Only the stability counter
    // resets on a throw, and the counter changes cost, never which keys count.)
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let runs = 0;
    const mod = createModule("m", {
      schema: {
        facts: { fail: t.boolean(), a: t.number(), b: t.number() },
      },
      init: (f: any) => {
        f.fail = false;
        f.a = 0;
        f.b = 0;
      },
      effects: {
        watch: {
          run: (f: any) => {
            runs++;
            if (f.fail) {
              void f.a;
              throw new Error("boom");
            }
            void f.b;
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod } as never) as any;
    system.start();
    await drain(system);
    const initial = runs;
    expect(initial).toBeGreaterThan(0);

    // `fail` was read by the good run, so this wakes it, and it throws.
    system.facts.fail = true;
    await drain(system);
    expect(runs).toBe(initial + 1);

    // `a` was read only by the throwing run: nothing wakes the effect.
    system.facts.a = 1;
    await drain(system);
    system.facts.a = 2;
    await drain(system);
    expect(runs).toBe(initial + 1);

    // `b` was read by the last good run: it still wakes the effect.
    system.facts.b = 1;
    await drain(system);
    expect(runs).toBe(initial + 2);
    system.facts.b = 2;
    await drain(system);
    expect(runs).toBe(initial + 3);

    errors.mockRestore();
    await system.stop();
  });
});

describe("an async auto-tracked effect", () => {
  it("depends only on what it read before its first await", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    let runs = 0;
    const lateReads: number[] = [];
    const mod = createModule("m", {
      schema: { facts: { a: t.number(), b: t.number() } },
      init: (f: any) => {
        f.a = 0;
        f.b = 0;
      },
      effects: {
        watch: {
          run: async (f: any) => {
            runs++;
            void f.a;
            await Promise.resolve();
            // Read after the first await: seen, but not a dependency.
            lateReads.push(f.b);
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod } as never) as any;
    system.start();
    await drain(system);
    const initial = runs;
    expect(initial).toBeGreaterThan(0);
    expect(lateReads.length).toBe(initial);

    // `b` was read only after the await: a write to it wakes nothing.
    system.facts.b = 1;
    await drain(system);
    system.facts.b = 2;
    await drain(system);
    expect(runs).toBe(initial);

    // `a` was read before it: a write to it wakes the effect, and the read
    // after the await sees the latest `b`.
    system.facts.a = 1;
    await drain(system);
    expect(runs).toBe(initial + 1);
    expect(lateReads[lateReads.length - 1]).toBe(2);

    warnings.mockRestore();
    await system.stop();
  });
});

describe("a synchronous pass", () => {
  it("is settled after exactly one microtask, the effect having run", async () => {
    const seen: number[] = [];
    const mod = createModule("m", {
      schema: { facts: { n: t.number() } },
      init: (f: any) => {
        f.n = 0;
      },
      effects: {
        watch: {
          run: (f: any) => {
            seen.push(f.n);
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod } as never) as any;
    system.start();
    await drain(system);
    const before = seen.length;
    expect(system.isSettled).toBe(true);

    system.facts.n = 1;
    // The write schedules a pass; it has not run yet.
    expect(system.isSettled).toBe(false);
    expect(seen.length).toBe(before);

    // One microtask later the pass is done: every part of it was synchronous.
    await Promise.resolve();
    expect(system.isSettled).toBe(true);
    expect(seen.length).toBe(before + 1);
    expect(seen[seen.length - 1]).toBe(1);
    await system.stop();
  });
});
