import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box tests for what a user can see of a constraint at L2 beyond the
// requirements it emits: which constraints a pass asks, and what
// system.inspect() and a plugin's onConstraintEvaluate hook report about them.
// Public API only. inspect() and the plugin hook are used to observe; the rule
// they check is the constraint's, not the snapshot's layout. What is pinned is
// the 1.35 behaviour, not message text or timestamps' exact source.

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const req = (tag: string) => ({ type: "R", tag });

const flush = async () => {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
};

/** Swallow the development warnings and errors these scenarios provoke. */
function quiet() {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
}

interface BuildOptions {
  constraints: Record<string, unknown>;
  /** Tags whose resolver waits on a gate before it finishes. */
  hold?: string[];
  /** Runs inside the resolver for R, before it finishes. */
  onResolve?: (req: any, context: any) => void;
  /** Called with (id, active) on every constraint evaluation a plugin sees. */
  onEvaluate?: (id: string, active: boolean) => void;
}

/**
 * One module: facts n, m (numbers) and flag (boolean); one requirement type R
 * carrying a tag; one resolver for R that logs `start:<tag>` and runs
 * `onResolve`.
 */
function build(options: BuildOptions) {
  const log: string[] = [];
  const gates = new Map<
    string,
    { promise: Promise<void>; resolve: () => void }
  >();
  for (const tag of options.hold ?? []) {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    gates.set(tag, { promise, resolve });
  }
  const mod = createModule("m", {
    schema: {
      facts: { n: t.number(), m: t.number(), flag: t.boolean() },
      derivations: {},
      events: {},
      requirements: { R: { tag: t.string() } },
    },
    init: (facts: any) => {
      facts.n = 0;
      facts.m = 0;
      facts.flag = false;
    },
    constraints: options.constraints,
    resolvers: {
      r: {
        requirement: "R",
        resolve: async (r: any, context: any) => {
          log.push(`start:${r.tag}`);
          await gates.get(r.tag)?.promise;
          options.onResolve?.(r, context);
        },
      },
    },
  } as never);
  const system = createSystem({
    module: mod,
    plugins: [
      {
        name: "observer",
        onConstraintEvaluate: (id: string, active: boolean) => {
          options.onEvaluate?.(id, active);
        },
      },
    ],
  } as never) as any;
  const row = (id: string) =>
    system.inspect().constraints.find((c: any) => c.id === id);

  return {
    system,
    log,
    row,
    open: (tag: string) => gates.get(tag)!.resolve(),
    starts: () =>
      log.filter((l) => l.startsWith("start:")).map((l) => l.slice(6)),
  };
}

describe("a disabled constraint is not asked while it is waiting on another", () => {
  it("is not asked when the constraint it follows finishes and the finishing write wakes a pass", async () => {
    let calls = 0;
    const { system, starts } = build({
      constraints: {
        first: { when: (facts: any) => facts.n === 0, require: req("first") },
        second: {
          after: ["first"],
          when: () => {
            calls++;

            return true;
          },
          require: req("second"),
        },
      },
      onResolve: (r, context) => {
        if (r.tag === "first") {
          context.facts.n = 1;
        }
      },
    });
    system.constraints.disable("second");
    system.start();
    await system.settle();
    expect(starts()).toEqual(["first"]);
    expect(calls).toBe(0);
    system.destroy();
  });

  it("asks it, once, after it is enabled again", async () => {
    let calls = 0;
    const { system, starts } = build({
      constraints: {
        first: { when: (facts: any) => facts.n === 0, require: req("first") },
        second: {
          after: ["first"],
          when: () => {
            calls++;

            return true;
          },
          require: req("second"),
        },
      },
      onResolve: (r, context) => {
        if (r.tag === "first") {
          context.facts.n = 1;
        }
      },
    });
    system.constraints.disable("second");
    system.start();
    await system.settle();
    expect(calls).toBe(0);
    system.constraints.enable("second");
    system.facts.m = 1;
    await system.settle();
    expect(starts()).toEqual(["first", "second"]);
    expect(calls).toBe(1);
    system.destroy();
  });

  it("is not asked when the system restarts after a write while it was stopped", async () => {
    let calls = 0;
    const { system } = build({
      constraints: {
        watched: { when: (facts: any) => facts.n > 100, require: req("w") },
        off: {
          when: () => {
            calls++;

            return true;
          },
          require: req("off"),
        },
      },
    });
    system.start();
    await system.settle();
    expect(calls).toBe(1);
    system.constraints.disable("off");
    system.stop();
    system.facts.n = 1;
    system.start();
    await system.settle();
    expect(calls).toBe(1);
    system.destroy();
  });
});

describe("a constraint enabled again still waits for the one it follows", () => {
  it("does not run before that constraint's resolver has finished", async () => {
    const { system, log, open } = build({
      hold: ["a"],
      constraints: {
        a: { when: (facts: any) => facts.flag, require: req("a") },
        b: { after: ["a"], when: () => true, require: req("b") },
      },
    });
    system.start();
    await system.settle();
    // `a` does not fire, so `b` is not held back and runs.
    expect(log).toEqual(["start:b"]);
    system.constraints.disable("b");
    system.facts.m = 1;
    await system.settle();
    system.facts.flag = true;
    await flush();
    expect(log).toEqual(["start:b", "start:a"]);
    system.constraints.enable("b");
    system.facts.m = 2;
    await flush();
    // `a` is still running: `b` waits.
    expect(log).toEqual(["start:b", "start:a"]);
    open("a");
    await system.settle();
    expect(log).toEqual(["start:b", "start:a", "start:b"]);
    system.destroy();
  });
});

describe("every dependent of a constraint is asked once it finishes", () => {
  it("asks each of two constraints waiting on the same one", async () => {
    const { system, starts } = build({
      constraints: {
        first: { when: (facts: any) => facts.n === 0, require: req("first") },
        second: { after: ["first"], when: () => true, require: req("second") },
        third: { after: ["first"], when: () => true, require: req("third") },
      },
      onResolve: (r, context) => {
        if (r.tag === "first") {
          context.facts.n = 1;
        }
      },
    });
    system.start();
    await system.settle();
    expect(starts().sort()).toEqual(["first", "second", "third"]);
    system.destroy();
  });
});

describe("inspect() reports each constraint", () => {
  it("lists every constraint in declaration order with its priority and whether it is disabled", async () => {
    const { system } = build({
      constraints: {
        low: { when: () => false, require: req("low") },
        high: { priority: 5, when: () => false, require: req("high") },
        off: { priority: -2, when: () => true, require: req("off") },
      },
    });
    system.constraints.disable("off");
    system.start();
    await system.settle();
    const rows = system
      .inspect()
      .constraints.map((c: any) => [c.id, c.priority, c.disabled]);
    expect(rows).toEqual([
      ["low", 0, false],
      ["high", 5, false],
      ["off", -2, true],
    ]);
    system.destroy();
  });

  it("shows whether a constraint is active, how many times it was, and when it last was", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const { system, row } = build({
      constraints: {
        gate: { when: (facts: any) => facts.flag, require: req("gate") },
        never: { when: (facts: any) => facts.n < 0, require: req("never") },
      },
    });
    system.start();
    await system.settle();
    expect(row("gate")).toMatchObject({
      active: false,
      hitCount: 0,
      lastActiveAt: null,
    });

    system.facts.flag = true;
    await system.settle();
    expect(row("gate")).toMatchObject({
      active: true,
      hitCount: 1,
      lastActiveAt: 1_000_000,
    });

    vi.setSystemTime(1_005_000);
    system.facts.flag = false;
    await system.settle();
    // No longer active, and the last time it was stays what it was.
    expect(row("gate")).toMatchObject({
      active: false,
      hitCount: 1,
      lastActiveAt: 1_000_000,
    });

    vi.setSystemTime(1_009_000);
    system.facts.flag = true;
    await system.settle();
    expect(row("gate")).toMatchObject({
      active: true,
      hitCount: 2,
      lastActiveAt: 1_009_000,
    });
    expect(row("never")).toMatchObject({
      active: false,
      hitCount: 0,
      lastActiveAt: null,
    });
    system.destroy();
  });

  it("keeps counting across passes: each pass that finds it active adds one", async () => {
    const { system, row } = build({
      constraints: {
        busy: { when: (facts: any) => facts.n >= 0, require: req("busy") },
      },
    });
    system.start();
    await system.settle();
    const first = row("busy").hitCount;
    expect(first).toBeGreaterThanOrEqual(1);
    for (let i = 1; i <= 3; i++) {
      system.facts.n = i;
      await system.settle();
      expect(row("busy").hitCount).toBe(first + i);
    }
    system.destroy();
  });

  it("shows a constraint whose when threw as not active", async () => {
    quiet();
    const { system, row } = build({
      constraints: {
        shaky: {
          when: (facts: any) => {
            if (facts.flag) {
              throw new Error("boom");
            }

            return true;
          },
          require: req("shaky"),
        },
      },
    });
    system.start();
    await system.settle();
    expect(row("shaky").active).toBe(true);
    system.facts.flag = true;
    await system.settle();
    expect(row("shaky").active).toBe(false);
    system.facts.flag = false;
    await system.settle();
    expect(row("shaky").active).toBe(true);
    system.destroy();
  });

  it("reports an async constraint the same way, and not active once its when rejects", async () => {
    quiet();
    const { system, row } = build({
      constraints: {
        slow: {
          async: true,
          deps: ["n", "flag"],
          when: async (facts: any) => {
            if (facts.flag) {
              throw new Error("boom");
            }

            return facts.n >= 0;
          },
          require: req("slow"),
        },
      },
    });
    system.start();
    await system.settle();
    expect(row("slow")).toMatchObject({ active: true, hitCount: 1 });
    system.facts.n = 1;
    await system.settle();
    expect(row("slow")).toMatchObject({ active: true, hitCount: 2 });
    system.facts.flag = true;
    await system.settle();
    expect(row("slow")).toMatchObject({ active: false, hitCount: 2 });
    system.destroy();
  });
});

describe("a when that returns a promise without async: true", () => {
  it("is reported to plugins and to inspect() with the answer it resolved to, every time it is asked", async () => {
    quiet();
    const seen: Array<[string, boolean]> = [];
    const calls = { yes: 0, no: 0 };
    const { system, row } = build({
      onEvaluate: (id, active) => {
        seen.push([id, active]);
      },
      constraints: {
        yes: {
          when: () => {
            calls.yes++;

            return Promise.resolve(true);
          },
          require: () => null,
        },
        no: {
          when: () => {
            calls.no++;

            return Promise.resolve(false);
          },
          require: () => null,
        },
      },
    });
    system.start();
    await system.settle();
    system.facts.n = 1;
    await system.settle();
    expect(calls.yes).toBeGreaterThanOrEqual(1);
    // One report per ask, each with the answer the promise gave.
    expect(seen.filter(([id]) => id === "yes")).toEqual(
      Array.from({ length: calls.yes }, () => ["yes", true]),
    );
    expect(seen.filter(([id]) => id === "no")).toEqual(
      Array.from({ length: calls.no }, () => ["no", false]),
    );
    expect(row("yes")).toMatchObject({ active: true, hitCount: calls.yes });
    expect(row("no")).toMatchObject({ active: false, hitCount: 0 });
    system.destroy();
  });
});
