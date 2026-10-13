import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import type { ObservationEvent } from "../types/system.js";

/**
 * Replaying the emitted events must land on the value the facts actually hold.
 * That is what a durable record is for, and what `@directive-run/timeline`
 * does literally.
 *
 * Coalescing per key AND origin broke it. A batch that writes a fact, rewinds
 * history, then writes it again produced one entry per origin — and the two
 * entries were emitted in first-touch order, not in the order the writes
 * happened. Replaying them applied the older value last.
 *
 * Entries are now cut at each change of origin instead of grouped by it, so a
 * key can appear more than once in a batch and the entries stay in the order
 * the writes were made.
 */

function factChanges(events: ObservationEvent[]) {
  return events.filter((e) => e.type === "fact.change");
}

function replay(events: ObservationEvent[]): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const e of factChanges(events)) {
    if (e.type === "fact.change") state[e.key] = e.next;
  }

  return state;
}

describe("the emitted stream", () => {
  it("reconstructs the value a mixed-origin batch left behind", async () => {
    const mod = createModule("m", {
      schema: { facts: { a: t.number() } },
      init: (facts) => {
        facts.a = 0;
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();
    system.facts.a = 100;
    await system.settle();
    system.facts.a = 200;
    await system.settle();

    const events: ObservationEvent[] = [];
    const unsubscribe = system.observe((e) => events.push(e));

    system.batch(() => {
      system.facts.a = 1;
      system.history!.goBack();
      system.facts.a = 7;
    });

    unsubscribe();

    expect(system.facts.a).toBe(7);
    expect(replay(events).a).toBe(system.facts.a);

    await system.stop();
  });

  it("chains prev to next across the whole batch", async () => {
    const mod = createModule("m", {
      schema: { facts: { a: t.number() } },
      init: (facts) => {
        facts.a = 0;
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();
    system.facts.a = 100;
    await system.settle();
    system.facts.a = 200;
    await system.settle();

    const events: ObservationEvent[] = [];
    const unsubscribe = system.observe((e) => events.push(e));

    system.batch(() => {
      system.facts.a = 1;
      system.history!.goBack();
      system.facts.a = 7;
    });

    unsubscribe();

    const forA = factChanges(events).filter(
      (e) => e.type === "fact.change" && e.key === "a",
    );
    // Every entry's `prev` is the previous entry's `next`. A gap here means an
    // auditor reading the rows in order sees a value appear from nowhere.
    for (let i = 1; i < forA.length; i++) {
      const before = forA[i - 1];
      const current = forA[i];
      if (before?.type !== "fact.change" || current?.type !== "fact.change") {
        continue;
      }
      expect(current.prev).toEqual(before.next);
    }

    await system.stop();
  });

  it("still coalesces a hot loop to a single entry", async () => {
    const mod = createModule("m", {
      schema: { facts: { n: t.number() } },
      init: (facts) => {
        facts.n = 0;
      },
    });
    const system = createSystem({ module: mod });
    await system.start();

    const events: ObservationEvent[] = [];
    const unsubscribe = system.observe((e) => events.push(e));

    system.batch(() => {
      for (let i = 1; i <= 10_000; i++) {
        system.facts.n = i;
      }
    });

    unsubscribe();

    expect(factChanges(events)).toHaveLength(1);
    expect(factChanges(events)[0]).toMatchObject({ prev: 0, next: 10_000 });

    await system.stop();
  });
});
