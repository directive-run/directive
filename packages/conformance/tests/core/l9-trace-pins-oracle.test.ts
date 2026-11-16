// Ported from packages/core/src/core/__tests__/l9-trace-pins-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Black-box pins of 1.35's trace and introspection behaviour that no other
// test states (the L9 RFC, "Untested behaviours" U1, U5 to U7, U9, U11, U12,
// U15 and U16). Each pins what 1.35 does today. Where an approved row of the
// RFC changes it ((bh) for U1 and U12), the case keeps 1.35's side and names
// the row; the signed entry that shows the difference is added with the row
// (L9b). Row (bj) was declined, so U7 is 1.35's for good. Public API only.

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** The RFC's probe module: a tagged fact, a constraint and a slow resolver. */
function account(tags: string[] = ["pii"]) {
  return createModule("account", {
    schema: {
      facts: {
        email: t.string().meta({ label: "Email", tags }),
        plan: t.string(),
        seats: t.number(),
      },
      derivations: { contact: t.string() },
      events: { upgrade: {} },
      requirements: { CHARGE: {} },
    },
    init: (facts: any) => {
      facts.email = "a@b.c";
      facts.plan = "free";
      facts.seats = 1;
    },
    derive: {
      contact: (facts: any) => `mail ${facts.email}`,
    },
    events: {
      upgrade: (facts: any) => {
        facts.plan = "pro";
      },
    },
    constraints: {
      charge: {
        when: (facts: any) => facts.plan === "pro" && facts.seats > 0,
        require: { type: "CHARGE" },
      },
    },
    resolvers: {
      charge: {
        requirement: "CHARGE",
        resolve: async (_req: unknown, context: any) => {
          await wait(5);
          context.facts.seats = 0;
        },
      },
    },
  } as never);
}

/** A started system, settled. */
async function begin(config: Record<string, unknown> = {}) {
  const system = createSystem({ module: account(), ...config } as never) as any;
  system.start();
  await system.settle();

  return system;
}

describe("system.trace hands every reader the same array and the live entries (U1; row bh)", () => {
  it("two reads are one array, and an item pushed onto one read is in the next", async () => {
    const system = await begin({ trace: true });
    const first = system.trace;
    const length = first.length;

    expect(system.trace).toBe(first);
    first.push("pushed");
    expect(system.trace).toHaveLength(length + 1);
    expect(system.trace[length]).toBe("pushed");
    first.pop();
    system.destroy();
  });

  it("an edit to an entry shows in system.trace and in inspect().trace", async () => {
    const system = await begin({ trace: true });
    system.trace[0].causalChain = "edited";

    expect(system.trace[0].causalChain).toBe("edited");
    expect(system.inspect().trace[0].causalChain).toBe("edited");
    system.destroy();
  });

  it("inspect().trace is a copy: an edit to it changes nothing", async () => {
    const system = await begin({ trace: true });
    const chain = system.trace[0].causalChain;
    system.inspect().trace[0].causalChain = "edited";

    expect(system.trace[0].causalChain).toBe(chain);
    expect(system.inspect().trace[0].causalChain).toBe(chain);
    system.destroy();
  });
});

/** A tagged fact, a derivation that reads it, and one whose body can throw. */
function throwing() {
  return createModule("account", {
    schema: {
      facts: { email: t.string().meta({ tags: ["pii"] }), seats: t.number() },
      derivations: { contact: t.string(), broken: t.string() },
      events: {},
      requirements: {},
    },
    init: (facts: any) => {
      facts.email = "a@b.c";
      facts.seats = 1;
    },
    derive: {
      contact: (facts: any) => `mail ${facts.email}`,
      // Computed once at start, when it reads `email` and returns; it
      // throws once `seats` is above 1.
      broken: (facts: any) => {
        if (facts.seats > 1) {
          throw new Error("broken");
        }

        return facts.email;
      },
    },
  } as never);
}

describe("carriesTag answers undefined where it has no answer (U5)", () => {
  it("for an unknown kind, __proto__, an unknown id and a derivation whose body throws", async () => {
    const system = createSystem({ module: throwing() } as never) as any;
    system.start();
    await system.settle();
    system.facts.seats = 2;
    await system.settle();
    const ask = (kind: string, id: string) =>
      system.meta.carriesTag(kind, id, "pii");

    expect(ask("bogus", "email")).toBeUndefined();
    expect(ask("__proto__", "email")).toBeUndefined();
    expect(ask("fact", "nope")).toBeUndefined();
    expect(ask("derivation", "nope")).toBeUndefined();
    expect(ask("derivation", "broken")).toBeUndefined();
    // The definite answers, on the same system.
    expect(ask("fact", "email")).toBe(true);
    expect(ask("fact", "seats")).toBe(false);
    expect(ask("derivation", "contact")).toBe(true);
    system.destroy();
  });
});

describe("a caller's tags array is copied when the system is built (U6)", () => {
  it("emptying it, or adding to it, afterwards changes no answer", async () => {
    const tags = ["pii"];
    const system = createSystem({ module: account(tags) } as never) as any;
    system.start();
    await system.settle();
    tags.length = 0;
    tags.push("other");

    expect(system.meta.fact("email").tags).toEqual(["pii"]);
    expect(system.meta.carriesTag("fact", "email", "pii")).toBe(true);
    expect(system.meta.carriesTag("fact", "email", "other")).toBe(false);
    system.destroy();
  });
});

describe("the 101st observer hears nothing (U7; row bj, declined)", () => {
  it("gets a function back and no event, development warns, and a freed place takes a new observer", async () => {
    const system = await begin();
    const offs = Array.from({ length: 100 }, () => system.observe(() => {}));
    const warn = vi.mocked(console.warn);
    warn.mockClear();
    const heard: string[] = [];
    const off = system.observe((event: any) => heard.push(event.type));

    expect(typeof off).toBe("function");
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("Maximum observer limit (100)"),
      ),
    ).toBe(true);
    system.facts.seats = 7;
    await system.settle();
    expect(heard).toEqual([]);

    off();
    offs[0]();
    const later: string[] = [];
    system.observe((event: any) => later.push(event.type));
    system.facts.seats = 8;
    await system.settle();
    expect(later.length).toBeGreaterThan(0);
    expect(heard).toEqual([]);
    system.destroy();
  });
});

describe("destroy() leaves the trace empty, not null (U9)", () => {
  it("system.trace reads [] after destroy()", async () => {
    const system = await begin({ trace: true });
    expect(system.trace.length).toBeGreaterThan(0);
    system.destroy();

    expect(Array.isArray(system.trace)).toBe(true);
    expect(system.trace).toEqual([]);
  });
});

describe("notify has four members, and the clobber-loop pair share the depth-4 cap (U11)", () => {
  const loop = (type: string) => ({ type, resolver: "charge" }) as never;

  it("lists clobberLoopDetected, clobberLoopResolved, guardrailBlocked and guardrailCoverage", async () => {
    const system = await begin();

    expect(Object.keys(system.notify).sort()).toEqual([
      "clobberLoopDetected",
      "clobberLoopResolved",
      "guardrailBlocked",
      "guardrailCoverage",
    ]);
    system.destroy();
  });

  it("a plugin that re-emits from its own hook is called four times, for either member", async () => {
    const ref: { system?: any } = {};
    const calls = { detected: 0, resolved: 0 };
    const reemits = {
      name: "reemits",
      onClobberLoopDetected: (event: unknown) => {
        calls.detected += 1;
        ref.system.notify.clobberLoopDetected(event);
      },
      onClobberLoopResolved: (event: unknown) => {
        calls.resolved += 1;
        ref.system.notify.clobberLoopResolved(event);
      },
    };
    const system = await begin({ plugins: [reemits] });
    ref.system = system;
    system.notify.clobberLoopDetected(loop("resolver.clobber.loop.detected"));
    system.notify.clobberLoopResolved(loop("resolver.clobber.loop.resolved"));

    expect(calls).toEqual({ detected: 4, resolved: 4 });
    system.destroy();
  });

  it("guardrailBlocked and clobberLoopDetected share one cap", async () => {
    const ref: { system?: any } = {};
    const order: string[] = [];
    const pingPong = {
      name: "ping-pong",
      onGuardrailBlocked: () => {
        order.push("blocked");
        ref.system.notify.clobberLoopDetected(
          loop("resolver.clobber.loop.detected"),
        );
      },
      onClobberLoopDetected: () => {
        order.push("detected");
        ref.system.notify.guardrailBlocked("ping-pong", "email", "redact", 1);
      },
    };
    const system = await begin({ plugins: [pingPong] });
    ref.system = system;
    system.notify.guardrailBlocked("ping-pong", "email", "redact", 1);

    expect(order).toEqual(["blocked", "detected", "blocked", "detected"]);
    system.destroy();
  });

  it("after destroy(), a clobber-loop call reaches no plugin", async () => {
    let heard = 0;
    const system = await begin({
      plugins: [
        {
          name: "listens",
          onClobberLoopDetected: () => {
            heard += 1;
          },
        },
      ],
    });
    system.destroy();
    system.notify.clobberLoopDetected(loop("resolver.clobber.loop.detected"));

    expect(heard).toBe(0);
  });
});

describe("a plugin that edits the entry onTraceComplete hands it changes the trace (U12; row bh)", () => {
  it("the edit shows in system.trace and in inspect().trace", async () => {
    const annotate = {
      name: "annotate",
      onTraceComplete: (entry: any) => {
        entry.causalChain = `annotated ${entry.id}`;
        entry.anomalies = ["annotated"];
      },
    };
    const system = await begin({ trace: true, plugins: [annotate] });
    system.facts.seats = 3;
    await system.settle();
    const last = system.trace[system.trace.length - 1];

    expect(last.causalChain).toBe(`annotated ${last.id}`);
    expect(last.anomalies).toEqual(["annotated"]);
    const inspected = system.inspect().trace;
    expect(inspected[inspected.length - 1].causalChain).toBe(
      `annotated ${last.id}`,
    );
    system.destroy();
  });
});

/** The RFC's P21 module, function form: no data-form `when` anywhere. */
function lights() {
  return createModule("traffic", {
    schema: {
      facts: { phase: t.string(), elapsed: t.number() },
      derivations: {},
      events: {},
      requirements: { GO: {} },
    },
    init: (facts: any) => {
      facts.phase = "red";
      facts.elapsed = 0;
    },
    constraints: {
      go: {
        when: (facts: any) => facts.phase === "red" && facts.elapsed >= 30,
        require: { type: "GO" },
      },
    },
    resolvers: { go: { requirement: "GO", resolve: async () => {} } },
  } as never);
}

/** The P21 steps: observe, start, write `elapsed` to 30, wait. */
async function lightsRun() {
  const system = createSystem({ module: lights() } as never) as any;
  const events: Record<string, unknown>[] = [];
  system.observe((event: any) => {
    if (event.type === "constraint.evaluate") {
      events.push(event);
    }
  });
  system.start();
  system.facts.elapsed = 30;
  await wait(20);

  return { system, events };
}

describe("a function-form when has no data-form introspection (U15)", () => {
  it("inspect() gives the constraint no whenSpec key", async () => {
    const { system } = await lightsRun();
    const constraint = system
      .inspect()
      .constraints.find((c: any) => c.id === "go");

    expect(constraint).toBeDefined();
    expect("whenSpec" in constraint).toBe(false);
    system.destroy();
  });

  it("explain() of its unmet requirement has no Predicate clauses section", async () => {
    const { system } = await lightsRun();
    const unmet = system.inspect().unmet;

    expect(unmet.length).toBeGreaterThan(0);
    const text = system.explain(unmet[0].id);
    expect(typeof text).toBe("string");
    expect(text).not.toContain("Predicate clauses:");
    system.destroy();
  });
});

describe("the observer's constraint.evaluate event has no whenExplain key (U16)", () => {
  it("absent, not undefined, on every evaluation of a function-form when", async () => {
    const { system, events } = await lightsRun();

    expect(events.length).toBeGreaterThan(0);
    // `toEqual` cannot tell an absent key from an undefined one.
    expect(events.filter((event) => "whenExplain" in event)).toEqual([]);
    system.destroy();
  });
});
