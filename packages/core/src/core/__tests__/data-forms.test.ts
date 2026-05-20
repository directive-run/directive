import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { flushMicrotasks } from "../../utils/testing.js";

async function flush(): Promise<void> {
  await flushMicrotasks();
  await new Promise((r) => setTimeout(r, 0));
  await flushMicrotasks();
}

// ============================================================================
// Constraint `when` as data
// ============================================================================

describe("constraint when — data form", () => {
  it("fires when the predicate holds and produces requirements", async () => {
    const onResolve = vi.fn(async () => {});

    const mod = createModule("traffic", {
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

    const system = createSystem({ module: mod });
    system.start();

    // Predicate does not hold yet — no resolve.
    system.facts.elapsed = 10;
    await flush();
    expect(onResolve).not.toHaveBeenCalled();

    // Predicate holds — resolver fires.
    system.facts.elapsed = 30;
    await flush();
    expect(onResolve).toHaveBeenCalledTimes(1);

    system.destroy();
  });
});

// ============================================================================
// Effect `on` data trigger
// ============================================================================

describe("effect on — data trigger", () => {
  it("runs only when the predicate currently holds for a referenced fact", async () => {
    const ran = vi.fn();

    const mod = createModule("led", {
      schema: {
        facts: { phase: t.string<"red" | "green">(), brightness: t.number() },
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

    const system = createSystem({ module: mod });
    system.start();
    await flush();
    ran.mockClear();

    // Touching brightness should not fire the effect — predicate doesn't hold.
    system.facts.brightness = 5;
    await flush();
    expect(ran).not.toHaveBeenCalled();

    // Flip phase to red — predicate now holds, effect runs.
    system.facts.phase = "red";
    await flush();
    expect(ran).toHaveBeenCalledWith("red");

    // Flip back to green — effect does not run.
    ran.mockClear();
    system.facts.phase = "green";
    await flush();
    expect(ran).not.toHaveBeenCalled();

    system.destroy();
  });
});

// ============================================================================
// Resolver KeySelector
// ============================================================================

describe("resolver key — KeySelector", () => {
  it("dedups equivalent requirements by selected fields", async () => {
    let active = true;
    const resolveStarted = vi.fn();
    let release: () => void = () => {};

    const mod = createModule("fetch", {
      schema: {
        facts: { tick: t.number() },
        derivations: {},
        events: {},
        requirements: {
          FETCH: { id: t.string() },
        },
      },
      init: (facts) => {
        facts.tick = 0;
      },
      constraints: {
        loadA: {
          when: () => active,
          require: { type: "FETCH", id: "abc" },
        },
        loadB: {
          when: () => active,
          require: { type: "FETCH", id: "abc" },
        },
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

    const system = createSystem({ module: mod });
    system.start();
    await flush();

    // Two constraints emit FETCH with the same `id` — KeySelector ["id"]
    // dedups them so resolve is called once.
    expect(resolveStarted).toHaveBeenCalledTimes(1);
    expect(resolveStarted).toHaveBeenCalledWith("abc");

    active = false;
    release();
    await flush();
    system.destroy();
  });
});

// ============================================================================
// Event `patch`
// ============================================================================

describe("event patch — data form", () => {
  it("sets facts from literals, $ref payload copies, and $template strings", async () => {
    const mod = createModule("status", {
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

    const system = createSystem({ module: mod });
    system.start();

    system.events.setStatus({ value: "active", id: 42, name: "ada" });
    await flush();

    expect(system.facts.status).toBe("active");
    expect(system.facts.userId).toBe(42);
    expect(system.facts.label).toBe("user ada");

    system.destroy();
  });
});

// ============================================================================
// Derivation `compute` data forms
// ============================================================================

describe("derivation compute — data forms", () => {
  it("computes boolean derivations from a predicate and string derivations from a template", async () => {
    const mod = createModule("user", {
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

    const system = createSystem({ module: mod });
    system.start();
    await flush();

    expect(system.derive.isAdult).toBe(true);
    expect(system.derive.fullName).toBe("Grace Hopper");

    system.facts.age = 10;
    await flush();
    expect(system.derive.isAdult).toBe(false);

    system.facts.firstName = "Ada";
    await flush();
    expect(system.derive.fullName).toBe("Ada Hopper");

    system.destroy();
  });
});
