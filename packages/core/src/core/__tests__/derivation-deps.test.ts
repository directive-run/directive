/**
 * Auto-tracking captures derivation reads as well as fact reads.
 *
 * A constraint's `when()` and an effect's `run()` are both evaluated under
 * dependency tracking, and both can read a derivation through `system.derive`.
 * Incremental evaluation has to honour the resulting dependency the same way it
 * honours a fact dependency — otherwise a constraint or effect gated purely on
 * a derivation runs once, at startup, and is never brought back.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("derivation dependencies", () => {
  it("re-evaluates a constraint gated only on a derivation", async () => {
    const evaluations: boolean[] = [];
    let readReady: () => boolean = () => false;

    const mod = createModule("gate", {
      schema: {
        facts: { count: t.number(), fired: t.boolean() },
        derivations: { ready: t.boolean() },
        requirements: { GO: {} },
      },
      init: (facts) => {
        facts.count = 0;
        facts.fired = false;
      },
      derive: { ready: (facts) => facts.count >= 2 },
      constraints: {
        go: {
          when: () => {
            const value = readReady();
            evaluations.push(value);

            return value;
          },
          // A static `require` reads no facts, so the derivation is the
          // constraint's only tracked dependency.
          require: { type: "GO" },
        },
      },
      resolvers: {
        go: {
          requirement: "GO",
          key: () => "go",
          resolve: async (_req, context) => {
            context.facts.fired = true;
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    readReady = () => system.derive.ready;
    system.start();

    system.facts.count = 1;
    await settle();
    expect(system.facts.fired).toBe(false);

    system.facts.count = 2;
    await settle();

    expect(system.facts.fired).toBe(true);
    expect(evaluations.length).toBeGreaterThan(1);
    system.destroy();
  });

  it("re-runs an effect that reads a derivation and no facts", async () => {
    const seen: boolean[] = [];
    let readReady: () => boolean = () => false;

    const mod = createModule("watcher", {
      schema: {
        facts: { count: t.number() },
        derivations: { ready: t.boolean() },
      },
      init: (facts) => {
        facts.count = 0;
      },
      derive: { ready: (facts) => facts.count >= 2 },
      effects: {
        watch: {
          run: () => {
            seen.push(readReady());
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    readReady = () => system.derive.ready;
    system.start();
    await settle();

    system.facts.count = 2;
    await settle();

    expect(seen).toContain(true);
    system.destroy();
  });

  it("leaves a system whose constraints read only facts unchanged", async () => {
    const mod = createModule("plain", {
      schema: {
        facts: { count: t.number(), fired: t.boolean() },
        derivations: { doubled: t.number() },
        requirements: { GO: {} },
      },
      init: (facts) => {
        facts.count = 0;
        facts.fired = false;
      },
      derive: { doubled: (facts) => facts.count * 2 },
      constraints: {
        go: {
          when: (facts) => facts.count >= 2,
          require: { type: "GO" },
        },
      },
      resolvers: {
        go: {
          requirement: "GO",
          key: () => "go",
          resolve: async (_req, context) => {
            context.facts.fired = true;
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    system.facts.count = 3;
    await settle();

    expect(system.facts.fired).toBe(true);
    expect(system.derive.doubled).toBe(6);
    system.destroy();
  });
});
