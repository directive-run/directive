import { expect, it, vi } from "vitest";

// S2 in production: a runaway an observer's own write raises still stops the
// batch and is not logged as the observer's throw. The rethrow does not hang
// on the development flag.
vi.mock("#is-development", () => ({ default: false }));

const { createModule } = await import("../api/core.js");
const { t } = await import("../api/schema-builders.js");
const { createSystem } = await import("../api/system.js");

it("production: a batch stops at an observer whose own write runs away", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const system = createSystem({
    module: createModule("m", {
      schema: { facts: { n: t.number(), m1: t.number(), m2: t.number() } },
      init: (facts) => {
        facts.n = 0;
        facts.m1 = 0;
        facts.m2 = 0;
      },
    }),
  });
  system.start();
  let armed = false;
  system.subscribe(["n"], () => {
    if (armed) {
      system.facts.n = (system.facts.n as number) + 1;
    }
  });
  const delivered: string[] = [];
  system.observe((event) => {
    if (event.type !== "fact.change") {
      return;
    }
    delivered.push(event.key as string);
    if (event.key === "m1") {
      armed = true;
      system.facts.n = 1000;
    }
  });
  system.batch(() => {
    system.facts.m1 = 1;
    system.facts.m2 = 1;
  });
  armed = false;
  expect(delivered.filter((key) => key !== "n")).toEqual(["m1"]);
  expect(
    error.mock.calls.some((call) => String(call[0]).includes("Observer threw")),
  ).toBe(false);
  system.destroy();
  error.mockRestore();
});
