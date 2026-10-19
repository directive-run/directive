// Ported from packages/core/src/core/__tests__/blackbox-facts.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import type { ObservationEvent } from "@directive-run/core";
import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box tests for the fact store: everything here goes through
// createModule / createSystem and the `system.facts` proxy (including its
// public `$store` / `$snapshot` accessors). Development mode, where schema
// validation and the nested-mutation warnings live.

// biome-ignore lint/suspicious/noExplicitAny: facts are driven dynamically on purpose
type Any = any;

async function start(
  facts: Record<string, unknown>,
  init?: (facts: Any) => void,
  extra: Record<string, unknown> = {},
) {
  const mod = createModule("m", {
    schema: { facts: facts as Any },
    init: init ?? (() => {}),
  });
  const system = createSystem({ module: mod, ...extra } as Any) as Any;
  await system.start();

  return system;
}

function caught(fn: () => void): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the call to throw");
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Basic reads, writes, delete
// ---------------------------------------------------------------------------

describe("facts: reads, writes and delete", () => {
  it("reads back what was written and reports presence", async () => {
    const system = await start({ n: t.number() });

    expect("n" in system.facts).toBe(false);
    expect(system.facts.n).toBeUndefined();

    system.facts.n = 3;

    expect("n" in system.facts).toBe(true);
    expect(system.facts.n).toBe(3);
    expect(system.facts.$snapshot().get("n")).toBe(3);
    expect(system.facts.$snapshot().has("n")).toBe(true);
    await system.stop();
  });

  it("removes a fact completely on delete", async () => {
    const system = await start({ n: t.number() }, (f) => {
      f.n = 1;
    });

    delete system.facts.n;

    expect(system.facts.n).toBeUndefined();
    expect("n" in system.facts).toBe(false);
    expect(system.facts.$snapshot().has("n")).toBe(false);
    expect(system.facts.$store.has("n")).toBe(false);
    expect(Object.keys(system.facts.$store.toObject())).not.toContain("n");
    await system.stop();
  });

  it("serialises only the facts that currently hold a value", async () => {
    const system = await start(
      { a: t.number(), b: t.string(), c: t.number() },
      (f) => {
        f.a = 1;
        f.b = "x";
      },
    );

    expect(system.facts.$store.toObject()).toEqual({ a: 1, b: "x" });

    delete system.facts.a;
    expect(system.facts.$store.toObject()).toEqual({ b: "x" });
    await system.stop();
  });

  it("does not notify when a write leaves the value unchanged", async () => {
    const system = await start({ n: t.number() }, (f) => {
      f.n = 1;
    });
    const key = vi.fn();
    const all = vi.fn();
    system.subscribe(["n"], key);
    system.facts.$store.subscribeAll(all);

    system.facts.n = 1;

    expect(key).not.toHaveBeenCalled();
    expect(all).not.toHaveBeenCalled();

    system.facts.n = 2;

    expect(key).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledTimes(1);
    await system.stop();
  });

  it("treats NaN written over NaN as no change", async () => {
    const system = await start({ n: t.number() }, (f) => {
      f.n = Number.NaN;
    });
    const key = vi.fn();
    system.subscribe(["n"], key);

    system.facts.n = Number.NaN;

    expect(key).not.toHaveBeenCalled();
    await system.stop();
  });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

describe("facts: notifications", () => {
  it("notifies every subscriber of a key, not just the last one", async () => {
    const system = await start({ n: t.number() });
    const a = vi.fn();
    const b = vi.fn();
    system.subscribe(["n"], a);
    system.subscribe(["n"], b);

    system.facts.n = 1;

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    await system.stop();
  });

  it("keeps the remaining subscribers when one of two unsubscribes", async () => {
    const system = await start({ n: t.number() });
    const a = vi.fn();
    const b = vi.fn();
    const offA = system.subscribe(["n"], a);
    system.subscribe(["n"], b);

    offA();
    system.facts.n = 1;

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    await system.stop();
  });

  it("tolerates unsubscribing twice", async () => {
    const system = await start({ n: t.number() });
    const a = vi.fn();
    const off = system.subscribe(["n"], a);

    off();

    expect(() => off()).not.toThrow();
    system.facts.n = 1;
    expect(a).not.toHaveBeenCalled();
    await system.stop();
  });

  it("stops a catch-all subscriber when it unsubscribes", async () => {
    const system = await start({ n: t.number() });
    const all = vi.fn();
    const off = system.facts.$store.subscribeAll(all);

    system.facts.n = 1;
    expect(all).toHaveBeenCalledTimes(1);

    off();
    system.facts.n = 2;

    expect(all).toHaveBeenCalledTimes(1);
    await system.stop();
  });

  it("lets a subscriber to several keys leave all of them at once", async () => {
    const system = await start({ a: t.number(), b: t.number() });
    const fn = vi.fn();
    const off = system.subscribe(["a", "b"], fn);

    system.facts.a = 1;
    system.facts.b = 1;
    expect(fn).toHaveBeenCalledTimes(2);

    off();
    system.facts.a = 2;
    system.facts.b = 2;

    expect(fn).toHaveBeenCalledTimes(2);
    await system.stop();
  });

  it("notifies only the key that changed", async () => {
    const system = await start({ a: t.number(), b: t.number() });
    const a = vi.fn();
    const b = vi.fn();
    system.subscribe(["a"], a);
    system.subscribe(["b"], b);

    system.facts.a = 1;

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    await system.stop();
  });

  it("notifies on delete, once", async () => {
    const system = await start({ n: t.number() }, (f) => {
      f.n = 1;
    });
    const key = vi.fn();
    system.subscribe(["n"], key);

    delete system.facts.n;

    expect(key).toHaveBeenCalledTimes(1);
    await system.stop();
  });

  it("emits exactly one fact.change per write, and nothing for an unrelated key", async () => {
    const system = await start({ n: t.number() });
    const events: ObservationEvent[] = [];
    system.observe((e: ObservationEvent) => events.push(e));

    system.facts.n = 5;

    const changes = events.filter((e) => e.type === "fact.change");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ key: "n", prev: undefined, next: 5 });
    await system.stop();
  });

  it("tells a plugin about each write once, with the key it wrote", async () => {
    const seen: Array<[string, unknown, unknown]> = [];
    const system = await start({ n: t.number() }, undefined, {
      plugins: [
        {
          name: "spy",
          onFactSet: (k: string, v: unknown, p: unknown) => {
            seen.push([k, v, p]);
          },
        },
      ],
    });

    system.facts.n = 1;
    system.facts.n = 2;

    expect(seen).toEqual([
      ["n", 1, undefined],
      ["n", 2, 1],
    ]);
    await system.stop();
  });

  it("completes a re-entrant chain of at least a hundred follow-up writes", async () => {
    const system = await start({ n: t.number() }, (f) => {
      f.n = 0;
    });
    const store = system.facts.$store;
    store.subscribe(["n"], () => {
      const n = store.get("n") as number;
      if (n < 101) {
        store.set("n", n + 1);
      }
    });

    expect(() => {
      system.facts.n = 1;
    }).not.toThrow();

    expect(system.facts.n).toBe(101);
    await system.stop();
  });

  it("defers a write made inside a listener until the current notification cycle is over", async () => {
    const system = await start({ a: t.number(), b: t.number() });
    const log: string[] = [];
    system.subscribe(["a"], () => {
      log.push("a:start");
      system.facts.b = 1;
      log.push("a:end");
    });
    system.subscribe(["b"], () => {
      log.push("b");
    });

    system.facts.a = 1;

    expect(log.indexOf("b")).toBeGreaterThan(log.indexOf("a:end"));
    expect(log.filter((e) => e === "b")).toHaveLength(1);
    await system.stop();
  });

  it("still tells catch-all subscribers about a write made from a listener", async () => {
    const system = await start({ a: t.number(), b: t.number() });
    const all = vi.fn();
    system.subscribe(["a"], () => {
      system.facts.b = 1;
    });
    system.facts.$store.subscribeAll(all);

    system.facts.a = 1;

    // the first cycle plus the deferred write
    expect(all.mock.calls.length).toBeGreaterThanOrEqual(2);
    await system.stop();
  });

  it("stops a runaway write loop rather than spinning forever", async () => {
    const system = await start({ n: t.number() }, (f) => {
      f.n = 0;
    });
    const store = system.facts.$store;
    store.subscribe(["n"], () => {
      store.set("n", (store.get("n") as number) + 1);
    });

    const error = caught(() => {
      system.facts.n = 1;
    });

    expect(error.message).toMatch(/notification loop/i);
    expect(error.message).toMatch(/listener/i);
    await system.stop();
  });

  it("does not leave the system stuck after a runaway loop was stopped", async () => {
    const system = await start({ n: t.number(), other: t.number() }, (f) => {
      f.n = 0;
      f.other = 0;
    });
    const store = system.facts.$store;
    let runaway = true;
    store.subscribe(["n"], () => {
      if (runaway) {
        store.set("n", (store.get("n") as number) + 1);
      }
    });
    expect(() => {
      system.facts.n = 1;
    }).toThrow();
    runaway = false;
    const other = vi.fn();
    system.subscribe(["other"], other);

    system.facts.other = 1;

    expect(other).toHaveBeenCalledTimes(1);
    await system.stop();
  });

  it("keeps delivering later keys when an observer throws a non-error value", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const thrown of [null, undefined, "boom", 42]) {
      const system = await start({ a: t.number(), b: t.number() });
      const delivered: string[] = [];
      system.observe((e: ObservationEvent) => {
        if (e.type !== "fact.change") {
          return;
        }
        delivered.push(e.key);
        if (e.key === "a") {
          throw thrown;
        }
      });

      expect(() =>
        system.batch(() => {
          system.facts.a = 1;
          system.facts.b = 1;
        }),
      ).not.toThrow();

      expect(delivered).toEqual(["a", "b"]);
      await system.stop();
    }
  });

  it("delivers a plain Error thrown by an observer as a logged failure, not a crash", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const system = await start({ a: t.number(), b: t.number() });
    const delivered: string[] = [];
    system.observe((e: ObservationEvent) => {
      if (e.type === "fact.change") {
        delivered.push(e.key);
        if (e.key === "a") {
          throw new Error("observer failed");
        }
      }
    });

    system.batch(() => {
      system.facts.a = 1;
      system.facts.b = 1;
    });

    expect(delivered).toEqual(["a", "b"]);
    expect(errorLog).toHaveBeenCalled();
    await system.stop();
  });
});

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

describe("facts: batching", () => {
  it("notifies once after a batch, not once per write", async () => {
    const system = await start({ a: t.number(), b: t.number() });
    const a = vi.fn();
    const all = vi.fn();
    system.subscribe(["a"], a);
    system.facts.$store.subscribeAll(all);

    system.batch(() => {
      system.facts.a = 1;
      system.facts.a = 2;
      system.facts.b = 1;
      expect(a).not.toHaveBeenCalled();
      expect(all).not.toHaveBeenCalled();
    });

    expect(a).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledTimes(1);
    await system.stop();
  });

  it("holds notifications until the outermost of nested batches ends", async () => {
    const system = await start({ a: t.number(), b: t.number() });
    const a = vi.fn();
    system.subscribe(["a"], a);

    system.batch(() => {
      system.batch(() => {
        system.facts.a = 1;
      });
      expect(a).not.toHaveBeenCalled();
      system.facts.b = 1;
    });

    expect(a).toHaveBeenCalledTimes(1);
    await system.stop();
  });

  it("tells a derivation's subscriber once, after the outermost of nested batches", async () => {
    const mod = createModule("m", {
      schema: {
        facts: { a: t.number(), b: t.number() },
        derivations: { doubled: t.number() },
      },
      init: (f) => {
        f.a = 0;
        f.b = 0;
      },
      derive: { doubled: (f) => f.a * 2 },
    });
    const system = createSystem({ module: mod }) as Any;
    await system.start();
    expect(system.derive.doubled).toBe(0);
    const heard = vi.fn();
    system.subscribe(["doubled"], heard);
    let seenInside = -1;

    system.batch(() => {
      system.batch(() => {
        system.facts.a = 2;
      });
      expect(heard).not.toHaveBeenCalled();
      seenInside = system.derive.doubled;
      system.facts.b = 1;
      expect(heard).not.toHaveBeenCalled();
    });

    expect(seenInside).toBe(4);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(system.derive.doubled).toBe(4);

    system.batch(() => {
      system.batch(() => {});
      system.facts.a = 3;
    });
    expect(heard).toHaveBeenCalledTimes(2);
    expect(system.derive.doubled).toBe(6);
    await system.stop();
  });

  it("reads its own writes immediately inside a batch", async () => {
    const system = await start({ n: t.number() });

    system.batch(() => {
      system.facts.n = 4;
      expect(system.facts.n).toBe(4);
    });
    await system.stop();
  });

  it("does not call anyone for an empty batch or one that changed nothing", async () => {
    const batches = vi.fn();
    const system = await start(
      { n: t.number() },
      (f) => {
        f.n = 1;
      },
      { plugins: [{ name: "p", onFactsBatch: batches }] },
    );
    const all = vi.fn();
    system.facts.$store.subscribeAll(all);
    system.facts.$store.subscribe(["n"], all);

    batches.mockClear();

    system.batch(() => {});
    system.batch(() => {
      system.facts.n = 1;
    });

    expect(all).not.toHaveBeenCalled();
    expect(batches).not.toHaveBeenCalled();
    await system.stop();
  });

  it("reports an empty batch to a plugin never, and a real one once with every change", async () => {
    const batches: Array<Array<{ key: string; type: string }>> = [];
    const system = await start({ a: t.number(), b: t.number() }, undefined, {
      plugins: [
        {
          name: "spy",
          onFactsBatch: (changes: Array<{ key: string; type: string }>) => {
            batches.push(changes);
          },
        },
      ],
    });

    system.batch(() => {});
    expect(batches).toHaveLength(0);

    system.batch(() => {
      system.facts.a = 1;
      system.facts.b = 2;
      delete system.facts.a;
    });

    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((c) => [c.key, c.type])).toEqual([
      ["a", "set"],
      ["b", "set"],
      ["a", "delete"],
    ]);
    await system.stop();
  });

  it("notifies a key deleted inside a batch once, after the batch", async () => {
    const system = await start({ n: t.number(), o: t.number() }, (f) => {
      f.n = 1;
    });
    const key = vi.fn();
    system.subscribe(["n"], key);

    system.batch(() => {
      delete system.facts.n;
      system.facts.o = 1;
      expect(key).not.toHaveBeenCalled();
    });

    expect(key).toHaveBeenCalledTimes(1);
    expect(system.facts.n).toBeUndefined();
    await system.stop();
  });

  it("reports a delete inside a batch with the value it removed", async () => {
    const system = await start({ n: t.number() }, (f) => {
      f.n = 9;
    });
    const events: ObservationEvent[] = [];
    system.observe((e: ObservationEvent) => events.push(e));

    system.batch(() => {
      delete system.facts.n;
    });

    const change = events.find((e) => e.type === "fact.change") as Any;
    expect(change).toMatchObject({ key: "n", prev: 9, next: undefined });
    expect(change.origin).toBe("authored");
    await system.stop();
  });

  it("lets a derivation read see a fact deleted earlier in the same batch", async () => {
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number() },
        derivations: { label: t.string() },
      },
      init: (f) => {
        f.n = 1;
      },
      derive: { label: (f) => (f.n === undefined ? "gone" : `n=${f.n}`) },
    });
    const system = createSystem({ module: mod }) as Any;
    await system.start();
    expect(system.derive.label).toBe("n=1");
    let seen = "";

    system.batch(() => {
      delete system.facts.n;
      seen = system.derive.label;
    });

    expect(seen).toBe("gone");
    await system.stop();
  });

  it("still flushes a batch whose body throws, and rethrows", async () => {
    const system = await start({ n: t.number() });
    const key = vi.fn();
    system.subscribe(["n"], key);

    expect(() =>
      system.batch(() => {
        system.facts.n = 1;
        throw new Error("body failed");
      }),
    ).toThrow("body failed");

    expect(key).toHaveBeenCalledTimes(1);
    // and the next batch behaves normally
    system.batch(() => {
      system.facts.n = 2;
    });
    expect(key).toHaveBeenCalledTimes(2);
    await system.stop();
  });

  it("defers a write made from a batch listener until the flush cycle is over", async () => {
    const system = await start({ a: t.number(), b: t.number(), c: t.number() });
    const log: string[] = [];
    system.subscribe(["a"], () => {
      log.push("a:start");
      system.facts.c = 1;
      log.push("a:end");
    });
    system.subscribe(["b"], () => {
      log.push("b");
    });
    system.subscribe(["c"], () => {
      log.push("c");
    });

    system.batch(() => {
      system.facts.a = 1;
      system.facts.b = 1;
    });

    expect(log.indexOf("c")).toBeGreaterThan(log.indexOf("a:end"));
    expect(log.indexOf("c")).toBeGreaterThan(log.indexOf("b"));
    await system.stop();
  });

  it("completes a follow-up chain started from a batch flush", async () => {
    const system = await start({ n: t.number(), m: t.number() }, (f) => {
      f.n = 0;
      f.m = 0;
    });
    const store = system.facts.$store;
    store.subscribe(["n"], () => {
      const n = store.get("n") as number;
      if (n < 20) {
        store.set("n", n + 1);
      }
    });
    const all = vi.fn();
    store.subscribeAll(all);

    system.batch(() => {
      system.facts.n = 1;
    });

    expect(system.facts.n).toBe(20);
    expect(all.mock.calls.length).toBeGreaterThanOrEqual(2);
    await system.stop();
  });

  it("stops a runaway chain started inside a batch flush", async () => {
    const system = await start({ n: t.number() }, (f) => {
      f.n = 0;
    });
    const store = system.facts.$store;
    store.subscribe(["n"], () => {
      store.set("n", (store.get("n") as number) + 1);
    });

    const error = caught(() =>
      system.batch(() => {
        system.facts.n = 1;
      }),
    );

    expect(error.message).toMatch(/notification loop/i);
    expect(error.message).toMatch(/flush/i);
    await system.stop();
  });

  it("labels what a restore wrote as restore, and the rest as authored", async () => {
    const system = await start(
      { n: t.number(), extra: t.number() },
      (f) => {
        f.n = 0;
        f.extra = 0;
      },
      { history: { maxSnapshots: 10 } },
    );
    system.facts.n = 1;
    await system.settle();
    system.facts.n = 2;
    await system.settle();
    const events: ObservationEvent[] = [];
    system.observe((e: ObservationEvent) => events.push(e));

    system.batch(() => {
      system.facts.extra = 7;
      system.history.goBack();
    });

    const changes = events.filter((e) => e.type === "fact.change") as Any[];
    expect(changes.find((c) => c.key === "n")?.origin).toBe("restore");
    expect(changes.find((c) => c.key === "extra")?.origin).toBe("authored");
    await system.stop();
  });
});

// ---------------------------------------------------------------------------
// Schema validation in development
// ---------------------------------------------------------------------------

describe("facts: schema validation (development)", () => {
  it("rejects a value of the wrong type and keeps the old value", async () => {
    const system = await start({ n: t.number() }, (f) => {
      f.n = 1;
    });

    const error = caught(() => {
      system.facts.n = "nope";
    });

    expect(error.message).toMatch(/Validation failed for "n"/);
    expect(error.message).toMatch(/expected number/);
    expect(system.facts.n).toBe(1);
    await system.stop();
  });

  it("does not notify for a rejected write", async () => {
    const system = await start({ n: t.number() }, (f) => {
      f.n = 1;
    });
    const key = vi.fn();
    system.subscribe(["n"], key);

    expect(() => {
      system.facts.n = "nope";
    }).toThrow();

    expect(key).not.toHaveBeenCalled();
    await system.stop();
  });

  it("describes the offending value by its kind", async () => {
    const system = await start({ n: t.number() });
    const message = (value: unknown) =>
      caught(() => {
        system.facts.n = value;
      }).message;

    expect(message(null)).toMatch(/got null/);
    expect(message([1])).toMatch(/got array/);
    expect(message("s")).toMatch(/got string/);
    expect(message({ a: 1 })).toMatch(/got object/);
    expect(message(true)).toMatch(/got boolean/);
    await system.stop();
  });

  it("shows a preview of the rejected value, trimmed to a bounded length", async () => {
    const system = await start({ n: t.number() });

    const object = caught(() => {
      system.facts.n = { a: 1 };
    }).message;
    expect(object).toMatch(/"a":1/);

    const long = caught(() => {
      system.facts.n = "y".repeat(500);
    }).message;
    expect(long).toContain("y".repeat(50));
    expect(long).not.toContain("y".repeat(200));

    const missing = caught(() => {
      system.facts.n = undefined;
    }).message;
    expect(missing).toMatch(/undefined/);
    expect(missing).not.toMatch(/circular/);
    await system.stop();
  });

  it("still reports a value that cannot be stringified", async () => {
    const system = await start({ n: t.number() });
    const circular: Any = {};
    circular.self = circular;

    const viaCycle = caught(() => {
      system.facts.n = circular;
    });
    const viaBigInt = caught(() => {
      system.facts.n = 10n;
    });

    expect(viaCycle.message).toMatch(/Validation failed for "n"/);
    expect(viaCycle.message).toMatch(/circular/);
    expect(viaBigInt.message).toMatch(/Validation failed for "n"/);
    await system.stop();
  });

  it("does not hide the value in an error message", async () => {
    const system = await start({ n: t.number() });

    const error = caught(() => {
      system.facts.n = "visible-text";
    });

    expect(error.message).toContain("visible-text");
    expect(error.message).not.toMatch(/redacted/i);
    await system.stop();
  });

  it("names the failing custom validator by position", async () => {
    const system = await start({
      even: t.number().validate((v: number) => v % 2 === 0),
    });

    const second = caught(() => {
      system.facts.even = 3;
    }).message;
    const first = caught(() => {
      system.facts.even = "x";
    }).message;

    expect(second).toMatch(/\(validator 2 failed\)$/);
    expect(first).not.toMatch(/validator \d+ failed/);
    expect(first).toMatch(/"x"$/);
    system.facts.even = 4;
    expect(system.facts.even).toBe(4);
    await system.stop();
  });

  it("points at the failing element of a typed array, and forgets it afterwards", async () => {
    const system = await start({ list: t.array<number>().of(t.number()) });

    const mid = caught(() => {
      system.facts.list = [1, "x"];
    }).message;
    expect(mid).toMatch(/index 1/);

    const notArray = caught(() => {
      system.facts.list = "nope";
    }).message;
    expect(notArray).not.toMatch(/element at index/);
    expect(notArray).toMatch(/"nope"$/);

    const first = caught(() => {
      system.facts.list = ["x", 2];
    }).message;
    expect(first).toMatch(/index 0/);
    system.facts.list = [1, 2];
    expect(system.facts.list).toEqual([1, 2]);
    await system.stop();
  });

  it("accepts every valid write through each builder", async () => {
    const system = await start({
      s: t.string(),
      b: t.boolean(),
      o: t.object<{ x: number }>(),
      a: t.array<string>(),
    });

    system.facts.s = "a";
    system.facts.b = false;
    system.facts.o = { x: 1 };
    system.facts.a = ["z"];

    expect(system.facts.$store.toObject()).toEqual({
      s: "a",
      b: false,
      o: { x: 1 },
      a: ["z"],
    });
    await system.stop();
  });

  it("validates a write made inside a batch before applying it", async () => {
    const system = await start({ n: t.number() }, (f) => {
      f.n = 1;
    });

    expect(() =>
      system.batch(() => {
        system.facts.n = "bad";
      }),
    ).toThrow(/Validation failed/);
    expect(system.facts.n).toBe(1);
    await system.stop();
  });

  it("validates writes made through the store directly", async () => {
    const system = await start({ n: t.number() });

    expect(() => system.facts.$store.set("n", "bad")).toThrow(
      /Validation failed/,
    );
    expect(() => system.facts.$store.set("ghost", 1)).toThrow(/ghost/);
    await system.stop();
  });

  it("validates a first write of a fact that was never set", async () => {
    const system = await start({ s: t.string() });

    expect(() => {
      system.facts.s = 5;
    }).toThrow(/expected string/);
    await system.stop();
  });
});

describe("facts: unknown keys (development)", () => {
  it("refuses to write a key the schema does not declare", async () => {
    const system = await start({ n: t.number() });

    const error = caught(() => {
      system.facts.ghost = 1;
    });

    expect(error.message).toMatch(/Unknown fact key/);
    expect(error.message).toContain("ghost");
    expect(system.facts.ghost).toBeUndefined();
    expect("ghost" in system.facts).toBe(false);
    await system.stop();
  });

  it("still stores the value, without throwing, when the schema declares no facts", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = createModule("m", {
      schema: { facts: {} as { loose: number } },
      init: () => {},
    });
    const system = createSystem({ module: mod }) as Any;
    await system.start();

    expect(() => {
      system.facts.loose = 1;
    }).not.toThrow();

    expect(system.facts.loose).toBe(1);
    await system.stop();
  });
});

// ---------------------------------------------------------------------------
// Schema-like objects that are not t.* builders
// ---------------------------------------------------------------------------

type ParseResult = {
  success: boolean;
  error?: { message?: string; issues?: Array<{ message?: string }> };
};

function zodLike(
  safeParse: (v: unknown) => ParseResult,
  typeName?: string,
): Record<string, unknown> {
  return {
    safeParse,
    parse: (v: unknown) => v,
    _def: typeName ? { typeName } : {},
  };
}

describe("facts: Zod-style schemas", () => {
  const rejectsStrings = (v: unknown): ParseResult =>
    typeof v === "number"
      ? { success: true }
      : { success: false, error: { message: "must be a number" } };

  it("accepts a value the schema parses and rejects one it does not", async () => {
    const system = await start({ z: zodLike(rejectsStrings, "ZodNumber") });

    system.facts.z = 3;
    expect(system.facts.z).toBe(3);

    const error = caught(() => {
      system.facts.z = "no";
    });
    expect(error.message).toMatch(/Validation failed for "z"/);
    expect(error.message).toMatch(/expected number/);
    expect(error.message).toMatch(/got string/);
    expect(error.message).toContain("must be a number");
    expect(system.facts.z).toBe(3);
    await system.stop();
  });

  it("derives the expected type name by dropping a leading Zod and lower-casing", async () => {
    const system = await start({
      a: zodLike(() => ({ success: false }), "ZodString"),
      b: zodLike(() => ({ success: false }), "MyZodThing"),
      c: zodLike(() => ({ success: false })),
    });
    const msg = (key: string) =>
      caught(() => {
        system.facts[key] = 1;
      }).message;

    expect(msg("a")).toMatch(/expected string,/);
    expect(msg("b")).toMatch(/expected myzodthing,/);
    expect(msg("c")).toMatch(/expected unknown,/);
    await system.stop();
  });

  it("copes with a Zod-shaped schema whose definition is empty", async () => {
    const system = await start({
      u: { ...zodLike(() => ({ success: false })), _def: undefined },
      n: { ...zodLike(() => ({ success: false })), _def: null },
    });
    const msg = (key: string) =>
      caught(() => {
        system.facts[key] = 1;
      }).message;

    expect(msg("u")).toMatch(/Validation failed for "u".*expected unknown,/);
    expect(msg("n")).toMatch(/Validation failed for "n".*expected unknown,/);
    await system.stop();
  });

  it("prefers a declared type name over the Zod definition", async () => {
    const schema = {
      ...zodLike(() => ({ success: false }), "ZodString"),
      _typeName: "custom",
    };
    const system = await start({ a: schema });

    expect(
      caught(() => {
        system.facts.a = 1;
      }).message,
    ).toMatch(/expected custom,/);
    await system.stop();
  });

  it("falls back from the error message to the first issue to a generic line", async () => {
    const system = await start({
      withMessage: zodLike(() => ({
        success: false,
        error: { message: "from-message", issues: [{ message: "from-issue" }] },
      })),
      withIssue: zodLike(() => ({
        success: false,
        error: { issues: [{ message: "from-issue" }] },
      })),
      emptyIssues: zodLike(() => ({ success: false, error: { issues: [] } })),
      issueWithoutMessage: zodLike(() => ({
        success: false,
        error: { issues: [{}] },
      })),
      noIssues: zodLike(() => ({ success: false, error: {} })),
      noError: zodLike(() => ({ success: false })),
    });
    const msg = (key: string) =>
      caught(() => {
        system.facts[key] = 1;
      }).message;

    expect(msg("withMessage")).toContain("from-message");
    expect(msg("withMessage")).not.toContain("from-issue");
    expect(msg("withIssue")).toContain("from-issue");
    for (const key of [
      "emptyIssues",
      "issueWithoutMessage",
      "noIssues",
      "noError",
    ]) {
      expect(msg(key)).toMatch(new RegExp(`Validation failed for "${key}"`));
      expect(msg(key)).toMatch(/Validation failed\.?$/);
    }
    await system.stop();
  });

  it("does not treat something missing a Zod ingredient as a Zod schema", async () => {
    const reject = () => ({ success: false });
    const fn: Any = () => {};
    fn.safeParse = reject;
    fn.parse = () => {};
    fn._def = {};
    const notZod: Record<string, unknown> = {
      noSafeParse: { parse: () => {}, _def: {} },
      safeParseNotFn: { safeParse: "x", parse: () => {}, _def: {} },
      noDef: { safeParse: reject, parse: () => {} },
      noParse: { safeParse: reject, _def: {} },
      parseNotFn: { safeParse: reject, parse: "x", _def: {} },
      functionShaped: fn,
    };
    const system = await start(notZod);

    for (const key of Object.keys(notZod)) {
      expect(() => {
        system.facts[key] = 1;
      }, key).not.toThrow();
      expect(system.facts[key]).toBe(1);
    }
    await system.stop();
  });

  it("recognises a schema whose hooks are present", async () => {
    const system = await start({ z: zodLike(() => ({ success: false })) });

    expect(() => {
      system.facts.z = 1;
    }).toThrow(/Validation failed/);
    await system.stop();
  });
});

describe("facts: hand-rolled schema entries", () => {
  it("accepts anything for an entry that carries no validators", async () => {
    const system = await start({
      plain: {} as Any,
      emptyList: { _validators: [] },
      notAList: { _validators: { 0: () => false, length: 1 } },
    });

    system.facts.plain = 1;
    system.facts.emptyList = 2;
    system.facts.notAList = 3;

    expect(system.facts.$store.toObject()).toEqual({
      plain: 1,
      emptyList: 2,
      notAList: 3,
    });
    await system.stop();
  });

  it("runs validators in order, skipping entries that are not functions", async () => {
    const calls: string[] = [];
    const system = await start({
      odd: {
        _validators: [
          "not a function",
          (v: unknown) => {
            calls.push("first");
            return typeof v === "number";
          },
          (v: number) => {
            calls.push("second");
            return v % 2 === 1;
          },
        ],
      },
    });

    system.facts.odd = 3;
    expect(calls).toEqual(["first", "second"]);

    const error = caught(() => {
      system.facts.odd = 4;
    });
    expect(error.message).toMatch(/Validation failed for "odd"/);
    expect(error.message).toMatch(/expected unknown,/);
    expect(error.message).toMatch(/validator 3 failed/);

    expect(() => {
      system.facts.odd = "x";
    }).toThrow(/Validation failed/);
    await system.stop();
  });

  it("falls back to the declared type name when there is one", async () => {
    const system = await start({
      named: { _typeName: "widget", _validators: [() => false] },
    });

    expect(
      caught(() => {
        system.facts.named = 1;
      }).message,
    ).toMatch(/expected widget,/);
    await system.stop();
  });
});

// ---------------------------------------------------------------------------
// Dev-mode warnings: non-JSON values, nested mutation
// ---------------------------------------------------------------------------

describe("facts: non-JSON assignment (development)", () => {
  it("still stores the value it warned about", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = await start({ keepMe: t.object<unknown>() });
    const date = new Date(7);

    system.facts.keepMe = date;

    expect(system.facts.$store.get("keepMe")).toBe(date);
    await system.stop();
  });
});

describe("facts: nested mutation (development)", () => {
  it("still assigns a nested property", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = await start({ user: t.object<{ name: string }>() }, (f) => {
      f.user = { name: "a" };
    });

    system.facts.user.name = "b";

    expect(system.facts.user.name).toBe("b");
    await system.stop();
  });

  it("still assigns deeper nested properties", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = await start(
      {
        deep: t.object<{
          a: { b: { c: number } };
          list: Array<{ n: number }>;
        }>(),
      },
      (f) => {
        f.deep = { a: { b: { c: 1 } }, list: [{ n: 1 }] };
      },
    );

    system.facts.deep.a.b.c = 2;
    system.facts.deep.list[0]!.n = 2;

    expect(system.facts.deep.a.b.c).toBe(2);
    expect(system.facts.deep.list[0]!.n).toBe(2);
    await system.stop();
  });

  it("reads normally and allows replacing the whole fact", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = await start({ user: t.object<{ name: string }>() }, (f) => {
      f.user = { name: "a" };
    });

    expect(system.facts.user.name).toBe("a");
    system.facts.user = { ...system.facts.user, name: "c" };

    expect(system.facts.user.name).toBe("c");
    await system.stop();
  });

  it("still assigns when a read-back value was stored as the fact", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = await start(
      { doc: t.object<{ inner: { x: number }; title: string }>() },
      (f) => {
        f.doc = { inner: { x: 1 }, title: "t" };
      },
    );
    const sameWrapper = system.facts.doc;
    system.facts.doc = sameWrapper;
    const again = system.facts.doc;
    system.facts.doc = again;

    system.facts.doc.title = "u";

    expect(system.facts.doc.title).toBe("u");
    await system.stop();
  });

  it("still assigns nested values copied out of a read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = await start(
      { doc: t.object<{ inner: { x: number }; title: string }>() },
      (f) => {
        f.doc = { inner: { x: 1 }, title: "t" };
      },
    );
    system.facts.doc = { ...system.facts.doc };
    system.facts.doc = { ...system.facts.doc };

    system.facts.doc.inner.x = 2;

    expect(system.facts.doc.inner.x).toBe(2);
    await system.stop();
  });

  it("keeps working on frozen and sealed containers", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const frozen = Object.freeze({ inner: Object.freeze({ a: 1 }) });
    const system = await start({ doc: t.object<Any>() }, (f) => {
      f.doc = frozen;
    });

    expect(system.facts.doc.inner.a).toBe(1);
    await system.stop();
  });

  it("reads a nested object behind a read-only or non-configurable property", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const holder: Any = {};
    Object.defineProperty(holder, "ro", {
      value: { x: 1 },
      writable: false,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(holder, "sealed", {
      value: { y: 1 },
      writable: true,
      configurable: false,
      enumerable: true,
    });
    const system = await start({ doc: t.object<Any>() }, (f) => {
      f.doc = holder;
    });

    system.facts.doc.ro.x = 2;
    system.facts.doc.sealed.y = 2;

    expect(holder.ro.x).toBe(2);
    expect(holder.sealed.y).toBe(2);
    await system.stop();
  });

  it("returns null properties and primitives untouched", async () => {
    const system = await start({ doc: t.object<Any>() }, (f) => {
      f.doc = { nothing: null, n: 1, s: "x", fn: undefined };
    });

    expect(system.facts.doc.nothing).toBeNull();
    expect(system.facts.doc.n).toBe(1);
    expect(system.facts.doc.s).toBe("x");
    expect(system.facts.doc.fn).toBeUndefined();
    await system.stop();
  });

  it("hides prototype-pollution keys on nested values", async () => {
    const system = await start({ doc: t.object<Any>() }, (f) => {
      f.doc = { a: { b: 1 } };
    });

    expect(system.facts.doc.constructor).toBeUndefined();
    expect(system.facts.doc.__proto__).toBeUndefined();
    expect(system.facts.doc.prototype).toBeUndefined();
    expect(system.facts.doc.a.constructor).toBeUndefined();
    await system.stop();
  });

  it("leaves Map, Set and Date usable inside a fact", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = await start({ doc: t.object<Any>() }, (f) => {
      f.doc = {
        map: new Map([["k", 1]]),
        set: new Set([1]),
        when: new Date(5),
      };
    });

    expect(system.facts.doc.map.get("k")).toBe(1);
    expect(system.facts.doc.set.has(1)).toBe(true);
    expect(system.facts.doc.when.getTime()).toBe(5);
    await system.stop();
  });

  it("leaves objects with no prototype mutable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bare = Object.create(null);
    bare.v = 1;
    const system = await start({ doc: t.object<Any>() }, (f) => {
      f.doc = { bare };
    });

    system.facts.doc.bare.v = 2;

    expect(bare.v).toBe(2);
    await system.stop();
  });

  it("allows symbol-keyed assignment, and hands symbol-keyed objects back as they are", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sym = Symbol("s");
    const payload = { z: 1 };
    const system = await start({ doc: t.object<Any>() }, (f) => {
      f.doc = { [sym]: payload, a: 1 };
    });

    system.facts.doc[Symbol("other")] = 1;

    expect(system.facts.doc[sym]).toBe(payload);
    await system.stop();
  });
});

// ---------------------------------------------------------------------------
// History and snapshots
// ---------------------------------------------------------------------------

describe("facts: history snapshots", () => {
  it("snapshots a fact that holds null, inside and outside an object", async () => {
    const system = await start(
      { doc: t.object<Any>(), nul: {} as Any, tick: t.number() },
      (f) => {
        f.tick = 0;
        f.nul = null;
        f.doc = { a: null, b: { c: null } };
      },
      { history: { maxSnapshots: 20 } },
    );
    system.facts.doc = { ...system.facts.doc };
    system.facts.tick = 1;
    await system.settle();

    const latest = system.history.snapshots.at(-1).facts;

    expect(latest.nul).toBeNull();
    expect(latest.doc).toEqual({ a: null, b: { c: null } });
    await system.stop();
  });

  it("snapshots an array that was rebuilt from reads of its elements", async () => {
    const system = await start(
      { items: t.array<Any>(), tick: t.number() },
      (f) => {
        f.tick = 0;
        f.items = [{ n: 1 }, { n: 2 }];
      },
      { history: { maxSnapshots: 20 } },
    );
    system.facts.items = system.facts.items.map((i: Any) => i);
    system.facts.tick = 1;
    await system.settle();

    const latest = system.history.snapshots.at(-1).facts;

    expect(latest.items).toEqual([{ n: 1 }, { n: 2 }]);
    expect(() => structuredClone(latest)).not.toThrow();
    await system.stop();
  });

  it("keeps Dates and Maps inside objects of a rebuilt array", async () => {
    type Row = { when: Date; tags: Map<string, number> };
    const system = await start(
      { rows: t.array<Row>(), tick: t.number() },
      (f) => {
        f.tick = 0;
        f.rows = [{ when: new Date(5), tags: new Map([["a", 1]]) }];
      },
      { history: { maxSnapshots: 20 } },
    );
    system.facts.rows = system.facts.rows.map((r: Row) => r);
    system.facts.tick = 1;
    await system.settle();

    const latest = system.history.snapshots.at(-1).facts as { rows: Row[] };

    expect(latest.rows[0]!.when).toBeInstanceOf(Date);
    expect(latest.rows[0]!.when.getTime()).toBe(5);
    expect(latest.rows[0]!.tags).toBeInstanceOf(Map);
    await system.stop();
  });

  it("goes back and forward over a deleted fact", async () => {
    const system = await start(
      { n: t.number(), tick: t.number() },
      (f) => {
        f.n = 1;
        f.tick = 0;
      },
      { history: { maxSnapshots: 20 } },
    );
    system.facts.tick = 1;
    await system.settle();
    delete system.facts.n;
    system.facts.tick = 2;
    await system.settle();
    expect(system.facts.n).toBeUndefined();

    system.history.goBack();
    await system.settle();

    expect(system.facts.n).toBe(1);
    expect(system.facts.tick).toBe(1);
    await system.stop();
  });
});

// ---------------------------------------------------------------------------
// Teardown and dynamic modules
// ---------------------------------------------------------------------------

describe("facts: teardown and dynamic registration", () => {
  it("drops its listeners when the system is destroyed", async () => {
    const system = await start({ n: t.number() });
    const store = system.facts.$store;
    const key = vi.fn();
    const all = vi.fn();
    system.subscribe(["n"], key);
    store.subscribeAll(all);

    system.destroy();
    try {
      store.set("n", 1);
    } catch {
      // writing to a destroyed system may be refused; either way nobody is told
    }

    expect(key).not.toHaveBeenCalled();
    expect(all).not.toHaveBeenCalled();
  });

  it("serialises a dynamically registered module only once its facts hold values", async () => {
    const base = createModule("base", {
      schema: { facts: { a: t.number() } },
      init: (f) => {
        f.a = 1;
      },
    });
    const system = createSystem({ module: base }) as Any;
    await system.start();

    system.registerModule(
      createModule("late", {
        schema: { facts: { lateValue: t.number(), lateEmpty: t.number() } },
        init: (f) => {
          f.lateValue = 2;
        },
      }) as never,
    );

    const object = system.facts.$store.toObject();
    expect(Object.keys(object)).toContain("lateValue");
    expect(Object.keys(object)).not.toContain("lateEmpty");
    expect(system.facts.lateValue).toBe(2);
    await system.stop();
  });

  it("registers a module with no facts without disturbing the existing ones", async () => {
    const base = createModule("base", {
      schema: { facts: { a: t.number() } },
      init: (f) => {
        f.a = 1;
      },
    });
    const system = createSystem({ module: base }) as Any;
    await system.start();
    const events: ObservationEvent[] = [];
    system.observe((e: ObservationEvent) => events.push(e));

    system.registerModule(
      createModule("empty", {
        schema: { facts: {} as Record<string, never> },
        init: () => {},
      }) as never,
    );

    expect(system.facts.a).toBe(1);
    expect(events.filter((e) => e.type === "fact.change")).toHaveLength(0);
    await system.stop();
  });

  it("does not wake tag watchers more than once for a module that declares no facts", async () => {
    const base = createModule("base", {
      schema: { facts: { a: t.number() } },
      init: () => {},
    });
    const system = createSystem({ module: base }) as Any;
    await system.start();
    const woken = vi.fn();
    system.meta.subscribe(["pii"], woken);

    system.registerModule(
      createModule("empty", {
        schema: { facts: {} as Record<string, never> },
        init: () => {},
      }) as never,
    );

    expect(woken.mock.calls.length).toBeLessThanOrEqual(1);
    await system.stop();
  });

  it("refuses to re-declare an existing fact through a second module", async () => {
    const base = createModule("base", {
      schema: { facts: { a: t.number() } },
      init: () => {},
    });
    const system = createSystem({ module: base }) as Any;
    await system.start();

    expect(() =>
      system.registerModule(
        createModule("dup", {
          schema: { facts: { a: t.string() } },
          init: () => {},
        }) as never,
      ),
    ).toThrow();
    await system.stop();
  });

  it("lets a re-registered module's facts be written again", async () => {
    const make = () =>
      createModule("rot", {
        schema: { facts: { r: t.number() } },
        init: (f) => {
          f.r = 1;
        },
      });
    const base = createModule("keep", {
      schema: { facts: { k: t.number() } },
      init: () => {},
    });
    const system = createSystem({ module: base }) as Any;
    await system.start();

    system.registerModule(make() as never);
    await system.unregisterModule("rot");
    expect(system.facts.r).toBeUndefined();
    system.registerModule(make() as never);

    expect(system.facts.r).toBe(1);
    system.facts.r = 5;
    expect(system.facts.r).toBe(5);
    await system.stop();
  });

  it("reports an unregistered module's facts to plugins as one batch of deletions", async () => {
    const batches: Array<Array<{ key: string; type: string; prev: unknown }>> =
      [];
    const keep = createModule("keep", {
      schema: { facts: { k: t.number() } },
      init: () => {},
    });
    const gone = createModule("gone", {
      schema: { facts: { g1: t.number(), g2: t.number() } },
      init: (f) => {
        f.g1 = 1;
        f.g2 = 2;
      },
    });
    const system = createSystem({
      module: keep,
      plugins: [
        {
          name: "spy",
          onFactsBatch: (
            c: Array<{ key: string; type: string; prev: unknown }>,
          ) => batches.push(c),
        },
      ],
    } as Any) as Any;
    await system.start();
    system.registerModule(gone as never);
    batches.length = 0;

    await system.unregisterModule("gone");

    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((c) => [c.key, c.type, c.prev]).sort()).toEqual([
      ["g1", "delete", 1],
      ["g2", "delete", 2],
    ]);
    await system.stop();
  });

  it("ignores a late write to a fact whose module was unregistered", async () => {
    const gone = createModule("gone", {
      schema: { facts: { g: t.number() } },
      init: (f) => {
        f.g = 1;
      },
    });
    const keep = createModule("keep", {
      schema: { facts: { k: t.number() } },
      init: () => {},
    });
    const system = createSystem({ module: keep }) as Any;
    await system.start();
    system.registerModule(gone as never);
    const store = system.facts.$store;
    expect(store.get("g")).toBe(1);

    await system.unregisterModule("gone");

    expect(() => store.set("g", 9)).not.toThrow();
    expect(store.has("g")).toBe(false);
    expect(Object.keys(store.toObject())).not.toContain("g");
    await system.stop();
  });
});
