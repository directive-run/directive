/**
 * Data-form definitions inside namespaced multi-module systems.
 *
 * Mirrors `data-forms.test.ts` but exercises every surface
 * (constraint `when`, effect `on`, resolver `KeySelector`, event `patch`,
 * derivation `compute` predicate + template) through
 * `createSystem({ modules: { ... } })`.
 *
 * Also covers dynamic data-form `when` registration against
 * `system.constraints.register` / `assign`.
 */

import { describe, expect, it, vi } from "vitest";
import type { ObservationEvent } from "../../index.js";
import { createModule, createSystem, t } from "../../index.js";
import { flushMicrotasks } from "../../utils/testing.js";

async function flush(): Promise<void> {
  await flushMicrotasks();
  await new Promise((r) => setTimeout(r, 0));
  await flushMicrotasks();
}

// ============================================================================
// Constraint `when` — data form, multi-module
// ============================================================================

describe("namespaced constraint when — data form", () => {
  it("fires when the predicate holds and produces requirements", async () => {
    const onResolve = vi.fn(async () => {});

    const traffic = createModule("traffic", {
      schema: {
        facts: {
          phase: t.string<"red" | "green">(),
          elapsed: t.number(),
        },
        derivations: {},
        events: {},
        requirements: {
          TRANSITION: { to: t.string() },
        },
      },
      init: (facts) => {
        facts.phase = "red";
        facts.elapsed = 0;
      },
      constraints: {
        transition: {
          when: { phase: "red", elapsed: { $gte: 30 } },
          require: { type: "TRANSITION", to: "green" },
        },
      },
      resolvers: {
        transition: {
          requirement: "TRANSITION",
          resolve: onResolve,
        },
      },
    });

    const audit = createModule("audit", {
      schema: {
        facts: { entries: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.entries = 0;
      },
    });

    const system = createSystem({ modules: { traffic, audit } });
    system.start();

    system.facts.traffic.elapsed = 10;
    await flush();
    expect(onResolve).not.toHaveBeenCalled();

    system.facts.traffic.elapsed = 30;
    await flush();
    expect(onResolve).toHaveBeenCalledTimes(1);

    system.destroy();
  });

  it("inspect exposes the data-form whenSpec with namespaced keys", async () => {
    const traffic = createModule("traffic", {
      schema: {
        facts: {
          phase: t.string<"red" | "green">(),
          elapsed: t.number(),
        },
        derivations: {},
        events: {},
        requirements: { TRANSITION: { to: t.string() } },
      },
      init: (facts) => {
        facts.phase = "red";
        facts.elapsed = 0;
      },
      constraints: {
        transition: {
          when: { phase: "red", elapsed: { $gte: 30 } },
          require: { type: "TRANSITION", to: "green" },
        },
      },
      resolvers: {
        transition: { requirement: "TRANSITION", resolve: async () => {} },
      },
    });

    const audit = createModule("audit", {
      schema: {
        facts: { entries: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.entries = 0;
      },
    });

    const system = createSystem({ modules: { traffic, audit } });
    system.start();
    await flush();

    const info = system.inspect();
    const constraint = info.constraints.find((c) =>
      c.id.endsWith("transition"),
    );
    expect(constraint?.whenSpec).toEqual({
      "traffic::phase": "red",
      "traffic::elapsed": { $gte: 30 },
    });

    system.destroy();
  });
});

// ============================================================================
// Effect `on` — data trigger, multi-module
// ============================================================================

describe("namespaced effect on — data trigger", () => {
  it("runs only when the predicate currently holds for its own module's fact", async () => {
    const ran = vi.fn();

    const led = createModule("led", {
      schema: {
        facts: {
          phase: t.string<"red" | "green">(),
          brightness: t.number(),
        },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.phase = "green";
        facts.brightness = 0;
      },
      effects: {
        logRed: {
          on: { phase: "red" },
          run: (facts) => {
            ran(facts.phase);
          },
        },
      },
    });

    const sensor = createModule("sensor", {
      schema: {
        facts: { readings: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.readings = 0;
      },
    });

    const system = createSystem({ modules: { led, sensor } });
    system.start();
    await flush();
    ran.mockClear();

    // Touching an unrelated module's fact doesn't fire the effect.
    system.facts.sensor.readings = 5;
    await flush();
    expect(ran).not.toHaveBeenCalled();

    // Touching led.brightness — predicate still doesn't hold.
    system.facts.led.brightness = 5;
    await flush();
    expect(ran).not.toHaveBeenCalled();

    // Flip phase to red — predicate holds, effect runs with the
    // module-scoped facts proxy (unprefixed `phase`).
    system.facts.led.phase = "red";
    await flush();
    expect(ran).toHaveBeenCalledWith("red");

    ran.mockClear();
    system.facts.led.phase = "green";
    await flush();
    expect(ran).not.toHaveBeenCalled();

    system.destroy();
  });
});

// ============================================================================
// Resolver KeySelector — dynamic register against a namespaced system
// ============================================================================

describe("namespaced resolver key — KeySelector via dynamic register", () => {
  it("dedups equivalent requirements by selected fields", async () => {
    const resolveStarted = vi.fn();
    let release: () => void = () => {};

    const fetcher = createModule("fetcher", {
      schema: {
        facts: { tick: t.number() },
        derivations: {},
        events: {},
        requirements: { FETCH: { id: t.string() } },
      },
      init: (facts) => {
        facts.tick = 0;
      },
      resolvers: {
        fetcher: {
          requirement: "FETCH",
          key: ["id"],
          resolve: async (req) => {
            resolveStarted(req.id);
            await new Promise<void>((r) => {
              release = r;
            });
          },
        },
      },
    });

    const audit = createModule("audit", {
      schema: {
        facts: { events: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.events = 0;
      },
    });

    const system = createSystem({ modules: { fetcher, audit } });
    system.start();
    await flush();

    // Register two constraints that emit the same FETCH requirement —
    // the resolver's KeySelector should dedup them.
    system.constraints.register("loadA", {
      when: () => true,
      require: { type: "FETCH", id: "abc" },
    });
    system.constraints.register("loadB", {
      when: () => true,
      require: { type: "FETCH", id: "abc" },
    });

    await flush();
    expect(resolveStarted).toHaveBeenCalledTimes(1);
    expect(resolveStarted).toHaveBeenCalledWith("abc");

    release();
    await flush();
    system.destroy();
  });
});

// ============================================================================
// Event `patch` — data form, multi-module
// ============================================================================

describe("namespaced event patch — data form", () => {
  it("sets facts from literals, $ref payload copies, and $template strings", async () => {
    const status = createModule("status", {
      schema: {
        facts: {
          status: t.string(),
          userId: t.number(),
          label: t.string(),
        },
        derivations: {},
        events: {
          setStatus: { value: t.string(), id: t.number(), name: t.string() },
        },
        requirements: {},
      },
      init: (facts) => {
        facts.status = "idle";
        facts.userId = 0;
        facts.label = "";
      },
      events: {
        setStatus: {
          patch: {
            $set: {
              status: { $ref: "value" },
              userId: { $ref: "id" },
              label: { $template: "user ${name}" },
            },
          },
        },
      },
    });

    const audit = createModule("audit", {
      schema: {
        facts: { entries: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.entries = 0;
      },
    });

    const system = createSystem({ modules: { status, audit } });
    system.start();

    system.events.status.setStatus({ value: "active", id: 42, name: "ada" });
    await flush();

    expect(system.facts.status.status).toBe("active");
    expect(system.facts.status.userId).toBe(42);
    expect(system.facts.status.label).toBe("user ada");

    system.destroy();
  });
});

// ============================================================================
// Derivation `compute` — data forms (predicate + template), multi-module
// ============================================================================

describe("namespaced derivation compute — data forms", () => {
  it("computes boolean derivations from a predicate and string derivations from a template", async () => {
    const user = createModule("user", {
      schema: {
        facts: {
          firstName: t.string(),
          lastName: t.string(),
          age: t.number(),
        },
        derivations: {
          isAdult: t.boolean(),
          fullName: t.string(),
        },
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.firstName = "Grace";
        facts.lastName = "Hopper";
        facts.age = 30;
      },
      derive: {
        isAdult: { compute: { age: { $gte: 18 } } },
        fullName: { compute: { $template: "${firstName} ${lastName}" } },
      },
    });

    const audit = createModule("audit", {
      schema: {
        facts: { events: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.events = 0;
      },
    });

    const system = createSystem({ modules: { user, audit } });
    system.start();
    await flush();

    expect(system.derive.user.isAdult).toBe(true);
    expect(system.derive.user.fullName).toBe("Grace Hopper");

    system.facts.user.age = 10;
    await flush();
    expect(system.derive.user.isAdult).toBe(false);

    system.facts.user.firstName = "Ada";
    await flush();
    expect(system.derive.user.fullName).toBe("Ada Hopper");

    system.destroy();
  });
});

// ============================================================================
// Dynamic data-form `when` — single-module + namespaced
// ============================================================================

describe("dynamic constraint register — data-form when", () => {
  it("register accepts a data `when` and evaluates it correctly", async () => {
    const counter = createModule("counter", {
      schema: {
        facts: { count: t.number() },
        derivations: {},
        events: {},
        requirements: { ALERT: { reason: t.string() } },
      },
      init: (facts) => {
        facts.count = 0;
      },
      resolvers: {
        alert: { requirement: "ALERT", resolve: async () => {} },
      },
    });

    const system = createSystem({ module: counter });
    system.start();
    await flush();

    system.constraints.register("highCount", {
      when: { count: { $gte: 5 } },
      require: { type: "ALERT", reason: "high" },
    });

    // Below threshold — no requirement emitted.
    let inspection = system.inspect();
    let dyn = inspection.constraints.find((c) => c.id === "highCount");
    expect(dyn?.active).toBeFalsy();

    // Trip the predicate.
    system.facts.count = 10;
    await flush();

    inspection = system.inspect();
    dyn = inspection.constraints.find((c) => c.id === "highCount");
    expect(dyn?.active).toBe(true);
    // whenSpec should reflect the original data form
    expect(dyn?.whenSpec).toEqual({ count: { $gte: 5 } });

    system.destroy();
  });

  it("assign swaps a function-form constraint to a data-form `when`", async () => {
    const counter = createModule("counter", {
      schema: {
        facts: { count: t.number() },
        derivations: {},
        events: {},
        requirements: { ALERT: { reason: t.string() } },
      },
      init: (facts) => {
        facts.count = 0;
      },
      constraints: {
        gate: {
          when: (facts) => facts.count > 100,
          require: { type: "ALERT", reason: "function-form" },
        },
      },
      resolvers: {
        alert: { requirement: "ALERT", resolve: async () => {} },
      },
    });

    const system = createSystem({ module: counter });
    system.start();
    await flush();

    // Function form doesn't expose a whenSpec.
    let inspection = system.inspect();
    let gate = inspection.constraints.find((c) => c.id === "gate");
    expect(gate?.whenSpec).toBeUndefined();

    // Swap to a data form — assign should normalize and stash the spec.
    system.constraints.assign("gate", {
      when: { count: { $gte: 5 } },
      require: { type: "ALERT", reason: "data-form" },
    });

    system.facts.count = 10;
    await flush();

    inspection = system.inspect();
    gate = inspection.constraints.find((c) => c.id === "gate");
    expect(gate?.active).toBe(true);
    expect(gate?.whenSpec).toEqual({ count: { $gte: 5 } });

    system.destroy();
  });
});

// ============================================================================
// AE-R2 regression: effect `$changed` under a namespaced system
// ============================================================================

describe("namespaced effect `$changed` operator", () => {
  it("fires when the watched fact transitions between values; not on first run", async () => {
    const ran = vi.fn();

    const led = createModule("led", {
      schema: {
        facts: {
          phase: t.string<"red" | "green" | "yellow">(),
          brightness: t.number(),
        },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.phase = "red";
        facts.brightness = 0;
      },
      effects: {
        onPhaseChange: {
          // Data-form `on` — predicate uses `$changed` against the module's
          // own (unprefixed) `phase` fact. Effects DO carry a prev snapshot.
          on: { phase: { $changed: true } },
          run: (facts) => {
            ran(facts.phase);
          },
        },
      },
    });

    const sensor = createModule("sensor", {
      schema: {
        facts: { readings: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.readings = 0;
      },
    });

    const system = createSystem({ modules: { led, sensor } });
    system.start();
    await flush();

    // After start: ignore any initial-run fires.
    ran.mockClear();

    // Touching another module's fact does not fire (predicate references led.phase).
    system.facts.sensor.readings = 5;
    await flush();
    expect(ran).not.toHaveBeenCalled();

    // Touching brightness (different fact in same module) does not fire.
    system.facts.led.brightness = 50;
    await flush();
    expect(ran).not.toHaveBeenCalled();

    // Flip phase — $changed predicate matches.
    system.facts.led.phase = "green";
    await flush();
    expect(ran).toHaveBeenCalledWith("green");

    // Same-value write (still "green") — predicate does not match.
    ran.mockClear();
    system.facts.led.phase = "green";
    await flush();
    expect(ran).not.toHaveBeenCalled();

    // Another transition.
    system.facts.led.phase = "yellow";
    await flush();
    expect(ran).toHaveBeenCalledWith("yellow");

    system.destroy();
  });
});

// ============================================================================
// AE R2 fix: namespace-pivot nested form in data-form `when`
// ============================================================================

// Before R2, the cross-module RFC nested form (`when: { self: {...}, auth:
// {...} }`) was mangled by `prefixPredicateSpec` — `self` was treated as a
// regular fact and prefixed to `<ns>::self`, which is unreachable. The
// prefixer now recognizes "self" and declared `crossModuleDeps` namespaces
// as pivot keys and flattens them one level.
describe("namespace-pivot `self` and dep-namespace forms", () => {
  it("constraint when: { self: { phase } } evaluates and fires", async () => {
    const onResolve = vi.fn(async () => {});

    const traffic = createModule("traffic", {
      schema: {
        facts: {
          phase: t.string<"red" | "green">(),
          elapsed: t.number(),
        },
        derivations: {},
        events: {},
        requirements: { TRANSITION: { to: t.string() } },
      },
      init: (facts) => {
        facts.phase = "red";
        facts.elapsed = 0;
      },
      constraints: {
        // Nested-form `self` pivot — should flatten to `traffic::phase` /
        // `traffic::elapsed`, NOT `traffic::self`.
        transition: {
          when: { self: { phase: "red", elapsed: { $gte: 30 } } } as never,
          require: { type: "TRANSITION", to: "green" },
        },
      },
      resolvers: {
        transition: { requirement: "TRANSITION", resolve: onResolve },
      },
    });

    const audit = createModule("audit", {
      schema: {
        facts: { entries: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.entries = 0;
      },
    });

    const system = createSystem({ modules: { traffic, audit } });
    system.start();

    system.facts.traffic.elapsed = 30;
    await flush();
    expect(onResolve).toHaveBeenCalledTimes(1);

    system.destroy();
  });

  it("constraint with crossModuleDeps fires for `self` + dep pivots together", async () => {
    const onResolve = vi.fn(async () => {});

    const authSchema = {
      facts: { token: t.string() },
      derivations: {},
      events: {},
      requirements: {},
    };

    const auth = createModule("auth", {
      schema: authSchema,
      init: (facts) => {
        facts.token = "";
      },
    });

    const traffic = createModule("traffic", {
      schema: {
        facts: { phase: t.string<"red" | "green">() },
        derivations: {},
        events: {},
        requirements: { TRANSITION: { to: t.string() } },
      },
      crossModuleDeps: { auth: authSchema },
      init: (facts: { phase: "red" | "green" }) => {
        facts.phase = "red";
      },
      constraints: {
        // Combined pivot — `self` flattens against `traffic`, `auth` flattens
        // against the declared dep namespace `auth`. The constraint should
        // fire only when both pivot clauses hold.
        transition: {
          when: {
            self: { phase: "red" },
            auth: { token: { $ne: "" } },
          } as never,
          require: { type: "TRANSITION", to: "green" },
        },
      },
      resolvers: {
        transition: { requirement: "TRANSITION", resolve: onResolve },
      },
    } as never);

    const system = createSystem({ modules: { auth, traffic } });
    system.start();
    await flush();
    expect(onResolve).not.toHaveBeenCalled();

    // Setting the dep token causes both pivot clauses to hold.
    system.facts.auth.token = "abc";
    await flush();
    expect(onResolve).toHaveBeenCalledTimes(1);

    system.destroy();
  });

  it("already-prefixed keys in `$all` pass through unchanged", async () => {
    const onResolve = vi.fn(async () => {});

    const authSchema = {
      facts: { token: t.string() },
      derivations: {},
      events: {},
      requirements: {},
    };

    const auth = createModule("auth", {
      schema: authSchema,
      init: (facts) => {
        facts.token = "";
      },
    });

    const traffic = createModule("traffic", {
      schema: {
        facts: { phase: t.string<"red" | "green">() },
        derivations: {},
        events: {},
        requirements: { TRANSITION: { to: t.string() } },
      },
      crossModuleDeps: { auth: authSchema },
      init: (facts: { phase: "red" | "green" }) => {
        facts.phase = "red";
      },
      constraints: {
        // Mixed: an already-prefixed key + an unprefixed key in `$all`. The
        // prefixer must pass `auth::token` through verbatim and prefix
        // `phase` to `traffic::phase`.
        transition: {
          when: {
            $all: [{ "auth::token": { $ne: "" } }, { phase: "red" }],
          } as never,
          require: { type: "TRANSITION", to: "green" },
        },
      },
      resolvers: {
        transition: { requirement: "TRANSITION", resolve: onResolve },
      },
    } as never);

    const system = createSystem({ modules: { auth, traffic } });
    system.start();
    await flush();
    expect(onResolve).not.toHaveBeenCalled();

    system.facts.auth.token = "abc";
    await flush();
    expect(onResolve).toHaveBeenCalledTimes(1);

    system.destroy();
  });
});

// ============================================================================
// AE R2 fix: namespaced events both `handler` AND `patch` dev-warn
// ============================================================================

// Before R2 the engine's single-module path warned when both `handler` and
// `patch` were provided, but the namespaced path silently kept the handler
// without warning. The normalizer now mirrors the engine's diagnostic so
// authors of namespaced systems see the same friendly message.
describe("namespaced event handler + patch — dev warn", () => {
  it("dev-warns when both `handler` and `patch` are provided, keeps the handler", async () => {
    const handler = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const status = createModule("status", {
      schema: {
        facts: { status: t.string() },
        derivations: {},
        events: { setStatus: { value: t.string() } },
        requirements: {},
      },
      init: (facts) => {
        facts.status = "idle";
      },
      events: {
        // Both forms present — handler wins, patch is ignored.
        setStatus: {
          handler,
          patch: { $set: { status: { $ref: "value" } } },
        } as never,
      },
    });

    const audit = createModule("audit", {
      schema: {
        facts: { entries: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.entries = 0;
      },
    });

    const system = createSystem({ modules: { status, audit } });
    system.start();

    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes('event "setStatus"'),
      ),
    ).toBe(true);
    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes("both `handler` and `patch` provided"),
      ),
    ).toBe(true);

    system.events.status.setStatus({ value: "active" });
    await flush();

    // Handler ran (the patch was ignored — status stays "idle" because the
    // vi.fn handler doesn't mutate facts).
    expect(handler).toHaveBeenCalledTimes(1);
    expect(system.facts.status.status).toBe("idle");

    warn.mockRestore();
    system.destroy();
  });
});

// ============================================================================
// RFC-0003 clobber detection — namespaced `owns`
// ============================================================================

describe("namespaced constraint owns — clobber detection", () => {
  it("prefixes owns keys so clobber detection fires in a multi-module system", async () => {
    let releaseA!: () => void;
    const blockerA = new Promise<void>((r) => {
      releaseA = r;
    });

    const counter = createModule("counter", {
      schema: {
        facts: { status: t.string() },
        derivations: {},
        events: { go: {}, clobberIt: {} },
        requirements: { TICK: {} },
      },
      init: (f) => {
        f.status = "idle";
      },
      events: {
        go: (f) => {
          f.status = "ticking";
        },
        clobberIt: (f) => {
          f.status = "external";
        },
      },
      constraints: {
        tick: {
          when: (f) => f.status === "ticking",
          require: { type: "TICK" },
          owns: ["status"],
        },
      },
      resolvers: {
        tick: {
          requirement: "TICK",
          resolve: async (_req, ctx) => {
            await blockerA;
            // Owned write — should be dropped because `clobberIt` mutated
            // `counter::status` while the resolver was awaiting.
            ctx.facts.status = "resolved";
          },
        },
      },
    });

    const audit = createModule("audit", {
      schema: {
        facts: { entries: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (f) => {
        f.entries = 0;
      },
    });

    const system = createSystem({ modules: { counter, audit } });
    system.start();
    await flush();

    const events: ObservationEvent[] = [];
    const unsub = system.observe((e) => events.push(e));

    system.events.counter.go();
    await flush();
    // External mutation of the owned fact while the resolver is blocked.
    system.events.counter.clobberIt();
    await flush();
    releaseA();
    await flush();

    const clobbers = events.filter(
      (e): e is Extract<ObservationEvent, { type: "resolver.write.rejected" }> =>
        e.type === "resolver.write.rejected",
    );
    expect(clobbers.length).toBeGreaterThanOrEqual(1);
    const clob = clobbers[0]!;
    expect(clob.kind).toBe("rejection");
    if (clob.kind !== "rejection") {
      throw new Error("expected a rejection-kind event");
    }
    // The clobbered fact name is namespace-prefixed.
    expect(clob.fact).toBe("counter::status");
    expect(clob.actual).toBe("external");
    // The dropped owned write never landed.
    expect(system.facts.counter.status).toBe("external");

    unsub();
    system.destroy();
  });

  it("each module's owns is scoped to its own namespace", async () => {
    let releaseOne!: () => void;
    const blockerOne = new Promise<void>((r) => {
      releaseOne = r;
    });

    // Distinct requirement types per module — requirement `type` is a global
    // identity, so each namespaced module needs its own.
    const makeModule = (slot: "one" | "two", reqType: string) =>
      createModule(slot, {
        schema: {
          facts: { value: t.string() },
          derivations: {},
          events: { start: {}, intrude: {} },
          requirements: { [reqType]: {} },
        },
        init: (f) => {
          f.value = "init";
        },
        events: {
          start: (f) => {
            f.value = "working";
          },
          intrude: (f) => {
            f.value = "intruder";
          },
        },
        constraints: {
          act: {
            when: (f) => f.value === "working",
            require: { type: reqType },
            owns: ["value"],
          },
        },
        resolvers: {
          act: {
            requirement: reqType,
            resolve: async (_req, ctx) => {
              if (slot === "one") {
                await blockerOne;
              }
              ctx.facts.value = "done";
            },
          },
        },
      });

    const system = createSystem({
      modules: {
        one: makeModule("one", "ACT_ONE"),
        two: makeModule("two", "ACT_TWO"),
      },
    });
    system.start();
    await flush();

    const events: ObservationEvent[] = [];
    const unsub = system.observe((e) => events.push(e));

    // Module two resolves cleanly — no clobber.
    system.events.two.start();
    await flush();
    await flush();
    expect(system.facts.two.value).toBe("done");

    // Module one is clobbered while its resolver awaits.
    system.events.one.start();
    await flush();
    system.events.one.intrude();
    await flush();
    releaseOne();
    await flush();

    const clobbers = events.filter(
      (e): e is Extract<ObservationEvent, { type: "resolver.write.rejected" }> =>
        e.type === "resolver.write.rejected",
    );
    expect(clobbers.length).toBe(1);
    const clob = clobbers[0]!;
    expect(clob.kind).toBe("rejection");
    if (clob.kind !== "rejection") {
      throw new Error("expected a rejection-kind event");
    }
    expect(clob.fact).toBe("one::value");
    expect(system.facts.one.value).toBe("intruder");

    unsub();
    system.destroy();
  });
});
