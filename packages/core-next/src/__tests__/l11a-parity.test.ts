/**
 * L11a parity: a derivation that throws at initialize's eager compute.
 * 1.35 computes every derivation there, unguarded (engine.ts:3292–3297), so
 * the throw is reported through onError and then leaves `start()`, before
 * the system runs and before `onStart`. The L11 data-form fuzz reached it
 * with a `$template` compute whose string length a later derivation throws
 * on; the template is only the way in, so both forms are pinned.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

type Any = any;

afterEach(() => {
  vi.restoreAllMocks();
});

function build(form: "fn" | "template") {
  const seen: string[] = [];
  const module = createModule("a", {
    schema: {
      facts: { f0: t.number() },
      derivations: { d1: t.string(), d2: t.number(), d3: t.number() },
      events: {},
    },
    init: (facts: Any) => {
      facts.f0 = 0;
    },
    derive: {
      d1:
        form === "fn"
          ? (facts: Any) => `${facts.f0}`
          : { compute: { $template: "${f0}" } },
      d2: (_facts: Any, derived: Any) => {
        if (derived.d1.length === 1) {
          throw new Error("d2 throws");
        }

        return 0;
      },
      d3: (facts: Any) => {
        seen.push("d3");

        return facts.f0;
      },
    },
  } as Any);
  const system = createSystem({
    module,
    plugins: [
      {
        name: "p",
        onStart: () => seen.push("onStart"),
        onError: (error: Any) => seen.push(`onError ${error.message}`),
      },
    ],
  } as Any);

  return { system, seen };
}

describe("L11a parity: a throw at initialize's eager compute", () => {
  for (const form of ["fn", "template"] as const) {
    it(`leaves start(), after onError and before onStart (${form})`, () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { system, seen } = build(form);
      expect(() => system.start()).toThrow("d2 throws");
      // Reported first; the derivations after it are not computed; no start.
      expect(seen).toEqual(["onError d2 throws"]);
      expect(system.isRunning).toBe(false);
      system.destroy();
    });
  }
});
