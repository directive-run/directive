import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../api/schema-builders.js";
import {
  createModule,
  createModuleFactory,
  createSystem,
} from "../api/system.js";

const counterSchema = {
  facts: { count: t.number() },
  derivations: { doubled: t.number() },
  events: { bump: {} },
};
const counter = () =>
  createModule("counter", {
    schema: counterSchema,
    init: (facts) => {
      facts.count = 1;
    },
    derive: { doubled: (facts) => facts.count * 2 },
    events: {
      bump: (facts) => {
        facts.count += 1;
      },
    },
  });
const label = (runs: unknown[] = []) =>
  createModule("label", {
    schema: {
      facts: { prefix: t.string() },
      derivations: { text: t.string() },
    },
    crossModuleDeps: { counter: counterSchema },
    init: (facts: any) => {
      facts.prefix = "n";
    },
    derive: {
      text: (facts: any) => `${facts.self.prefix}=${facts.counter.count}`,
    },
    effects: {
      log: {
        run: (facts: any, prev: any) => {
          runs.push([facts.counter.count, prev?.counter.count]);
        },
      },
    },
  } as any);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("namespaced systems", () => {
  it("keeps each module's facts, derivations and events in its namespace", () => {
    const system = createSystem({
      modules: { a: counter(), b: counter() },
    }) as any;
    system.start();
    system.events.a.bump();

    expect(system.facts.a.count).toBe(2);
    expect(system.facts.b.count).toBe(1);
    expect(system.derive.a.doubled).toBe(4);
    expect(system.read("b.doubled")).toBe(2);
    expect(Object.keys(system.facts)).toEqual(["a", "b"]);
    expect(Object.keys(system.facts.a)).toEqual(["count"]);
    expect(Object.getPrototypeOf(system.facts)).toBeNull();
    expect(system.facts.nope).toBeUndefined();
    expect(system._mode).toBe("namespaced");
  });

  it("reads another module through crossModuleDeps, inits dependencies first", async () => {
    const runs: unknown[] = [];
    // Declared label-first: the dependency order puts counter's init first.
    const system = createSystem({
      modules: { label: label(runs), counter: counter() },
    }) as any;
    system.start();
    expect(system.derive.label.text).toBe("n=1");
    expect(system.inspect().modules.map((m: any) => m.id)).toEqual([
      "counter",
      "label",
    ]);
    await system.settle();
    system.facts.counter.count = 5;
    await system.settle();

    expect(system.derive.label.text).toBe("n=5");
    expect(runs).toEqual([
      [1, undefined],
      [5, 1],
    ]);
  });

  it("translates dotted ids and wildcards for subscribe and watch", () => {
    const system = createSystem({
      modules: { a: counter(), b: counter() },
    }) as any;
    system.start();
    const all = vi.fn();
    const watched: unknown[] = [];
    system.subscribe(["a.*"], all);
    system.watch("a.doubled", (next: unknown, prev: unknown) =>
      watched.push([next, prev]),
    );
    system.facts.b.count = 9;
    expect(all).not.toHaveBeenCalled();
    system.facts.a.count = 3;

    expect(all).toHaveBeenCalled();
    expect(watched).toEqual([[6, 2]]);
  });

  it("rejects the shapes 1.35 rejects", () => {
    expect(() => createSystem({} as any)).toThrow(/either `\{ module \}`/);
    expect(() => createSystem({ modules: [counter()] } as any)).toThrow(
      /not an array/,
    );
    expect(() => createSystem({ modules: counter() } as any)).toThrow(
      /single module was passed/,
    );
    expect(() =>
      createSystem({ modules: { "a::b": counter() } } as any),
    ).toThrow(/reserved separator/);
  });

  it("warns once when a derivation is read where a module name belongs", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = createSystem({ modules: { a: counter() } }) as any;
    system.start();
    expect(system.derive.doubled).toBeUndefined();
    expect(system.derive.doubled).toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('module "a"');
  });
});

describe("createModule", () => {
  it("throws on reserved fact names and the dependency separator", () => {
    for (const name of ["self", "prev", "current"]) {
      expect(() =>
        createModule("m", { schema: { facts: { [name]: t.number() } } }),
      ).toThrow(/reserved/);
    }
    expect(() =>
      createModule("m", { schema: { facts: { "a\u001Fb": t.number() } } }),
    ).toThrow(/fact key '/);
  });

  it("fills in derive and events, and a factory names each copy", () => {
    const make = createModuleFactory({ schema: { facts: { x: t.number() } } });
    const one = make("one");

    expect(one.id).toBe("one");
    expect(one.derive).toEqual({});
    expect(one.events).toEqual({});
    expect(make("two")).not.toBe(one);
  });
});

describe("an effect's checked read-only view", () => {
  it("reports a value changed in place as a blocked write", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const blocked: unknown[] = [];
    const system = createSystem({
      module: createModule("m", {
        schema: { facts: { list: t.array<number>() } },
        init: (facts) => {
          facts.list = [1];
        },
        effects: {
          push: {
            run: (facts: any) => {
              facts.list.push(2);
            },
          },
        },
      }),
      plugins: [
        {
          name: "p",
          onEffectWriteBlocked: (id: string, key: string) =>
            blocked.push([id, key]),
        },
      ],
    });
    system.start();
    await system.settle();

    expect(blocked).toEqual([["push", "list.1"]]);
    expect(String(error.mock.calls[0]?.[1])).toContain(
      'changed "list.1" in place',
    );
  });

  it("gives a derivation a getter descriptor, as 1.35 does", () => {
    const system = createSystem({ module: counter() });
    system.start();
    const desc = Object.getOwnPropertyDescriptor(system.derive, "doubled");

    expect(desc?.enumerable).toBe(true);
    expect(desc?.get?.()).toBe(2);
  });
});
