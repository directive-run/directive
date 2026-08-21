import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import type { ObservationEvent } from "../types/system.js";

/**
 * `system.observe()` is the bridge every durable consumer sits behind — the
 * audit ledger among them. It implemented `onFactSet` and not `onFactsBatch`,
 * so a write made inside `system.batch()` reached no observer at all.
 *
 * That is not a corner: event handlers, effects, resolvers before their first
 * await, `initialFacts`, `hydrate` and every history restore write through a
 * batch. The unbatched write beside them was recorded. So suppressing an entry
 * needed no privileged handle and no forged label — an ordinary
 * `system.batch()` did it.
 */

function makeSystem() {
  const mod = createModule("m", {
    schema: {
      facts: { a: t.number(), b: t.string() },
    },
    init: (facts) => {
      facts.a = 0;
      facts.b = "start";
    },
  });

  return createSystem({ module: mod, history: { maxSnapshots: 50 } });
}

function factChanges(events: ObservationEvent[]) {
  return events.filter((e) => e.type === "fact.change");
}

describe("observe() and batched writes", () => {
  it("records a write made inside system.batch()", async () => {
    const system = makeSystem();
    await system.start();

    const events: ObservationEvent[] = [];
    const unsubscribe = system.observe((e) => events.push(e));

    system.batch(() => {
      system.facts.a = 1;
    });

    unsubscribe();
    await system.stop();

    expect(factChanges(events)).toHaveLength(1);
  });

  it("records the same write whether or not a batch wraps it", async () => {
    const unbatched = makeSystem();
    await unbatched.start();
    const unbatchedEvents: ObservationEvent[] = [];
    const unsubA = unbatched.observe((e) => unbatchedEvents.push(e));
    unbatched.facts.a = 1;
    unsubA();
    await unbatched.stop();

    const batched = makeSystem();
    await batched.start();
    const batchedEvents: ObservationEvent[] = [];
    const unsubB = batched.observe((e) => batchedEvents.push(e));
    batched.batch(() => {
      batched.facts.a = 1;
    });
    unsubB();
    await batched.stop();

    expect(factChanges(batchedEvents)).toEqual(factChanges(unbatchedEvents));
  });

  it("coalesces repeated writes to one key into the net change", async () => {
    const system = makeSystem();
    await system.start();

    const events: ObservationEvent[] = [];
    const unsubscribe = system.observe((e) => events.push(e));

    system.batch(() => {
      system.facts.a = 1;
      system.facts.a = 2;
      system.facts.a = 3;
    });

    unsubscribe();
    await system.stop();

    const changes = factChanges(events);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ key: "a", prev: 0, next: 3 });
  });

  it("keeps one event per key, in the order the keys were first written", async () => {
    const system = makeSystem();
    await system.start();

    const events: ObservationEvent[] = [];
    const unsubscribe = system.observe((e) => events.push(e));

    system.batch(() => {
      system.facts.b = "second";
      system.facts.a = 1;
      system.facts.b = "third";
    });

    unsubscribe();
    await system.stop();

    const changes = factChanges(events);
    expect(changes.map((c) => (c.type === "fact.change" ? c.key : null))).toEqual([
      "b",
      "a",
    ]);
    expect(changes[0]).toMatchObject({ prev: "start", next: "third" });
  });

  it("records a history restore, labelled as one", async () => {
    const system = makeSystem();
    await system.start();
    system.facts.a = 42;
    await system.settle();
    system.facts.a = 43;
    await system.settle();

    const events: ObservationEvent[] = [];
    const unsubscribe = system.observe((e) => events.push(e));

    system.history!.goBack();

    unsubscribe();
    await system.stop();

    const changes = factChanges(events);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      key: "a",
      prev: 43,
      next: 0,
      origin: "restore",
    });
  });

  it("labels an ordinary write as authored", async () => {
    const system = makeSystem();
    await system.start();

    const events: ObservationEvent[] = [];
    const unsubscribe = system.observe((e) => events.push(e));

    system.batch(() => {
      system.facts.a = 1;
    });

    unsubscribe();
    await system.stop();

    const [change] = factChanges(events);
    expect(change).toMatchObject({ origin: "authored" });
  });

  it("records a delete the same way batched or not", async () => {
    const unbatched = makeSystem();
    await unbatched.start();
    const unbatchedEvents: ObservationEvent[] = [];
    const unsubA = unbatched.observe((e) => unbatchedEvents.push(e));
    delete (unbatched.facts as { a?: number }).a;
    unsubA();
    await unbatched.stop();

    const batched = makeSystem();
    await batched.start();
    const batchedEvents: ObservationEvent[] = [];
    const unsubB = batched.observe((e) => batchedEvents.push(e));
    batched.batch(() => {
      delete (batched.facts as { a?: number }).a;
    });
    unsubB();
    await batched.stop();

    expect(factChanges(unbatchedEvents)).toHaveLength(1);
    expect(factChanges(batchedEvents)).toEqual(factChanges(unbatchedEvents));
  });
});
