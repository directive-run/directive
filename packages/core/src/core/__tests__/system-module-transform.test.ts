import { describe, expect, it, vi } from "vitest";
import {
  prefixModuleDefinition,
  type PrefixModuleOptions,
  type FlatModuleDefinition,
} from "../system-module-transform.js";
import type { ModuleDef, ModuleSchema, ModulesMap } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

const minimalSchema: ModuleSchema = {
  facts: { count: { _type: 0 }, name: { _type: "" } },
};

const fullSchema: ModuleSchema = {
  facts: {
    count: { _type: 0 },
    name: { _type: "" },
    active: { _type: false },
  },
  derivations: {
    doubled: { _type: 0 },
    label: { _type: "" },
  },
  events: {
    increment: {},
    setName: { name: { _type: "" } },
  },
  requirements: {
    FETCH: { id: { _type: "" } },
    SAVE: {},
  },
};

function makeModule(
  overrides: Partial<ModuleDef<ModuleSchema>> = {},
): ModuleDef<ModuleSchema> {
  return {
    id: "test-mod",
    schema: minimalSchema,
    ...overrides,
  };
}

function makeOptions(
  overrides: Partial<PrefixModuleOptions> = {},
): PrefixModuleOptions {
  const mod = overrides.mod ?? makeModule();
  const modulesMap: ModulesMap = overrides.modulesMap ?? { auth: mod };
  const namespace = overrides.namespace ?? "auth";

  return {
    mod,
    namespace,
    modulesMap,
    getModuleNames: overrides.getModuleNames ?? (() => Object.keys(modulesMap)),
    snapshotModulesSet: overrides.snapshotModulesSet ?? null,
  };
}

// ============================================================================
// Return Shape
// ============================================================================

describe("prefixModuleDefinition", () => {
  describe("return shape", () => {
    it("returns id from the module", () => {
      const result = prefixModuleDefinition(
        makeOptions({ mod: makeModule({ id: "my-module" }) }),
      );

      expect(result.id).toBe("my-module");
    });

    it("returns hooks from the module unchanged", () => {
      const hooks = { onStart: vi.fn(), onStop: vi.fn() };
      const result = prefixModuleDefinition(
        makeOptions({ mod: makeModule({ hooks }) }),
      );

      expect(result.hooks).toBe(hooks);
    });

    it("returns requirements from schema", () => {
      const result = prefixModuleDefinition(
        makeOptions({
          mod: makeModule({
            schema: {
              facts: { x: { _type: 0 } },
              requirements: { FETCH: { id: { _type: "" } } },
            },
          }),
        }),
      );

      expect(result.requirements).toEqual({ FETCH: { id: { _type: "" } } });
    });

    it("returns empty requirements object when schema has no requirements", () => {
      const result = prefixModuleDefinition(
        makeOptions({ mod: makeModule({ schema: minimalSchema }) }),
      );

      expect(result.requirements).toEqual({});
    });

    it("returns all expected keys", () => {
      const result = prefixModuleDefinition(makeOptions());
      const keys = Object.keys(result).sort();

      expect(keys).toEqual([
        "constraints",
        "derive",
        "effects",
        "events",
        "history",
        "hooks",
        "id",
        "init",
        "requirements",
        "resolvers",
        "schema",
      ]);
    });
  });

  // ==========================================================================
  // Empty sections
  // ==========================================================================

  describe("empty sections", () => {
    it("returns undefined for derive when module has no derive", () => {
      const result = prefixModuleDefinition(makeOptions());

      expect(result.derive).toBeUndefined();
    });

    it("returns undefined for events when module has no events", () => {
      const result = prefixModuleDefinition(makeOptions());

      expect(result.events).toBeUndefined();
    });

    it("returns undefined for effects when module has no effects", () => {
      const result = prefixModuleDefinition(makeOptions());

      expect(result.effects).toBeUndefined();
    });

    it("returns undefined for constraints when module has no constraints", () => {
      const result = prefixModuleDefinition(makeOptions());

      expect(result.constraints).toBeUndefined();
    });

    it("returns undefined for resolvers when module has no resolvers", () => {
      const result = prefixModuleDefinition(makeOptions());

      expect(result.resolvers).toBeUndefined();
    });

    it("returns undefined for init when module has no init", () => {
      const result = prefixModuleDefinition(makeOptions());

      expect(result.init).toBeUndefined();
    });
  });

  // ==========================================================================
  // Schema prefixing
  // ==========================================================================

  describe("schema prefixing", () => {
    it("prefixes all fact keys with namespace::key", () => {
      const result = prefixModuleDefinition(
        makeOptions({ namespace: "auth" }),
      );

      expect(result.schema).toEqual({
        "auth::count": { _type: 0 },
        "auth::name": { _type: "" },
      });
    });

    it("uses the correct namespace", () => {
      const result = prefixModuleDefinition(
        makeOptions({ namespace: "data" }),
      );

      expect(Object.keys(result.schema)).toEqual(["data::count", "data::name"]);
    });

    it("preserves schema values", () => {
      const schema: ModuleSchema = {
        facts: {
          flag: { _type: false, _validate: (v: unknown) => typeof v === "boolean" },
        },
      };
      const result = prefixModuleDefinition(
        makeOptions({ mod: makeModule({ schema }), namespace: "cfg" }),
      );

      expect(result.schema["cfg::flag"]).toBe(schema.facts.flag);
    });
  });

  // ==========================================================================
  // Init
  // ==========================================================================

  describe("init", () => {
    it("wraps init to translate proxy keys", () => {
      const initFn = vi.fn((facts: any) => {
        facts.count = 42;
        facts.name = "hello";
      });
      const mod = makeModule({ init: initFn });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "app" }));

      // Simulate calling with a flat facts store
      const flatStore: Record<string, unknown> = {};
      result.init!(flatStore);

      expect(flatStore["app::count"]).toBe(42);
      expect(flatStore["app::name"]).toBe("hello");
    });

    it("reads existing values through the proxy", () => {
      let readValue: unknown;
      const initFn = vi.fn((facts: any) => {
        readValue = facts.count;
      });
      const mod = makeModule({ init: initFn });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "ns" }));

      const flatStore: Record<string, unknown> = { "ns::count": 99 };
      result.init!(flatStore);

      expect(readValue).toBe(99);
    });

    it("calls the original init function exactly once", () => {
      const initFn = vi.fn();
      const mod = makeModule({ init: initFn });
      const result = prefixModuleDefinition(makeOptions({ mod }));

      result.init!({});

      expect(initFn).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // Derive
  // ==========================================================================

  describe("derive", () => {
    it("prefixes derivation keys", () => {
      const mod = makeModule({
        schema: fullSchema,
        derive: {
          doubled: (facts: any) => facts.count * 2,
          label: (facts: any) => `${facts.name}-label`,
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "app" }));

      expect(Object.keys(result.derive!)).toEqual(["app::doubled", "app::label"]);
    });

    it("derivation functions receive proxied facts", () => {
      const mod = makeModule({
        schema: fullSchema,
        derive: {
          doubled: (facts: any) => facts.count * 2,
          label: () => "x",
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "m" }));

      const flatFacts = { "m::count": 5 };
      const flatDerive = {};
      const value = result.derive!["m::doubled"](flatFacts, flatDerive);

      expect(value).toBe(10);
    });

    it("derivation functions receive proxied derive accessor", () => {
      const mod = makeModule({
        schema: fullSchema,
        derive: {
          doubled: (facts: any) => facts.count * 2,
          label: (facts: any, derived: any) => `${derived.doubled}-label`,
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "z" }));

      const flatFacts = { "z::count": 3 };
      const flatDerive = { "z::doubled": 6 };
      const value = result.derive!["z::label"](flatFacts, flatDerive);

      expect(value).toBe("6-label");
    });

    it("uses cross-module facts proxy when crossModuleDeps defined", () => {
      const otherSchema: ModuleSchema = { facts: { token: { _type: "" } } };
      const mod = makeModule({
        schema: fullSchema,
        derive: {
          doubled: (facts: any) => facts.self.count * 2,
          label: () => "x",
        },
        crossModuleDeps: { other: otherSchema },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "m" }));

      const flatFacts = { "m::count": 7, "other::token": "abc" };
      const flatDerive = {};
      const value = result.derive!["m::doubled"](flatFacts, flatDerive);

      expect(value).toBe(14);
    });

    it("cross-module derive can read dependency module facts", () => {
      const otherSchema: ModuleSchema = { facts: { token: { _type: "" } } };
      const mod = makeModule({
        schema: fullSchema,
        derive: {
          doubled: () => 0,
          label: (facts: any) => `token:${facts.other.token}`,
        },
        crossModuleDeps: { other: otherSchema },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "m" }));

      const flatFacts = { "m::count": 1, "other::token": "xyz" };
      const value = result.derive!["m::label"](flatFacts, {});

      expect(value).toBe("token:xyz");
    });
  });

  // ==========================================================================
  // Events
  // ==========================================================================

  describe("events", () => {
    it("prefixes event handler keys", () => {
      const mod = makeModule({
        schema: fullSchema,
        events: {
          increment: (facts: any) => { facts.count += 1; },
          setName: (facts: any, payload: any) => { facts.name = payload.name; },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "ev" }));

      expect(Object.keys(result.events!)).toEqual(["ev::increment", "ev::setName"]);
    });

    it("event handlers receive proxied facts for writes", () => {
      const mod = makeModule({
        schema: fullSchema,
        events: {
          increment: (facts: any) => { facts.count += 1; },
          setName: () => {},
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "ev" }));

      const flatStore: Record<string, unknown> = { "ev::count": 10 };
      result.events!["ev::increment"](flatStore, {});

      expect(flatStore["ev::count"]).toBe(11);
    });

    it("event handlers receive the event payload", () => {
      let receivedPayload: unknown;
      const mod = makeModule({
        schema: fullSchema,
        events: {
          increment: () => {},
          setName: (_facts: any, payload: any) => {
            receivedPayload = payload;
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "ev" }));

      const payload = { name: "test" };
      result.events!["ev::setName"]({}, payload);

      expect(receivedPayload).toBe(payload);
    });
  });

  // ==========================================================================
  // Constraints
  // ==========================================================================

  describe("constraints", () => {
    it("prefixes constraint keys", () => {
      const mod = makeModule({
        schema: fullSchema,
        constraints: {
          check: {
            when: () => true,
            require: { type: "FETCH", id: "1" },
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "c" }));

      expect(Object.keys(result.constraints!)).toEqual(["c::check"]);
    });

    it("when function receives proxied facts", () => {
      let readCount: unknown;
      const mod = makeModule({
        schema: fullSchema,
        constraints: {
          check: {
            when: (facts: any) => {
              readCount = facts.count;

              return facts.count > 5;
            },
            require: { type: "FETCH", id: "1" },
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "c" }));

      const constraint = result.constraints!["c::check"] as any;
      const flatFacts = { "c::count": 10 };
      const whenResult = constraint.when(flatFacts);

      expect(readCount).toBe(10);
      expect(whenResult).toBe(true);
    });

    it("when returns false when condition not met", () => {
      const mod = makeModule({
        schema: fullSchema,
        constraints: {
          check: {
            when: (facts: any) => facts.count > 100,
            require: { type: "FETCH", id: "1" },
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "c" }));

      const constraint = result.constraints!["c::check"] as any;

      expect(constraint.when({ "c::count": 2 })).toBe(false);
    });

    it("static require is passed through unchanged", () => {
      const staticReq = { type: "FETCH", id: "abc" };
      const mod = makeModule({
        schema: fullSchema,
        constraints: {
          check: { when: () => true, require: staticReq },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "c" }));

      const constraint = result.constraints!["c::check"] as any;

      expect(constraint.require).toBe(staticReq);
    });

    it("function require receives proxied facts", () => {
      const mod = makeModule({
        schema: fullSchema,
        constraints: {
          check: {
            when: () => true,
            require: (facts: any) => ({ type: "FETCH", id: facts.name }),
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "c" }));

      const constraint = result.constraints!["c::check"] as any;
      const flatFacts = { "c::name": "hello" };
      const req = constraint.require(flatFacts);

      expect(req).toEqual({ type: "FETCH", id: "hello" });
    });

    it("prefixes deps array", () => {
      const mod = makeModule({
        schema: fullSchema,
        constraints: {
          check: {
            when: () => true,
            require: { type: "FETCH", id: "1" },
            deps: ["count", "name"],
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "c" }));

      const constraint = result.constraints!["c::check"] as any;

      expect(constraint.deps).toEqual(["c::count", "c::name"]);
    });

    it("prefixes after array for same-module references", () => {
      const mod = makeModule({
        schema: fullSchema,
        constraints: {
          first: {
            when: () => true,
            require: { type: "FETCH", id: "1" },
          },
          second: {
            when: () => true,
            require: { type: "SAVE" },
            after: ["first"],
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "c" }));

      const constraint = result.constraints!["c::second"] as any;

      expect(constraint.after).toEqual(["c::first"]);
    });

    it("passes through already-prefixed after references (containing ::)", () => {
      const mod = makeModule({
        schema: fullSchema,
        constraints: {
          check: {
            when: () => true,
            require: { type: "FETCH", id: "1" },
            after: ["local", "other::remote"],
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "c" }));

      const constraint = result.constraints!["c::check"] as any;

      expect(constraint.after).toEqual(["c::local", "other::remote"]);
    });

    it("preserves priority", () => {
      const mod = makeModule({
        schema: fullSchema,
        constraints: {
          check: {
            priority: 99,
            when: () => true,
            require: { type: "FETCH", id: "1" },
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "c" }));

      const constraint = result.constraints!["c::check"] as any;

      expect(constraint.priority).toBe(99);
    });

    it("preserves async and timeout", () => {
      const mod = makeModule({
        schema: fullSchema,
        constraints: {
          check: {
            async: true,
            timeout: 5000,
            when: () => Promise.resolve(true),
            require: { type: "FETCH", id: "1" },
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "c" }));

      const constraint = result.constraints!["c::check"] as any;

      expect(constraint.async).toBe(true);
      expect(constraint.timeout).toBe(5000);
    });

    it("constraint when uses cross-module proxy when crossModuleDeps defined", () => {
      const otherSchema: ModuleSchema = { facts: { token: { _type: "" } } };
      let readToken: unknown;
      const mod = makeModule({
        schema: fullSchema,
        constraints: {
          check: {
            when: (facts: any) => {
              readToken = facts.other.token;

              return true;
            },
            require: { type: "FETCH", id: "1" },
          },
        },
        crossModuleDeps: { other: otherSchema },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "m" }));

      const constraint = result.constraints!["m::check"] as any;
      constraint.when({ "m::count": 1, "other::token": "secret" });

      expect(readToken).toBe("secret");
    });

    it("constraint function require uses cross-module proxy when crossModuleDeps defined", () => {
      const otherSchema: ModuleSchema = { facts: { token: { _type: "" } } };
      const mod = makeModule({
        schema: fullSchema,
        constraints: {
          check: {
            when: () => true,
            require: (facts: any) => ({ type: "FETCH", id: facts.other.token }),
          },
        },
        crossModuleDeps: { other: otherSchema },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "m" }));

      const constraint = result.constraints!["m::check"] as any;
      const req = constraint.require({ "m::count": 1, "other::token": "tok123" });

      expect(req).toEqual({ type: "FETCH", id: "tok123" });
    });

    it("returns undefined deps when original has no deps", () => {
      const mod = makeModule({
        schema: fullSchema,
        constraints: {
          check: {
            when: () => true,
            require: { type: "FETCH", id: "1" },
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "c" }));

      const constraint = result.constraints!["c::check"] as any;

      expect(constraint.deps).toBeUndefined();
    });

    it("returns undefined after when original has no after", () => {
      const mod = makeModule({
        schema: fullSchema,
        constraints: {
          check: {
            when: () => true,
            require: { type: "FETCH", id: "1" },
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "c" }));

      const constraint = result.constraints!["c::check"] as any;

      expect(constraint.after).toBeUndefined();
    });
  });

  // ==========================================================================
  // Resolvers
  // ==========================================================================

  describe("resolvers", () => {
    it("prefixes resolver keys", () => {
      const mod = makeModule({
        schema: fullSchema,
        resolvers: {
          fetch: {
            requirement: "FETCH",
            resolve: async () => {},
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "r" }));

      expect(Object.keys(result.resolvers!)).toEqual(["r::fetch"]);
    });

    it("preserves requirement type", () => {
      const mod = makeModule({
        schema: fullSchema,
        resolvers: {
          fetch: {
            requirement: "FETCH",
            resolve: async () => {},
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "r" }));

      const resolver = result.resolvers!["r::fetch"] as any;

      expect(resolver.requirement).toBe("FETCH");
    });

    it("preserves key function", () => {
      const keyFn = (req: any) => `fetch-${req.id}`;
      const mod = makeModule({
        schema: fullSchema,
        resolvers: {
          fetch: {
            requirement: "FETCH",
            key: keyFn,
            resolve: async () => {},
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "r" }));

      const resolver = result.resolvers!["r::fetch"] as any;

      expect(resolver.key).toBe(keyFn);
    });

    it("preserves retry policy", () => {
      const retry = { attempts: 3, backoff: "exponential" as const };
      const mod = makeModule({
        schema: fullSchema,
        resolvers: {
          fetch: {
            requirement: "FETCH",
            retry,
            resolve: async () => {},
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "r" }));

      const resolver = result.resolvers!["r::fetch"] as any;

      expect(resolver.retry).toBe(retry);
    });

    it("resolve receives namespaced facts proxy scoped to own module", async () => {
      const resolveFn = vi.fn(async (req: any, ctx: any) => {
        ctx.facts.count = 100;
      });
      const mod = makeModule({
        schema: fullSchema,
        resolvers: {
          fetch: {
            requirement: "FETCH",
            resolve: resolveFn,
          },
        },
      });
      const modulesMap: ModulesMap = { r: mod };
      const result = prefixModuleDefinition(
        makeOptions({ mod, namespace: "r", modulesMap }),
      );

      const resolver = result.resolvers!["r::fetch"] as any;
      const flatFacts: Record<string, unknown> = { "r::count": 0 };
      const controller = new AbortController();

      await resolver.resolve(
        { type: "FETCH", id: "1" },
        { facts: flatFacts, signal: controller.signal },
      );

      expect(flatFacts["r::count"]).toBe(100);
    });

    it("resolve passes through the abort signal", async () => {
      let receivedSignal: AbortSignal | undefined;
      const resolveFn = vi.fn(async (_req: any, ctx: any) => {
        receivedSignal = ctx.signal;
      });
      const mod = makeModule({
        schema: fullSchema,
        resolvers: {
          fetch: {
            requirement: "FETCH",
            resolve: resolveFn,
          },
        },
      });
      const modulesMap: ModulesMap = { r: mod };
      const result = prefixModuleDefinition(
        makeOptions({ mod, namespace: "r", modulesMap }),
      );

      const resolver = result.resolvers!["r::fetch"] as any;
      const controller = new AbortController();

      await resolver.resolve(
        { type: "FETCH", id: "1" },
        { facts: {}, signal: controller.signal },
      );

      expect(receivedSignal).toBe(controller.signal);
    });

    it("resolve passes through the requirement object", async () => {
      let receivedReq: unknown;
      const mod = makeModule({
        schema: fullSchema,
        resolvers: {
          fetch: {
            requirement: "FETCH",
            resolve: async (req: any) => {
              receivedReq = req;
            },
          },
        },
      });
      const modulesMap: ModulesMap = { r: mod };
      const result = prefixModuleDefinition(
        makeOptions({ mod, namespace: "r", modulesMap }),
      );

      const resolver = result.resolvers!["r::fetch"] as any;
      const req = { type: "FETCH", id: "abc" };

      await resolver.resolve(req, { facts: {}, signal: new AbortController().signal });

      expect(receivedReq).toBe(req);
    });
  });

  // ==========================================================================
  // Effects
  // ==========================================================================

  describe("effects", () => {
    it("prefixes effect keys", () => {
      const mod = makeModule({
        effects: {
          log: { run: () => {} },
          sync: { run: () => {} },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "e" }));

      expect(Object.keys(result.effects!)).toEqual(["e::log", "e::sync"]);
    });

    it("effect run receives proxied facts", () => {
      let readCount: unknown;
      const mod = makeModule({
        effects: {
          log: {
            run: (facts: any) => {
              readCount = facts.count;
            },
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "e" }));

      const effect = result.effects!["e::log"] as any;
      effect.run({ "e::count": 42 }, undefined);

      expect(readCount).toBe(42);
    });

    it("effect run receives proxied prev facts", () => {
      let prevCount: unknown;
      const mod = makeModule({
        effects: {
          log: {
            run: (_facts: any, prev: any) => {
              prevCount = prev?.count;
            },
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "e" }));

      const effect = result.effects!["e::log"] as any;
      effect.run({ "e::count": 10 }, { "e::count": 5 });

      expect(prevCount).toBe(5);
    });

    it("effect run receives undefined prev when prev is null/undefined", () => {
      let prevArg: unknown = "sentinel";
      const mod = makeModule({
        effects: {
          log: {
            run: (_facts: any, prev: any) => {
              prevArg = prev;
            },
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "e" }));

      const effect = result.effects!["e::log"] as any;
      effect.run({ "e::count": 10 }, undefined);

      expect(prevArg).toBeUndefined();
    });

    it("prefixes deps array", () => {
      const mod = makeModule({
        effects: {
          log: {
            run: () => {},
            deps: ["count", "name"],
          },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "e" }));

      const effect = result.effects!["e::log"] as any;

      expect(effect.deps).toEqual(["e::count", "e::name"]);
    });

    it("returns undefined deps when original has no deps", () => {
      const mod = makeModule({
        effects: {
          log: { run: () => {} },
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "e" }));

      const effect = result.effects!["e::log"] as any;

      expect(effect.deps).toBeUndefined();
    });

    it("effect uses cross-module proxy when crossModuleDeps defined", () => {
      const otherSchema: ModuleSchema = { facts: { token: { _type: "" } } };
      let readToken: unknown;
      const mod = makeModule({
        effects: {
          log: {
            run: (facts: any) => {
              readToken = facts.other.token;
            },
          },
        },
        crossModuleDeps: { other: otherSchema },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "m" }));

      const effect = result.effects!["m::log"] as any;
      effect.run({ "m::count": 1, "other::token": "xyz" }, undefined);

      expect(readToken).toBe("xyz");
    });

    it("effect prev uses cross-module proxy when crossModuleDeps defined", () => {
      const otherSchema: ModuleSchema = { facts: { token: { _type: "" } } };
      let prevToken: unknown;
      const mod = makeModule({
        effects: {
          log: {
            run: (_facts: any, prev: any) => {
              prevToken = prev?.other?.token;
            },
          },
        },
        crossModuleDeps: { other: otherSchema },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "m" }));

      const effect = result.effects!["m::log"] as any;
      effect.run(
        { "m::count": 1, "other::token": "new" },
        { "m::count": 0, "other::token": "old" },
      );

      expect(prevToken).toBe("old");
    });
  });

  // ==========================================================================
  // History
  // ==========================================================================

  describe("history", () => {
    it("prefixes snapshotEvents", () => {
      const mod = makeModule({
        schema: fullSchema,
        history: { snapshotEvents: ["increment", "setName"] },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "h" }));

      expect(result.history.snapshotEvents).toEqual([
        "h::increment",
        "h::setName",
      ]);
    });

    it("returns undefined snapshotEvents when module has no history config", () => {
      const mod = makeModule();
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "h" }));

      expect(result.history.snapshotEvents).toBeUndefined();
    });

    it("returns empty array when module is excluded from snapshots", () => {
      const mod = makeModule({
        schema: fullSchema,
        history: { snapshotEvents: ["increment"] },
      });
      const excluded = new Set(["other"]);
      const result = prefixModuleDefinition(
        makeOptions({ mod, namespace: "h", snapshotModulesSet: excluded }),
      );

      expect(result.history.snapshotEvents).toEqual([]);
    });

    it("returns prefixed events when module is included in snapshots set", () => {
      const mod = makeModule({
        schema: fullSchema,
        history: { snapshotEvents: ["increment"] },
      });
      const included = new Set(["h"]);
      const result = prefixModuleDefinition(
        makeOptions({ mod, namespace: "h", snapshotModulesSet: included }),
      );

      expect(result.history.snapshotEvents).toEqual(["h::increment"]);
    });

    it("returns prefixed events when snapshotModulesSet is null (all included)", () => {
      const mod = makeModule({
        schema: fullSchema,
        history: { snapshotEvents: ["increment"] },
      });
      const result = prefixModuleDefinition(
        makeOptions({ mod, namespace: "h", snapshotModulesSet: null }),
      );

      expect(result.history.snapshotEvents).toEqual(["h::increment"]);
    });
  });

  // ==========================================================================
  // getFactsProxy selection (internal)
  // ==========================================================================

  describe("getFactsProxy selection", () => {
    it("uses simple module proxy when no crossModuleDeps", () => {
      let readSelf: unknown;
      const mod = makeModule({
        schema: fullSchema,
        derive: {
          doubled: (facts: any) => {
            // Without crossModuleDeps, facts.count accesses directly
            readSelf = facts.count;

            return facts.count * 2;
          },
          label: () => "x",
        },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "m" }));

      result.derive!["m::doubled"]({ "m::count": 8 }, {});

      expect(readSelf).toBe(8);
    });

    it("uses cross-module proxy when crossModuleDeps has keys", () => {
      const otherSchema: ModuleSchema = { facts: { token: { _type: "" } } };
      let readSelfCount: unknown;
      let readOtherToken: unknown;
      const mod = makeModule({
        schema: fullSchema,
        derive: {
          doubled: (facts: any) => {
            readSelfCount = facts.self.count;
            readOtherToken = facts.other.token;

            return facts.self.count * 2;
          },
          label: () => "x",
        },
        crossModuleDeps: { other: otherSchema },
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "m" }));

      result.derive!["m::doubled"](
        { "m::count": 4, "other::token": "tok" },
        {},
      );

      expect(readSelfCount).toBe(4);
      expect(readOtherToken).toBe("tok");
    });

    it("empty crossModuleDeps object uses simple module proxy", () => {
      let readCount: unknown;
      const mod = makeModule({
        schema: fullSchema,
        derive: {
          doubled: (facts: any) => {
            readCount = facts.count;

            return facts.count * 2;
          },
          label: () => "x",
        },
        crossModuleDeps: {},
      });
      const result = prefixModuleDefinition(makeOptions({ mod, namespace: "m" }));

      result.derive!["m::doubled"]({ "m::count": 3 }, {});

      expect(readCount).toBe(3);
    });
  });

  // ==========================================================================
  // Multiple sections together
  // ==========================================================================

  describe("full module with all sections", () => {
    it("transforms all sections of a complete module", () => {
      const mod = makeModule({
        id: "full",
        schema: fullSchema,
        init: (facts: any) => {
          facts.count = 0;
        },
        derive: {
          doubled: (facts: any) => facts.count * 2,
          label: (facts: any) => facts.name,
        },
        events: {
          increment: (facts: any) => { facts.count += 1; },
          setName: (facts: any, p: any) => { facts.name = p.name; },
        },
        effects: {
          log: { run: () => {}, deps: ["count"] },
        },
        constraints: {
          check: {
            when: (facts: any) => facts.count > 10,
            require: { type: "FETCH", id: "1" },
            deps: ["count"],
          },
        },
        resolvers: {
          fetch: {
            requirement: "FETCH",
            resolve: async () => {},
          },
        },
        hooks: { onStart: vi.fn() },
        history: { snapshotEvents: ["increment"] },
      });

      const modulesMap: ModulesMap = { app: mod };
      const result = prefixModuleDefinition(
        makeOptions({ mod, namespace: "app", modulesMap }),
      );

      // Schema
      expect(Object.keys(result.schema)).toEqual([
        "app::count",
        "app::name",
        "app::active",
      ]);

      // Init
      const store: Record<string, unknown> = {};
      result.init!(store);
      expect(store["app::count"]).toBe(0);

      // Derive
      expect(Object.keys(result.derive!)).toEqual(["app::doubled", "app::label"]);

      // Events
      expect(Object.keys(result.events!)).toEqual(["app::increment", "app::setName"]);

      // Effects
      expect(Object.keys(result.effects!)).toEqual(["app::log"]);
      expect((result.effects!["app::log"] as any).deps).toEqual(["app::count"]);

      // Constraints
      expect(Object.keys(result.constraints!)).toEqual(["app::check"]);
      expect((result.constraints!["app::check"] as any).deps).toEqual(["app::count"]);

      // Resolvers
      expect(Object.keys(result.resolvers!)).toEqual(["app::fetch"]);

      // Hooks
      expect(result.hooks).toBe(mod.hooks);

      // History
      expect(result.history.snapshotEvents).toEqual(["app::increment"]);

      // ID
      expect(result.id).toBe("full");
    });
  });
});
