import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

// Five L9 gate stops (GATE-8.md), each matched to 1.35: destroy() and
// destroyAsync() forget module and event meta, the build freezes only object
// schema types, reconcile.end needs a configured plugin, and disable() drops
// a constraint's dependency record.

afterEach(() => {
  vi.restoreAllMocks();
});

const wait = (ms = 0) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function metaModule() {
  return createModule("m", {
    schema: {
      facts: { tagged: t.number().meta({ label: "F", tags: ["x"] }) },
      derivations: {},
      events: {},
      requirements: { NEVER: {} },
    },
    init: (f: any) => {
      f.tagged = 0;
    },
    events: {
      handled: {
        handler: (f: any) => {
          f.tagged = 1;
        },
        meta: { label: "H", tags: ["x"] },
      },
    },
    constraints: {
      c: {
        when: () => false,
        require: { type: "NEVER" },
        meta: { label: "C", tags: ["x"] },
      },
    },
    meta: { label: "M", tags: ["x"] },
  } as never);
}

/** What `system.meta` answers for module and event, and what it keeps. */
function readMeta(system: any) {
  return {
    module: system.meta.module("m"),
    event: system.meta.event("handled"),
    eventTag: system.meta.carriesTag("event", "handled", "x"),
    moduleTag: system.meta.carriesTag("module", "m", "x"),
    kinds: system.meta.byTag("x").map((row: any) => row.kind),
    constraint: system.meta.constraint("c"),
    fact: system.meta.fact("tagged"),
  };
}

describe("destroy forgets module and event meta, as 1.35 (engine.ts:3504–3506)", () => {
  it("destroy()", () => {
    const system = createSystem({ module: metaModule() } as never) as any;
    system.start();
    expect(readMeta(system)).toMatchObject({
      module: { label: "M" },
      event: { label: "H" },
      eventTag: true,
      moduleTag: true,
      kinds: ["module", "fact", "event", "constraint"],
    });
    system.destroy();

    expect(readMeta(system)).toEqual({
      module: undefined,
      event: undefined,
      eventTag: undefined,
      moduleTag: undefined,
      kinds: ["fact", "constraint"],
      constraint: { label: "C", tags: ["x"] },
      fact: { label: "F", tags: ["x"] },
    });
  });

  it("destroyAsync(), which also empties the trace (engine.ts:3552–3554)", async () => {
    const system = createSystem({
      module: metaModule(),
      trace: true,
    } as never) as any;
    system.start();
    system.dispatch({ type: "handled" });
    await system.settle();
    expect(system.trace.length).toBeGreaterThan(0);
    await system.destroyAsync();

    expect(readMeta(system)).toMatchObject({
      module: undefined,
      event: undefined,
      kinds: ["fact", "constraint"],
      constraint: { label: "C" },
    });
    expect(system.trace).toEqual([]);
  });
});

describe("the schema-type freeze at build, as 1.35's isOwnSchemaType (engine.ts:253–259)", () => {
  it("freezes an object type that carries _typeName, not a function that does", () => {
    const fnType = Object.assign(() => undefined, {
      _typeName: "fn",
      _validators: [],
    });
    const own = t.number().meta({ label: "Own" });
    const mod = createModule("z", {
      schema: {
        facts: { fn: fnType, own },
        derivations: {},
        events: {},
        requirements: {},
      },
    } as never);
    const system = createSystem({ module: mod } as never) as any;

    expect(Object.isFrozen(own)).toBe(true);
    expect(Object.isFrozen(fnType)).toBe(false);
    system.destroy();
  });
});

describe("reconcile.end goes out only with plugins configured, as 1.35 (engine.ts:2180)", () => {
  const heard = async (options: Record<string, unknown>) => {
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (f: any) => {
        f.n = 0;
      },
    } as never);
    const system = createSystem({ module: mod, ...options } as never) as any;
    const types: string[] = [];
    system.observe((e: any) => types.push(e.type));
    system.start();
    system.facts.n = 1;
    await system.settle();
    system.destroy();

    return {
      start: types.includes("reconcile.start"),
      end: types.includes("reconcile.end"),
    };
  };

  it("an observer alone hears reconcile.start but no reconcile.end", async () => {
    expect(await heard({})).toEqual({ start: true, end: false });
    expect(await heard({ plugins: [] })).toEqual({ start: true, end: false });
  });

  it("with one plugin, the observer and the plugin hear reconcile.end", async () => {
    const ends: unknown[] = [];
    const plugin = { name: "p", onReconcileEnd: (r: unknown) => ends.push(r) };

    expect(await heard({ plugins: [plugin] })).toEqual({
      start: true,
      end: true,
    });
    expect(ends.length).toBeGreaterThan(0);
  });
});

describe("disable() drops the constraint's dependency record, as 1.35 (constraints.ts:777)", () => {
  it("so explain() of its requirement lists every fact", async () => {
    const mod = createModule("m", {
      schema: {
        facts: { short: t.string(), other: t.number() },
        derivations: {},
        events: {},
        requirements: { ORPHAN: {} },
      },
      init: (f: any) => {
        f.short = "hi";
        f.other = 7;
      },
      constraints: {
        always: {
          when: (f: any) => f.short !== "",
          require: { type: "ORPHAN" },
        },
      },
    } as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = createSystem({ module: mod } as never) as any;
    system.start();
    await wait(10);
    const id = system.inspect().unmet[0].id;
    // Before disable it lists what `when` read.
    expect(system.explain(id)).not.toContain("other = 7");
    system.constraints.disable("always");
    const text: string = system.explain(id);

    expect(text).toContain("short = hi");
    expect(text).toContain("other = 7");
    system.destroy();
  });
});
