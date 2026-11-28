/**
 * `settle()` across a destroy in the same tick as a write.
 *
 * 1.35's reconcile microtask always clears its scheduled flag, so a system
 * destroyed in the tick of a write is settled: `settle()` resolves at once.
 * Not pinned: `isSettled` read synchronously right after `destroy()` (1.35
 * false for one microtask, 2.0 true); it is read after a microtask here.
 */
import { afterEach, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

type Any = any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** `p`'s outcome, or "pending" if it has none within 300 ms. */
const outcome = (p: Promise<unknown>) =>
  Promise.race([
    p.then(
      () => "resolved",
      (e) => `rejected: ${String(e?.message)}`,
    ),
    sleep(300).then(() => "pending"),
  ]);

afterEach(() => {
  vi.restoreAllMocks();
});

function quiet() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

function plain() {
  const system = createSystem({
    module: createModule("c", {
      schema: { facts: { n: t.number() } },
      init: (f: Any) => {
        f.n = 1;
      },
    } as never),
  } as never) as Any;
  system.start();

  return system;
}

function slow() {
  const system = createSystem({
    module: createModule("c", {
      schema: {
        facts: { n: t.number(), label: t.string() },
        requirements: { SLOW: {} },
      },
      init: (f: Any) => {
        f.n = 1;
        f.label = "a";
      },
      constraints: {
        s: {
          when: (f: Any) => f.label === "slow",
          require: { type: "SLOW" },
        },
      },
      resolvers: {
        slow: {
          requirement: "SLOW",
          resolve: async (_r: Any, c: Any) => {
            await sleep(150);
            c.facts.label = "done";
          },
        },
      },
    } as never),
  } as never) as Any;
  system.start();

  return system;
}

it("write, settle, destroy in one tick: settle resolves", async () => {
  quiet();
  const system = plain();
  await sleep(5);
  system.facts.n = 2;
  const settled = system.settle();
  system.destroy();
  expect(await outcome(settled)).toBe("resolved");
  await Promise.resolve();
  expect(system.isSettled).toBe(true);
});

it("write, destroy, then settle: settle resolves", async () => {
  quiet();
  const system = plain();
  await sleep(5);
  system.facts.n = 2;
  system.destroy();
  expect(await outcome(system.settle())).toBe("resolved");
});

it("a resolver in flight, a write, settle, destroy in one tick: settle resolves", async () => {
  quiet();
  const system = slow();
  system.facts.label = "slow";
  await sleep(10);
  expect(system.inspect().inflight.length).toBe(1);
  system.facts.n = 9;
  const settled = system.settle();
  system.destroy();
  expect(await outcome(settled)).toBe("resolved");
});
