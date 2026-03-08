import { describe, it, expect, vi } from "vitest";
import { createModule, createModuleFactory } from "../module.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const minimalSchema = {
  facts: { count: { _type: 0 } },
  derivations: {},
  events: {},
  requirements: {},
};

const fullSchema = {
  facts: {
    count: { _type: 0 },
    name: { _type: "" },
  },
  derivations: {
    doubled: { _type: 0 },
  },
  events: {
    increment: {},
    setName: { name: { _type: "" } },
  },
  requirements: {
    FETCH: { id: { _type: "" } },
  },
};

// ---------------------------------------------------------------------------
// createModule
// ---------------------------------------------------------------------------

describe("createModule", () => {
  it("creates a module def with id and schema", () => {
    const mod = createModule("test", { schema: minimalSchema });
    expect(mod.id).toBe("test");
    expect(mod.schema).toBe(minimalSchema);
  });

  it("passes through all config properties", () => {
    const initFn = vi.fn();
    const deriveFn = vi.fn();
    const eventFn = vi.fn();
    const effectDef = { log: { run: vi.fn() } };
    const constraintDef = {
      check: { when: () => true, require: { type: "X" } },
    };
    const resolverDef = {
      fetch: { requirement: "FETCH", resolve: vi.fn() },
    };
    const hooks = { onStart: vi.fn() };

    // biome-ignore lint/suspicious/noExplicitAny: Test — loose types are fine
    const mod = createModule("full", {
      schema: fullSchema,
      init: initFn,
      derive: { doubled: deriveFn },
      events: { increment: eventFn, setName: eventFn },
      effects: effectDef,
      constraints: constraintDef,
      resolvers: resolverDef,
      hooks,
    } as any);

    expect(mod.init).toBe(initFn);
    expect(mod.derive!.doubled).toBe(deriveFn);
    expect(mod.events!.increment).toBe(eventFn);
    expect(mod.effects).toBe(effectDef);
    expect(mod.constraints).toBe(constraintDef);
    expect(mod.resolvers).toBe(resolverDef);
    expect(mod.hooks).toBe(hooks);
  });

  it("defaults derive and events to empty objects", () => {
    const mod = createModule("defaults", { schema: minimalSchema });
    expect(mod.derive).toEqual({});
    expect(mod.events).toEqual({});
  });

  it("passes through snapshotEvents", () => {
    // biome-ignore lint/suspicious/noExplicitAny: Test — loose types
    const mod = createModule("snap", {
      schema: fullSchema,
      derive: { doubled: (f: any) => f.count * 2 },
      events: {
        increment: (f: any) => { f.count += 1; },
        setName: (f: any, p: any) => { f.name = p.name; },
      },
      snapshotEvents: ["increment"],
    } as any);
    expect(mod.snapshotEvents).toEqual(["increment"]);
  });

  it("stores crossModuleDeps when provided", () => {
    const authSchema = {
      facts: { token: { _type: "" } },
      derivations: {},
      events: {},
      requirements: {},
    };

    const mod = createModule("with-deps", {
      schema: minimalSchema,
      crossModuleDeps: { auth: authSchema },
    } as any);

    expect(mod.crossModuleDeps).toEqual({ auth: authSchema });
  });

  // ---- dev-mode validations -----------------------------------------------

  it("warns on empty module ID", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createModule("", { schema: minimalSchema });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("non-empty string"),
    );
    warnSpy.mockRestore();
  });

  it("warns on non-kebab-case ID", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createModule("My Module", { schema: minimalSchema });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("kebab-case"),
    );
    warnSpy.mockRestore();
  });

  it("warns when schema is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createModule("no-schema", {} as any);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("schema is required"),
    );
    warnSpy.mockRestore();
  });

  it("warns when schema.facts is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createModule("no-facts", { schema: {} as any });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("schema.facts is required"),
    );
    warnSpy.mockRestore();
  });

  it("warns on derive key not in schema.derivations", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createModule("extra-derive", {
      schema: minimalSchema,
      derive: { unknown: () => 1 } as any,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Derivation "unknown" not declared'),
    );
    warnSpy.mockRestore();
  });

  it("warns on schema.derivations key without derive impl", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createModule("missing-derive", {
      schema: {
        facts: { x: { _type: 0 } },
        derivations: { computed: { _type: 0 } },
        events: {},
        requirements: {},
      },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("has no matching implementation in derive"),
    );
    warnSpy.mockRestore();
  });

  it("warns on event key not in schema.events", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createModule("extra-event", {
      schema: minimalSchema,
      events: { unknown: () => {} } as any,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Event "unknown" not declared'),
    );
    warnSpy.mockRestore();
  });

  it("warns on schema.events key without event handler", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createModule("missing-event", {
      schema: {
        facts: { x: { _type: 0 } },
        derivations: {},
        events: { click: {} },
        requirements: {},
      },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("has no matching handler in events"),
    );
    warnSpy.mockRestore();
  });

  it("warns on empty snapshotEvents array", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createModule("empty-snap", {
      schema: minimalSchema,
      snapshotEvents: [],
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("empty array"),
    );
    warnSpy.mockRestore();
  });

  it("warns on snapshotEvents referencing unknown event", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createModule("bad-snap", {
      schema: {
        facts: { x: { _type: 0 } },
        derivations: {},
        events: { click: {} },
        requirements: {},
      },
      events: { click: () => {} } as any,
      snapshotEvents: ["nonexistent" as any],
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"nonexistent" not declared'),
    );
    warnSpy.mockRestore();
  });

  it("warns on resolver referencing unknown requirement type", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createModule("bad-resolver", {
      schema: {
        facts: { x: { _type: 0 } },
        derivations: {},
        events: {},
        requirements: { VALID: {} },
      },
      resolvers: {
        doSomething: {
          requirement: "INVALID",
          resolve: async () => {},
        },
      } as any,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown requirement type "INVALID"'),
    );
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// createModuleFactory
// ---------------------------------------------------------------------------

describe("createModuleFactory", () => {
  it("returns a factory function", () => {
    const factory = createModuleFactory({ schema: minimalSchema });
    expect(typeof factory).toBe("function");
  });

  it("factory produces modules with given name", () => {
    const factory = createModuleFactory({ schema: minimalSchema });
    const mod1 = factory("room-1");
    const mod2 = factory("room-2");

    expect(mod1.id).toBe("room-1");
    expect(mod2.id).toBe("room-2");
    expect(mod1.schema).toBe(mod2.schema);
  });

  it("factory passes through all config", () => {
    const initFn = vi.fn();
    // biome-ignore lint/suspicious/noExplicitAny: Test — loose types
    const factory = createModuleFactory({
      schema: fullSchema,
      init: initFn,
      derive: { doubled: (f: any) => f.count * 2 },
      events: {
        increment: (f: any) => { f.count += 1; },
        setName: (f: any, p: any) => { f.name = p.name; },
      },
    } as any);

    const mod = factory("instance");
    expect(mod.init).toBe(initFn);
    expect(mod.derive!.doubled).toBeDefined();
  });

  it("each factory call produces independent module defs", () => {
    const factory = createModuleFactory({ schema: minimalSchema });
    const a = factory("a");
    const b = factory("b");
    expect(a).not.toBe(b);
    expect(a.id).not.toBe(b.id);
  });
});
