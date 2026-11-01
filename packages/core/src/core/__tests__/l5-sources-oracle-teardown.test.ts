import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box rewrites of the async-teardown and `evictAll` cases in
// `sources.test.ts` (WHITE-BOX.md maps each one): `stopAsync()` and
// `evict()` await a source's async work, each capped by its timeout, and a
// failure in one source never stops the others. Public API only; a timeout
// error's message is asserted where the original did (it says "timeout", or
// the source's own `12000ms`).

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A plugin that records each source error as [id, phase], and its message. */
function errorLog() {
  const errors: string[][] = [];
  const messages: string[] = [];
  const plugin = {
    name: "source-errors",
    onSourceError: (
      id: string,
      _moduleId: string,
      phase: string,
      error: unknown,
    ) => {
      errors.push([id, phase]);
      messages.push((error as Error)?.message ?? "");
    },
  };

  return { errors, messages, plugin };
}

function sourceModule(sources: Record<string, unknown>) {
  return createModule("m", {
    schema: {
      facts: { open: t.boolean() },
      derivations: {},
      events: {},
    },
    init: (facts: any) => {
      facts.open = false;
    },
    sources,
  } as any);
}

const never = () => new Promise<void>(() => undefined);

describe("an async unsubscribe", () => {
  it("is not awaited by stop(), and is awaited by stopAsync()", async () => {
    vi.useFakeTimers();
    let finished = false;
    const system = createSystem({
      module: sourceModule({
        s: {
          attach: () => async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            finished = true;
          },
        },
      }),
    } as any);
    system.start();
    system.stop();
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(finished).toBe(true);

    finished = false;
    system.start();
    const stopping = system.stopAsync();
    await vi.advanceTimersByTimeAsync(20);
    await stopping;
    expect(finished).toBe(true);
    system.destroy();
  });

  it("that hangs is given up on by stopAsync() as a cleanup error, and the next source still unsubscribes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    const { errors, messages, plugin } = errorLog();
    let cleaned = false;
    const system = createSystem({
      module: sourceModule({
        hung: { attach: () => never },
        clean: {
          attach: () => () => {
            cleaned = true;
          },
        },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    const stopping = system.stopAsync();
    await vi.advanceTimersByTimeAsync(6_000);
    await stopping;
    expect(errors).toEqual([["hung", "cleanup"]]);
    expect(messages[0]).toContain("timeout");
    expect(cleaned).toBe(true);
    system.destroy();
  });

  it("is waited on for its own evictTimeoutMs, when that is longer than the default", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    const { errors, messages, plugin } = errorLog();
    const system = createSystem({
      module: sourceModule({
        slow: { evictTimeoutMs: 12_000, attach: () => never },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    const stopping = system.stopAsync();
    await vi.advanceTimersByTimeAsync(7_000);
    expect(errors).toEqual([]);
    await vi.advanceTimersByTimeAsync(6_000);
    await stopping;
    expect(errors).toEqual([["slow", "cleanup"]]);
    expect(messages[0]).toContain("12000ms");
    system.destroy();
  });
});

describe("evict()", () => {
  it("runs each source's onEvict in order, and a throwing one is a runtime error that stops none of the others", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    const { errors, plugin } = errorLog();
    const order: string[] = [];
    const system = createSystem({
      module: sourceModule({
        first: {
          attach: () => () => undefined,
          onEvict: async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            order.push("first");
          },
        },
        bad: {
          attach: () => () => undefined,
          onEvict: () => {
            order.push("bad");
            throw new Error("eviction failed");
          },
        },
        last: {
          attach: () => () => undefined,
          onEvict: () => {
            order.push("last");
          },
        },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    const evicting = system.evict();
    await vi.advanceTimersByTimeAsync(10);
    await evicting;
    expect(order).toEqual(["first", "bad", "last"]);
    expect(errors).toEqual([["bad", "runtime"]]);
  });

  it("gives up on an onEvict that hangs as a runtime error, and still evicts the next source", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    const { errors, messages, plugin } = errorLog();
    let evicted = false;
    const system = createSystem({
      module: sourceModule({
        hung: { attach: () => () => undefined, onEvict: never },
        last: {
          attach: () => () => undefined,
          onEvict: () => {
            evicted = true;
          },
        },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    const evicting = system.evict();
    await vi.advanceTimersByTimeAsync(6_000);
    await evicting;
    expect(errors).toEqual([["hung", "runtime"]]);
    expect(messages[0]).toContain("timeout");
    expect(evicted).toBe(true);
  });

  it("waits on an onEvict for its own evictTimeoutMs, when that is longer than the default", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    const { errors, messages, plugin } = errorLog();
    const system = createSystem({
      module: sourceModule({
        slow: {
          evictTimeoutMs: 12_000,
          attach: () => () => undefined,
          onEvict: never,
        },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    const evicting = system.evict();
    await vi.advanceTimersByTimeAsync(7_000);
    expect(errors).toEqual([]);
    await vi.advanceTimersByTimeAsync(6_000);
    await evicting;
    expect(errors).toEqual([["slow", "runtime"]]);
    expect(messages[0]).toContain("12000ms");
  });

  it("with evictTimeoutMs Infinity reports no error for an onEvict that finishes", async () => {
    const { errors, plugin } = errorLog();
    const system = createSystem({
      module: sourceModule({
        unbounded: {
          evictTimeoutMs: Number.POSITIVE_INFINITY,
          attach: () => () => undefined,
          onEvict: () => Promise.resolve(),
        },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    await system.evict();
    expect(errors).toEqual([]);
  });

  it("with no onEvict on the source resolves, and unsubscribes it once", async () => {
    let unsubscribed = 0;
    const system = createSystem({
      module: sourceModule({
        plain: {
          attach: () => () => {
            unsubscribed += 1;
          },
        },
      }),
    } as any);
    system.start();
    await expect(system.evict()).resolves.toBeUndefined();
    expect(unsubscribed).toBe(1);
  });

  it("skips a gated source whose gate never opened, or opened and closed again", async () => {
    const run = async (writes: boolean[]) => {
      const onEvict = vi.fn();
      const system = createSystem({
        module: sourceModule({
          s: {
            active: (facts: any) => facts.open === true,
            attach: () => () => undefined,
            onEvict,
          },
        }),
      } as any);
      system.start();
      for (const open of writes) {
        (system.facts as any).open = open;
        await system.settle();
      }
      await system.evict();

      return onEvict.mock.calls.length;
    };
    expect(await run([])).toBe(0);
    expect(await run([true, false])).toBe(0);
    expect(await run([true])).toBe(1);
  });
});
