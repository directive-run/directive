// Ported from packages/core/src/core/__tests__/l3-engine-oracle-lifecycle-pins.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box tests that pin two lifecycle rules of 1.35 the other L3 files do
// not reach: when a system becomes ready, and that every module's onStart runs
// in a namespaced system. Public API only. Each test records what a user can
// see (a flag read from inside a callback, the order callbacks ran in) and
// asserts the exact sequence.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readiness timing", () => {
  /**
   * One module that reads `isReady` from every place user code runs during a
   * pass: a plugin's pass-start and pass-end hooks, an effect, a constraint's
   * `when` and the derivation it reads. Each read is appended to `log`.
   */
  function observed() {
    const log: string[] = [];
    // biome-ignore lint/style/useConst: assigned once the system exists
    let sys: any;
    let inPass = false;
    const mark = (label: string) => {
      log.push(`${label}:${sys.isReady}`);
    };
    const mod = createModule("m", {
      schema: {
        facts: { count: t.number() },
        derivations: { parity: t.string() },
        events: {},
        requirements: { LOAD: {} },
      },
      init: (facts: any) => {
        facts.count = 0;
      },
      // A write made in onStart is what the first pass has to work on: it wakes
      // the effect and the constraint, and the derivation the constraint reads
      // has to recompute inside that pass.
      hooks: {
        onStart: (system: any) => {
          system.facts.count = 2;
        },
      },
      derive: {
        parity: (facts: any) => {
          // Only the recompute inside a pass is of interest; whether and when
          // a derivation first computes outside one is not part of this test.
          if (inPass) mark("derive");

          return facts.count % 2 === 0 ? "even" : "odd";
        },
      },
      constraints: {
        load: {
          when: (_facts: any, derived: any) => {
            mark("when");

            return derived.parity === "odd";
          },
          require: { type: "LOAD" },
        },
      },
      resolvers: {
        load: { requirement: "LOAD", resolve: async () => {} },
      },
      effects: {
        watch: {
          run: (facts: any) => {
            void facts.count;
            mark("effect");
          },
        },
      },
    } as never);
    sys = createSystem({
      module: mod,
      plugins: [
        {
          name: "probe",
          onStart: () => mark("onStart"),
          onReconcileStart: () => {
            inPass = true;
            mark("onReconcileStart");
          },
          onReconcileEnd: () => {
            mark("onReconcileEnd");
            inPass = false;
          },
        },
      ],
    } as never);

    return { sys, log, mark };
  }

  it("isReady is false for the whole first pass and true only once it has ended", async () => {
    const { sys, log, mark } = observed();

    expect(sys.isReady).toBe(false);
    sys.start();
    expect(sys.isReady).toBe(false);
    const ready = sys.whenReady().then(() => mark("whenReady"));

    expect(log).toEqual(["onStart:false"]);
    await ready;

    // The effect, the constraint, the derivation and both pass hooks all ran
    // inside the first pass and saw a system that was not ready; the flag is
    // up only after the pass-end hook, and whenReady() resolves after that.
    expect(log).toEqual([
      "onStart:false",
      "onReconcileStart:false",
      "effect:false",
      "when:false",
      "derive:false",
      "onReconcileEnd:false",
      "whenReady:true",
    ]);
    expect(sys.isReady).toBe(true);

    await sys.settle();
    expect(log).toHaveLength(7);
    sys.destroy();
  });

  it("whenReady() is one shared promise while it waits", async () => {
    const { sys } = observed();

    sys.start();
    const first = sys.whenReady();
    const second = sys.whenReady();

    expect(second).toBe(first);
    await first;
    expect(sys.isReady).toBe(true);
    sys.destroy();
  });

  it("stays ready after stop(), and a restart is still ready from its first pass", async () => {
    const { sys, log } = observed();

    sys.start();
    await sys.whenReady();
    log.length = 0;

    sys.stop();
    expect(sys.isRunning).toBe(false);
    expect(sys.isReady).toBe(true);
    await expect(sys.whenReady()).resolves.toBeUndefined();

    sys.start();
    expect(sys.isReady).toBe(true);
    await sys.settle();
    expect(log.length).toBeGreaterThan(0);
    expect(log.filter((entry) => entry.endsWith(":false"))).toEqual([]);
    sys.destroy();
  });
});

describe("namespaced module onStart", () => {
  function member(id: string, order: string[]) {
    return createModule(id, {
      schema: { facts: { n: t.number() }, derivations: {}, events: {} },
      init: (facts: any) => {
        facts.n = 0;
      },
      hooks: { onStart: () => order.push(id) },
    } as never);
  }

  it("every module's onStart runs on start(), in registration order", async () => {
    const order: string[] = [];
    // Registered out of alphabetical order, so neither "first" nor "last"
    // can be mistaken for sorted order.
    const sys = createSystem({
      modules: {
        zeta: member("zeta", order),
        alpha: member("alpha", order),
        mid: member("mid", order),
      },
    } as never) as any;

    expect(order).toEqual([]);
    sys.start();
    expect(order).toEqual(["zeta", "alpha", "mid"]);

    await sys.settle();
    sys.start();
    expect(order).toEqual(["zeta", "alpha", "mid"]);
    sys.destroy();
  });

  it("a module with no onStart does not stop the ones after it", async () => {
    const order: string[] = [];
    const plain = createModule("plain", {
      schema: { facts: { n: t.number() }, derivations: {}, events: {} },
      init: (facts: any) => {
        facts.n = 0;
      },
    } as never);
    const sys = createSystem({
      modules: {
        first: member("first", order),
        plain,
        last: member("last", order),
      },
    } as never) as any;

    sys.start();
    expect(order).toEqual(["first", "last"]);
    await sys.settle();
    sys.destroy();
  });
});
