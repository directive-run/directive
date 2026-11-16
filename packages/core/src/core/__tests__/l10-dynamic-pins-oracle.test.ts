import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box pins of 1.35's dynamic-definition behaviour that no other test
// states (the L10 RFC, "Untested behaviours" U1, U4, U6 to U8, U10, U13 and
// U22). Each pins what 1.35 does today. Row (bl) is approved for L10a, so U1
// shows it: L10a keeps what both engines share and pins 2.0's side in
// core-next. Rows (bn) and (bo) were declined, so U4 and U22 are 1.35's for
// good. Public API only.

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const warnings = () =>
  vi.mocked(console.warn).mock.calls.map((call) => call.map(String).join(" "));

/** The RFC's probe module: facts a, b and log, a derivation and WORK. */
function probe() {
  return createModule("m", {
    schema: {
      facts: { a: t.number(), b: t.number(), log: t.string() },
      derivations: { double: t.number() },
      events: { bump: {} },
      requirements: { WORK: {} },
    },
    init: (facts: any) => {
      facts.a = 1;
      facts.b = 0;
      facts.log = "";
    },
    derive: { double: (facts: any) => facts.a * 2 },
    events: {
      bump: (facts: any) => {
        facts.a += 1;
      },
    },
  } as never);
}

function begin(options: Record<string, unknown> = {}) {
  const system = createSystem({ module: probe(), ...options } as never) as any;
  system.start();

  return system;
}

describe("derive.assign with { compute, meta } leaves the derivation throwing (U1; row bl)", () => {
  // Row (bl), approved for L10a (the L10 RFC rev 2; "I approve you for to
  // do everything", 2026-11-15): 2.0 unwraps the object on assign as on
  // register. 1.35 writes the raw object back over the unwrapped compute.
  it("on a registered derivation: the assign returns, then every read, call and meta.derivation throws until a function is assigned", () => {
    const system = begin();
    system.derive.register("tripled", (facts: any) => facts.a * 3);

    expect(system.read("tripled")).toBe(3);
    expect(() =>
      system.derive.assign("tripled", {
        compute: (facts: any) => facts.a * 4,
        meta: { label: "X" },
      }),
    ).not.toThrow();
    expect(() => system.read("tripled")).toThrow(TypeError);
    expect(() => system.read("tripled")).toThrow("is not a function");
    expect(() => system.derive.call("tripled")).toThrow("is not a function");
    expect(() => system.meta.derivation("tripled")).toThrow(
      "is not a function",
    );
    system.facts.a = 2;
    expect(() => system.read("tripled")).toThrow("is not a function");

    system.derive.assign("tripled", (facts: any) => facts.a * 6);
    expect(system.read("tripled")).toBe(12);
    system.destroy();
  });

  it("on a static derivation: the same", () => {
    const system = begin();

    expect(() =>
      system.derive.assign("double", {
        compute: (facts: any) => facts.a * 5,
        meta: { label: "Y" },
      }),
    ).not.toThrow();
    expect(() => system.read("double")).toThrow("is not a function");
    system.derive.assign("double", (facts: any) => facts.a * 7);
    expect(system.read("double")).toBe(7);
    system.destroy();
  });

  it("register with the same object form works", () => {
    const system = begin();
    system.derive.register("objreg", {
      compute: (facts: any) => facts.a + 101,
      meta: { label: "Obj" },
    });

    expect(system.read("objreg")).toBe(102);
    expect(system.meta.derivation("objreg")).toMatchObject({ label: "Obj" });
    system.destroy();
  });
});

describe("a subscriber to a name not registered yet is never called (U4; row bn, declined)", () => {
  it("development warns at the call; the later registration and its changes reach no subscriber", async () => {
    const system = begin();
    const heard: unknown[] = [];
    system.subscribe(["later"], () => heard.push(system.read("later")));

    expect(warnings()).toContain('[Directive] subscribe: unknown key "later"');
    system.derive.register("later", (facts: any) => facts.a + 100);
    expect(system.read("later")).toBe(101);
    system.facts.a = 5;
    await wait(5);
    expect(system.read("later")).toBe(105);
    expect(heard).toEqual([]);
    system.destroy();
  });
});

/** A module of each kind, for registerModule over the probe module. */
function extra() {
  return createModule("x", {
    schema: {
      facts: { c: t.number() },
      derivations: { double: t.number(), cPlus: t.number() },
      events: {},
      requirements: { NOTE: {} },
    },
    init: (facts: any) => {
      facts.c = 7;
    },
    derive: { double: () => -1, cPlus: (facts: any) => facts.c + 1 },
    constraints: {
      note: { when: (facts: any) => facts.c > 100, require: { type: "NOTE" } },
    },
    resolvers: {
      noter: { requirement: "NOTE", resolve: async () => {} },
    },
    effects: { watchC: { run: () => {} } },
  } as never);
}

describe("a module's definitions are not dynamic (U6)", () => {
  it("isDynamic is false and listDynamic is empty for every kind", async () => {
    const system = begin();
    system.registerModule(extra());
    await wait(5);

    expect(system.read("cPlus")).toBe(8);
    expect(system.derive.isDynamic("cPlus")).toBe(false);
    expect(system.constraints.isDynamic("note")).toBe(false);
    expect(system.resolvers.isDynamic("noter")).toBe(false);
    expect(system.effects.isDynamic("watchC")).toBe(false);
    expect(system.derive.listDynamic()).toEqual([]);
    expect(system.constraints.listDynamic()).toEqual([]);
    expect(system.resolvers.listDynamic()).toEqual([]);
    expect(system.effects.listDynamic()).toEqual([]);
    system.destroy();
  });
});

describe("registerModule over a live derivation replaces it (U7)", () => {
  it("the module's compute wins, and development says nothing", async () => {
    const system = begin();

    expect(system.read("double")).toBe(2);
    system.registerModule(extra());
    await wait(5);
    expect(system.read("double")).toBe(-1);
    expect(warnings()).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
    system.destroy();
  });
});

describe("meta.subscribe hears each definition change once, registerModule twice (U8)", () => {
  it("2 for registerModule, then 1 each for register, assign and unregister, and 0 for a write", async () => {
    const system = begin();
    let calls = 0;
    system.meta.subscribe(() => {
      calls += 1;
    });
    system.registerModule(extra());
    await wait(5);

    expect(calls).toBe(2);
    system.derive.register("z", () => 1);
    expect(calls).toBe(3);
    system.derive.assign("z", () => 2);
    expect(calls).toBe(4);
    system.derive.unregister("z");
    expect(calls).toBe(5);
    system.facts.a = 9;
    await wait(5);
    expect(calls).toBe(5);
    system.destroy();
  });
});

describe("unregistering a static or unknown id is not an error (U10)", () => {
  it("each returns, and development warns 'Cannot unregister static …', for an unknown id too", () => {
    const system = begin();

    expect(system.derive.unregister("double")).toBeUndefined();
    expect(system.effects.unregister("nope")).toBeUndefined();
    expect(system.constraints.unregister("nope")).toBeUndefined();
    expect(warnings()).toEqual([
      '[Directive] Cannot unregister static derivation "double". Only dynamically registered derivations can be removed.',
      '[Directive] Cannot unregister static effect "nope". Only dynamically registered effects can be removed.',
      '[Directive] Cannot unregister static constraint "nope". Only dynamically registered constraints can be removed.',
    ]);
    expect(system.read("double")).toBe(2);
    system.destroy();
  });
});

describe("the trace's hit rows after a constraint is unregistered mid-flight (U13)", () => {
  it("name only constraints that exist: the unregister's pass hits nothing", async () => {
    const system = begin({ trace: true });
    await wait(1);
    system.resolvers.register("work", {
      requirement: "WORK",
      resolve: async (_req: unknown, context: any) => {
        await wait(30);
        context.facts.log = "done";
      },
    });
    system.constraints.register("dyn", {
      when: (facts: any) => facts.a > 1,
      require: { type: "WORK" },
    });
    system.facts.a = 2;
    await wait(5);
    system.constraints.unregister("dyn");
    await wait(60);
    await system.settle();

    const hits = system.trace.map((run: any) =>
      run.constraintsHit.map((c: any) => c.id),
    );
    expect(hits).toEqual([[], ["dyn"], []]);
    expect(system.inspect().constraints).toEqual([]);
    expect(system.inspect().unmet).toEqual([]);
    expect(system.facts.log).toBe("done");
    system.destroy();
  });
});

describe("getOriginal and restoreOriginal are not on a 1.35 system (U22; row bo, declined)", () => {
  // The RFC read them from 1.35's `System` type (api-surface.json); the
  // L10-pre probe found no runtime member: createSystem's object has
  // neither, single-module or namespaced. So 2.0 keeps them absent.
  it("a single-module system has neither member", () => {
    const system = begin();
    system.derive.assign("double", (facts: any) => facts.a * 10);

    expect(typeof system.getOriginal).toBe("undefined");
    expect(typeof system.restoreOriginal).toBe("undefined");
    expect("getOriginal" in system).toBe(false);
    expect("restoreOriginal" in system).toBe(false);
    system.destroy();
  });

  it("a namespaced system has neither member", () => {
    const system = createSystem({ modules: { m: probe() } } as never) as any;
    system.start();

    expect(typeof system.getOriginal).toBe("undefined");
    expect(typeof system.restoreOriginal).toBe("undefined");
    system.destroy();
  });
});
