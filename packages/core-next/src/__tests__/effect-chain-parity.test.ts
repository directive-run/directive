/**
 * L0 parity with 1.35 for the effect self-wake chain cut (see
 * packages/core/src/core/engine.ts): the effects phase stays open while a pass
 * awaits its async effects, so a write made then does not restart the chain,
 * and a write the cut keeps is processed in a pass that does not start the
 * chain again. The same cases are pinned for both engines by the conformance
 * test l3-engine-oracle-effect-chain.test.ts.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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

describe("the effect chain cut, as 1.35 does it", () => {
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
});
