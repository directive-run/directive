import { describe, expect, it, vi } from "vitest";
import {
  createModule,
  createModuleFactory,
  createSystem,
  t,
} from "../../index.js";

/**
 * RFC 0002 — `unregisterModule()`.
 *
 * `registerModule` has shipped; removal never did, so a module set could only
 * ever grow. That is what makes a representative nephron, an alveolar unit or
 * any per-instance population unbuildable: the pattern needs instances to come
 * and go, and today every instance is permanent.
 *
 * Cancellation follows the RFC's Option C. Unregistering detaches the module
 * synchronously AND aborts its in-flight resolvers, so a resolver that watches
 * `context.signal` stops promptly while one that ignores it is merely detached
 * — its writes land nowhere, because the facts are gone.
 */

function counterModule(start = 0) {
  return createModule("counter", {
    schema: {
      facts: { count: t.number() },
      derivations: { doubled: t.number() },
      events: { bump: {} },
    },
    init: (facts) => {
      facts.count = start;
    },
    derive: {
      doubled: (facts) => facts.count * 2,
    },
    events: {
      bump: (facts) => {
        facts.count = facts.count + 1;
      },
    },
  });
}

const hostModule = createModule("host", {
  schema: { facts: { label: t.string() } },
  init: (facts) => {
    facts.label = "host";
  },
});

describe("unregisterModule", () => {
  it("removes the namespace and its facts", async () => {
    const system = createSystem({
      modules: { host: hostModule, counter: counterModule(3) },
    });
    system.start();

    expect((system.facts as any).counter.count).toBe(3);

    await (system as any).unregisterModule("counter");

    expect((system.facts as any).counter).toBeUndefined();
    expect((system.facts as any).host.label).toBe("host");

    system.destroy();
  });

  it("frees the name so the same module can be registered again", async () => {
    // The rotation case: one instance retires, its replacement takes the name.
    const system = createSystem({ modules: { counter: counterModule(1) } });
    system.start();

    await (system as any).unregisterModule("counter");
    (system as any).registerModule("counter", counterModule(9));

    expect((system.facts as any).counter.count).toBe(9);

    system.destroy();
  });

  it("tears down the module the caller named, not one that shares its id", async () => {
    // One definition registered under two namespaces used to produce two
    // entries sharing an id, so looking a module up by id destroyed whichever
    // came first and left the named one running with no namespace to reach it.
    // The flattened module is now identified by its namespace instead.
    const shared = counterModule(7);
    const system = createSystem({ modules: { a: shared, b: shared } });
    system.start();

    await system.unregisterModule("b");

    expect((system.facts as any).a.count).toBe(7);
    expect((system.facts as any).b).toBeUndefined();

    system.destroy();
  });

  it("stops the module's derivations, events and effects", async () => {
    const effectRun = vi.fn();
    const watched = createModule("watched", {
      schema: {
        facts: { n: t.number() },
        derivations: { half: t.number() },
        events: { tick: {} },
      },
      init: (facts) => {
        facts.n = 2;
      },
      derive: { half: (facts) => facts.n / 2 },
      events: {
        tick: (facts) => {
          facts.n = facts.n + 2;
        },
      },
      effects: {
        record: { deps: ["n"], run: effectRun },
      },
    });

    const system = createSystem({ modules: { watched } });
    system.start();
    await system.settle();
    effectRun.mockClear();

    await (system as any).unregisterModule("watched");

    expect(() => system.read("watched.half")).toThrow();
    expect(effectRun).not.toHaveBeenCalled();

    system.destroy();
  });

  it("detaches the module's sources", async () => {
    const unsubscribe = vi.fn();
    const sourced = createModule("sourced", {
      schema: { facts: { seen: t.number() }, events: { ping: {} } },
      init: (facts) => {
        facts.seen = 0;
      },
      events: {
        ping: (facts) => {
          facts.seen = facts.seen + 1;
        },
      },
      sources: {
        feed: {
          attach: () => unsubscribe,
        },
      },
    });

    const system = createSystem({ modules: { sourced } });
    system.start();

    expect(system.inspect().attachedSourceCount).toBe(1);

    await (system as any).unregisterModule("sourced");

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(system.inspect().attachedSourceCount).toBe(0);

    system.destroy();
  });

  it("aborts an in-flight resolver that watches the signal", async () => {
    let aborted = false;
    const slow = createModule("slow", {
      schema: {
        facts: { pending: t.boolean(), done: t.boolean() },
        requirements: { WORK: {} },
      },
      init: (facts) => {
        facts.pending = true;
        facts.done = false;
      },
      constraints: {
        needsWork: {
          when: (facts) => facts.pending,
          require: { type: "WORK" },
        },
      },
      resolvers: {
        work: {
          requirement: "WORK",
          resolve: async (_req, context) => {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, 50);
              context.signal.addEventListener("abort", () => {
                aborted = true;
                clearTimeout(timer);
                resolve();
              });
            });
            context.facts.done = true;
          },
        },
      },
    });

    const system = createSystem({ modules: { slow } });
    system.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await (system as any).unregisterModule("slow");

    expect(aborted).toBe(true);

    system.destroy();
  });

  it("resolves only once in-flight resolvers have drained", async () => {
    const order: string[] = [];
    const draining = createModule("draining", {
      schema: {
        facts: { pending: t.boolean() },
        requirements: { WORK: {} },
      },
      init: (facts) => {
        facts.pending = true;
      },
      constraints: {
        needsWork: {
          when: (facts) => facts.pending,
          require: { type: "WORK" },
        },
      },
      resolvers: {
        work: {
          requirement: "WORK",
          resolve: async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            order.push("resolver-finished");
          },
        },
      },
    });

    const system = createSystem({ modules: { draining } });
    system.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await (system as any).unregisterModule("draining");
    order.push("unregister-resolved");

    expect(order).toEqual(["resolver-finished", "unregister-resolved"]);

    system.destroy();
  });

  it("leaves other modules running and their cross-module reads defined", async () => {
    const system = createSystem({
      modules: { host: hostModule, counter: counterModule(0) },
    });
    system.start();

    await (system as any).unregisterModule("counter");
    (system.facts as any).host.label = "still here";

    expect((system.facts as any).host.label).toBe("still here");
    expect(system.isRunning).toBe(true);

    system.destroy();
  });

  it("rejects an unknown namespace", async () => {
    const system = createSystem({ modules: { host: hostModule } });
    system.start();

    await expect((system as any).unregisterModule("nope")).rejects.toThrow(
      /"nope"/,
    );

    system.destroy();
  });

  it("rejects on a destroyed system", async () => {
    const system = createSystem({ modules: { host: hostModule } });
    system.start();
    system.destroy();

    await expect((system as any).unregisterModule("host")).rejects.toThrow(
      /destroyed/,
    );
  });

  it("is callable without a cast, and works on a single-module system", async () => {
    // No `as any` anywhere in this test: if the public types are wrong, it
    // fails to compile rather than failing at runtime somewhere later.
    const system = createSystem({ module: counterModule(5) });
    system.start();

    expect(system.facts.count).toBe(5);
    await system.unregisterModule("counter");

    expect(system.isRunning).toBe(true);

    system.destroy();
  });

  it("retires one instance of a factory-built module and leaves its siblings", async () => {
    // The motivating case from RFC 0002 — a representative unit repeated N
    // times, where instances come and go while the population keeps running.
    const nephron = createModuleFactory({
      schema: { facts: { filtered: t.number() } },
      init: (facts) => {
        facts.filtered = 0;
      },
    });

    const system = createSystem({
      modules: {
        n1: nephron("n1"),
        n2: nephron("n2"),
        n3: nephron("n3"),
      },
    });
    system.start();

    await system.unregisterModule("n2");

    expect((system.facts as any).n1.filtered).toBe(0);
    expect((system.facts as any).n2).toBeUndefined();
    expect((system.facts as any).n3.filtered).toBe(0);

    // And the population can grow again into the freed name.
    system.registerModule("n2", nephron("n2"));
    expect((system.facts as any).n2.filtered).toBe(0);

    system.destroy();
  });

  it("waits for an in-flight batched resolver and aborts it", async () => {
    // Batched resolvers returned early before the drain could see them, so
    // unregister resolved while the batch was still writing.
    const order: string[] = [];
    let sawAbort = false;

    const batched = createModule("batched", {
      schema: {
        facts: { pending: t.boolean() },
        requirements: { WORK: {} },
      },
      init: (facts) => {
        facts.pending = true;
      },
      constraints: {
        needsWork: {
          when: (facts) => facts.pending,
          require: { type: "WORK" },
        },
      },
      resolvers: {
        work: {
          requirement: "WORK",
          batch: { enabled: true, windowMs: 5 },
          resolveBatch: async (_reqs, context) => {
            order.push("batch-started");
            await new Promise((resolve) => setTimeout(resolve, 40));
            sawAbort = context.signal.aborted;
            order.push("batch-finished");
          },
        },
      },
    });

    const system = createSystem({ modules: { batched } });
    system.start();
    await new Promise((resolve) => setTimeout(resolve, 20));

    await system.unregisterModule("batched");
    order.push("unregister-resolved");

    expect(order).toEqual([
      "batch-started",
      "batch-finished",
      "unregister-resolved",
    ]);
    expect(sawAbort).toBe(true);

    system.destroy();
  });

  it("does not let a retired module's late write reach its replacement", async () => {
    // The rotation-contamination case: a resolver that outlives its module
    // used to write into whatever instance had taken the name next.
    const leaky = (marker: number) =>
      createModule("leaky", {
        schema: {
          facts: { pending: t.boolean(), written: t.number() },
          requirements: { WORK: {} },
        },
        init: (facts) => {
          facts.pending = marker === 1;
          facts.written = 0;
        },
        constraints: {
          needsWork: {
            when: (facts) => facts.pending,
            require: { type: "WORK" },
          },
        },
        resolvers: {
          work: {
            requirement: "WORK",
            resolve: async (_req, context) => {
              // Deliberately ignores the abort signal.
              await new Promise((resolve) => setTimeout(resolve, 30));
              context.facts.written = marker;
            },
          },
        },
      });

    const system = createSystem({ modules: { leaky: leaky(1) } });
    system.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await system.unregisterModule("leaky");
    system.registerModule("leaky", leaky(2));

    // Well past the orphan's completion.
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect((system.facts as any).leaky.written).toBe(0);

    system.destroy();
  });

  it("cancels a pending linger timer so a gated source cannot re-attach", async () => {
    // The timer's closure held the old definition and called back into attach,
    // so a detached source revived itself as a subscription no inspection
    // surface could see.
    let attachCount = 0;
    const gated = createModule("gated", {
      schema: { facts: { open: t.boolean(), room: t.string() } },
      init: (facts) => {
        facts.open = true;
        facts.room = "one";
      },
      sources: {
        feed: {
          key: (facts) => (facts["gated::open"] ? "on" : null),
          gateLingerMs: 40,
          attach: () => {
            attachCount++;

            return () => undefined;
          },
        },
      },
    });

    const system = createSystem({ modules: { gated } });
    system.start();
    await system.settle();
    const attachedBefore = attachCount;

    await system.unregisterModule("gated");
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(attachCount).toBe(attachedBefore);
    expect(system.inspect().attachedSourceCount).toBe(0);
    expect(system.inspect().sources).toEqual([]);

    system.destroy();
  });

  it("releases the name even when hooks.onStop throws", async () => {
    // onStop runs after teardown, so letting it escape abandoned the rest of
    // the bookkeeping and left a namespace that could be neither unregistered
    // nor registered again.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const rude = createModule("rude", {
      schema: { facts: { n: t.number() } },
      init: (facts) => {
        facts.n = 1;
      },
      hooks: {
        onStop: () => {
          throw new Error("onStop exploded");
        },
      },
    });

    const system = createSystem({ modules: { rude } });
    system.start();

    await expect(system.unregisterModule("rude")).resolves.toBeUndefined();

    // The name is genuinely free.
    system.registerModule("rude", counterModule(4));
    expect((system.facts as any).rude.count).toBe(4);

    consoleError.mockRestore();
    system.destroy();
  });

  it("recomputes a dependent module's derivation instead of freezing it", async () => {
    // Removing facts without notifying meant invalidation never walked the
    // dependency index, so a reader in another module held its cached number
    // forever — a value for something that no longer existed.
    const provider = createModule("provider", {
      schema: { facts: { value: t.number() } },
      init: (facts) => {
        facts.value = 10;
      },
    });

    const consumer = createModule("consumer", {
      schema: {
        facts: { own: t.number() },
        derivations: { doubled: t.number() },
      },
      crossModuleDeps: { provider: provider.schema },
      init: (facts: any) => {
        facts.own = 0;
      },
      derive: {
        doubled: (facts: any) => (facts.provider.value ?? 0) * 2,
      },
    } as any);

    const system = createSystem({ modules: { provider, consumer } });
    system.start();
    await system.settle();

    expect(system.read("consumer.doubled")).toBe(20);

    await system.unregisterModule("provider");

    expect(system.read("consumer.doubled")).toBe(0);

    system.destroy();
  });

  it("notifies subscribers that the facts are gone", async () => {
    const hits: unknown[] = [];
    const system = createSystem({ modules: { counter: counterModule(2) } });
    system.start();

    system.subscribe(["counter.count"], () => {
      hits.push(system.facts.counter?.count);
    });

    await system.unregisterModule("counter");

    expect(hits).toEqual([undefined]);

    system.destroy();
  });

  it("tears down in the documented order", async () => {
    // The changeset and the JSDoc both call the order load-bearing, so it is
    // pinned rather than merely described.
    const seen: string[] = [];
    const full = createModule("full", {
      schema: {
        facts: { on: t.boolean() },
        derivations: { flipped: t.boolean() },
        requirements: { GO: {} },
      },
      init: (facts) => {
        facts.on = false;
      },
      derive: { flipped: (facts) => !facts.on },
      effects: { noop: { deps: ["on"], run: () => undefined } },
      sources: { feed: { attach: () => () => undefined } },
      constraints: {
        go: { when: (facts) => facts.on, require: { type: "GO" } },
      },
      resolvers: {
        go: { requirement: "GO", resolve: async () => undefined },
      },
    });

    const system = createSystem({
      modules: { full },
      plugins: [
        {
          name: "order-watch",
          onDefinitionUnregister: (type: string) => {
            seen.push(type);
          },
        },
      ],
    });
    system.start();

    await system.unregisterModule("full");

    expect(seen).toEqual([
      "source",
      "resolver",
      "constraint",
      "effect",
      "derivation",
      "module",
    ]);

    system.destroy();
  });

  it("leaves a sibling instance's source attached", async () => {
    // Source ownership is recorded per module id. While the flattened id was
    // the definition's rather than the namespace, retiring one factory-built
    // instance detached its sibling's live subscription — permanently, and
    // with nothing reported.
    const attached: string[] = [];
    const detached: string[] = [];
    const unit = (n: number) =>
      createModule("unit", {
        schema: { facts: { v: t.number() } },
        init: (facts) => {
          facts.v = n;
        },
        sources: {
          [`feed${n}`]: {
            attach: () => {
              attached.push(`a${n}`);

              return () => {
                detached.push(`d${n}`);
              };
            },
          },
        },
      });

    const system = createSystem({ modules: { u1: unit(1), u2: unit(2) } });
    system.start();
    expect(attached).toEqual(["a1", "a2"]);

    await system.unregisterModule("u1");

    expect(detached).toEqual(["d1"]);
    expect((system.facts as any).u2.v).toBe(2);
    expect(system.inspect().attachedSourceCount).toBe(1);

    system.destroy();
  });

  it("leaves a surviving module's requirement key in place", async () => {
    // `setRequirementKey` is last-write-wins across modules, so removing the
    // key unconditionally stripped the dedupe identity from a module that was
    // never touched — changing whether its requirements coalesce.
    const keyCalls: string[] = [];
    const make = (name: string) =>
      createModule(name, {
        schema: {
          facts: { go: t.boolean() },
          requirements: { SHARED: {} },
        },
        init: (facts) => {
          facts.go = false;
        },
        constraints: {
          [`c_${name}`]: {
            when: (facts) => facts.go,
            require: { type: "SHARED" },
          },
        },
        resolvers: {
          [`res_${name}`]: {
            requirement: "SHARED",
            key: () => {
              keyCalls.push(name);

              return `k-${name}`;
            },
            resolve: async () => undefined,
          },
        },
      });

    const system = createSystem({
      modules: { one: make("one"), two: make("two") },
    });
    system.start();

    await system.unregisterModule("one");

    // Module two still owns a key for SHARED, so the identity survives.
    keyCalls.length = 0;
    (system.facts as any).two.go = true;
    await system.settle();

    expect(keyCalls).toContain("two");

    system.destroy();
  });

  it("drops a write from an orphaned resolver instead of throwing", async () => {
    // The guard sat behind schema validation, and unregistering is precisely
    // what removes the schema entry — so in development the documented
    // "writes land nowhere" raised "unknown fact key" in user code instead.
    let write: (() => void) | null = null;
    const worker = createModule("worker", {
      schema: {
        facts: { pending: t.boolean(), out: t.number() },
        requirements: { WORK: {} },
      },
      init: (facts) => {
        facts.pending = true;
        facts.out = 0;
      },
      constraints: {
        go: { when: (facts) => facts.pending, require: { type: "WORK" } },
      },
      resolvers: {
        go: {
          requirement: "WORK",
          resolve: async (_req, context) => {
            write = () => {
              context.facts.out = 5;
            };
          },
        },
      },
    });

    const system = createSystem({ modules: { worker } });
    system.start();
    await system.settle();

    await system.unregisterModule("worker");

    expect(write).not.toBeNull();
    expect(() => write?.()).not.toThrow();
    expect((system.facts as any).worker).toBeUndefined();

    system.destroy();
  });

  it("frees the namespace again when registerModule itself fails", async () => {
    // The name was claimed before the engine validated, and nothing rolled it
    // back — so a rejected registration left a namespace that could be neither
    // unregistered nor registered.
    const system = createSystem({ modules: { host: hostModule } });
    system.start();

    const bad = createModule("bad", {
      schema: { facts: { ok: t.boolean() } },
      sources: {
        // A blocked property name — the engine rejects this at registration.
        constructor: { attach: () => () => undefined },
      },
    } as any);

    expect(() => system.registerModule("wedge", bad)).toThrow();

    // The name is genuinely free.
    system.registerModule("wedge", counterModule(3));
    expect((system.facts as any).wedge.count).toBe(3);

    system.destroy();
  });

  it("announces a module's removal once, not once per fact", async () => {
    // Notifying per key published every torn intermediate state — a watcher
    // saw one fact gone while its siblings remained, then the next, then the
    // next. Renders of states that never existed.
    const seen: string[] = [];
    const trio = createModule("trio", {
      schema: {
        facts: { x: t.number(), y: t.number(), z: t.number() },
        derivations: { joined: t.string() },
      },
      init: (facts) => {
        facts.x = 1;
        facts.y = 2;
        facts.z = 3;
      },
      derive: {
        joined: (facts) => `${facts.x}/${facts.y}/${facts.z}`,
      },
    });

    const system = createSystem({ modules: { trio } });
    system.start();
    await system.settle();

    system.subscribe(["trio.joined"], () => {
      seen.push(String(system.read("trio.joined")));
    });

    await system.unregisterModule("trio");

    expect(seen.length).toBeLessThanOrEqual(1);

    system.destroy();
  });

  it("emits an observation event naming the module", async () => {
    const events: string[] = [];
    const system = createSystem({
      modules: { host: hostModule, counter: counterModule() },
    });
    system.observe((event) => {
      if (event.type.startsWith("module.")) {
        events.push(`${event.type}:${(event as { id?: string }).id}`);
      }
    });
    system.start();

    await (system as any).unregisterModule("counter");

    expect(events).toContain("module.unregistered:counter");

    system.destroy();
  });
});
