import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box tests for constraints at L2: when/require, the requirements they
// emit, priority and `after` ordering, re-evaluation after writes, async
// constraints with their timeout, and errors inside when/require. Public API
// only (createSystem, constraints, resolvers, system.constraints.disable /
// enable / isDisabled, start/stop/settle). Function `when` only: the data form
// is L11. What is pinned is the 1.35 rule, not message text: a warning is
// checked for the names it carries, never its wording.

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
};

const req = (tag: string) => ({ type: "R", tag });

/** Every console.warn / console.error call, its arguments joined. */
function consoleSpy() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const text = (spy: typeof warn) =>
    spy.mock.calls.map((args) => args.map((a) => String(a)).join(" "));

  return {
    warnings: () => text(warn),
    errors: () => text(error),
    /** Warnings that name every one of `names`. */
    naming: (...names: string[]) =>
      text(warn).filter((w) => names.every((n) => w.includes(`"${n}"`))),
  };
}

interface BuildOptions {
  facts?: Record<string, unknown>;
  init?: (facts: any) => void;
  constraints: Record<string, unknown>;
  /** Tags whose resolver waits on a gate before it finishes. */
  hold?: string[];
  /** Runs inside the resolver, after its gate, before it finishes. */
  onResolve?: (req: any, context: any) => void;
}

/**
 * One module: facts n, m (numbers) and flag (boolean), plus `facts`; one
 * requirement type R carrying a tag; one resolver for R that logs
 * `start:<tag>` and `end:<tag>` (and `abort:<tag>` if its run is aborted).
 */
function build(options: BuildOptions) {
  const log: string[] = [];
  const gates = new Map<
    string,
    { promise: Promise<void>; resolve: () => void }
  >();
  for (const tag of options.hold ?? []) {
    gates.set(tag, deferred());
  }
  const mod = createModule("m", {
    schema: {
      facts: {
        n: t.number(),
        m: t.number(),
        flag: t.boolean(),
        ...(options.facts ?? {}),
      },
      derivations: {},
      events: {},
      requirements: { R: { tag: t.string() } },
    },
    init: (facts: any) => {
      facts.n = 0;
      facts.m = 0;
      facts.flag = false;
      options.init?.(facts);
    },
    constraints: options.constraints,
    resolvers: {
      r: {
        requirement: "R",
        resolve: async (req: any, context: any) => {
          log.push(`start:${req.tag}`);
          context.signal?.addEventListener?.("abort", () => {
            log.push(`abort:${req.tag}`);
          });
          const gate = gates.get(req.tag);
          if (gate) {
            await gate.promise;
          }
          options.onResolve?.(req, context);
          log.push(`end:${req.tag}`);
        },
      },
    },
  } as never);
  const system = createSystem({ module: mod } as never) as any;

  return {
    system,
    log,
    open: (tag: string) => gates.get(tag)!.resolve(),
    starts: () =>
      log.filter((l) => l.startsWith("start:")).map((l) => l.slice(6)),
  };
}

describe("when and require", () => {
  it("emits the requirement of a constraint whose when holds, and none for one whose when does not", async () => {
    const { system, starts } = build({
      constraints: {
        yes: { when: () => true, require: req("yes") },
        no: { when: () => false, require: req("no") },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual(["yes"]);
    system.destroy();
  });

  it("emits nothing for a require that returns null, undefined or an empty list", async () => {
    const out = consoleSpy();
    const { system, starts } = build({
      constraints: {
        nul: { when: () => true, require: () => null },
        undef: { when: () => true, require: () => undefined },
        empty: { when: () => true, require: () => [] },
        fine: { when: () => true, require: req("fine") },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual(["fine"]);
    expect(out.errors()).toEqual([]);
    system.destroy();
  });

  it("skips null and undefined entries in a list and emits the rest in order", async () => {
    const { system, starts } = build({
      constraints: {
        many: {
          when: () => true,
          require: () => [null, req("a"), undefined, req("b")],
        },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual(["a", "b"]);
    system.destroy();
  });

  it("emits one requirement for a static require and for a require function returning one", async () => {
    const { system, starts } = build({
      constraints: {
        fixed: { when: () => true, require: req("fixed") },
        fn: { when: () => true, require: (facts: any) => req(`fn${facts.n}`) },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual(["fixed", "fn0"]);
    system.destroy();
  });

  it("emits a requirement once a require that answered nothing answers one", async () => {
    const { system, starts } = build({
      constraints: {
        later: {
          when: (facts: any) => facts.n >= 0,
          require: (facts: any) => (facts.n > 0 ? req("later") : null),
        },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual([]);
    system.facts.n = 1;
    await system.settle();
    expect(starts()).toEqual(["later"]);
    system.destroy();
  });

  it("keeps an untouched constraint answering nothing when another constraint fires", async () => {
    const out = consoleSpy();
    const { system, starts } = build({
      constraints: {
        quiet: { when: (facts: any) => facts.n >= 0, require: () => null },
        off: { when: (facts: any) => facts.n < 0, require: req("off") },
        other: { when: (facts: any) => facts.m > 0, require: req("other") },
      },
    });
    system.start();
    await system.settle();
    system.facts.m = 1;
    await system.settle();
    system.facts.m = 2;
    await system.settle();
    expect(starts()).toEqual(["other"]);
    expect(out.errors()).toEqual([]);
    expect(out.warnings()).toEqual([]);
    system.destroy();
  });

  it("wakes a constraint on a fact only its require read", async () => {
    const { system, starts } = build({
      constraints: {
        c: {
          when: (facts: any) => facts.flag === false,
          require: (facts: any) => (facts.m > 0 ? req(`m${facts.m}`) : null),
        },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual([]);
    system.facts.m = 2;
    await system.settle();
    expect(starts()).toEqual(["m2"]);
    system.destroy();
  });

  it("warns in development when one constraint emits more than ten requirements, and not at ten", async () => {
    const out = consoleSpy();
    const list = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => req(`${prefix}${i}`));
    const { system, starts } = build({
      constraints: {
        ten: { when: () => true, require: () => list("t", 10) },
        eleven: { when: () => true, require: () => list("e", 11) },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toHaveLength(21);
    expect(out.naming("eleven")).toHaveLength(1);
    expect(out.naming("ten")).toHaveLength(0);
    system.destroy();
  });

  it("passes the system's derived values to when and require", async () => {
    const mod = createModule("d", {
      schema: {
        facts: { n: t.number() },
        derivations: { twice: t.number() },
        events: {},
        requirements: { R: { tag: t.string() } },
      },
      init: (facts: any) => {
        facts.n = 2;
      },
      derive: { twice: (facts: any) => facts.n * 2 },
      constraints: {
        c: {
          when: (_facts: any, derived: any) => derived.twice === 4,
          require: (_facts: any, derived: any) => req(`d${derived.twice}`),
        },
      },
      resolvers: {
        r: {
          requirement: "R",
          resolve: async (r: any) => {
            seen.push(r.tag);
          },
        },
      },
    } as never);
    const seen: string[] = [];
    const system = createSystem({ module: mod } as never) as any;
    system.start();
    await system.settle();
    expect(seen).toEqual(["d4"]);
    system.destroy();
  });
});

describe("priority", () => {
  it("asks higher priority first; equal priority keeps declaration order; no priority is 0", async () => {
    const { system, starts } = build({
      constraints: {
        low: { priority: -5, when: () => true, require: req("low") },
        plain: { when: () => true, require: req("plain") },
        high: { priority: 10, when: () => true, require: req("high") },
        zero: { priority: 0, when: () => true, require: req("zero") },
        mid: { priority: 3, when: () => true, require: req("mid") },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual(["high", "mid", "plain", "zero", "low"]);
    system.destroy();
  });

  it("orders by priority again when the system restarts", async () => {
    let open = true;
    const when = (facts: any) => facts.n >= 0 && open;
    const { system, starts, log } = build({
      constraints: {
        low: { priority: 1, when, require: req("low") },
        high: { priority: 2, when, require: req("high") },
      },
    });
    system.start();
    await system.settle();
    open = false;
    system.facts.n = 1;
    await system.settle();
    system.stop();
    open = true;
    log.length = 0;
    system.start();
    await system.settle();
    expect(starts()).toEqual(["high", "low"]);
    system.destroy();
  });
});

describe("after", () => {
  it("waits for the named constraint's resolver to finish", async () => {
    const out = consoleSpy();
    const { system, log, open } = build({
      hold: ["first"],
      constraints: {
        second: { after: ["first"], when: () => true, require: req("second") },
        first: { when: () => true, require: req("first") },
      },
    });
    system.start();
    await flush();
    expect(log).toEqual(["start:first"]);
    open("first");
    await system.settle();
    expect(log).toEqual([
      "start:first",
      "end:first",
      "start:second",
      "end:second",
    ]);
    expect(out.warnings()).toEqual([]);
    system.destroy();
  });

  it("runs the waiting constraint when the named one's resolver satisfied it by its own write", async () => {
    const { system, log } = build({
      constraints: {
        first: { when: (facts: any) => facts.n === 0, require: req("first") },
        second: { after: ["first"], when: () => true, require: req("second") },
      },
      onResolve: (r, context) => {
        if (r.tag === "first") {
          context.facts.n = 1;
        }
      },
    });
    system.start();
    await system.settle();
    expect(log).toEqual([
      "start:first",
      "end:first",
      "start:second",
      "end:second",
    ]);
    system.destroy();
  });

  it("waits for every constraint it names", async () => {
    const { system, log, open, starts } = build({
      hold: ["a", "b"],
      constraints: {
        last: { after: ["a", "b"], when: () => true, require: req("last") },
        a: { when: () => true, require: req("a") },
        b: { when: () => true, require: req("b") },
      },
    });
    system.start();
    await flush();
    expect(starts()).toEqual(["a", "b"]);
    open("b");
    await flush();
    expect(starts()).toEqual(["a", "b"]);
    open("a");
    await system.settle();
    expect(log.indexOf("start:last")).toBeGreaterThan(log.indexOf("end:a"));
    expect(log.indexOf("start:last")).toBeGreaterThan(log.indexOf("end:b"));
    system.destroy();
  });

  it("does not wait for a named constraint whose when does not hold", async () => {
    const { system, starts } = build({
      constraints: {
        second: { after: ["first"], when: () => true, require: req("second") },
        first: { when: () => false, require: req("first") },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual(["second"]);
    system.destroy();
  });

  it("does not wait for a named constraint that is disabled", async () => {
    const { system, starts } = build({
      constraints: {
        second: { after: ["first"], when: () => true, require: req("second") },
        first: { when: () => true, require: req("first") },
      },
    });
    system.constraints.disable("first");
    system.start();
    await system.settle();
    expect(starts()).toEqual(["second"]);
    system.destroy();
  });

  it("does not wait for a named constraint whose when threw", async () => {
    consoleSpy();
    const { system, starts } = build({
      constraints: {
        second: { after: ["first"], when: () => true, require: req("second") },
        first: {
          when: () => {
            throw new Error("boom");
          },
          require: req("first"),
        },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual(["second"]);
    system.destroy();
  });

  it("does not wait for a named constraint whose require threw", async () => {
    consoleSpy();
    const { system, starts } = build({
      constraints: {
        second: { after: ["first"], when: () => true, require: req("second") },
        first: {
          when: () => true,
          require: () => {
            throw new Error("bad require");
          },
        },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual(["second"]);
    system.destroy();
  });

  it("ignores an `after` naming no constraint, with a development warning naming both", async () => {
    const out = consoleSpy();
    const { system, starts } = build({
      constraints: {
        second: {
          after: ["missing"],
          when: () => true,
          require: req("second"),
        },
        first: { after: [], when: () => true, require: req("first") },
      },
    });
    expect(out.naming("second", "missing")).toHaveLength(1);
    expect(out.naming("first")).toHaveLength(0);
    system.start();
    await system.settle();
    expect(starts()).toEqual(["second", "first"]);
    system.destroy();
  });

  it("keeps the requirement of a constraint it holds back", async () => {
    const { system, log, open } = build({
      hold: ["first"],
      constraints: {
        first: { when: (facts: any) => facts.n === 1, require: req("first") },
        second: {
          after: ["first"],
          when: (facts: any) => facts.m >= 0,
          require: req("second"),
        },
      },
    });
    system.start();
    await system.settle();
    expect(log).toEqual(["start:second", "end:second"]);
    system.facts.n = 1;
    system.facts.m = 1;
    await flush();
    expect(log).toEqual(["start:second", "end:second", "start:first"]);
    open("first");
    await system.settle();
    expect(log).toEqual([
      "start:second",
      "end:second",
      "start:first",
      "end:first",
    ]);
    system.destroy();
  });

  it("waits again for a named constraint that did not fire on an earlier pass and fires now", async () => {
    const { system, log, open } = build({
      hold: ["first"],
      constraints: {
        first: { when: (facts: any) => facts.n === 1, require: req("first") },
        second: {
          after: ["first"],
          when: (facts: any) => facts.m >= 0,
          require: (facts: any) => req(`second${facts.m}`),
        },
      },
    });
    system.start();
    await system.settle();
    expect(log).toEqual(["start:second0", "end:second0"]);
    // A pass in which first is asked and does not fire.
    system.facts.n = 2;
    await system.settle();
    system.facts.n = 1;
    system.facts.m = 1;
    await flush();
    expect(log).toEqual(["start:second0", "end:second0", "start:first"]);
    open("first");
    await system.settle();
    expect(log).toEqual([
      "start:second0",
      "end:second0",
      "start:first",
      "end:first",
      "start:second1",
      "end:second1",
    ]);
    system.destroy();
  });

  it("lets an unrelated write through while a higher-priority constraint is still held back", async () => {
    const out = consoleSpy();
    const { system, log, open } = build({
      hold: ["first"],
      constraints: {
        second: {
          priority: 10,
          after: ["first"],
          when: () => true,
          require: req("second"),
        },
        first: { when: () => true, require: req("first") },
      },
    });
    system.start();
    await flush();
    system.facts.flag = true;
    await flush();
    expect(log).toEqual(["start:first"]);
    open("first");
    await system.settle();
    expect(log).toEqual([
      "start:first",
      "end:first",
      "start:second",
      "end:second",
    ]);
    expect(out.errors()).toEqual([]);
    system.destroy();
  });

  it("keeps the requirements of every other constraint while one is held back", async () => {
    const out = consoleSpy();
    const { system, log, open } = build({
      hold: ["first"],
      constraints: {
        first: { when: () => true, require: req("first") },
        second: { after: ["first"], when: () => true, require: req("second") },
        other: { when: (facts: any) => facts.m > 0, require: req("other") },
      },
    });
    system.start();
    await flush();
    system.facts.m = 1;
    await flush();
    expect(log).toEqual(["start:first", "start:other", "end:other"]);
    open("first");
    await system.settle();
    expect(log).toEqual([
      "start:first",
      "start:other",
      "end:other",
      "end:first",
      "start:second",
      "end:second",
    ]);
    expect(out.errors()).toEqual([]);
    system.destroy();
  });

  it("after a restart asks constraints of equal priority dependencies first", async () => {
    let open = true;
    const when = (facts: any) => facts.n >= 0 && open;
    const { system, starts, log } = build({
      constraints: {
        second: { after: ["first"], when, require: req("second") },
        first: { when, require: req("first") },
        third: { when, require: req("third") },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual(["first", "third", "second"]);
    open = false;
    system.facts.n = 1;
    await system.settle();
    system.stop();
    open = true;
    log.length = 0;
    system.start();
    await system.settle();
    // The dependency is asked first and every constraint runs again. Whether
    // `second` waits for `first`'s new requirement to resolve is quirk (e) in
    // contracts/GATE-1.md: 1.35 remembers the old resolution (first, second,
    // third), 2.0 waits (first, third, second). Not pinned here; core-next
    // pins the 2.0 behaviour and the L2 gate records the divergence.
    expect(starts()[0]).toBe("first");
    expect([...starts()].sort()).toEqual(["first", "second", "third"]);
    system.destroy();
  });

  it("runs a diamond in dependency order", async () => {
    const { system, log } = build({
      constraints: {
        d: { after: ["b", "c"], when: () => true, require: req("d") },
        b: { after: ["a"], when: () => true, require: req("b") },
        c: { after: ["a"], when: () => true, require: req("c") },
        a: { when: () => true, require: req("a") },
      },
    });
    system.start();
    await system.settle();
    const at = (entry: string) => log.indexOf(entry);
    expect(at("end:a")).toBeLessThan(at("start:b"));
    expect(at("end:a")).toBeLessThan(at("start:c"));
    expect(at("start:d")).toBeGreaterThan(at("end:b"));
    expect(at("start:d")).toBeGreaterThan(at("end:c"));
    expect(log.filter((l) => l.startsWith("start:"))).toHaveLength(4);
    system.destroy();
  });

  it("rejects a cycle when the system is created, naming the constraints on it and no other", () => {
    let message = "";
    try {
      build({
        constraints: {
          bystander: { after: ["a"], when: () => true, require: req("x") },
          a: { after: ["side", "b"], when: () => true, require: req("a") },
          side: { when: () => true, require: req("side") },
          b: { after: ["a"], when: () => true, require: req("b") },
        },
      });
    } catch (error) {
      message = String((error as Error).message);
    }
    expect(message).toContain("a");
    expect(message).toMatch(/\bb\b/);
    expect(message).not.toContain("bystander");
    expect(message).not.toContain("side");
  });

  it("rejects a constraint that names itself in `after`", () => {
    let message = "";
    try {
      build({
        constraints: {
          selfish: { after: ["selfish"], when: () => true, require: req("s") },
        },
      });
    } catch (error) {
      message = String((error as Error).message);
    }
    expect(message).toContain("selfish");
  });
});

describe("re-evaluation after writes", () => {
  it("asks a constraint again only when a fact its when read changes", async () => {
    let calls = 0;
    let peer = 0;
    const { system } = build({
      constraints: {
        c: {
          when: (facts: any) => {
            calls++;

            return facts.n > 5;
          },
          require: req("c"),
        },
        peer: {
          when: (facts: any) => {
            peer++;

            return facts.n > 5;
          },
          require: req("peer"),
        },
      },
    });
    system.start();
    await system.settle();
    expect([calls, peer]).toEqual([1, 1]);
    system.facts.m = 1;
    await system.settle();
    expect([calls, peer]).toEqual([1, 1]);
    system.facts.n = 1;
    await system.settle();
    expect([calls, peer]).toEqual([2, 2]);
    system.destroy();
  });

  it("follows the branch its when took: the fact it stopped reading no longer wakes it", async () => {
    let calls = 0;
    const { system, starts } = build({
      facts: { mode: t.string(), a: t.number(), b: t.number() },
      init: (facts: any) => {
        facts.mode = "a";
        facts.a = 0;
        facts.b = 0;
      },
      constraints: {
        c: {
          when: (facts: any) => {
            calls++;

            return facts.mode === "a" ? facts.a > 5 : facts.b > 5;
          },
          require: req("c"),
        },
      },
    });
    system.start();
    await system.settle();
    system.facts.b = 1;
    await system.settle();
    expect(calls).toBe(1);
    system.facts.a = 1;
    await system.settle();
    expect(calls).toBe(2);
    system.facts.mode = "b";
    await system.settle();
    expect(calls).toBe(3);
    system.facts.a = 2;
    await system.settle();
    expect(calls).toBe(3);
    system.facts.b = 9;
    await system.settle();
    expect(calls).toBe(4);
    expect(starts()).toEqual(["c"]);
    system.destroy();
  });

  it("stops being woken by a fact it no longer reads when it reads fewer facts", async () => {
    let calls = 0;
    const { system } = build({
      constraints: {
        c: {
          when: (facts: any) => {
            calls++;
            if (facts.flag) {
              return facts.n > 5;
            }
            const n = facts.n;
            const m = facts.m;

            return n > 5 && m > 5;
          },
          require: req("c"),
        },
      },
    });
    system.start();
    await system.settle();
    system.facts.flag = true;
    await system.settle();
    expect(calls).toBe(2);
    system.facts.m = 1;
    await system.settle();
    expect(calls).toBe(2);
    system.facts.n = 1;
    await system.settle();
    expect(calls).toBe(3);
    system.destroy();
  });

  it("keeps waking the other constraints on a fact one of them stopped reading", async () => {
    const calls = { one: 0, two: 0 };
    const { system } = build({
      facts: { mode: t.string() },
      init: (facts: any) => {
        facts.mode = "n";
      },
      constraints: {
        one: {
          when: (facts: any) => {
            calls.one++;

            return facts.mode === "n" ? facts.n > 5 : facts.m > 5;
          },
          require: req("one"),
        },
        two: {
          when: (facts: any) => {
            calls.two++;

            return facts.n > 5;
          },
          require: req("two"),
        },
      },
    });
    system.start();
    await system.settle();
    system.facts.mode = "m";
    await system.settle();
    expect(calls).toEqual({ one: 2, two: 1 });
    system.facts.n = 1;
    await system.settle();
    expect(calls).toEqual({ one: 2, two: 2 });
    system.destroy();
  });

  it("with explicit deps, is woken by those and not by other facts its when read", async () => {
    let calls = 0;
    const { system } = build({
      constraints: {
        c: {
          deps: ["n"],
          when: (facts: any) => {
            calls++;

            return facts.n > 5 && facts.m > 5;
          },
          require: req("c"),
        },
      },
    });
    system.start();
    await system.settle();
    system.facts.m = 9;
    await system.settle();
    expect(calls).toBe(1);
    system.facts.n = 9;
    await system.settle();
    expect(calls).toBe(2);
    system.destroy();
  });

  it("keeps the requirement of a constraint a write did not touch, without aborting its resolver", async () => {
    const { system, log, open } = build({
      hold: ["held"],
      constraints: {
        held: { when: (facts: any) => facts.n === 0, require: req("held") },
        other: { when: (facts: any) => facts.m > 0, require: req("other") },
      },
    });
    system.start();
    await flush();
    system.facts.m = 1;
    await flush();
    expect(log).toEqual(["start:held", "start:other", "end:other"]);
    open("held");
    await system.settle();
    expect(log).toEqual(["start:held", "start:other", "end:other", "end:held"]);
    system.destroy();
  });
});

describe("errors inside when and require", () => {
  it("reports a when that throws in development, naming the constraint, and emits nothing", async () => {
    const out = consoleSpy();
    const { system, starts } = build({
      constraints: {
        thrower: {
          when: () => {
            throw new Error("when-broke");
          },
          require: req("thrower"),
        },
        fine: { when: () => true, require: req("fine") },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual(["fine"]);
    const reports = out
      .warnings()
      .concat(out.errors())
      .filter((w) => w.includes("thrower") && w.includes("when-broke"));
    expect(reports.length).toBeGreaterThan(0);
    system.destroy();
  });

  it("reports a require that throws in development, with the original error, and emits nothing", async () => {
    const out = consoleSpy();
    const { system, starts } = build({
      constraints: {
        bad: {
          when: () => true,
          require: () => {
            throw new Error("require-broke");
          },
        },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual([]);
    const reports = out
      .warnings()
      .concat(out.errors())
      .filter((w) => w.includes("bad") && w.includes("require-broke"));
    expect(reports.length).toBeGreaterThan(0);
    system.destroy();
  });

  it("wakes a require that threw on the write that fixes what it read", async () => {
    consoleSpy();
    const { system, starts } = build({
      facts: { item: t.object<{ name?: string }>() },
      init: (facts: any) => {
        facts.item = {};
      },
      constraints: {
        c: {
          when: (facts: any) => facts.flag === false,
          require: (facts: any) => req(facts.item.name.toUpperCase()),
        },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual([]);
    system.facts.item = { name: "fixed" };
    await system.settle();
    expect(starts()).toEqual(["FIXED"]);
    system.destroy();
  });

  it("keeps an untouched constraint whose require threw out of later passes", async () => {
    const out = consoleSpy();
    const { system, starts } = build({
      constraints: {
        bad: {
          when: (facts: any) => facts.n >= 0,
          require: () => {
            throw new Error("nope");
          },
        },
        other: { when: (facts: any) => facts.m > 0, require: req("other") },
      },
    });
    system.start();
    await system.settle();
    system.facts.m = 1;
    await system.settle();
    expect(starts()).toEqual(["other"]);
    expect(
      out.errors().filter((e) => !e.includes("nope") && !e.includes("bad")),
    ).toEqual([]);
    system.destroy();
  });
});

describe("async constraints", () => {
  it("emits the requirement of an async when that resolves true, and none for one that resolves false", async () => {
    consoleSpy();
    const { system, starts } = build({
      constraints: {
        yes: {
          async: true,
          deps: ["n"],
          when: async () => true,
          require: req("yes"),
        },
        no: {
          async: true,
          deps: ["n"],
          when: async () => false,
          require: req("no"),
        },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual(["yes"]);
    system.destroy();
  });

  it("asks an async constraint with deps again on a write to one of them, not on other writes", async () => {
    const out = consoleSpy();
    let calls = 0;
    const { system } = build({
      constraints: {
        c: {
          async: true,
          deps: ["n"],
          when: async (facts: any) => {
            calls++;

            return facts.n > 5;
          },
          require: req("c"),
        },
      },
    });
    system.start();
    await system.settle();
    system.facts.m = 1;
    await system.settle();
    expect(calls).toBe(1);
    system.facts.n = 1;
    await system.settle();
    expect(calls).toBe(2);
    expect(out.naming("c")).toHaveLength(0);
    system.destroy();
  });

  it("treats `async: false` like no flag: asks it again only when what its when read changes", async () => {
    let calls = 0;
    const { system } = build({
      constraints: {
        c: {
          async: false,
          when: (facts: any) => {
            calls++;

            return facts.n > 5;
          },
          require: req("c"),
        },
      },
    });
    system.start();
    await system.settle();
    system.facts.m = 1;
    await system.settle();
    expect(calls).toBe(1);
    system.facts.n = 1;
    await system.settle();
    expect(calls).toBe(2);
    system.destroy();
  });

  it("asks an async constraint without deps on every pass, with a development warning naming it", async () => {
    const out = consoleSpy();
    let calls = 0;
    const { system } = build({
      constraints: {
        loose: {
          async: true,
          when: async () => {
            calls++;

            return false;
          },
          require: req("loose"),
        },
        sync: { when: () => false, require: req("sync") },
      },
    });
    expect(out.naming("loose")).toHaveLength(1);
    expect(out.naming("sync")).toHaveLength(0);
    system.start();
    await system.settle();
    expect(calls).toBe(1);
    system.facts.m = 1;
    await system.settle();
    expect(calls).toBe(2);
    expect(out.errors()).toEqual([]);
    system.destroy();
  });

  it("treats a when that returns a promise as async: warns, honours the answer, asks it every pass", async () => {
    const out = consoleSpy();
    const calls = { yes: 0, no: 0 };
    const { system, starts } = build({
      constraints: {
        yes: {
          when: () => {
            calls.yes++;

            return Promise.resolve(true);
          },
          require: req("yes"),
        },
        no: {
          when: () => {
            calls.no++;

            return Promise.resolve(false);
          },
          require: req("no"),
        },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual(["yes"]);
    expect(out.naming("yes").length).toBeGreaterThan(0);
    expect(out.naming("no").length).toBeGreaterThan(0);
    const before = { ...calls };
    system.facts.m = 1;
    await system.settle();
    expect(calls).toEqual({ yes: before.yes + 1, no: before.no + 1 });
    expect(starts()).toEqual(["yes"]);
    system.destroy();
  });

  it("emits nothing for a when that returns a promise that rejects, and reports it", async () => {
    const out = consoleSpy();
    const { system, starts } = build({
      constraints: {
        rejects: {
          when: () => Promise.reject(new Error("promise-broke")),
          require: req("rejects"),
        },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual([]);
    const reports = out
      .warnings()
      .concat(out.errors())
      .filter((w) => w.includes("rejects") && w.includes("promise-broke"));
    expect(reports.length).toBeGreaterThan(0);
    system.destroy();
  });

  it("emits nothing for an async when that rejects, reports it, and fires once it resolves true", async () => {
    const out = consoleSpy();
    let fail = true;
    const { system, starts } = build({
      constraints: {
        flaky: {
          async: true,
          deps: ["n"],
          when: async () => {
            if (fail) {
              throw new Error("async-broke");
            }

            return true;
          },
          require: req("flaky"),
        },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual([]);
    const reports = out
      .warnings()
      .concat(out.errors())
      .filter((w) => w.includes("flaky") && w.includes("async-broke"));
    expect(reports.length).toBeGreaterThan(0);
    fail = false;
    system.facts.n = 1;
    await system.settle();
    expect(starts()).toEqual(["flaky"]);
    system.destroy();
  });

  it("times an async when out after its own timeout and emits nothing", async () => {
    vi.useFakeTimers();
    const out = consoleSpy();
    const { system, starts } = build({
      constraints: {
        slow: {
          async: true,
          deps: ["n"],
          timeout: 50,
          when: () => new Promise<boolean>(() => undefined),
          require: req("slow"),
        },
      },
    });
    system.start();
    await vi.advanceTimersByTimeAsync(49);
    const named = () =>
      out
        .warnings()
        .concat(out.errors())
        .filter((w) => w.includes("slow")).length;
    expect(named()).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(named()).toBeGreaterThan(0);
    expect(starts()).toEqual([]);
    system.destroy();
  });

  it("times an async when out after 5000 ms by default", async () => {
    vi.useFakeTimers();
    const out = consoleSpy();
    const { system } = build({
      constraints: {
        slow: {
          async: true,
          deps: ["n"],
          when: () => new Promise<boolean>(() => undefined),
          require: req("slow"),
        },
      },
    });
    system.start();
    const named = () =>
      out
        .warnings()
        .concat(out.errors())
        .filter((w) => w.includes("slow")).length;
    await vi.advanceTimersByTimeAsync(4990);
    expect(named()).toBe(0);
    await vi.advanceTimersByTimeAsync(20);
    expect(named()).toBeGreaterThan(0);
    system.destroy();
  });

  it("fires an async when that answers true before its timeout", async () => {
    vi.useFakeTimers();
    const { system, starts } = build({
      constraints: {
        slowYes: {
          async: true,
          deps: ["n"],
          timeout: 100,
          when: () =>
            new Promise<boolean>((resolve) =>
              setTimeout(() => resolve(true), 60),
            ),
          require: req("slowYes"),
        },
      },
    });
    system.start();
    await vi.advanceTimersByTimeAsync(70);
    expect(starts()).toEqual(["slowYes"]);
    system.destroy();
  });

  it("emits the requirements of sync constraints before those of async ones in the same pass", async () => {
    const out = consoleSpy();
    const { system, starts } = build({
      constraints: {
        later: {
          async: true,
          deps: ["n"],
          priority: 10,
          when: async () => true,
          require: req("async"),
        },
        now: { when: () => true, require: req("sync") },
      },
    });
    system.start();
    await system.settle();
    expect(starts()).toEqual(["sync", "async"]);
    expect(out.naming("later")).toHaveLength(0);
    system.destroy();
  });

  it("emits nothing for an async constraint disabled while its when was pending", async () => {
    const gate = deferred<boolean>();
    const { system, starts } = build({
      constraints: {
        pending: {
          async: true,
          deps: ["n"],
          when: () => gate.promise,
          require: req("pending"),
        },
      },
    });
    system.start();
    await flush();
    system.constraints.disable("pending");
    gate.resolve(true);
    await system.settle();
    expect(starts()).toEqual([]);
    system.destroy();
  });

  it("does not ask a disabled async constraint without deps on later passes", async () => {
    consoleSpy();
    let calls = 0;
    const { system } = build({
      constraints: {
        loose: {
          async: true,
          when: async () => {
            calls++;

            return false;
          },
          require: req("loose"),
        },
        tracked: { when: (facts: any) => facts.m > 5, require: req("t") },
      },
    });
    system.start();
    await system.settle();
    expect(calls).toBe(1);
    system.constraints.disable("loose");
    system.facts.m = 1;
    await system.settle();
    system.facts.n = 1;
    await system.settle();
    expect(calls).toBe(1);
    system.destroy();
  });
});

describe("disable and enable", () => {
  it("does not ask a disabled constraint when the system starts, and asks the rest", async () => {
    let calls = 0;
    const { system, starts } = build({
      constraints: {
        off: {
          when: () => {
            calls++;

            return true;
          },
          require: req("off"),
        },
        on: { when: () => true, require: req("on") },
      },
    });
    system.constraints.disable("off");
    system.start();
    await system.settle();
    expect(calls).toBe(0);
    expect(starts()).toEqual(["on"]);
    system.destroy();
  });

  it("asks a re-enabled constraint on the next pass, even if nothing it read changed, and only then", async () => {
    let calls = 0;
    const { system, starts } = build({
      constraints: {
        c: {
          when: (facts: any) => {
            calls++;

            return facts.n === 0;
          },
          require: req("c"),
        },
      },
    });
    system.constraints.disable("c");
    system.start();
    await system.settle();
    expect(starts()).toEqual([]);
    system.constraints.enable("c");
    system.facts.m = 1;
    await system.settle();
    expect(starts()).toEqual(["c"]);
    expect(calls).toBe(1);
    system.facts.m = 2;
    await system.settle();
    expect(calls).toBe(1);
    system.destroy();
  });

  it("reports a name that is no constraint as not disabled, and keeps working after enable() of one", async () => {
    consoleSpy();
    const { system, starts } = build({
      constraints: {
        c: { when: (facts: any) => facts.n > 0, require: req("c") },
      },
    });
    system.constraints.disable("nope");
    expect(system.constraints.isDisabled("nope")).toBe(false);
    system.constraints.enable("ghost");
    system.start();
    await system.settle();
    system.constraints.enable("phantom");
    system.facts.n = 1;
    await system.settle();
    expect(starts()).toEqual(["c"]);
    expect(system.constraints.isDisabled("c")).toBe(false);
    system.destroy();
  });
});

describe("a derivation read only through a membership test", () => {
  const ask = (name: string) => (_facts: any, derived: any) =>
    name in derived ? 1 : 0;

  /**
   * One module: facts a and b, the given derivations, and a constraint whose
   * `when` reads only `read(derived)` and never fires. Returns what each
   * `when` call saw, grouped by the step that caused it: the first start, then
   * a = 1, a = 2, a = 3, b = 1, a = 4.
   */
  async function evaluations(
    derive: Record<string, (facts: any, derived: any) => unknown>,
    read: (derived: any) => unknown,
  ) {
    const seen: unknown[] = [];
    const mod = createModule("members", {
      schema: {
        facts: { a: t.number(), b: t.number() },
        derivations: Object.fromEntries(
          Object.keys(derive).map((name) => [name, t.any()]),
        ),
        events: {},
        requirements: { R: {} },
      },
      init: (facts: any) => {
        facts.a = 0;
        facts.b = 0;
      },
      derive,
      constraints: {
        c: {
          when: (_facts: any, derived: any) => {
            seen.push(read(derived));

            return false;
          },
          require: { type: "R" },
        },
      },
    } as never);
    const system = createSystem({ module: mod } as never) as any;
    const steps: unknown[][] = [];
    const take = () => steps.push(seen.splice(0));
    system.start();
    await system.settle();
    take();
    for (const [fact, value] of [
      ["a", 1],
      ["a", 2],
      ["a", 3],
      ["b", 1],
      ["a", 4],
    ] as const) {
      system.facts[fact] = value;
      await system.settle();
      take();
    }
    system.destroy();

    return steps;
  }

  it("is asked again on every change of the derivation, not only the first", async () => {
    expect(
      await evaluations(
        { d: (facts: any) => facts.a + 1 },
        (derived) => "d" in derived,
      ),
    ).toEqual([[true], [true], [true], [true], [], [true]]);
  });

  it("wakes a derivation that only asks, and the constraint that reads it, on every change", async () => {
    expect(
      await evaluations(
        { d: (facts: any) => facts.a + 1, asks: ask("d") },
        (derived) => derived.asks,
      ),
    ).toEqual([[1], [1], [1], [1], [], [1]]);
  });

  it("wakes the constraint through two askers of one derivation on every change", async () => {
    expect(
      await evaluations(
        {
          d: (facts: any) => facts.a + 1,
          asks1: ask("d"),
          asks2: (_facts: any, derived: any) => ("d" in derived ? 2 : 0),
          top: (_facts: any, derived: any) => derived.asks1 + derived.asks2,
        },
        (derived) => derived.top,
      ),
    ).toEqual([[3], [3], [3], [3], [], [3]]);
  });

  it("wakes the constraint when the asker is read by value further down", async () => {
    expect(
      await evaluations(
        {
          d: (facts: any) => facts.a + 1,
          asks: ask("d"),
          down: (_facts: any, derived: any) => derived.asks * 10,
        },
        (derived) => derived.down,
      ),
    ).toEqual([[10], [10], [10], [10], [], [10]]);
  });
});
