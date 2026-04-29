import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { flushAsync, flushMicrotasks } from "../testing.js";

describe("flushMicrotasks", () => {
  it("drains a single Promise.resolve() chain", async () => {
    let count = 0;
    Promise.resolve()
      .then(() => {
        count++;
      })
      .then(() => {
        count++;
      });

    await flushMicrotasks();

    expect(count).toBe(2);
  });

  it("does not advance setTimeout(0) macrotasks", async () => {
    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 0);

    await flushMicrotasks();

    // setTimeout(0) is a macrotask — flushMicrotasks alone does not run it
    expect(timerFired).toBe(false);

    // Cleanup: actually wait for the timer so it doesn't leak across tests
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("flushAsync", () => {
  it("drains a Promise.resolve() chain", async () => {
    let count = 0;
    Promise.resolve()
      .then(() => {
        count++;
      })
      .then(() => {
        count++;
      });

    await flushAsync();

    expect(count).toBe(2);
  });

  it("drains setTimeout(0) macrotasks", async () => {
    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 0);

    await flushAsync();

    expect(timerFired).toBe(true);
  });

  it("drains chained microtask + macrotask pipelines", async () => {
    const order: string[] = [];

    Promise.resolve().then(() => {
      order.push("microtask-1");
      setTimeout(() => {
        order.push("macrotask-1");
        Promise.resolve().then(() => {
          order.push("microtask-after-macrotask");
        });
      }, 0);
    });

    await flushAsync();

    expect(order).toEqual([
      "microtask-1",
      "macrotask-1",
      "microtask-after-macrotask",
    ]);
  });

  it("drains a constraint -> resolver pipeline in a real system", async () => {
    const mod = createModule("flush-async-test", {
      schema: {
        facts: { count: t.number(), result: t.string() },
        derivations: {},
        events: {},
        requirements: { COMPUTE: { input: t.number() } },
      },
      init: (f) => {
        f.count = 0;
        f.result = "";
      },
      constraints: {
        compute: {
          when: (f) => f.count > 0 && f.result === "",
          require: (f) => ({ type: "COMPUTE", input: f.count }),
        },
      },
      resolvers: {
        compute: {
          requirement: "COMPUTE",
          // Async resolver simulating an I/O step
          resolve: async (req, ctx) => {
            await Promise.resolve();
            await new Promise((r) => setTimeout(r, 0));
            ctx.facts.result = `computed:${req.input}`;
          },
        },
      },
    });

    const sys = createSystem({ module: mod });
    sys.start();

    sys.facts.count = 5;

    await flushAsync();

    expect(sys.facts.result).toBe("computed:5");

    sys.destroy();
  });

  it("handles deeply chained Promise.then with intermediate setTimeouts", async () => {
    let final: number | null = null;

    Promise.resolve()
      .then(() => 1)
      .then((v) => v + 1)
      .then(
        (v) =>
          new Promise<number>((resolve) => {
            setTimeout(() => {
              resolve(v + 1);
            }, 0);
          }),
      )
      .then((v) => {
        final = v;
      });

    await flushAsync();

    expect(final).toBe(3);
  });
});
