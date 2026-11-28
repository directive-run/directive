/**
 * L3: `settle()` across a `destroy()` in the same tick as a write. The write,
 * the `settle()` and the `destroy()` are one `run` step, because the driver
 * flushes after every step. 1.35 clears its scheduled flag in the reconcile
 * microtask whatever happened to the system, so the promise resolves; 2.0
 * once dropped that flush and waited out its five-second timeout. `isSettled`
 * is read after a microtask, not right after `destroy()` (1.35 false for one
 * microtask, 2.0 true: a known difference).
 */

import { scenario, suite } from "../scenario.js";

suite("L3 settle after destroy", () => {
  scenario(
    "settle() resolves when a write and a destroy share a tick",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: {
          facts: { n: t.number() },
          derivations: {},
          events: {},
          requirements: {},
        },
        init: (facts: any) => {
          facts.n = 1;
        },
      }),
    }),
    [
      { op: "start" },
      { op: "settle" },
      {
        op: "run",
        label: "write, settle, destroy in one tick",
        fn: async (system, { external }) => {
          system.facts.n = 2;
          const settled = system.settle();
          system.destroy();
          await settled;
          external(["settle resolved"]);
          await Promise.resolve();
          external(["isSettled after a microtask", system.isSettled]);
        },
      },
    ],
  );
});
