/**
 * Four 1.35 behaviours the hardened oracle (PR #212) found missing on v2:
 * the validation preview, an unstringifiable value, an effect that reads
 * only a derivation, and a derive entry that is not a definition.
 */
import { describe, expect, it } from "vitest";
import { t } from "../api/schema-builders.js";
import { createModule, createSystem } from "../api/system.js";

const settle = () => new Promise((r) => setTimeout(r, 0));

function start() {
  const mod = createModule("v", {
    schema: { facts: { n: t.number() } },
    init: (facts: any) => {
      facts.n = 0;
    },
  });
  const system = createSystem({ module: mod }) as any;
  system.start();

  return system;
}

const caught = (fn: () => void): string => {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("did not throw");
};

describe("validation preview (1.35 facts.ts safeStringify)", () => {
  it("previews the value as compact JSON, cut at 100 chars", () => {
    const system = start();
    expect(caught(() => (system.facts.n = { a: 1 }))).toContain('{"a":1}');
    const long = caught(() => (system.facts.n = "y".repeat(500)));
    expect(long).toContain("y".repeat(99));
    expect(long).not.toContain("y".repeat(100));
    expect(caught(() => (system.facts.n = undefined))).toMatch(
      /got undefined undefined/,
    );
    system.stop();
  });

  it("reports a circular or bigint value without throwing a TypeError", () => {
    const system = start();
    const circular: any = {};
    circular.self = circular;
    for (const bad of [circular, 10n]) {
      const message = caught(() => (system.facts.n = bad));
      expect(message).toMatch(/Validation failed for "n"/);
      expect(message).toContain("[circular or non-serializable]");
    }
    system.stop();
  });
});

describe("derivation-only effect dependencies", () => {
  it("re-runs an effect that reads only a derivation via system.derive", async () => {
    const seen: boolean[] = [];
    const box: { system?: any } = {};
    const mod = createModule("w", {
      schema: {
        facts: { count: t.number() },
        derivations: { ready: t.boolean() },
      },
      init: (facts: any) => {
        facts.count = 0;
      },
      derive: { ready: (facts: any) => facts.count >= 2 },
      effects: {
        watch: { run: () => void seen.push(box.system.derive.ready) },
      },
    });
    const system = createSystem({ module: mod }) as any;
    box.system = system;
    system.start();
    await settle();
    expect(seen).toEqual([false]);
    system.facts.count = 2;
    await settle();
    expect(seen).toEqual([false, true]);
    system.stop();
  });
});

describe("derive entries that are not definitions", () => {
  it("tolerates null, a number and a string at registration", () => {
    for (const odd of [null, 7, "text"]) {
      const mod = createModule("odd", {
        schema: { facts: { n: t.number() }, derivations: { d: t.number() } },
        init: (facts: any) => {
          facts.n = 1;
        },
        derive: { d: odd } as any,
      });
      expect(() => createSystem({ module: mod })).not.toThrow();
    }
  });
});
