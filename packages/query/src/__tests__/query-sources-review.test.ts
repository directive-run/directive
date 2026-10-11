// @ts-nocheck – withQueries config typing, same as the sibling suites
import { createModule, createSystem, t } from "@directive-run/core";
import type { ModuleSchema } from "@directive-run/core";
import { describe, expect, it } from "vitest";
import { createQuery, createSubscription, withQueries } from "../index.js";
import type { ResourceState } from "../index.js";

const schema = (facts: Record<string, unknown>) =>
  ({
    facts,
    derivations: {},
    events: {},
    requirements: {},
  }) satisfies ModuleSchema;

class Money {
  constructor(public amount: number) {}
}

describe("subscriptions", () => {
  it("opens when the key reads a fact holding a class instance", async () => {
    let opened = 0;
    const sub = createSubscription({
      name: "price",
      key: (f) => (f.filter?.ticker ? { ticker: f.filter.ticker } : null),
      subscribe: () => {
        opened++;

        return undefined;
      },
    });
    const system = createSystem({
      module: createModule(
        "test",
        withQueries([sub], {
          schema: schema({ filter: t.object<any>() }),
          init: (f) => {
            f.filter = { ticker: "A", min: new Money(5) };
          },
        }),
      ),
    });
    system.start();
    await system.settle();

    expect(opened).toBe(1);
    system.destroy();
  });

  it("goes idle when enabled() turns false", async () => {
    let push: ((data: unknown) => void) | null = null;
    const sub = createSubscription({
      name: "price",
      key: () => ({ ticker: "A" }),
      enabled: (f) => f.on === true,
      subscribe: (_params, callbacks) => {
        push = callbacks.onData;

        return undefined;
      },
    });
    const system = createSystem({
      module: createModule(
        "test",
        withQueries([sub], {
          schema: schema({ on: t.boolean() }),
          init: (f) => {
            f.on = true;
          },
        }),
      ),
    });
    system.start();
    await system.settle();
    push!({ price: 1 });
    await system.settle();
    expect((system.read("price") as ResourceState<unknown>).isSuccess).toBe(
      true,
    );

    system.facts.on = false;
    await system.settle();
    const state = system.read("price") as ResourceState<unknown>;
    expect(state.status).toBe("pending");
    expect(state.isFetching).toBe(false);
    expect(state.isSuccess).toBe(false);
    expect(state.data).toBeNull();
    system.destroy();
  });

  it("two systems from one definition each get their own key object", async () => {
    const seen: unknown[] = [];
    const sub = createSubscription({
      name: "price",
      key: (f) => ({ since: f.since }),
      subscribe: (params) => {
        seen.push(params.since);

        return undefined;
      },
    });
    const mod = (since: Date) =>
      createModule(
        "test",
        withQueries([sub], {
          schema: schema({ since: t.object<Date>() }),
          init: (f) => {
            f.since = since;
          },
        }),
      );
    const a = new Date(5);
    const b = new Date(5);
    const first = createSystem({ module: mod(a) });
    const second = createSystem({ module: mod(b) });
    first.start();
    second.start();
    await first.settle();
    await second.settle();

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(a);
    expect(seen[1]).toBe(b);
    first.destroy();
    second.destroy();
  });
});

describe("cost with large data", () => {
  it("an unrelated write stays cheap with 10k rows cached", async () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({ id: i, v: i }));
    const query = createQuery({
      name: "rows",
      key: (f) => (f.on ? { on: true } : null),
      fetcher: async () => rows,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchInterval: () => 60_000,
    });
    const system = createSystem({
      module: createModule(
        "test",
        withQueries([query], {
          schema: schema({ on: t.boolean(), n: t.number() }),
          init: (f) => {
            f.on = true;
            f.n = 0;
          },
        }),
      ),
    });
    system.start();
    await system.settle();
    expect((system.read("rows") as ResourceState<unknown[]>).data).toHaveLength(
      10_000,
    );

    const writes = 50;
    const started = performance.now();
    for (let i = 1; i <= writes; i++) {
      system.facts.n = i;
      await system.settle();
    }
    const perWrite = (performance.now() - started) / writes;
    // Measured ~0.03ms; 0.5ms is the budget for development.
    expect(perWrite).toBeLessThan(0.5);
    system.destroy();
  });
});
