import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import type { ObservationEvent } from "../types/system.js";

/**
 * Provenance is stamped against each write as it is made, never read from a
 * flag when the batch is reported.
 *
 * The difference is not academic. `store.batch` nests, so a history navigation
 * made inside a wider batch does not flush until that outer batch ends — by
 * which time the history manager has already put its flag down in a `finally`.
 * A label taken at report time is therefore wrong in both directions: the
 * replayed writes lose it, and a write the program made while a restore was in
 * flight gains it. An undo button is enough to reach the first, because event
 * dispatch wraps its handler in a batch.
 *
 * That is the same defect that closed an earlier attempt at this. It came back
 * because the fix was written against the flag rather than against the write.
 */

function makeSystem() {
  const mod = createModule("m", {
    schema: {
      facts: { a: t.number(), b: t.number() },
      events: { UNDO: {} },
    },
    init: (facts) => {
      facts.a = 0;
      facts.b = 0;
    },
  });

  return createSystem({ module: mod, history: { maxSnapshots: 50 } });
}

function factChanges(events: ObservationEvent[]) {
  return events.filter((e) => e.type === "fact.change");
}

describe("fact origin is stamped at the write", () => {
  it("keeps the label when a restore runs inside a wider batch", async () => {
    const system = makeSystem();
    await system.start();
    system.facts.a = 1;
    await system.settle();
    system.facts.a = 2;
    await system.settle();

    const events: ObservationEvent[] = [];
    const unsubscribe = system.observe((e) => events.push(e));

    system.batch(() => {
      system.facts.b = 7;
      system.history!.goBack();
    });

    unsubscribe();
    await system.stop();

    const changes = factChanges(events);
    const replayed = changes.filter(
      (c) => c.type === "fact.change" && c.origin === "restore",
    );
    expect(replayed.length).toBeGreaterThan(0);
    expect(
      replayed.some((c) => c.type === "fact.change" && c.key === "a"),
    ).toBe(true);
  });

  it("does not label a write the program made during a restore", async () => {
    const system = makeSystem();
    await system.start();
    system.facts.a = 1;
    await system.settle();
    system.facts.a = 2;
    await system.settle();

    const events: ObservationEvent[] = [];
    let smuggled = false;
    const unsubscribe = system.observe((e) => {
      events.push(e);
      if (!smuggled && e.type === "fact.change" && e.origin === "restore") {
        smuggled = true;
        system.batch(() => {
          system.facts.b = 424242;
        });
      }
    });

    system.history!.goBack();
    await system.settle();
    unsubscribe();
    await system.stop();

    const smuggledRow = factChanges(events).find(
      (c) => c.type === "fact.change" && c.key === "b" && c.next === 424242,
    );
    expect(smuggledRow).toBeDefined();
    expect(smuggledRow).toMatchObject({ origin: "authored" });
  });

  it("keeps both origins apart when one batch carries both", async () => {
    const system = makeSystem();
    await system.start();
    system.facts.a = 1;
    await system.settle();
    system.facts.a = 2;
    await system.settle();

    const events: ObservationEvent[] = [];
    const unsubscribe = system.observe((e) => events.push(e));

    system.batch(() => {
      system.facts.a = 99;
      system.history!.goBack();
    });

    unsubscribe();
    await system.stop();

    // `a` is written by the program and then again by the replay. Folded into
    // one row the pair would describe neither transition, and whichever origin
    // landed last would speak for both.
    const forA = factChanges(events).filter(
      (c) => c.type === "fact.change" && c.key === "a",
    );
    const origins = forA.map((c) => (c.type === "fact.change" ? c.origin : null));
    expect(origins).toContain("authored");
    expect(origins).toContain("restore");
  });

  it("labels hydrated state as hydration, not as something the program did", async () => {
    const mod = createModule("m", {
      schema: { facts: { a: t.number() } },
      init: (facts) => {
        facts.a = 0;
      },
    });
    const system = createSystem({ module: mod, initialFacts: { a: 42 } });

    const events: ObservationEvent[] = [];
    const unsubscribe = system.observe((e) => events.push(e));
    await system.start();
    unsubscribe();

    const hydrated = factChanges(events).find(
      (c) => c.type === "fact.change" && c.next === 42,
    );
    expect(hydrated).toMatchObject({ origin: "hydrate" });

    await system.stop();
  });

  it("reconciles a write made during a restore", async () => {
    // Gated on "is a restore in flight" rather than on the write itself, this
    // value was committed to the store and then never reconciled — so anything
    // waiting on it stayed unsatisfied for the life of the process while the
    // fact itself read back correctly.
    const ran: number[] = [];
    const mod = createModule("m", {
      schema: { facts: { a: t.number(), c: t.number() } },
      init: (facts) => {
        facts.a = 0;
        facts.c = 0;
      },
      effects: {
        watchC: {
          run: (facts) => {
            if (facts.c === 42) ran.push(1);
          },
        },
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();
    system.facts.a = 1;
    await system.settle();
    system.facts.a = 2;
    await system.settle();

    const before = ran.length;
    let wrote = false;
    const unsubscribe = system.observe((e) => {
      if (!wrote && e.type === "fact.change" && e.origin === "restore") {
        wrote = true;
        system.batch(() => {
          system.facts.c = 42;
        });
      }
    });

    system.history!.goBack();
    await system.settle();
    unsubscribe();

    expect(system.facts.c).toBe(42);
    expect(ran.length).toBeGreaterThan(before);

    await system.stop();
  });

  it("delivers the rest of a batch when an observer throws", async () => {
    // The hook runs inside one guard in the plugin manager, so an unguarded
    // per-key loop lost every key after the throw — turning a one-row gap in a
    // durable record into a whole-transaction gap.
    const mod = createModule("m", {
      schema: { facts: { a: t.number(), b: t.number(), c: t.number() } },
      init: (facts) => {
        facts.a = 0;
        facts.b = 0;
        facts.c = 0;
      },
    });
    const system = createSystem({ module: mod });
    await system.start();

    const seen: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const unsubscribe = system.observe((e) => {
      if (e.type !== "fact.change") return;
      if (e.key === "b") throw new Error("sink is down");
      seen.push(e.key);
    });

    system.batch(() => {
      system.facts.a = 1;
      system.facts.b = 2;
      system.facts.c = 3;
    });

    unsubscribe();
    errorSpy.mockRestore();
    await system.stop();

    expect(seen).toEqual(["a", "c"]);
  });
});
