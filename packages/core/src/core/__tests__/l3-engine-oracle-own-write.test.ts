/**
 * The engine's reconcile bookkeeping around a run that satisfied its own
 * requirement, and the plugin's view of what a pass canceled. Black-box:
 * what a user sees is whether a retracted run's signal aborted, which hooks
 * fired, and what `onReconcileEnd` reported.
 *
 * - Several runs retracted in one pass answer for the pass's changes
 *   together: each is judged against everyone's writes, not only its own.
 * - A run that wrote nothing is never satisfied by someone else's write.
 * - `onReconcileEnd` lists each requirement a pass retracted, by id.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

const flushMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

function tracker() {
  const log = { completed: 0, canceled: 0 };
  const plugin = {
    name: "track",
    onResolverComplete: () => {
      log.completed++;
    },
    onResolverCancel: () => {
      log.canceled++;
    },
  };

  return { log, plugin };
}

/** A keyed constraint: every wanted id without a result needs a run. */
function keyed(options: { writes: (id: string, results: any) => any }) {
  const { log, plugin } = tracker();
  const gates: Record<string, () => void> = {};
  const signals: Record<string, AbortSignal> = {};
  const abortedAfterWrite: Record<string, boolean> = {};
  const mod = createModule("keyed", {
    schema: {
      facts: {
        want: t.object<Record<string, boolean>>(),
        results: t.object<Record<string, string>>(),
      },
      derivations: {},
      events: {},
      requirements: { LOAD: { id: t.string() } },
    },
    init: (facts: any) => {
      facts.want = {};
      facts.results = {};
    },
    constraints: {
      load: {
        when: (facts: any) =>
          Object.keys(facts.want).some(
            (id) => facts.want[id] && !(id in facts.results),
          ),
        require: (facts: any) =>
          Object.keys(facts.want)
            .filter((id) => facts.want[id] && !(id in facts.results))
            .map((id) => ({ type: "LOAD" as const, id })),
      },
    },
    resolvers: {
      load: {
        requirement: "LOAD",
        key: (req: any) => `load-${req.id}`,
        resolve: async (req: any, context: any) => {
          signals[req.id] = context.signal;
          await new Promise<void>((resolve) => {
            gates[req.id] = resolve;
          });
          if (context.signal.aborted) {
            return;
          }
          const next = options.writes(req.id, context.facts.results);
          if (next !== undefined) {
            context.facts.results = next;
          }
          // Stay in flight past the write, so the pass that retracts the
          // requirement finds the run still going.
          await flushMacrotask();
          abortedAfterWrite[req.id] = context.signal.aborted;
        },
      },
    },
  } as never);
  const system: any = createSystem({ module: mod, plugins: [plugin] });

  return { system, log, gates, signals, abortedAfterWrite };
}

describe("runs retracted together in one pass", () => {
  it("each is satisfied by the others' writes as well as its own", async () => {
    const { system, log, gates, signals, abortedAfterWrite } = keyed({
      writes: (id, results) => ({ ...results, [id]: "done" }),
    });
    system.start();
    system.facts.want = { a: true, b: true, d: true };
    await flushMacrotask();
    expect(Object.keys(signals).sort()).toEqual(["a", "b", "d"]);
    // All three runs write in the same synchronous run, so one pass sees them.
    gates.a!();
    gates.b!();
    gates.d!();
    for (let i = 0; i < 4; i++) {
      await flushMacrotask();
    }

    expect(system.facts.results).toEqual({ a: "done", b: "done", d: "done" });
    expect(abortedAfterWrite).toEqual({ a: false, b: false, d: false });
    expect(log.canceled).toBe(0);
    expect(log.completed).toBe(3);
    system.destroy();
  });

  it("a run that wrote nothing is canceled, whoever else made its requirement go away", async () => {
    // a's write also supplies c's result, so c's requirement goes away in the
    // pass where a and b are satisfied. c's run wrote nothing: it did not
    // satisfy anything, and it sits between two runs that did.
    const { system, log, gates, signals, abortedAfterWrite } = keyed({
      writes: (id, results) =>
        id === "c"
          ? undefined
          : id === "a"
            ? { ...results, a: "done", c: "done" }
            : { ...results, [id]: "done" },
    });
    system.start();
    system.facts.want = { a: true, c: true, b: true };
    await flushMacrotask();
    expect(Object.keys(signals).sort()).toEqual(["a", "b", "c"]);
    gates.a!();
    gates.b!();
    for (let i = 0; i < 4; i++) {
      await flushMacrotask();
    }

    expect(system.facts.results).toEqual({ a: "done", c: "done", b: "done" });
    expect(abortedAfterWrite).toEqual({ a: false, b: false });
    expect(signals.c!.aborted).toBe(true);
    expect(log.canceled).toBe(1);
    system.destroy();
  });
});

describe("onReconcileEnd", () => {
  it("reports a run the pass canceled by its requirement id, and what is in flight", async () => {
    const results: any[] = [];
    const plugin = {
      name: "ends",
      onReconcileEnd: (result: any) => {
        results.push(structuredClone(result));
      },
    };
    const mod = createModule("cancels", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { LOAD: {} },
      },
      init: (facts: any) => {
        facts.go = false;
      },
      constraints: {
        load: {
          when: (facts: any) => facts.go,
          require: { type: "LOAD" },
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async () => {
            await new Promise(() => {});
          },
        },
      },
    } as never);
    const system: any = createSystem({ module: mod, plugins: [plugin] });
    system.start();
    system.facts.go = true;
    await flushMacrotask();
    const started = results[results.length - 1];
    expect(started.inflight).toHaveLength(1);
    expect(started.inflight[0].resolverId).toBe("load");
    expect(started.canceled).toEqual([]);
    expect(started.completed).toEqual([]);

    // The user retracts the requirement while its run is in flight.
    system.facts.go = false;
    await flushMacrotask();
    const canceled = results.flatMap((r) => r.canceled);
    expect(canceled).toHaveLength(1);
    expect(canceled[0].id).toBe(started.inflight[0].id);
    expect(typeof canceled[0].resolverId).toBe("string");
    expect(canceled[0].resolverId.length).toBeGreaterThan(0);
    system.destroy();
  });

  it("lists a retracted requirement whose run is no longer in flight, with a resolver id", async () => {
    const results: any[] = [];
    const plugin = {
      name: "ends",
      onReconcileEnd: (result: any) => {
        results.push(structuredClone(result));
      },
    };
    const mod = createModule("finished", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { LOAD: {} },
      },
      init: (facts: any) => {
        facts.go = false;
      },
      constraints: {
        load: {
          when: (facts: any) => facts.go,
          require: { type: "LOAD" },
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async () => undefined,
        },
      },
    } as never);
    const system: any = createSystem({ module: mod, plugins: [plugin] });
    system.start();
    system.facts.go = true;
    for (let i = 0; i < 3; i++) {
      await flushMacrotask();
    }
    // The run finished and the constraint is still true. Now it stops.
    system.facts.go = false;
    await flushMacrotask();
    const canceled = results.flatMap((r) => r.canceled);
    expect(canceled).toHaveLength(1);
    expect(typeof canceled[0].resolverId).toBe("string");
    expect(canceled[0].resolverId.length).toBeGreaterThan(0);
    system.destroy();
  });
});
