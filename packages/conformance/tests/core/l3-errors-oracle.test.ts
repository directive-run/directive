// Ported from packages/core/src/core/__tests__/l3-errors-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import {
  DirectiveError,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box tests for the error boundary (L3): which recovery strategy a
// source gets, what an observer is told, what each strategy does, how
// retry-later backs off, and when the development warning speaks. Public API
// only: errorBoundary options, plugin hooks, module hooks and what a reader
// of the system sees. Fake timers wherever a clock decides the outcome.

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const SOURCES = ["constraint", "resolver", "effect", "derivation"] as const;
type Source = (typeof SOURCES)[number];

const ID: Record<Source, string> = {
  constraint: "probe",
  resolver: "work",
  effect: "watcher",
  derivation: "dd",
};

const OPTION: Record<Source, string> = {
  constraint: "onConstraintError",
  resolver: "onResolverError",
  effect: "onEffectError",
  derivation: "onDerivationError",
};

function quiet() {
  return {
    warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
    error: vi.spyOn(console, "error").mockImplementation(() => undefined),
  };
}

/** The unhandled-error warnings: one per source id, naming it. */
function unhandled(warn: { mock: { calls: unknown[][] } }): string[] {
  return warn.mock.calls
    .map((c) => String(c[0]))
    .filter((m) => m.includes("threw:"));
}

interface Rig {
  system: any;
  /** Set a flag and that source throws the next time it runs. */
  fail: Record<Source, boolean>;
  /** What the failing source throws (default: an Error saying so). */
  make: (source: Source) => unknown;
  calls: Record<Source, number>;
  /** Every DirectiveError a plugin's onError saw. */
  errors: DirectiveError[];
  /** [error.source, error.sourceId, strategy] from a plugin's onErrorRecovery. */
  recovery: [string, string, string][];
  /** Times (ms since the rig was built) a reconcile pass started. */
  passes: number[];
}

/**
 * One module with four sources that can each be told to throw: a constraint
 * `probe` and an effect `watcher` (both read `x`), a derivation `dd`, and a
 * resolver `work` that runs while `go` is true.
 */
function rig(
  errorBoundary?: Record<string, unknown>,
  extra: { plugins?: unknown[]; hooks?: Record<string, unknown> } = {},
): Rig {
  const t0 = Date.now();
  const r: Rig = {
    system: undefined,
    fail: {
      constraint: false,
      resolver: false,
      effect: false,
      derivation: false,
    },
    make: (source) => new Error(`${source} boom`),
    calls: { constraint: 0, resolver: 0, effect: 0, derivation: 0 },
    errors: [],
    recovery: [],
    passes: [],
  };
  const mod = createModule("m", {
    schema: {
      facts: { x: t.number(), go: t.boolean() },
      derivations: { dd: t.number() },
      events: { bump: {} },
      requirements: { R: {} },
    },
    init: (facts: any) => {
      facts.x = 0;
      facts.go = false;
    },
    events: {
      bump: (facts: any) => {
        facts.x = facts.x + 1;
      },
    },
    derive: {
      dd: (facts: any) => {
        r.calls.derivation++;
        if (r.fail.derivation && facts.x > 0) {
          throw r.make("derivation");
        }

        return facts.x * 2;
      },
    },
    effects: {
      watcher: {
        run: (facts: any) => {
          r.calls.effect++;
          const x = facts.x;
          if (r.fail.effect && x > 0) {
            throw r.make("effect");
          }
        },
      },
    },
    constraints: {
      probe: {
        when: (facts: any) => {
          r.calls.constraint++;
          const x = facts.x;
          if (r.fail.constraint && x > 0) {
            throw r.make("constraint");
          }

          return false;
        },
        require: { type: "R" },
      },
      need: {
        when: (facts: any) => facts.go === true,
        require: { type: "R" },
      },
    },
    resolvers: {
      work: {
        requirement: "R",
        resolve: async () => {
          r.calls.resolver++;
          if (r.fail.resolver) {
            throw r.make("resolver");
          }
        },
      },
    },
    hooks: extra.hooks,
  } as never);
  r.system = createSystem({
    module: mod,
    errorBoundary,
    plugins: [
      {
        name: "watch",
        onError: (e: DirectiveError) => r.errors.push(e),
        onErrorRecovery: (e: DirectiveError, s: string) =>
          r.recovery.push([e.source, e.sourceId, s]),
        onReconcileStart: () => r.passes.push(Date.now() - t0),
      },
      ...(extra.plugins ?? []),
    ],
  } as never) as any;

  return r;
}

/** Make the named sources throw, once each. */
async function trip(r: Rig, which: readonly Source[] = SOURCES) {
  for (const s of which) {
    r.fail[s] = true;
  }
  if (which.includes("resolver")) {
    r.system.facts.go = true;
    await r.system.settle();
  }
  r.system.events.bump();
  await r.system.settle();
  if (which.includes("derivation")) {
    try {
      r.system.read("dd");
    } catch {
      // The reader sees the error too; the boundary is what is under test.
    }
  }
}

/** Raise the resolver's requirement again after it was settled or failed. */
async function reraise(r: Rig) {
  r.system.facts.go = false;
  await r.system.settle();
  r.system.facts.go = true;
  await r.system.settle();
}

describe("which strategy a source gets", () => {
  it("skips by default, for every source, and the system keeps running", async () => {
    quiet();
    const r = rig();
    r.system.start();
    await trip(r);

    expect(r.recovery).toHaveLength(4);
    expect(r.recovery).toEqual(
      expect.arrayContaining(SOURCES.map((s) => [s, ID[s], "skip"])),
    );

    for (const s of SOURCES) {
      r.fail[s] = false;
    }
    r.recovery.length = 0;
    r.system.events.bump();
    await r.system.settle();

    expect(r.system.read("dd")).toBe(4);
    expect(r.recovery).toEqual([]);
    r.system.destroy();
  });

  it.each(SOURCES)(
    "an option set for the %s source changes that source and no other",
    async (source) => {
      quiet();
      const r = rig({ [OPTION[source]]: "disable" });
      r.system.start();
      await trip(r);

      expect(r.recovery).toHaveLength(4);
      expect(r.recovery).toEqual(
        expect.arrayContaining(
          SOURCES.map((s) => [s, ID[s], s === source ? "disable" : "skip"]),
        ),
      );
      r.system.destroy();
    },
  );

  it("a handler function receives the thrown error and the id; a string it returns is the strategy", async () => {
    quiet();
    const seen: [string, string, boolean][] = [];
    const handler = (result: unknown) => (error: Error, id: string) => {
      seen.push([id, error.message, error instanceof Error]);

      return result as never;
    };
    const r = rig({
      onConstraintError: handler("disable"),
      onResolverError: handler(undefined),
      onEffectError: handler("disable"),
      onDerivationError: handler(42),
    });
    r.system.start();
    await trip(r);

    expect(seen).toHaveLength(4);
    expect(seen).toEqual(
      expect.arrayContaining(SOURCES.map((s) => [ID[s], `${s} boom`, true])),
    );
    // Nothing returned, or something that is not a strategy name, is a skip.
    expect(r.recovery).toEqual(
      expect.arrayContaining([
        ["constraint", "probe", "disable"],
        ["resolver", "work", "skip"],
        ["effect", "watcher", "disable"],
        ["derivation", "dd", "skip"],
      ]),
    );
    r.system.destroy();
  });

  it("a handler that throws is logged and the error is skipped", async () => {
    const { error } = quiet();
    const broken = new Error("handler broke");
    const r = rig({
      onConstraintError: () => {
        throw broken;
      },
    });
    r.system.start();
    await trip(r, ["constraint"]);

    expect(r.recovery).toEqual([["constraint", "probe", "skip"]]);
    expect(error.mock.calls.some((c) => c.includes(broken))).toBe(true);
    r.system.destroy();
  });

  it("a value that is not an Error is reported by its string form", async () => {
    quiet();
    const seen: unknown[] = [];
    const r = rig({
      onConstraintError: (e: Error) => {
        seen.push(e);

        return "skip";
      },
    });
    r.make = (source) => `${source} as a string`;
    r.system.start();
    await trip(r, ["constraint"]);

    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toBeInstanceOf(DirectiveError);
    expect(r.errors[0]?.message).toBe("constraint as a string");
    expect(seen[0]).toBeInstanceOf(Error);
    expect((seen[0] as Error).message).toBe("constraint as a string");
    r.system.destroy();
  });
});

describe("what an observer is told", () => {
  it("a DirectiveError names the source, the id, the cause and whether it is recoverable", async () => {
    quiet();
    const fromConfig: DirectiveError[] = [];
    const r = rig({ onError: (e: DirectiveError) => fromConfig.push(e) });
    r.system.start();
    await trip(r);

    expect(r.errors).toHaveLength(4);
    for (const s of SOURCES) {
      const e = r.errors.find((x) => x.source === s) as DirectiveError;

      expect(e).toBeInstanceOf(DirectiveError);
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe("DirectiveError");
      expect(e.sourceId).toBe(ID[s]);
      expect(e.message).toBe(`${s} boom`);
      expect(e.recoverable).toBe(true);
      if (s !== "resolver") {
        expect(e.context).toBeUndefined();
      }
    }
    // A resolver's error carries the requirement that was being resolved.
    const resolver = r.errors.find((x) => x.source === "resolver") as any;

    expect(resolver.context.requirement.type).toBe("R");
    expect(resolver.context.fromConstraint).toBe("need");

    // errorBoundary.onError sees the very same objects, in the same order.
    expect(fromConfig).toHaveLength(4);
    fromConfig.forEach((e, i) => {
      expect(e).toBe(r.errors[i]);
    });
    r.system.destroy();
  });

  it("a DirectiveError the code threw itself reaches observers as that object, and the strategy follows the place it was thrown", async () => {
    quiet();
    const own = new DirectiveError(
      "custom failure",
      "system",
      "elsewhere",
      { n: 1 },
      false,
    );
    const r = rig({ onConstraintError: "disable" });
    r.make = () => own;
    r.system.start();
    await trip(r, ["constraint"]);

    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toBe(own);
    expect(own.source).toBe("system");
    expect(own.recoverable).toBe(false);
    expect(own.context).toEqual({ n: 1 });
    // The constraint's strategy ("disable") applied, so it stopped running.
    expect(r.recovery).toEqual([["system", "elsewhere", "disable"]]);
    const evaluated = r.calls.constraint;
    r.system.events.bump();
    await r.system.settle();

    expect(r.calls.constraint).toBe(evaluated);
    r.system.destroy();
  });

  it("an observer that throws is contained: the failure is logged and recovery still happens", async () => {
    const { error } = quiet();
    const r = rig({
      onError: () => {
        throw new Error("observer broke");
      },
    });
    r.system.start();
    await trip(r, ["constraint", "effect"]);

    expect(r.recovery).toHaveLength(2);
    expect(
      error.mock.calls.some((c) =>
        c.some((a) => a instanceof Error && a.message === "observer broke"),
      ),
    ).toBe(true);
    r.system.destroy();
  });

  it("plugins hear each source's own error hook, and a module hook hears resolver failures", async () => {
    const { error } = quiet();
    const heard: string[] = [];
    const moduleSaw: [string, string][] = [];
    const r = rig(undefined, {
      plugins: [
        {
          name: "hooks",
          onConstraintError: (id: string, e: Error) =>
            heard.push(`constraint ${id} ${e.message}`),
          onEffectError: (id: string, e: Error) =>
            heard.push(`effect ${id} ${e.message}`),
          onResolverError: (id: string, _req: unknown, e: Error) =>
            heard.push(`resolver ${id} ${e.message}`),
        },
      ],
      hooks: {
        onResolverError: (e: Error, requirement: { type: string }) => {
          moduleSaw.push([e.message, requirement.type]);
          throw new Error("module hook broke");
        },
      },
    });
    r.system.start();
    await trip(r);

    expect(heard.sort()).toEqual([
      "constraint probe constraint boom",
      "effect watcher effect boom",
      "resolver work resolver boom",
    ]);
    expect(moduleSaw).toEqual([["resolver boom", "R"]]);
    // The hook's own failure is isolated and logged, not raised.
    expect(
      error.mock.calls.some((c) =>
        c.some((a) => a instanceof Error && a.message === "module hook broke"),
      ),
    ).toBe(true);
    expect(r.recovery).toHaveLength(4);
    r.system.destroy();
  });
});

describe("what each strategy does", () => {
  it("disable stops a constraint from being evaluated again; skip does not", async () => {
    quiet();
    const disabled = rig({ onConstraintError: "disable" });
    disabled.system.start();
    await trip(disabled, ["constraint"]);
    const frozen = disabled.calls.constraint;
    for (let i = 0; i < 3; i++) {
      disabled.system.events.bump();
      await disabled.system.settle();
    }

    expect(disabled.calls.constraint).toBe(frozen);
    disabled.system.destroy();

    const skipped = rig();
    skipped.system.start();
    await trip(skipped, ["constraint"]);
    const before = skipped.calls.constraint;
    for (let i = 0; i < 3; i++) {
      skipped.system.events.bump();
      await skipped.system.settle();
    }

    expect(skipped.calls.constraint).toBe(before + 3);
    skipped.system.destroy();
  });

  it("disable stops an effect from running again; skip does not", async () => {
    quiet();
    const disabled = rig({ onEffectError: "disable" });
    disabled.system.start();
    await trip(disabled, ["effect"]);
    const frozen = disabled.calls.effect;
    for (let i = 0; i < 3; i++) {
      disabled.system.events.bump();
      await disabled.system.settle();
    }

    expect(disabled.calls.effect).toBe(frozen);
    disabled.system.destroy();

    const skipped = rig();
    skipped.system.start();
    await trip(skipped, ["effect"]);
    const before = skipped.calls.effect;
    for (let i = 0; i < 3; i++) {
      skipped.system.events.bump();
      await skipped.system.settle();
    }

    expect(skipped.calls.effect).toBe(before + 3);
    skipped.system.destroy();
  });

  it("disable on a resolver disables the constraint that required it", async () => {
    quiet();
    const disabled = rig({ onResolverError: "disable" });
    disabled.system.start();
    await trip(disabled, ["resolver"]);
    await reraise(disabled);

    expect(disabled.calls.resolver).toBe(1);
    disabled.system.destroy();

    const skipped = rig();
    skipped.system.start();
    await trip(skipped, ["resolver"]);
    await reraise(skipped);

    expect(skipped.calls.resolver).toBe(2);
    skipped.system.destroy();
  });

  it("retry runs a failed effect again without waiting for a change", async () => {
    quiet();
    const r: Rig = rig({
      onEffectError: "retry",
      onError: () => {
        r.fail.effect = false;
      },
    });
    r.system.start();
    const startRuns = r.calls.effect;
    await trip(r, ["effect"]);

    // One run that threw, one retry that did not.
    expect(r.calls.effect).toBe(startRuns + 2);
    expect(r.recovery).toEqual([["effect", "watcher", "retry"]]);
    r.system.destroy();
  });

  it("retry is reported for a failed resolver, which runs again the next time its requirement is raised", async () => {
    quiet();
    const r: Rig = rig({
      onResolverError: "retry",
      onError: () => {
        r.fail.resolver = false;
      },
    });
    r.system.start();
    await trip(r, ["resolver"]);
    await reraise(r);

    expect(r.calls.resolver).toBeGreaterThanOrEqual(2);
    expect(r.recovery).toEqual([["resolver", "work", "retry"]]);
    r.system.destroy();
  });

  it("retry makes the next read of a failed derivation compute it again", async () => {
    quiet();
    const r: Rig = rig({
      onDerivationError: "retry",
      onError: () => {
        r.fail.derivation = false;
      },
    });
    r.system.start();
    r.fail.derivation = true;
    r.system.events.bump();
    await r.system.settle();

    expect(() => r.system.read("dd")).toThrow("derivation boom");
    expect(r.system.read("dd")).toBe(2);
    expect(r.recovery).toEqual([["derivation", "dd", "retry"]]);
    r.system.destroy();
  });

  it("throw raises the DirectiveError to whoever read the derivation", async () => {
    quiet();
    const r = rig({ onDerivationError: "throw" });
    r.system.start();
    r.fail.derivation = true;
    r.system.events.bump();
    await r.system.settle();
    let caught: unknown;
    try {
      r.system.read("dd");
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(DirectiveError);
    expect(caught).toMatchObject({
      source: "derivation",
      sourceId: "dd",
      recoverable: true,
      message: "derivation boom",
    });
    expect(r.recovery).toEqual([["derivation", "dd", "throw"]]);
    r.system.destroy();
  });

  it.each(["constraint", "effect"] as const)(
    "throw stops the pass and reports the DirectiveError from a failing %s",
    async (source) => {
      const { error } = quiet();
      const r = rig({ [OPTION[source]]: "throw" });
      r.system.start();
      await trip(r, [source]);
      const reported = error.mock.calls
        .flat()
        .filter((a): a is DirectiveError => a instanceof DirectiveError);

      expect(reported).toHaveLength(1);
      expect(reported[0]).toMatchObject({ source, sourceId: ID[source] });
      expect(r.recovery).toEqual([[source, ID[source], "throw"]]);
      r.system.destroy();
    },
  );
});

/** A constraint `flaky` that always throws, retried later; `evals` are the times it ran. */
function flaky(retryLater: Record<string, number> | undefined, fixed = false) {
  const t0 = Date.now();
  const evals: number[] = [];
  const recovery: string[] = [];
  const passes: number[] = [];
  const state = { fixed };
  const mod = createModule("m", {
    schema: {
      facts: { x: t.number() },
      derivations: {},
      events: { bump: {} },
      requirements: { R: {} },
    },
    init: (facts: any) => {
      facts.x = 0;
    },
    events: {
      bump: (facts: any) => {
        facts.x = facts.x + 1;
      },
    },
    constraints: {
      flaky: {
        when: (facts: any) => {
          evals.push(Date.now() - t0);
          facts.x;
          if (!state.fixed) {
            throw new Error("always");
          }

          return false;
        },
        require: { type: "R" },
      },
    },
    resolvers: { r: { requirement: "R", resolve: async () => {} } },
  } as never);
  const system: any = createSystem({
    module: mod,
    errorBoundary: { onConstraintError: "retry-later", retryLater },
    plugins: [
      {
        name: "watch",
        onErrorRecovery: (_e: unknown, s: string) => recovery.push(s),
        onReconcileStart: () => passes.push(Date.now() - t0),
      },
    ],
  } as never);

  return { system, evals, recovery, passes, state, t0 };
}

describe("retry-later", () => {
  it("retries a failing constraint after a growing delay, then gives up with a skip", async () => {
    vi.useFakeTimers();
    const { warn } = quiet();
    const f = flaky({ delayMs: 1000, maxRetries: 3 });
    f.system.start();
    await vi.advanceTimersByTimeAsync(60_000);

    // First try at once, then 1s, 2s and 4s later; the fourth failure is the last.
    expect(f.evals).toEqual([0, 1000, 3000, 7000]);
    expect(f.recovery).toEqual([
      "retry-later",
      "retry-later",
      "retry-later",
      "skip",
    ]);
    // No pass runs while a retry is merely waiting.
    expect(
      [...new Set(f.passes)].every((p) => [0, 1000, 3000, 7000].includes(p)),
    ).toBe(true);
    const gaveUp = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("retry-later"));

    expect(gaveUp).toHaveLength(1);
    expect(gaveUp[0]).toContain("flaky");
    f.system.destroy();
  });

  it("starts the budget over once it has given up", async () => {
    vi.useFakeTimers();
    quiet();
    const f = flaky({ delayMs: 1000, maxRetries: 3 });
    f.system.start();
    await vi.advanceTimersByTimeAsync(60_000);
    f.evals.length = 0;
    f.recovery.length = 0;
    const base = Date.now() - f.t0;
    f.system.events.bump();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(f.evals.map((e) => e - base)).toEqual([0, 1000, 3000, 7000]);
    expect(f.recovery).toEqual([
      "retry-later",
      "retry-later",
      "retry-later",
      "skip",
    ]);
    f.system.destroy();
  });

  it("honours delayMs, backoffMultiplier, maxRetries and maxDelayMs", async () => {
    vi.useFakeTimers();
    quiet();
    const f = flaky({
      delayMs: 1000,
      maxRetries: 2,
      backoffMultiplier: 3,
      maxDelayMs: 2500,
    });
    f.system.start();
    await vi.advanceTimersByTimeAsync(60_000);

    // 1s after the first failure, then 3s capped to 2.5s; the third failure is the last.
    expect(f.evals).toEqual([0, 1000, 3500]);
    expect(f.recovery).toEqual(["retry-later", "retry-later", "skip"]);
    f.system.destroy();
  });

  it("stop() discards retries that were waiting", async () => {
    vi.useFakeTimers();
    quiet();
    const f = flaky({ delayMs: 1000, maxRetries: 3 });
    f.system.start();
    await vi.advanceTimersByTimeAsync(200);
    f.system.stop();
    f.state.fixed = true;
    await vi.advanceTimersByTimeAsync(100);
    f.system.start();
    await vi.advanceTimersByTimeAsync(10_000);

    // Evaluated at the first start and again at the restart, never by the old retry.
    expect(f.evals).toEqual([0, 300]);
    f.system.destroy();
  });

  it("a resolver that succeeds clears its retry budget and its waiting retry", async () => {
    vi.useFakeTimers();
    quiet();
    const r = rig({
      onResolverError: "retry-later",
      retryLater: { delayMs: 1000, maxRetries: 1 },
    });
    r.system.start();
    r.fail.resolver = true;
    r.system.facts.go = true;
    await vi.advanceTimersByTimeAsync(10);

    expect(r.recovery).toEqual([["resolver", "work", "retry-later"]]);

    r.fail.resolver = false;
    r.system.facts.go = false;
    await vi.advanceTimersByTimeAsync(10);
    r.system.facts.go = true;
    await vi.advanceTimersByTimeAsync(10);

    expect(r.calls.resolver).toBe(2);
    // Nothing is waiting any more: no pass runs when the old retry would have been due.
    const passes = r.passes.length;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(r.passes.length).toBe(passes);

    // And a new failure gets the full budget again, not a skip.
    r.fail.resolver = true;
    r.system.facts.go = false;
    await vi.advanceTimersByTimeAsync(10);
    r.system.facts.go = true;
    await vi.advanceTimersByTimeAsync(10);

    expect(r.recovery).toEqual([
      ["resolver", "work", "retry-later"],
      ["resolver", "work", "retry-later"],
    ]);
    r.system.destroy();
  });
});

describe("retry-later remembers attempts for a bounded number of sources", () => {
  // 1.35's bound on the memory of attempts; a bound is part of what is pinned here.
  it("keeps the attempt counts of the first 1000 sources and forgets the oldest after that", async () => {
    vi.useFakeTimers();
    quiet();
    const failing = new Set<number>();
    const constraints: Record<string, unknown> = {};
    for (let i = 0; i <= 1000; i++) {
      constraints[`c${i}`] = {
        when: (facts: any) => {
          facts.tick;
          if (failing.has(i)) {
            throw new Error("boom");
          }

          return false;
        },
        require: { type: "R" },
      };
    }
    const mod = createModule("many", {
      schema: {
        facts: { tick: t.number() },
        derivations: {},
        events: { bump: {} },
        requirements: { R: {} },
      },
      init: (facts: any) => {
        facts.tick = 0;
      },
      events: {
        bump: (facts: any) => {
          facts.tick = facts.tick + 1;
        },
      },
      constraints,
      resolvers: { r: { requirement: "R", resolve: async () => {} } },
    } as never);
    const recovery: [string, string][] = [];
    const system: any = createSystem({
      module: mod,
      errorBoundary: {
        onConstraintError: "retry-later",
        retryLater: { delayMs: 1000, maxRetries: 1 },
      },
      plugins: [
        {
          name: "watch",
          onErrorRecovery: (e: DirectiveError, s: string) =>
            recovery.push([e.sourceId, s]),
        },
      ],
    } as never);
    // One round: these constraints throw, then every waiting retry comes due and passes.
    const round = async (ids: number[]) => {
      recovery.length = 0;
      failing.clear();
      for (const id of ids) {
        failing.add(id);
      }
      system.events.bump();
      await vi.advanceTimersByTimeAsync(10);
      const seen = recovery.slice();
      failing.clear();
      await vi.advanceTimersByTimeAsync(5000);

      return seen;
    };

    for (let i = 0; i < 1000; i++) {
      failing.add(i);
    }
    system.start();
    await vi.advanceTimersByTimeAsync(10);

    expect(recovery).toHaveLength(1000);
    expect(recovery.every((r) => r[1] === "retry-later")).toBe(true);
    failing.clear();
    await vi.advanceTimersByTimeAsync(5000);

    // Exactly 1000 sources are all remembered: c0 already used its one retry.
    expect(await round([0])).toEqual([["c0", "skip"]]);
    // A 1001st source is new; then c0 (forgotten when it gave up) starts over.
    expect(await round([1000])).toEqual([["c1000", "retry-later"]]);
    expect(await round([0])).toEqual([["c0", "retry-later"]]);
    // That made 1001 counts, so the oldest, c1, was forgotten and starts over too.
    expect(await round([1])).toEqual([["c1", "retry-later"]]);
    system.destroy();
  });
});

describe("the development warning for an error nothing handles", () => {
  it("speaks once for each constraint, resolver and derivation that throws, never for an effect", async () => {
    const { warn } = quiet();
    const r = rig();
    const messages: Record<Source, string> = {
      constraint: "e.g. nope?! ",
      resolver: "disk full.",
      effect: "effect boom",
      derivation: "derivation boom",
    };
    r.make = (source) => new Error(messages[source]);
    r.system.start();
    await trip(r);
    const first = unhandled(warn);

    expect(first).toHaveLength(3);
    const constraint = first.find((m) =>
      m.includes('constraint "probe"'),
    ) as string;
    const derivation = first.find((m) =>
      m.includes('derivation "dd"'),
    ) as string;
    const resolver = first.find((m) => m.includes('resolver "work"')) as string;

    // The error's own message, without its closing punctuation, then one full stop.
    expect(constraint).toMatch(
      /threw: e\.g\. nope\. .*errorBoundary\.onConstraintError/,
    );
    expect(derivation).toMatch(
      /threw: derivation boom\. .*errorBoundary\.onDerivationError/,
    );
    // A resolver's also names the requirement that stays unmet.
    expect(resolver).toContain(
      'threw: disk full. Requirement "R" stays unmet.',
    );
    expect(resolver).toMatch(/errorBoundary\.onResolverError/);
    expect(resolver).not.toContain("full..");
    expect(first.some((m) => m.includes('effect "watcher"'))).toBe(false);

    // The same sources failing again say nothing new.
    r.system.events.bump();
    await reraise(r);
    try {
      r.system.read("dd");
    } catch {
      // expected
    }

    expect(unhandled(warn)).toHaveLength(3);
    r.system.destroy();
  });

  it.each(SOURCES.filter((s) => s !== "effect"))(
    "is silent when the %s source has an option, and speaks when only the other sources do",
    async (source) => {
      const { warn } = quiet();
      const others = SOURCES.filter((s) => s !== "effect" && s !== source);
      const configured = rig({ [OPTION[source]]: "skip" });
      configured.system.start();
      await trip(configured, [source]);

      expect(unhandled(warn)).toEqual([]);
      configured.system.destroy();

      const bare = rig(
        Object.fromEntries(others.map((s) => [OPTION[s], "skip"])),
      );
      bare.system.start();
      await trip(bare, [source]);
      const heard = unhandled(warn);

      expect(heard).toHaveLength(1);
      expect(heard[0]).toContain(`${source} "${ID[source]}"`);
      bare.system.destroy();
    },
  );

  it("a handler function counts as handling it, even one that returns nothing", async () => {
    const { warn } = quiet();
    const r = rig({
      onConstraintError: () => undefined,
      onResolverError: () => undefined,
      onDerivationError: () => undefined,
    });
    r.system.start();
    await trip(r);

    expect(unhandled(warn)).toEqual([]);
    r.system.destroy();
  });

  it("errorBoundary.onError counts as handling it", async () => {
    const { warn } = quiet();
    const r = rig({ onError: () => undefined });
    r.system.start();
    await trip(r);

    expect(unhandled(warn)).toEqual([]);
    r.system.destroy();
  });

  it("stays quiet about a failure that came after the run had satisfied its requirement", async () => {
    vi.useFakeTimers();
    const { warn } = quiet();
    const mod = createModule("load", {
      schema: {
        facts: { go: t.boolean(), done: t.boolean() },
        derivations: {},
        events: {},
        requirements: { LOAD: {} },
      },
      init: (facts: any) => {
        facts.go = false;
        facts.done = false;
      },
      constraints: {
        load: {
          when: (facts: any) => facts.go && !facts.done,
          require: { type: "LOAD" },
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async (_req: unknown, context: any) => {
            context.facts.done = true;
            await new Promise((resolve) => setTimeout(resolve, 20));
            throw new Error("too late");
          },
        },
      },
    } as never);
    const system: any = createSystem({ module: mod } as never);
    system.start();
    system.facts.go = true;
    await vi.advanceTimersByTimeAsync(100);
    const heard = unhandled(warn);

    expect(heard).toHaveLength(1);
    expect(heard[0]).toContain('resolver "load"');
    expect(heard[0]).toContain("too late");
    expect(heard[0]).not.toContain("stays unmet");
    system.destroy();
  });

  it("remembers the first 1000 sources it spoke about and forgets the oldest after that", async () => {
    const { warn } = quiet();
    const failing = new Set<number>();
    const constraints: Record<string, unknown> = {};
    for (let i = 0; i <= 1000; i++) {
      constraints[`c${i}`] = {
        when: (facts: any) => {
          facts.tick;
          if (failing.has(i)) {
            throw new Error("boom");
          }

          return false;
        },
        require: { type: "R" },
      };
    }
    const mod = createModule("many", {
      schema: {
        facts: { tick: t.number() },
        derivations: {},
        events: { bump: {} },
        requirements: { R: {} },
      },
      init: (facts: any) => {
        facts.tick = 0;
      },
      events: {
        bump: (facts: any) => {
          facts.tick = facts.tick + 1;
        },
      },
      constraints,
      resolvers: { r: { requirement: "R", resolve: async () => {} } },
    } as never);
    const system: any = createSystem({ module: mod } as never);
    const round = async (ids: number[]) => {
      failing.clear();
      for (const id of ids) {
        failing.add(id);
      }
      const before = unhandled(warn).length;
      system.events.bump();
      await system.settle();

      return unhandled(warn).length - before;
    };

    for (let i = 0; i < 1000; i++) {
      failing.add(i);
    }
    system.start();
    await system.settle();

    expect(unhandled(warn)).toHaveLength(1000);
    // Exactly 1000 sources are all still remembered.
    expect(await round([0])).toBe(0);
    // The 1001st pushes the oldest one out.
    expect(await round([1000])).toBe(1);
    expect(await round([0])).toBe(1);
    system.destroy();
  });
});
