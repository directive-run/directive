/**
 * P3-F6: two development warnings 2.0 printed where 1.35 does not (the
 * differential fuzz, seeds 3 and 9 with the console-warn wildcard narrowed).
 *
 * - The non-JSON fact warning is once per fact path and type for the whole
 *   process in 1.35 (tracking.ts `nonJsonWarningCache`, a module-level Set),
 *   so a second system from the same definitions stays quiet.
 * - A source gate in a module with crossModuleDeps reads its facts through
 *   1.35's gate view (system-proxies.ts `buildSourceGateFactsProxy`): an
 *   undeclared read warns with the gate's own text, once per system, not the
 *   constraint proxy's "accessed undeclared cross-module property" on every
 *   evaluation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as lib from "../index.js";

const { createModule, createSystem, t } = lib as any;

afterEach(() => {
  vi.restoreAllMocks();
});

const warnings = () => {
  const out: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((m: unknown) => {
    out.push(String(m));
  });

  return out;
};

describe("development warnings match 1.35's once-per rules", () => {
  it("the non-JSON fact warning is once per process: a second system stays quiet", async () => {
    const warns = warnings();
    const mod = createModule("p3f6twin", {
      schema: { facts: { when: t.date() }, derivations: {}, events: {} },
      init: (f: any) => {
        f.when = new Date(0);
      },
    });
    for (const _ of [1, 2]) {
      const sys: any = createSystem({ modules: { p3f6twin: mod } });
      sys.start();
      await sys.settle();
      sys.destroy();
    }
    expect(warns.filter((w) => w.includes("assigned a Date"))).toEqual([
      expect.stringMatching(
        /^\[Directive\] Fact "p3f6twin\.when" assigned a Date instance\./,
      ),
    ]);
  });

  it("an undeclared read in a source gate warns 1.35's gate text, once per system", async () => {
    const warns = warnings();
    const a = createModule("a", {
      schema: { facts: { f0: t.number() }, derivations: {}, events: {} },
      init: (f: any) => {
        f.f0 = 0;
      },
    });
    const b = createModule("b", {
      schema: {
        facts: { f0: t.number() },
        derivations: {},
        events: { bump: {} },
      },
      crossModuleDeps: { a: a.schema },
      init: (f: any) => {
        f.f0 = 0;
      },
      events: {
        bump: (f: any) => {
          f.f0 += 1;
        },
      },
      sources: {
        feed: {
          // A bare name under crossModuleDeps: undefined, and a mistake.
          active: (f: any) => f.f0 >= 1,
          attach: () => () => undefined,
        },
      },
    });
    const sys: any = createSystem({ modules: { a, b } });
    sys.start();
    await sys.settle();
    sys.events.b.bump();
    await sys.settle();
    sys.events.b.bump();
    await sys.settle();
    expect(warns.filter((w) => w.includes("undeclared"))).toEqual([
      '[Directive] Module "b" read undeclared property "f0" in a source gate. This module declares crossModuleDeps, so gate facts are namespaced: use "facts.self.f0" for its own fact, or add the module to crossModuleDeps.',
    ]);
    sys.destroy();
    // Once per system: a second system hears about it again (1.35's
    // warnOncePerSystem is keyed by the system's fact store).
    const again: any = createSystem({ modules: { a, b } });
    again.start();
    await again.settle();
    expect(warns.filter((w) => w.includes("in a source gate"))).toHaveLength(2);
    again.destroy();
  });
});
