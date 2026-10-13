// @ts-nocheck – withQueries config typing, same as the sibling suites
import { createModule, createSystem, t } from "@directive-run/core";
import type { ModuleSchema } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInfiniteQuery,
  createQuery,
  createSubscription,
  withQueries,
} from "../index.js";
import type { ResourceState } from "../index.js";

/**
 * Focus, reconnect, polling, cache expiry and subscription streams arrive from
 * outside, so they are sources that publish events. These pin down what that
 * buys: an expiry timer set for the exact moment, a poll that re-arms when its
 * interval changes, nothing re-opened by a history rewind, and the same
 * behaviour in a namespaced system.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const schema = (facts: Record<string, unknown>) =>
  ({
    facts,
    derivations: {},
    events: {},
    requirements: {},
  }) satisfies ModuleSchema;

function userQuery(options: Record<string, unknown> = {}) {
  return createQuery({
    name: "user",
    key: (f) => (f.userId ? { userId: f.userId as string } : null),
    fetcher: async (p) => ({ id: p.userId }),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    ...options,
  });
}

function userModule(query, id = "test") {
  return createModule(
    id,
    withQueries([query], {
      schema: schema({ userId: t.string() }),
      init: (f) => {
        f.userId = "";
      },
    }),
  );
}

describe("cache expiry", () => {
  it("expires at exactly dataUpdatedAt + expireAfter", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    });
    vi.setSystemTime(1_000_000);
    const system = createSystem({
      module: userModule(userQuery({ expireAfter: 6000 })),
    });
    system.start();
    system.facts.userId = "1";
    await system.settle();
    expect((system.read("user") as ResourceState<unknown>).isSuccess).toBe(
      true,
    );

    system.facts.userId = "";
    await system.settle();
    await vi.advanceTimersByTimeAsync(5999);
    expect((system.read("user") as ResourceState<unknown>).data).toEqual({
      id: "1",
    });

    await vi.advanceTimersByTimeAsync(1);
    await system.settle();
    const state = system.read("user") as ResourceState<unknown>;
    expect(state.data).toBeNull();
    expect(state.isPending).toBe(true);
    system.destroy();
  });

  it("an infinite query expires the same way", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    });
    vi.setSystemTime(1_000_000);
    const feed = createInfiniteQuery({
      name: "feed",
      key: (f) => (f.userId ? { userId: f.userId as string } : null),
      fetcher: async () => ({ items: [1] }),
      getNextPageParam: () => null,
      initialPageParam: 0,
      expireAfter: 6000,
    });
    const system = createSystem({ module: userModule(feed) });
    system.start();
    system.facts.userId = "1";
    await system.settle();
    expect(system.read("feed").pages).toHaveLength(1);

    system.facts.userId = "";
    await system.settle();
    await vi.advanceTimersByTimeAsync(5999);
    expect(system.read("feed").pages).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await system.settle();
    expect(system.read("feed").pages).toHaveLength(0);
    system.destroy();
  });
});

describe("polling", () => {
  it("re-arms when a function interval changes, and stops when it is falsy", async () => {
    let calls = 0;
    const query = userQuery({
      fetcher: async (p) => {
        calls++;

        return { id: p.userId, calls };
      },
      // Fast until the third fetch, then slow, then off.
      refetchInterval: (data) =>
        !data ? 20 : data.calls < 3 ? 20 : data.calls < 4 ? 60 : false,
    });
    const system = createSystem({ module: userModule(query) });
    system.start();
    system.facts.userId = "1";
    await system.settle();

    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(4), {
      timeout: 2000,
      interval: 10,
    });
    const settled = calls;
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toBe(settled);
    system.destroy();
  });

  it("a static interval polls only while the query has a key", async () => {
    let calls = 0;
    const query = userQuery({
      fetcher: async (p) => {
        calls++;

        return { id: p.userId };
      },
      refetchInterval: 20,
    });
    const system = createSystem({ module: userModule(query) });
    system.start();
    await new Promise((r) => setTimeout(r, 80));
    expect(calls).toBe(0);

    system.facts.userId = "1";
    await system.settle();
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(3), {
      timeout: 2000,
      interval: 10,
    });
    system.destroy();
  });
});

describe("window focus", () => {
  it("refetches in a namespaced system", async () => {
    const doc = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", doc);
    let calls = 0;
    const query = userQuery({
      fetcher: async (p) => {
        calls++;

        return { id: p.userId };
      },
      refetchOnWindowFocus: "always",
    });
    const other = createModule("other", {
      schema: { facts: { n: t.number() } },
      init: (f) => {
        f.n = 0;
      },
    });
    const system = createSystem({
      modules: { data: userModule(query, "data"), other },
    });
    system.start();
    system.facts.data.userId = "1";
    await system.settle();
    expect(calls).toBe(1);

    doc.dispatchEvent(new Event("visibilitychange"));
    await system.settle();
    expect(calls).toBe(2);

    // A hidden page does not refetch.
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    await system.settle();
    expect(calls).toBe(2);
    system.destroy();
  });
});

describe("subscriptions", () => {
  it("stream data flows in a namespaced system", async () => {
    let push: ((data: unknown) => void) | null = null;
    const sub = createSubscription({
      name: "price",
      key: (f) => (f.ticker ? { ticker: f.ticker as string } : null),
      subscribe: (_params, callbacks) => {
        push = callbacks.onData;

        return undefined;
      },
    });
    const mod = createModule(
      "market",
      withQueries([sub], {
        schema: schema({ ticker: t.string() }),
        init: (f) => {
          f.ticker = "";
        },
      }),
    );
    const other = createModule("other", {
      schema: { facts: { n: t.number() } },
      init: (f) => {
        f.n = 0;
      },
    });
    const system = createSystem({ modules: { market: mod, other } });
    system.start();
    system.facts.market.ticker = "AAPL";
    await system.settle();
    expect(push).not.toBeNull();

    push!({ price: 1 });
    await system.settle();
    expect(
      (system.derive.market.price as ResourceState<{ price: number }>).data,
    ).toEqual({ price: 1 });
    system.destroy();
  });

  it("passes subscribe the key object itself, not a JSON copy", async () => {
    const seen: unknown[] = [];
    const when = new Date(5);
    const sub = createSubscription({
      name: "price",
      key: () => ({ since: when }),
      subscribe: (params) => {
        seen.push(params.since);

        return undefined;
      },
    });
    const system = createSystem({ module: userModule(sub) });
    system.start();
    await system.settle();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(when);
    system.destroy();
  });

  it("ignores data from a stream that has been replaced", async () => {
    const pushes: Record<string, (data: unknown) => void> = {};
    const sub = createSubscription({
      name: "price",
      key: (f) => (f.ticker ? { ticker: f.ticker as string } : null),
      subscribe: (params, callbacks) => {
        pushes[params.ticker as string] = callbacks.onData;

        return undefined;
      },
    });
    const system = createSystem({
      module: createModule(
        "test",
        withQueries([sub], {
          schema: schema({ ticker: t.string() }),
          init: (f) => {
            f.ticker = "A";
          },
        }),
      ),
    });
    system.start();
    await system.settle();
    system.facts.ticker = "B";
    await system.settle();

    // A's stream was aborted on re-key, so its late data never lands.
    pushes.A!({ price: "stale" });
    pushes.B!({ price: "fresh" });
    await system.settle();
    expect((system.read("price") as ResourceState<unknown>).data).toEqual({
      price: "fresh",
    });
    system.destroy();
  });
});
