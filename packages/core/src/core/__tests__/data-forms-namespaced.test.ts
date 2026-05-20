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
