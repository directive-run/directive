// @ts-nocheck
/**
 * Directive Core Benchmarks
 *
 * Measures throughput of every hot path in the constraint engine:
 * fact mutations, derivation recomputation, constraint evaluation,
 * full reconciliation cycles, and real-world scenarios.
 *
 * Run: pnpm bench
 */
import { bench, describe } from "vitest";
import { createModule, createSystem, t } from "../../src/index";

// ============================================================================
// Helpers
// ============================================================================

function buildSchema(factCount: number) {
  const facts: Record<string, { _type: unknown }> = {};
  for (let i = 0; i < factCount; i++) {
    facts[`f${i}`] = { _type: 0 as unknown };
  }

  return facts;
}

function buildDerivations(count: number) {
  const derive: Record<string, (f: Record<string, unknown>) => unknown> = {};
  if (count > 0) {
    derive.d0 = (f) => (f.f0 as number) * 2;
  }
  for (let i = 1; i < count; i++) {
    const prev = `d${i - 1}`;
    derive[`d${i}`] = (_f, derived) => (derived[prev] as number) + 1;
  }

  return derive;
}

// ============================================================================
// 1. Fact Mutations
// ============================================================================

function createCounterSystem() {
  const mod = createModule("bench", {
    schema: {
      facts: { count: t.number() },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (f) => { f.count = 0; },
  });
  const sys = createSystem({ module: mod });
  sys.start();

  return sys;
}

function create100FactSystem() {
  const facts: Record<string, { _type: unknown }> = {};
  for (let i = 0; i < 100; i++) facts[`f${i}`] = { _type: 0 as unknown };
  const mod = createModule("bench", {
    schema: { facts, derivations: {}, events: {}, requirements: {} },
    init: (f) => { for (let i = 0; i < 100; i++) f[`f${i}`] = 0; },
  });
  const sys = createSystem({ module: mod });
  sys.start();

  return sys;
}

describe("Fact Mutations", () => {
  const sys = createCounterSystem();

  bench("single fact set", () => {
    sys.facts.count = (sys.facts.count as number) + 1;
  });

  bench("single fact read", () => {
    void sys.facts.count;
  });
});

describe("Fact Mutations – Batch", () => {
  const sys = create100FactSystem();

  bench("100 facts batched", () => {
    sys.facts.$store.batch(() => {
      for (let i = 0; i < 100; i++) {
        sys.facts.$store.set(`f${i}`, i);
      }
    });
  });

  bench("100 fact reads via proxy", () => {
    let sum = 0;
    for (let i = 0; i < 100; i++) {
      sum += sys.facts[`f${i}`] as number;
    }
    void sum;
  });
});

// ============================================================================
// 2. Derivation Performance
// ============================================================================

describe("Derivations", () => {
  // Pre-create systems — measure derivation read, not system creation
  const simpleMod = createModule("bench-d1", {
    schema: {
      facts: { count: t.number() },
      derivations: { doubled: t.number() },
      events: {},
      requirements: {},
    },
    init: (f) => { f.count = 5; },
    derive: { doubled: (f) => (f.count as number) * 2 },
  });
  const simpleSys = createSystem({ module: simpleMod });
  simpleSys.start();

  bench("simple derivation (read after invalidate)", () => {
    simpleSys.facts.count = (simpleSys.facts.count as number) + 1;
    void simpleSys.read("doubled");
  });

  const derive10 = buildDerivations(10);
  const mod10 = createModule("bench-d10", {
    schema: {
      facts: { f0: { _type: 0 as unknown } },
      derivations: Object.fromEntries(
        Object.keys(derive10).map((k) => [k, { _type: 0 as unknown }]),
      ),
      events: {},
      requirements: {},
    },
    init: (f) => { f.f0 = 1; },
    derive: derive10,
  });
  const sys10 = createSystem({ module: mod10 });
  sys10.start();

  bench("10 chained derivations (read after invalidate)", () => {
    sys10.facts.f0 = (sys10.facts.f0 as number) + 1;
    void sys10.read("d9");
  });

  const derive50 = buildDerivations(50);
  const mod50 = createModule("bench-d50", {
    schema: {
      facts: { f0: { _type: 0 as unknown } },
      derivations: Object.fromEntries(
        Object.keys(derive50).map((k) => [k, { _type: 0 as unknown }]),
      ),
      events: {},
      requirements: {},
    },
    init: (f) => { f.f0 = 1; },
    derive: derive50,
  });
  const sys50 = createSystem({ module: mod50 });
  sys50.start();

  bench("50 chained derivations (read after invalidate)", () => {
    sys50.facts.f0 = (sys50.facts.f0 as number) + 1;
    void sys50.read("d49");
  });
});

describe("Derivation Invalidation", () => {
  // Setup: 1 fact, 20 derivations all depending on it
  const derive: Record<string, (f: Record<string, unknown>) => unknown> = {};
  const derivSchema: Record<string, { _type: unknown }> = {};
  for (let i = 0; i < 20; i++) {
    derive[`d${i}`] = (f) => (f.f0 as number) + i;
    derivSchema[`d${i}`] = { _type: 0 as unknown };
  }
  const mod = createModule("bench-inv", {
    schema: {
      facts: { f0: { _type: 0 as unknown } },
      derivations: derivSchema,
      events: {},
      requirements: {},
    },
    init: (f) => { f.f0 = 0; },
    derive,
  });
  const sys = createSystem({ module: mod });
  sys.start();
  // Prime all derivations
  for (let i = 0; i < 20; i++) void sys.read(`d${i}`);

  bench("invalidate 20 derivations (1 fact change)", () => {
    sys.facts.f0 = (sys.facts.f0 as number) + 1;
  });
});

// ============================================================================
// 3. Constraint Evaluation
// ============================================================================

describe("Constraints", () => {
  bench("single constraint eval + reconcile", async () => {
    const mod = createModule("bench", {
      schema: {
        facts: { count: t.number() },
        derivations: {},
        events: { inc: {} },
        requirements: { INCREMENT: {} },
      },
      init: (f) => {
        f.count = 0;
      },
      events: {
        inc: (f) => {
          f.count = (f.count as number) + 1;
        },
      },
      constraints: {
        needsReset: {
          when: (f) => (f.count as number) > 10,
          require: { type: "INCREMENT" },
        },
      },
      resolvers: {
        reset: {
          requirement: "INCREMENT",
          resolve: async (_req, ctx) => {
            ctx.facts.count = 0;
          },
        },
      },
    });
    const sys = createSystem({ module: mod });
    sys.start();
    sys.dispatch({ type: "inc" });
    await sys.settle(1000);
    sys.destroy();
  });

  bench("10 constraints, 1 triggers", async () => {
    const constraints: Record<string, unknown> = {};
    const resolvers: Record<string, unknown> = {};
    const requirements: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 10; i++) {
      const reqType = `REQ_${i}`;
      requirements[reqType] = {};
      constraints[`c${i}`] = {
        when: (f: Record<string, unknown>) => (f.count as number) === i,
        require: { type: reqType },
      };
      resolvers[`r${i}`] = {
        requirement: reqType,
        resolve: async () => {},
      };
    }
    const mod = createModule("bench", {
      schema: {
        facts: { count: { _type: 0 as unknown } },
        derivations: {},
        events: {},
        requirements,
      },
      init: (f) => {
        f.count = -1;
      },
      constraints,
      resolvers,
    });
    const sys = createSystem({ module: mod });
    sys.start();
    sys.facts.count = 5; // triggers c5 only
    await sys.settle(1000);
    sys.destroy();
  });
});

// ============================================================================
// 3b. Sync vs Async Resolvers
// ============================================================================

describe("Sync vs Async Resolvers", () => {
  bench("sync resolver (no Promise)", async () => {
    const mod = createModule("bench", {
      schema: {
        facts: { ready: t.boolean(), result: t.string() },
        derivations: {},
        events: {},
        requirements: { DO_IT: {} },
      },
      init: (f) => { f.ready = false; f.result = ""; },
      constraints: {
        go: {
          when: (f) => f.ready === true && f.result === "",
          require: { type: "DO_IT" },
        },
      },
      resolvers: {
        doIt: {
          requirement: "DO_IT",
          // Sync resolver — returns undefined, not a Promise
          resolve: (_req: unknown, ctx: { facts: Record<string, unknown> }) => {
            ctx.facts.result = "done";
          },
        },
      },
    });
    const sys = createSystem({ module: mod });
    sys.start();
    sys.facts.ready = true;
    await sys.settle(1000);
    sys.destroy();
  });

  bench("async resolver (returns Promise)", async () => {
    const mod = createModule("bench", {
      schema: {
        facts: { ready: t.boolean(), result: t.string() },
        derivations: {},
        events: {},
        requirements: { DO_IT: {} },
      },
      init: (f) => { f.ready = false; f.result = ""; },
      constraints: {
        go: {
          when: (f) => f.ready === true && f.result === "",
          require: { type: "DO_IT" },
        },
      },
      resolvers: {
        doIt: {
          requirement: "DO_IT",
          resolve: async (_req, ctx) => {
            ctx.facts.result = "done";
          },
        },
      },
    });
    const sys = createSystem({ module: mod });
    sys.start();
    sys.facts.ready = true;
    await sys.settle(1000);
    sys.destroy();
  });
});

// ============================================================================
// 4. Full Reconciliation Cycle
// ============================================================================

describe("Reconciliation", () => {
  bench("no-op reconcile (nothing changed)", async () => {
    const mod = createModule("bench", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (f) => {
        f.x = 0;
      },
    });
    const sys = createSystem({ module: mod });
    sys.start();
    await sys.settle(100);
    sys.destroy();
  });

  bench("minimal cycle (1 fact → 1 constraint → 1 resolver)", async () => {
    const mod = createModule("bench", {
      schema: {
        facts: { ready: t.boolean(), result: t.string() },
        derivations: {},
        events: {},
        requirements: { FETCH: {} },
      },
      init: (f) => {
        f.ready = false;
        f.result = "";
      },
      constraints: {
        fetch: {
          when: (f) => f.ready === true && f.result === "",
          require: { type: "FETCH" },
        },
      },
      resolvers: {
        fetch: {
          requirement: "FETCH",
          resolve: async (_req, ctx) => {
            ctx.facts.result = "done";
          },
        },
      },
    });
    const sys = createSystem({ module: mod });
    sys.start();
    sys.facts.ready = true;
    await sys.settle(1000);
    sys.destroy();
  });

  bench(
    "medium system (5 facts → 3 constraints → 3 resolvers → 5 derivations)",
    async () => {
      const mod = createModule("bench", {
        schema: {
          facts: {
            a: { _type: 0 as unknown },
            b: { _type: 0 as unknown },
            c: { _type: 0 as unknown },
            d: { _type: 0 as unknown },
            e: { _type: "" as unknown },
          },
          derivations: {
            sum: { _type: 0 as unknown },
            avg: { _type: 0 as unknown },
            label: { _type: "" as unknown },
            isHigh: { _type: false as unknown },
            status: { _type: "" as unknown },
          },
          events: {},
          requirements: { CALC: {}, LABEL: {}, LOG: {} },
        },
        init: (f) => {
          f.a = 0;
          f.b = 0;
          f.c = 0;
          f.d = 0;
          f.e = "";
        },
        derive: {
          sum: (f) =>
            (f.a as number) +
            (f.b as number) +
            (f.c as number) +
            (f.d as number),
          avg: (_f, d) => (d.sum as number) / 4,
          label: (f) => `Result: ${f.e}`,
          isHigh: (_f, d) => (d.avg as number) > 50,
          status: (_f, d) => (d.isHigh ? "high" : "normal"),
        },
        constraints: {
          calc: {
            when: (f) => (f.a as number) > 0 && f.e === "",
            require: { type: "CALC" },
          },
          label: {
            when: (f) => f.e === "computed",
            require: { type: "LABEL" },
          },
          log: {
            when: (_f, d) => d.isHigh === true,
            require: { type: "LOG" },
          },
        },
        resolvers: {
          calc: {
            requirement: "CALC",
            resolve: async (_req, ctx) => {
              ctx.facts.e = "computed";
            },
          },
          label: {
            requirement: "LABEL",
            resolve: async () => {},
          },
          log: {
            requirement: "LOG",
            resolve: async () => {},
          },
        },
      });
      const sys = createSystem({ module: mod });
      sys.start();
      sys.facts.$store.batch(() => {
        sys.facts.$store.set("a", 100);
        sys.facts.$store.set("b", 200);
        sys.facts.$store.set("c", 300);
        sys.facts.$store.set("d", 400);
      });
      await sys.settle(2000);
      sys.destroy();
    },
  );
});

// ============================================================================
// 5. Real-World Scenarios
// ============================================================================

describe("Real-World: Traffic Light", () => {
  bench("full cycle: red → green → yellow → red", async () => {
    const mod = createModule("traffic", {
      schema: {
        facts: {
          phase: { _type: "" as unknown },
          elapsed: { _type: 0 as unknown },
        },
        derivations: {
          isRed: { _type: false as unknown },
          isGreen: { _type: false as unknown },
        },
        events: { tick: {} },
        requirements: { TRANSITION: {} },
      },
      init: (f) => {
        f.phase = "red";
        f.elapsed = 0;
      },
      derive: {
        isRed: (f) => f.phase === "red",
        isGreen: (f) => f.phase === "green",
      },
      events: {
        tick: (f) => {
          f.elapsed = (f.elapsed as number) + 1;
        },
      },
      constraints: {
        transition: {
          when: (f) => (f.elapsed as number) >= 3,
          require: (f) => ({
            type: "TRANSITION",
            from: f.phase,
          }),
        },
      },
      resolvers: {
        transition: {
          requirement: "TRANSITION",
          resolve: async (req, ctx) => {
            const next =
              req.from === "red"
                ? "green"
                : req.from === "green"
                  ? "yellow"
                  : "red";
            ctx.facts.phase = next;
            ctx.facts.elapsed = 0;
          },
        },
      },
    });

    const sys = createSystem({ module: mod });
    sys.start();

    // 3 ticks → transition, repeat for full cycle
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let tick = 0; tick < 3; tick++) {
        sys.dispatch({ type: "tick" });
      }
      await sys.settle(1000);
    }

    sys.destroy();
  });
});

describe("Real-World: Auth Flow", () => {
  bench("login → token → profile chain", async () => {
    const mod = createModule("auth", {
      schema: {
        facts: {
          email: { _type: "" as unknown },
          token: { _type: "" as unknown },
          profile: { _type: null as unknown },
        },
        derivations: {
          isLoggedIn: { _type: false as unknown },
          displayName: { _type: "" as unknown },
        },
        events: { login: { email: { _type: "" as unknown } } },
        requirements: { AUTH: {}, PROFILE: {} },
      },
      init: (f) => {
        f.email = "";
        f.token = "";
        f.profile = null;
      },
      derive: {
        isLoggedIn: (f) => f.token !== "",
        displayName: (f) =>
          f.profile
            ? (f.profile as { name: string }).name
            : "Guest",
      },
      events: {
        login: (f, { email }) => {
          f.email = email;
        },
      },
      constraints: {
        needsAuth: {
          when: (f) => f.email !== "" && f.token === "",
          require: { type: "AUTH" },
        },
        needsProfile: {
          when: (f) => f.token !== "" && f.profile === null,
          require: { type: "PROFILE" },
        },
      },
      resolvers: {
        auth: {
          requirement: "AUTH",
          resolve: async (_req, ctx) => {
            ctx.facts.token = "tok_123";
          },
        },
        profile: {
          requirement: "PROFILE",
          resolve: async (_req, ctx) => {
            ctx.facts.profile = { name: "Alice", id: 42 };
          },
        },
      },
    });

    const sys = createSystem({ module: mod });
    sys.start();
    sys.dispatch({ type: "login", email: "alice@example.com" });
    await sys.settle(2000);
    sys.destroy();
  });
});
