/**
 * Multi-module correctness — the round-2 Aperture findings.
 *
 * Every case here failed silently before the fix: the app did nothing and
 * nothing was logged. The tests pin the scoped behaviour, the legacy forms
 * that must keep working, and the dev warnings that make a mistake visible.
 */

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { createCrossModuleFactsProxy } from "../system-proxies.js";
import type { SourcePublish } from "../types/sources.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function warnSpy() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

function warnings(spy: ReturnType<typeof warnSpy>): string[] {
  return spy.mock.calls.map((call) => String(call[0]));
}

// ============================================================================
// Errors under the default "skip" strategy are visible in dev
// ============================================================================

describe("default error boundary warns in dev", () => {
  it("a throwing resolver warns once with the requirement that stays unmet", async () => {
    const spy = warnSpy();
    const mod = createModule("save", {
      schema: {
        facts: { draft: t.string() },
        events: { submit: { text: t.string() } },
        requirements: { SAVE: {} },
      },
      init: (f) => {
        f.draft = "";
      },
      events: {
        submit: (f, e) => {
          f.draft = e.text;
        },
      },
      constraints: {
        needsSave: {
          when: (f) => f.draft !== "",
          require: { type: "SAVE" },
        },
      },
      resolvers: {
        save: {
          requirement: "SAVE",
          resolve: async () => {
            throw new Error("disk full.");
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();
    system.events.submit({ text: "a" });
    await system.settle();
    system.events.submit({ text: "b" });
    await system.settle();

    const hits = warnings(spy).filter((w) => w.includes('resolver "save"'));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("disk full. Requirement");
    expect(hits[0]).not.toContain("full..");
    expect(hits[0]).toContain("SAVE");
    expect(hits[0]).toContain("onResolverError");
    system.destroy();
  });

  it("a throwing constraint warns once; effects keep their existing error log", async () => {
    const spy = warnSpy();
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const mod = createModule("boom", {
      schema: {
        facts: { n: t.number() },
        events: { bump: {} },
        requirements: { NOPE: {} },
      },
      init: (f) => {
        f.n = 0;
      },
      events: {
        bump: (f) => {
          f.n += 1;
        },
      },
      constraints: {
        bad: {
          when: (f) => {
            if (f.n > 0) {
              throw new Error("constraint broke");
            }

            return false;
          },
          require: { type: "NOPE" },
        },
      },
      effects: {
        loud: {
          run: (f) => {
            if (f.n > 0) {
              throw new Error("effect broke");
            }
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();
    system.events.bump();
    await system.settle();
    system.events.bump();
    await system.settle();

    const all = warnings(spy);
    const hits = all.filter((w) => w.includes('constraint "bad"'));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("onConstraintError");
    // Effects already log every throw with console.error; no second warning.
    expect(all.filter((w) => w.includes('effect "loud"'))).toEqual([]);
    expect(errSpy).toHaveBeenCalled();
    system.destroy();
  });

  it("stays quiet when the app configured a handler for that source", async () => {
    const spy = warnSpy();
    const mod = createModule("quiet", {
      schema: {
        facts: { n: t.number() },
        events: { bump: {} },
        requirements: { NOPE: {} },
      },
      init: (f) => {
        f.n = 0;
      },
      events: {
        bump: (f) => {
          f.n += 1;
        },
      },
      constraints: {
        bad: {
          when: (f) => {
            if (f.n > 0) {
              throw new Error("constraint broke");
            }

            return false;
          },
          require: { type: "NOPE" },
        },
      },
    });

    const system = createSystem({
      module: mod,
      errorBoundary: { onConstraintError: "skip" },
    });
    system.start();
    system.events.bump();
    await system.settle();

    expect(warnings(spy).filter((w) => w.includes('constraint "bad"'))).toEqual(
      [],
    );
    system.destroy();
  });
});

// ============================================================================
// Resolvers in a module with crossModuleDeps use flat access
// ============================================================================

const authSchema = {
  facts: { token: t.string() },
};

function authModule() {
  return createModule("auth", {
    schema: authSchema,
    init: (f) => {
      f.token = "tok";
    },
  });
}

function notesModule(resolve: (ctx: { facts: any }) => void) {
  return createModule("notes", {
    schema: {
      facts: { draft: t.string(), saved: t.string() },
      events: { submit: { text: t.string() } },
      requirements: { SAVE: {} },
    },
    crossModuleDeps: { auth: authSchema },
    init: (f) => {
      f.draft = "";
      f.saved = "";
    },
    events: {
      submit: (f, e) => {
        f.draft = e.text;
      },
    },
    constraints: {
      save: {
        when: (f) => f.self.draft !== "",
        require: { type: "SAVE" },
      },
    },
    resolvers: {
      save: {
        requirement: "SAVE",
        resolve: async (_req, context) => {
          resolve(context as { facts: any });
        },
      },
    },
  });
}

describe("resolvers in a module with crossModuleDeps", () => {
  it("get flat own-module facts, and the requirement is met", async () => {
    const mod = createModule("notes", {
      schema: {
        facts: { draft: t.string(), saved: t.string() },
        events: { submit: { text: t.string() } },
        requirements: { SAVE: {} },
      },
      crossModuleDeps: { auth: authSchema },
      init: (f) => {
        f.draft = "";
        f.saved = "";
      },
      events: {
        submit: (f, e) => {
          f.draft = e.text;
        },
      },
      constraints: {
        save: {
          when: (f) => f.self.draft !== "",
          require: { type: "SAVE" },
        },
      },
      resolvers: {
        save: {
          requirement: "SAVE",
          resolve: async (_req, context) => {
            // The documented, typed spelling.
            expectTypeOf(context.facts.draft).toEqualTypeOf<string>();
            context.facts.saved = context.facts.draft;
            context.facts.draft = "";
          },
        },
      },
    });

    const system = createSystem({
      modules: { auth: authModule(), notes: mod },
    });
    system.start();
    system.events.notes.submit({ text: "hello" });
    await system.settle();

    expect(system.facts.notes.saved).toBe("hello");
    expect(system.facts.notes.draft).toBe("");
    expect(system.inspect().unmet).toEqual([]);
    system.destroy();
  });

  it("keeps the legacy facts.self and facts.<dep> spellings working, warning once per system", async () => {
    const spy = warnSpy();
    const seen: string[] = [];
    const mod = notesModule(({ facts }) => {
      seen.push(facts.auth.token);
      facts.self.saved = facts.self.draft;
      facts.self.draft = "";
    });

    async function run(): Promise<void> {
      const system = createSystem({
        modules: { auth: authModule(), notes: mod },
      });
      system.start();
      system.events.notes.submit({ text: "one" });
      await system.settle();
      system.events.notes.submit({ text: "two" });
      await system.settle();

      expect(system.facts.notes.saved).toBe("two");
      expect(system.inspect().unmet).toEqual([]);
      system.destroy();
    }

    await run();
    const first = warnings(spy).filter((w) => w.includes('Found "ctx.facts.'));
    // Once for "self", once for "auth" – pointing at ctx.facts and ctx.deps.
    expect(first).toHaveLength(2);
    expect(first.join("\n")).toContain("ctx.deps.auth.x");

    // A second system is a second chance to make the mistake.
    await run();
    expect(
      warnings(spy).filter((w) => w.includes('Found "ctx.facts.')),
    ).toHaveLength(4);
    expect(seen).toEqual(["tok", "tok", "tok", "tok"]);
  });

  it("reads dependencies through typed, read-only ctx.deps", async () => {
    const seen: string[] = [];
    const mod = createModule("notes", {
      schema: {
        facts: { draft: t.string() },
        events: { submit: { text: t.string() } },
        requirements: { SAVE: {} },
      },
      crossModuleDeps: { auth: authSchema },
      init: (f) => {
        f.draft = "";
      },
      events: {
        submit: (f, e) => {
          f.draft = e.text;
        },
      },
      constraints: {
        save: {
          when: (f) => f.self.draft !== "",
          require: { type: "SAVE" },
        },
      },
      resolvers: {
        save: {
          requirement: "SAVE",
          resolve: async (_req, context) => {
            expectTypeOf(context.deps.auth.token).toEqualTypeOf<string>();
            // @ts-expect-error – another module's facts are read-only
            context.deps.auth.token = "x";
            seen.push(context.deps.auth.token);
            context.facts.draft = "";
          },
        },
      },
    });
    // The write above throws in development, so the resolver errors; read
    // the dep and prove the fact was not changed.
    const errSpy = warnSpy();
    const system = createSystem({
      modules: { auth: authModule(), notes: mod },
    });
    system.start();
    system.events.notes.submit({ text: "hi" });
    await system.settle();

    expect(system.facts.auth.token).toBe("tok");
    expect(seen).toEqual([]);
    expect(warnings(errSpy).join("\n")).toContain(
      'a resolver wrote "auth.token"',
    );
    system.destroy();
  });

  it("ctx.deps reads the dependency's current facts", async () => {
    const seen: string[] = [];
    const mod = createModule("notes", {
      schema: {
        facts: { draft: t.string() },
        events: { submit: { text: t.string() } },
        requirements: { SAVE: {} },
      },
      crossModuleDeps: { auth: authSchema },
      init: (f) => {
        f.draft = "";
      },
      events: {
        submit: (f, e) => {
          f.draft = e.text;
        },
      },
      constraints: {
        save: {
          when: (f) => f.self.draft !== "",
          require: { type: "SAVE" },
        },
      },
      resolvers: {
        save: {
          requirement: "SAVE",
          resolve: async (_req, context) => {
            seen.push(context.deps.auth.token);
            expect(Object.keys(context.deps)).toEqual(["auth"]);
            context.facts.draft = "";
          },
        },
      },
    });
    const system = createSystem({
      modules: { auth: authModule(), notes: mod },
    });
    system.start();
    system.events.notes.submit({ text: "hi" });
    await system.settle();

    expect(seen).toEqual(["tok"]);
    expect(system.inspect().unmet).toEqual([]);
    system.destroy();
  });

  it("a legacy ctx.facts.<dep> write is rejected like ctx.deps", async () => {
    const spy = warnSpy();
    const mod = notesModule(({ facts }) => {
      facts.auth.token = "stolen";
    });
    const system = createSystem({
      modules: { auth: authModule(), notes: mod },
    });
    system.start();
    system.events.notes.submit({ text: "hi" });
    await system.settle();

    expect(system.facts.auth.token).toBe("tok");
    expect(warnings(spy).join("\n")).toContain(
      'emit a requirement or dispatch an event that module "auth" owns',
    );
    system.destroy();
  });

  it("answers `in` for the pivots but enumerates only own facts", async () => {
    const result: { keys?: string[]; pivots?: boolean[] } = {};
    const mod = notesModule(({ facts }) => {
      result.keys = Object.keys(facts).sort();
      result.pivots = ["self" in facts, "auth" in facts, "draft" in facts];
      facts.draft = "";
    });
    const system = createSystem({
      modules: { auth: authModule(), notes: mod },
    });
    system.start();
    system.events.notes.submit({ text: "hi" });
    await system.settle();

    expect(result.keys).toEqual(["draft", "saved"]);
    expect(result.pivots).toEqual([true, true, true]);
    system.destroy();
  });

  it("keeps ctx.requeue and ctx.snapshot in namespaced resolvers", async () => {
    const seen: string[] = [];
    const mod = notesModule((context) => {
      const ctx = context as unknown as {
        requeue?: unknown;
        snapshot?: unknown;
        facts: { draft: string };
      };
      seen.push(typeof ctx.requeue, typeof ctx.snapshot);
      ctx.facts.draft = "";
    });
    const system = createSystem({
      modules: { auth: authModule(), notes: mod },
    });
    system.start();
    system.events.notes.submit({ text: "hi" });
    await system.settle();

    expect(seen).toEqual(["function", "function"]);
    system.destroy();
  });
});

describe("cross-module facts proxy", () => {
  it("rejects a top-level write with advice for its role, once per system", () => {
    const spy = warnSpy();
    const facts = { "notes::draft": "" };
    const proxy = createCrossModuleFactsProxy(
      facts,
      "notes",
      ["auth"],
      "derive",
    );

    expect(Reflect.set(proxy, "draft", "x")).toBe(false);
    expect(Reflect.set(proxy, "draft", "y")).toBe(false);
    const first = warnings(spy);
    expect(first).toHaveLength(1);
    expect(first[0]).toContain("a derivation tried to write");
    expect(first[0]).toContain("from an event handler or a resolver");
    expect(first[0]).not.toContain("facts.self.draft");

    // A different system (fact store) hears about it again.
    const other = createCrossModuleFactsProxy(
      { "notes::draft": "" },
      "notes",
      ["auth"],
      "derive",
    );
    Reflect.set(other, "draft", "z");
    expect(warnings(spy)).toHaveLength(2);

    const constraintProxy = createCrossModuleFactsProxy(facts, "notes", [
      "auth",
    ]);
    Reflect.set(constraintProxy, "draft", "x");
    expect(warnings(spy)[2]).toContain("a constraint tried to write");
  });
});

// ============================================================================
// Sources are scoped to their module
// ============================================================================

function loopModule(options: {
  capture?: { publish: SourcePublish | null };
  gate?: (f: any) => boolean;
  attached?: string[];
}) {
  return createModule("loop", {
    schema: {
      facts: { running: t.boolean(), ticks: t.number() },
      events: { START: {}, TICK: {} },
    },
    init: (f) => {
      f.running = false;
      f.ticks = 0;
    },
    events: {
      START: (f) => {
        f.running = true;
      },
      TICK: (f) => {
        f.ticks += 1;
      },
    },
    sources: {
      boot: {
        attach: (publish) => {
          if (options.capture) {
            options.capture.publish = publish;
          }

          return () => undefined;
        },
      },
      ...(options.gate
        ? {
            frame: {
              active: options.gate,
              attach: (publish: SourcePublish) => {
                options.attached?.push("frame");
                publish("TICK");

                return () => undefined;
              },
            },
          }
        : {}),
    },
  });
}

function otherModule() {
  return createModule("other", {
    schema: { facts: { n: t.number() } },
    init: (f) => {
      f.n = 7;
    },
  });
}

describe("sources in a namespaced system", () => {
  it("publish('START') runs the module's own START handler", async () => {
    const spy = warnSpy();
    const capture = { publish: null as SourcePublish | null };
    const system = createSystem({
      modules: { loop: loopModule({ capture }), other: otherModule() },
    });
    system.start();
    capture.publish!("START");
    await system.settle();

    expect(system.facts.loop.running).toBe(true);
    expect(warnings(spy).filter((w) => w.includes("Unknown event"))).toEqual(
      [],
    );
    const row = system.inspect().sources.find((s) => s.id === "loop::boot")!;
    expect(row.publishCount).toBe(1);
    expect(row.dropCount).toBe(0);
    system.destroy();
  });

  it("an already-prefixed name still works", async () => {
    const capture = { publish: null as SourcePublish | null };
    const system = createSystem({
      modules: { loop: loopModule({ capture }), other: otherModule() },
    });
    system.start();
    capture.publish!("loop::START");
    await system.settle();

    expect(system.facts.loop.running).toBe(true);
    system.destroy();
  });

  it("scopes to the registration key, not the module id", async () => {
    const capture = { publish: null as SourcePublish | null };
    const system = createSystem({
      modules: { x: loopModule({ capture }), other: otherModule() },
    });
    system.start();
    capture.publish!("START");
    await system.settle();

    expect(system.facts.x.running).toBe(true);
    system.destroy();
  });

  it("an unknown event is a drop, not a publish", async () => {
    warnSpy();
    const capture = { publish: null as SourcePublish | null };
    const onSourcePublish = vi.fn();
    const onSourceDrop = vi.fn();
    const system = createSystem({
      modules: { loop: loopModule({ capture }), other: otherModule() },
      plugins: [{ name: "spy", onSourcePublish, onSourceDrop }],
    });
    system.start();
    capture.publish!("NOPE");
    await system.settle();

    const row = system.inspect().sources.find((s) => s.id === "loop::boot")!;
    expect(row.publishCount).toBe(0);
    expect(row.dropCount).toBe(1);
    expect(row.lastDropReason).toBe("unknown-event");
    expect(onSourcePublish).not.toHaveBeenCalled();
    expect(onSourceDrop).toHaveBeenCalledTimes(1);
    system.destroy();
  });

  it("the active gate reads the module's own facts and nothing else", async () => {
    const capture = { publish: null as SourcePublish | null };
    const attached: string[] = [];
    let keys: string[] = [];
    const system = createSystem({
      modules: {
        loop: loopModule({
          capture,
          attached,
          gate: (f) => {
            keys = Object.keys(f);

            return f.running === true;
          },
        }),
        other: otherModule(),
      },
    });
    system.start();
    expect(attached).toEqual([]);
    capture.publish!("START");
    await system.settle();

    expect(attached).toEqual(["frame"]);
    expect(system.facts.loop.ticks).toBe(1);
    expect(keys.sort()).toEqual(["running", "ticks"]);
    system.destroy();
  });

  it("a gate in a module with crossModuleDeps reads facts.self and facts.<dep>", async () => {
    const attached: string[] = [];
    const mod = createModule("watch", {
      schema: { facts: { on: t.boolean() } },
      crossModuleDeps: { other: { facts: { n: t.number() } } },
      init: (f) => {
        f.on = true;
      },
      sources: {
        s: {
          active: (f: any) => f.self.on === true && f.other.n === 7,
          attach: () => {
            attached.push("s");

            return () => undefined;
          },
        },
      },
    });
    const system = createSystem({
      modules: { other: otherModule(), watch: mod },
    });
    system.start();
    await system.settle();

    expect(attached).toEqual(["s"]);
    system.destroy();
  });

  it("the legacy flat 'ns::fact' gate read still works and warns once", async () => {
    const spy = warnSpy();
    const capture = { publish: null as SourcePublish | null };
    const attached: string[] = [];
    const system = createSystem({
      modules: {
        loop: loopModule({
          capture,
          attached,
          gate: (f) => f["loop::running"] === true,
        }),
        other: otherModule(),
      },
    });
    system.start();
    capture.publish!("START");
    await system.settle();
    capture.publish!("TICK");
    await system.settle();

    expect(attached).toEqual(["frame"]);
    const legacy = warnings(spy).filter((w) => w.includes('"loop::running"'));
    expect(legacy).toHaveLength(1);
    system.destroy();
  });

  it("a gate that writes a fact is reported as a gate error and stays closed", async () => {
    warnSpy();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const attached: string[] = [];
    const system = createSystem({
      modules: {
        loop: loopModule({
          attached,
          gate: (f) => {
            f.running = true;

            return true;
          },
        }),
        other: otherModule(),
      },
    });
    system.start();
    await system.settle();

    expect(attached).toEqual([]);
    expect(system.facts.loop.running).toBe(false);
    const row = system.inspect().sources.find((s) => s.id === "loop::frame")!;
    expect(row.lastError?.phase).toBe("gate");
    system.destroy();
  });

  it("one factory module registered twice gets two independent sources", async () => {
    const a = { publish: null as SourcePublish | null };
    const b = { publish: null as SourcePublish | null };
    const system = createSystem({
      modules: { a: loopModule({ capture: a }), b: loopModule({ capture: b }) },
    });
    system.start();
    b.publish!("START");
    await system.settle();

    expect(system.facts.a.running).toBe(false);
    expect(system.facts.b.running).toBe(true);
    expect(
      system
        .inspect()
        .sources.map((s) => s.id)
        .sort(),
    ).toEqual(["a::boot", "b::boot"]);
    system.destroy();
  });
});

// ============================================================================
// Round 2: sources
// ============================================================================

describe("sources in a namespaced system – round 2", () => {
  it("passes a blocked publish name through so the engine reports it", async () => {
    const capture = { publish: null as SourcePublish | null };
    const system = createSystem({
      modules: { loop: loopModule({ capture }), other: otherModule() },
    });
    system.start();
    capture.publish!("__proto__");
    await system.settle();

    const row = system.inspect().sources.find((s) => s.id === "loop::boot")!;
    expect(row.dropCount).toBe(1);
    expect(row.lastDropReason).toBe("blocked-event-name");
    system.destroy();
  });

  it("reports prefixed event names and the local id to plugins and observers", async () => {
    const capture = { publish: null as SourcePublish | null };
    const onSourcePublish = vi.fn();
    const system = createSystem({
      modules: { loop: loopModule({ capture }), other: otherModule() },
      plugins: [{ name: "spy", onSourcePublish }],
    });
    const observed: Record<string, unknown>[] = [];
    system.observe((event) => {
      if (event.type === "source.publish") {
        observed.push(event as unknown as Record<string, unknown>);
      }
    });
    system.start();
    capture.publish!("START");
    await system.settle();

    expect(onSourcePublish).toHaveBeenCalledWith(
      "loop::boot",
      "loop",
      "loop::START",
    );
    expect(observed).toEqual([
      expect.objectContaining({
        id: "loop::boot",
        moduleId: "loop",
        localId: "boot",
        eventName: "loop::START",
      }),
    ]);
    const row = system.inspect().sources.find((s) => s.id === "loop::boot")!;
    expect(row.localId).toBe("boot");
    expect(row.moduleId).toBe("loop");
    system.destroy();
  });

  it("localId equals id in a single-module system", () => {
    const system = createSystem({ module: loopModule({}) });
    system.start();
    const row = system.inspect().sources[0]!;
    expect(row.id).toBe("boot");
    expect(row.localId).toBe("boot");
    system.destroy();
  });

  it("hands the gate the same cached proxy on every evaluation", async () => {
    const seen = new Set<unknown>();
    const capture = { publish: null as SourcePublish | null };
    const system = createSystem({
      modules: {
        loop: loopModule({
          capture,
          gate: (f) => {
            seen.add(f);

            return f.ticks > 100;
          },
        }),
        other: otherModule(),
      },
    });
    system.start();
    for (let i = 0; i < 5; i++) {
      capture.publish!("TICK");
      await system.settle();
    }

    expect(system.facts.loop.ticks).toBe(5);
    expect(seen.size).toBe(1);
    system.destroy();
  });

  it("warns once when a gate in a module with crossModuleDeps reads a bare fact", async () => {
    const spy = warnSpy();
    const mod = createModule("watch", {
      schema: { facts: { on: t.boolean() } },
      crossModuleDeps: { other: { facts: { n: t.number() } } },
      init: (f) => {
        f.on = true;
      },
      sources: {
        s: {
          // @ts-expect-error – own facts live under `self` with crossModuleDeps
          active: (f) => f.on === true,
          attach: () => () => undefined,
        },
      },
    });
    const system = createSystem({
      modules: { other: otherModule(), watch: mod },
    });
    system.start();
    await system.settle();

    const hits = warnings(spy).filter((w) =>
      w.includes('read undeclared property "on" in a source gate'),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("facts.self.on");
    system.destroy();
  });

  it("types gate facts from the module schema in both modes", () => {
    createModule("typed", {
      schema: { facts: { running: t.boolean(), room: t.string() } },
      sources: {
        a: {
          active: (f) => {
            expectTypeOf(f.running).toEqualTypeOf<boolean>();
            // @ts-expect-error – gates are read-only
            f.running = false;

            return f.running;
          },
          attach: () => () => undefined,
        },
        b: {
          key: (f) => {
            expectTypeOf(f.room).toEqualTypeOf<string>();

            return f.room;
          },
          attach: () => () => undefined,
        },
      },
    });
    createModule("typedDeps", {
      schema: { facts: { on: t.boolean() } },
      crossModuleDeps: { other: { facts: { n: t.number() } } },
      sources: {
        s: {
          active: (f) => {
            expectTypeOf(f.self.on).toEqualTypeOf<boolean>();
            expectTypeOf(f.other.n).toEqualTypeOf<number>();

            return f.self.on && f.other.n > 0;
          },
          attach: () => () => undefined,
        },
      },
    });
  });

  it("keeps a class-based source's prototype and non-enumerable meta", async () => {
    class TickSource {
      attached = 0;
      get label(): string {
        return "ticker";
      }
      attach(publish: SourcePublish) {
        this.attached += 1;
        publish(this.label === "ticker" ? "TICK" : "NOPE");

        return () => undefined;
      }
    }
    const source = new TickSource();
    Object.defineProperty(source, "meta", {
      value: { label: "Ticker" },
      enumerable: false,
    });

    const mod = createModule("loop", {
      schema: {
        facts: { ticks: t.number() },
        events: { TICK: {} },
      },
      init: (f) => {
        f.ticks = 0;
      },
      events: {
        TICK: (f) => {
          f.ticks += 1;
        },
      },
      sources: { ticker: source },
    });
    const system = createSystem({ modules: { loop: mod } });
    system.start();
    await system.settle();

    expect(source.attached).toBe(1);
    expect(system.facts.loop.ticks).toBe(1);
    const row = system.inspect().sources.find((s) => s.id === "loop::ticker")!;
    expect((row.meta as { label?: string } | undefined)?.label).toBe("Ticker");
    system.destroy();
  });
});

// ============================================================================
// Round 2: blocked keys are rejected in both modes
// ============================================================================

const BLOCKED_KEYS = ["__proto__", "constructor", "prototype"] as const;

const SECTIONS: Record<string, (key: string) => Record<string, unknown>> = {
  schema: (key) => ({
    schema: { facts: { [key]: t.number() }, requirements: {} },
  }),
  events: (key) => ({ events: { [key]: () => undefined } }),
  derive: (key) => ({ derive: { [key]: () => 1 } }),
  effects: (key) => ({ effects: { [key]: { run: () => undefined } } }),
  sources: (key) => ({
    sources: { [key]: { attach: () => () => undefined } },
  }),
  constraints: (key) => ({
    constraints: { [key]: { when: () => false, require: { type: "X" } } },
  }),
  resolvers: (key) => ({
    resolvers: { [key]: { requirement: "X", resolve: async () => undefined } },
  }),
};

function rawModule(section: string, key: string): any {
  return {
    id: "m",
    schema: { facts: { ok: t.number() }, requirements: { X: {} } },
    ...SECTIONS[section]!(key),
  };
}

describe("blocked keys", () => {
  for (const section of Object.keys(SECTIONS)) {
    for (const key of BLOCKED_KEYS) {
      it(`rejects "${key}" in ${section} – single-module and namespaced`, () => {
        warnSpy();
        const pattern = new RegExp(`dangerous key "${key}" in ${section}`);

        expect(() =>
          createSystem({ module: rawModule(section, key) }),
        ).toThrowError(pattern);
        expect(() =>
          createSystem({ modules: { m: rawModule(section, key) } }),
        ).toThrowError(pattern);
      });
    }
  }
});
