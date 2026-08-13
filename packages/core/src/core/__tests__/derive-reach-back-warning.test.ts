/**
 * The reach-back that composed systems silently swallow, now said out loud.
 *
 * `createSystem({ module })` puts a module's derivations directly on
 * `system.derive`. `createSystem({ modules })` puts *module names* there and the
 * derivations one level down. So `system.derive.total` returns a value alone and
 * `undefined` composed — the gate goes falsy, the constraint never fires, and
 * nothing is written anywhere.
 *
 * Constraints and effects take `derived` as a parameter now, so there is no
 * reason left to reach back. But nothing was removed: every module written
 * before that still contains the read, and upgrading surfaces none of them. A
 * fixed API does not disarm a trap — this warning does.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index";

function counterModule() {
  return createModule("counter", {
    schema: {
      facts: { n: t.number() },
      derivations: { tooHigh: t.boolean() },
    },
    init: (facts) => {
      facts.n = 0;
    },
    derive: { tooHigh: (facts) => facts.n > 2 },
  });
}

function bystanderModule() {
  return createModule("bystander", {
    schema: { facts: { idle: t.boolean() } },
    init: (facts) => {
      facts.idle = true;
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reaching for a derivation where a module name belongs", () => {
  it("names the owning module, the parameter, and the correct path", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const system = createSystem({
      modules: { counter: counterModule(), bystander: bystanderModule() },
    });
    system.start();

    // @ts-expect-error deliberately the shape that silently returns undefined
    expect(system.derive.tooHigh).toBeUndefined();

    const message = warn.mock.calls.flat().join(" ");
    expect(message).toContain("system.derive.tooHigh is undefined");
    // The module that actually owns it.
    expect(message).toContain('"counter"');
    // The route to take inside a constraint or effect...
    expect(message).toContain("derived.tooHigh");
    // ...and the route to take outside one.
    expect(message).toContain("system.derive.counter.tooHigh");
    // What this system actually has, so the reader can orient.
    expect(message).toContain("bystander");

    system.stop();
  });

  it("says it once, not once per read", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const system = createSystem({
      modules: { counter: counterModule(), bystander: bystanderModule() },
    });
    system.start();

    for (let i = 0; i < 5; i++) {
      // @ts-expect-error same read, five times
      void system.derive.tooHigh;
    }

    // A warning that fires on every render in a loop teaches the reader to
    // filter the channel, which costs more than it saves.
    const hits = warn.mock.calls
      .flat()
      .filter((c) => String(c).includes("tooHigh"));
    expect(hits.length).toBe(1);

    system.stop();
  });

  it("stays quiet for a name that is neither a module nor a derivation", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const system = createSystem({
      modules: { counter: counterModule(), bystander: bystanderModule() },
    });
    system.start();

    // @ts-expect-error nothing in this system is called this
    expect(system.derive.nothingLikeThis).toBeUndefined();

    expect(
      warn.mock.calls
        .flat()
        .filter((c) => String(c).includes("nothingLikeThis")).length,
    ).toBe(0);

    system.stop();
  });

  it("stays quiet for the keys a runtime probes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const system = createSystem({
      modules: { counter: counterModule(), bystander: bystanderModule() },
    });
    system.start();

    // React 19 dev mode walks objects reading these. They are not typos, and
    // warning about them would fire on every render.
    for (const probe of ["$$typeof", "toJSON", "then", "nodeType"]) {
      // @ts-expect-error probing the shape the way a runtime does
      void system.derive[probe];
    }

    expect(warn).not.toHaveBeenCalled();

    system.stop();
  });

  it("does not fire in a single-module system, where the read is correct", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const system = createSystem({ module: counterModule() });
    system.start();

    // This shape is not a mistake here — the derivations are on `derive`.
    expect(system.derive.tooHigh).toBe(false);
    expect(warn).not.toHaveBeenCalled();

    system.stop();
  });
});
