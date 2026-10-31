/**
 * Black-box conformance for the engine's self-wake chain cut, with
 * auto-tracked effects only (no `deps`, no `on`): an effect that dispatches
 * an event through a captured system each time it runs.
 *
 * Public API only. What a user can see:
 *
 * - The cut drops what the chain itself carried, and the derivation changes
 *   it caused. A write that is not the chain's own (made while effects ran,
 *   but from outside any effect's body) is kept and processed after the cut,
 *   in a pass that does not start the chain again.
 * - A write made while an async effect awaits is made while effects ran: it
 *   does not restart the chain's count.
 * - Only passes started by effect writes alone form a chain: a long run of
 *   ordinary writes, or a chain whose every pass also carries a write made
 *   outside the effects, is never cut.
 * - After the cut the system reports that it settled.
 * - A failing effect under "retry" is retried three times in a row, and an
 *   ordinary write gives it its retries back.
 * - stop() and start() start the chain over: a chain stopped partway and
 *   restarted gets as many runs before the cut as one that started fresh.
 *
 * The exact chain bound and warning text are not contracts; the tests find
 * the pass the cut lands on by probing, and never pin how long a chain runs.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Lets queued microtasks run; no real timers. */
async function drain(turns = 2000) {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Calls `onCut` when the chain-cut warning is printed. */
function onCutWarning(onCut: () => void) {
  return vi.spyOn(console, "warn").mockImplementation((message) => {
    if (String(message).includes("kept waking each other")) {
      onCut();
    }
  });
}

interface ChainOptions {
  /** `late` writes `b = 5`, after an await, on this run. */
  lateWriteOn?: number;
}

/**
 * `echo` keeps dispatching `bump` while n > 0. `late` is not part of the
 * chain: on one run it writes once, while the effects phase is open, from
 * outside any effect's body, like a caller would.
 */
function chain(options: ChainOptions = {}) {
  const seenB: number[] = [];
  const counts = { echo: 0, late: 0, atCutLate: -1 };
  const mod = createModule("m", {
    schema: {
      facts: { n: t.number(), b: t.number() },
      events: { bump: {} },
    },
    init: (facts) => {
      facts.n = 0;
      facts.b = 0;
    },
    events: {
      bump: (facts) => {
        facts.n = facts.n + 1;
      },
    },
    effects: {
      echo: {
        run: (facts) => {
          if (facts.n > 0) {
            counts.echo++;
            system.events.bump();
          }
        },
      },
      late: {
        run: async (facts) => {
          if (facts.n <= 0) {
            return;
          }
          counts.late++;
          const run = counts.late;
          await Promise.resolve();
          if (run === options.lateWriteOn) {
            system.facts.b = 5;
          }
        },
      },
      watchB: {
        run: (facts) => {
          seenB.push(facts.b);
        },
      },
    },
  });
  const system = createSystem({ module: mod });

  return { system, seenB, counts };
}

/** Starts the system, then the chain. */
async function runChain(c: ReturnType<typeof chain>) {
  await c.system.start();
  await c.system.settle();
  c.system.events.bump();
  await c.system.settle();
  await tick();
}

/**
 * Where the cut lands, by run counts, on a chain with no extra writes, and
 * the `n` the chain ends on.
 */
async function probeCut() {
  const probe = chain();
  onCutWarning(() => {
    probe.counts.atCutLate = probe.counts.late;
  });
  await runChain(probe);
  const n = probe.system.facts.n;
  await probe.system.stop();
  vi.restoreAllMocks();
  expect(probe.counts.atCutLate).toBeGreaterThan(10);

  return { ...probe.counts, n };
}

describe("the cut drops only what the chain carried", () => {
  it("keeps a write that is not the chain's own", async () => {
    const probe = await probeCut();

    // Write `b` from the last `late` run before the cut, so it is carried
    // into the pass that is cut.
    const c = chain({ lateWriteOn: probe.atCutLate });
    let echoAtCut = -1;
    let seenAtCut = -1;
    onCutWarning(() => {
      echoAtCut = c.counts.echo;
      seenAtCut = c.seenB.length;
    });
    await runChain(c);

    expect(c.system.facts.b).toBe(5);
    // The kept write is processed after the cut: `watchB` runs once for it.
    expect(seenAtCut).toBeGreaterThan(0);
    expect(c.seenB.slice(seenAtCut)).toEqual([5]);
    // That pass does not start the chain again: `echo` never runs after the
    // cut, and the chain ends where it does without the write.
    expect(c.counts.echo).toBe(echoAtCut);
    expect(c.system.facts.n).toBe(probe.n);

    await c.system.stop();
  });

  it("a write made while an async effect awaits does not restart the chain's count", async () => {
    const probe = await probeCut();

    // Early in the chain: `late` writes `b` after its await, while the pass
    // still waits for it.
    const c = chain({ lateWriteOn: 5 });
    let lateAtCut = -1;
    onCutWarning(() => {
      lateAtCut = c.counts.late;
    });
    await runChain(c);

    expect(c.seenB).toContain(5);
    // The cut lands where it does without the write.
    expect(lateAtCut).toBe(probe.atCutLate);
    expect(c.system.facts.n).toBe(probe.n);

    await c.system.stop();
  });

  it("drops the derivation changes the chain carried: a later unrelated write does not replay them", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let doubleRuns = 0;
    const mod = createModule("d", {
      schema: {
        facts: { n: t.number(), x: t.number() },
        derivations: { double: t.number() },
        events: { inc: {} },
      },
      init: (facts) => {
        facts.n = 0;
        facts.x = 0;
      },
      derive: {
        double: (facts) => facts.n * 2,
      },
      events: {
        inc: (facts) => {
          facts.n = facts.n + 1;
        },
      },
      effects: {
        wake: {
          run: (facts) => {
            if (facts.n > 0) {
              sys.events.inc();
            }
          },
        },
        onDouble: {
          run: () => {
            void sys.derive.double;
            doubleRuns++;
          },
        },
        onX: {
          run: (facts) => {
            void facts.x;
          },
        },
      },
    });
    // biome-ignore lint/suspicious/noExplicitAny: effects reach the system they belong to
    const sys: any = createSystem({ module: mod });
    sys.start();
    await drain();
    sys.events.inc();
    await drain();
    expect(sys.isSettled).toBe(true);

    const before = doubleRuns;
    sys.facts.x = 1;
    await drain();

    expect(doubleRuns).toBe(before);
    sys.destroy();
  });
});

describe("what counts as a chain", () => {
  it("a long run of ordinary writes, each answered by an effect's write, is never cut", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seenM: number[] = [];
    const mod = createModule("o", {
      schema: { facts: { n: t.number(), m: t.number() } },
      init: (facts) => {
        facts.n = 0;
        facts.m = 0;
      },
      effects: {
        mirror: {
          run: (facts) => {
            const n = facts.n;
            if (n > 0) {
              sys.facts.m = n;
            }
          },
        },
        watchM: {
          run: (facts) => {
            seenM.push(facts.m);
          },
        },
      },
    });
    // biome-ignore lint/suspicious/noExplicitAny: effects reach the system they belong to
    const sys: any = createSystem({ module: mod });
    await sys.start();
    await sys.settle();

    const expected: number[] = [];
    for (let i = 1; i <= 150; i++) {
      sys.facts.n = i;
      await sys.settle();
      sys.facts.m = -i;
      await sys.settle();
      expected.push(i, -i);
    }

    expect(seenM.slice(1)).toEqual(expected);
    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes("kept waking each other"),
      ),
    ).toBe(false);
    await sys.stop();
  });

  it("a chain whose every pass also carries a write made outside the effects is never cut", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limit = 300;
    const mod = createModule("p", {
      schema: {
        facts: { n: t.number(), z: t.number() },
        events: { inc: {} },
      },
      init: (facts) => {
        facts.n = 0;
        facts.z = 0;
      },
      events: {
        inc: (facts) => {
          facts.n = facts.n + 1;
        },
      },
      effects: {
        wake: {
          run: (facts) => {
            if (facts.n > 0 && facts.n < limit) {
              sys.events.inc();
            }
          },
        },
      },
    });
    // A plugin that writes as each pass starts: outside the effects phase.
    const plugin = {
      name: "outside",
      onReconcileStart: () => {
        const n = sys.facts.n;
        if (n > 0 && n < limit) {
          sys.facts.z = n;
        }
      },
    };
    // biome-ignore lint/suspicious/noExplicitAny: effects reach the system they belong to
    const sys: any = createSystem({ module: mod, plugins: [plugin] });
    sys.start();
    await drain();
    sys.events.inc();
    await drain(5000);

    expect(sys.facts.n).toBe(limit);
    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes("kept waking each other"),
      ),
    ).toBe(false);
    sys.destroy();
  });
});

describe("after the cut", () => {
  it("onSettledChange hears that the system settled", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = createModule("s", {
      schema: { facts: { n: t.number() }, events: { inc: {} } },
      init: (facts) => {
        facts.n = 0;
      },
      events: {
        inc: (facts) => {
          facts.n = facts.n + 1;
        },
      },
      effects: {
        wake: {
          run: (facts) => {
            if (facts.n > 0) {
              sys.events.inc();
            }
          },
        },
      },
    });
    // biome-ignore lint/suspicious/noExplicitAny: effects reach the system they belong to
    const sys: any = createSystem({ module: mod });
    const heard: boolean[] = [];
    sys.onSettledChange(() => {
      heard.push(sys.isSettled);
    });
    sys.start();
    await drain();
    sys.events.inc();
    await drain();

    expect(sys.isSettled).toBe(true);
    expect(heard.at(-1)).toBe(true);
    sys.destroy();
  });
});

describe("the retry strategy for an effect", () => {
  it("retries a failing effect three times in a row, then leaves it until its next change", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let runs = 0;
    const mod = createModule("r", {
      schema: { facts: { n: t.number() } },
      init: (facts) => {
        facts.n = 0;
      },
      effects: {
        failing: {
          run: (facts) => {
            if (facts.n === 0) {
              return;
            }
            runs++;
            throw new Error("always fails");
          },
        },
      },
    });
    const system = createSystem({
      module: mod,
      errorBoundary: { onEffectError: "retry" },
    });
    await system.start();
    await system.settle();
    await tick();

    system.facts.n = 1;
    await system.settle();
    await tick();

    expect(runs).toBe(4);
    await system.stop();
  });

  it("an ordinary write gives a failing effect its retries back", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let runs = 0;
    const mod = createModule("r", {
      schema: { facts: { n: t.number() } },
      init: (facts) => {
        facts.n = 0;
      },
      effects: {
        failing: {
          run: (facts) => {
            if (facts.n === 0) {
              return;
            }
            runs++;
            throw new Error("always fails");
          },
        },
      },
    });
    const system = createSystem({
      module: mod,
      errorBoundary: { onEffectError: "retry" },
    });
    await system.start();
    await system.settle();
    await tick();

    system.facts.n = 1;
    await system.settle();
    await tick();
    const first = runs;
    expect(first).toBeGreaterThan(1);

    system.facts.n = 2;
    await system.settle();
    await tick();

    expect(runs - first).toBe(first);
    await system.stop();
  });
});

describe("stop() and start() start the chain over", () => {
  /**
   * `echo` keeps dispatching `bump` while n > 0, and stops the system, from
   * inside its own run, when n reaches `stopAt`. `cutAt` is the number of
   * `echo` runs when the chain-cut warning was printed.
   */
  function echoSystem(stopAt: number | null) {
    const counts = { echo: 0, cutAt: -1 };
    const mod = createModule("m", {
      schema: { facts: { n: t.number() }, events: { bump: {} } },
      init: (facts) => {
        facts.n = 0;
      },
      events: {
        bump: (facts) => {
          facts.n = facts.n + 1;
        },
      },
      effects: {
        echo: {
          run: (facts) => {
            if (facts.n > 0 && counts.cutAt < 0) {
              counts.echo++;
              if (facts.n === stopAt) {
                system.stop();
              }
              system.events.bump();
            }
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    onCutWarning(() => {
      counts.cutAt = counts.echo;
    });

    return { system, counts };
  }

  it("counts the chain from zero again, so a restart gets the same length as a fresh start", async () => {
    // A chain that is never interrupted: how many `echo` runs it gets.
    const fresh = echoSystem(null);
    fresh.system.start();
    fresh.system.events.bump();
    for (let i = 0; i < 40 && fresh.counts.cutAt < 0; i++) {
      await tick();
    }
    const freshRuns = fresh.counts.cutAt;
    expect(freshRuns).toBeGreaterThan(20);
    fresh.system.destroy();
    vi.restoreAllMocks();

    // The same chain, stopped from inside `echo` partway along.
    const stopAt = Math.floor(freshRuns / 2);
    const c = echoSystem(stopAt);
    c.system.start();
    c.system.events.bump();
    for (let i = 0; i < 20 && c.system.isRunning; i++) {
      await tick();
    }
    expect(c.system.isRunning).toBe(false);
    expect(c.counts.cutAt).toBe(-1);
    const before = c.counts.echo;
    expect(before).toBe(stopAt);

    c.system.start();
    for (let i = 0; i < 40 && c.counts.cutAt < 0; i++) {
      await tick();
    }

    // The restarted chain is cut: it is not left running for ever ...
    expect(c.counts.cutAt).toBeGreaterThan(-1);
    // ... and it gets as many runs as a chain that started fresh, not what
    // was left of the one that was stopped.
    expect(c.counts.cutAt - before).toBe(freshRuns);
    c.system.destroy();
  });
});
