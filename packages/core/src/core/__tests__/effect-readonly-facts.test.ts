import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

/**
 * Effects read facts; they never write them.
 *
 * A write from an effect used to be accepted and then half handled: constraints
 * and derivations saw it, other effects did not. The facts an effect receives
 * are now a read-only view, so every path a write could take from inside an
 * effect — the body, after an `await`, the cleanup, a namespaced module proxy,
 * `facts.$store` — is refused with a message that names the alternative.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function captureEffectErrors() {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args[1] ?? args[0]);
  });

  return { errors, spy };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("an effect writing a fact", () => {
  it("throws in development with a message that names the alternatives", async () => {
    const { errors } = captureEffectErrors();
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), pos: t.number() } },
      init: (facts) => {
        facts.n = 0;
        facts.pos = 0;
      },
      effects: {
        physics: {
          deps: ["n"],
          run: (facts) => {
            (facts as { pos: number }).pos = facts.n * 10;
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    system.facts.n = 1;
    await system.settle();

    expect(system.facts.pos).toBe(0);
    const message = String((errors.at(-1) as Error)?.message);
    expect(message).toContain('tried to write "pos"');
    expect(message).toContain("event handler");
    expect(message).toContain("derivation");
    expect(message).toContain("resolver");
    expect(message).toContain("source");

    await system.stop();
  });

  it("is refused after an await in an async effect", async () => {
    const { errors } = captureEffectErrors();
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), loaded: t.boolean() } },
      init: (facts) => {
        facts.n = 0;
        facts.loaded = false;
      },
      effects: {
        load: {
          deps: ["n"],
          run: async (facts) => {
            await Promise.resolve();
            (facts as { loaded: boolean }).loaded = true;
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    system.facts.n = 1;
    await system.settle();
    await flush();

    expect(system.facts.loaded).toBe(false);
    expect(String((errors.at(-1) as Error)?.message)).toContain(
      'tried to write "loaded"',
    );

    await system.stop();
  });

  it("is refused through facts.$store", async () => {
    const { errors } = captureEffectErrors();
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), pos: t.number() } },
      init: (facts) => {
        facts.n = 0;
        facts.pos = 0;
      },
      effects: {
        sneak: {
          deps: ["n"],
          run: (facts) => {
            facts.$store.set("pos", 5);
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    system.facts.n = 1;
    await system.settle();

    expect(system.facts.pos).toBe(0);
    expect(errors.length).toBeGreaterThan(0);

    await system.stop();
  });

  it("is refused in a cleanup function", async () => {
    let cleanupError: unknown = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), closed: t.boolean() } },
      init: (facts) => {
        facts.n = 0;
        facts.closed = false;
      },
      effects: {
        socket: {
          deps: ["n"],
          run: (facts) => () => {
            try {
              (facts as { closed: boolean }).closed = true;
            } catch (error) {
              cleanupError = error;
            }
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    system.facts.n = 1;
    await system.settle();
    system.facts.n = 2;
    await system.settle();

    expect(system.facts.closed).toBe(false);
    expect(String((cleanupError as Error)?.message)).toContain(
      'tried to write "closed"',
    );

    await system.stop();
  });

  it("is refused in a namespaced module", async () => {
    const { errors } = captureEffectErrors();
    const loop = createModule("loop", {
      schema: { facts: { ticks: t.number(), pos: t.number() } },
      init: (facts) => {
        facts.ticks = 0;
        facts.pos = 0;
      },
      effects: {
        physics: {
          deps: ["ticks"],
          run: (facts) => {
            (facts as { pos: number }).pos = facts.ticks;
          },
        },
      },
    });
    const notes = createModule("notes", {
      schema: { facts: { text: t.string() } },
      init: (facts) => {
        facts.text = "";
      },
    });
    const system = createSystem({ modules: { loop, notes } });
    await system.start();
    system.facts.loop.ticks = 3;
    await system.settle();

    expect(system.facts.loop.pos).toBe(0);
    expect(String((errors.at(-1) as Error)?.message)).toContain(
      'tried to write "loop::pos"',
    );

    await system.stop();
  });

  it("still lets the effect read facts and track them", async () => {
    const seen: number[] = [];
    const shapes: { keys: string[]; spread: unknown; direct: unknown }[] = [];
    const mod = createModule("m", {
      schema: { facts: { n: t.number() } },
      init: (facts) => {
        facts.n = 0;
      },
      effects: {
        view: {
          run: (facts) => {
            seen.push(facts.n);
            shapes.push({
              keys: Object.keys(facts),
              spread: { ...facts }.n,
              direct: facts.n,
            });
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    await system.settle();
    system.facts.n = 4;
    await system.settle();

    expect(seen.at(-1)).toBe(4);
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(shape.keys).toContain("n");
      expect(shape.spread).toBe(shape.direct);
    }

    await system.stop();
  });

  it("does not stop an effect from dispatching an event", async () => {
    // Not encouraged, but it is the program's own write, not a write through
    // the effect's facts, so it is outside this rule.
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number(), echoed: t.number() },
        events: { echo: { value: t.number() } },
      },
      init: (facts) => {
        facts.n = 0;
        facts.echoed = 0;
      },
      events: {
        echo: (facts, { value }) => {
          facts.echoed = value;
        },
      },
      effects: {
        relay: {
          deps: ["n"],
          run: (facts) => {
            if (facts.n > 0) {
              system.events.echo({ value: facts.n });
            }
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    await system.settle();
    await flush();
    system.facts.n = 2;
    await system.settle();
    await flush();

    expect(system.facts.echoed).toBe(2);

    await system.stop();
  });
});
