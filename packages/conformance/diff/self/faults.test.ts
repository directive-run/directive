/**
 * Faults inside the engine's source (diff/self/faults.ts) must fail the
 * differential suite: each faulted copy of core runs as the engine under
 * test against every hand scenario, then the fuzzer's fixed sample, until
 * one fails. A control copy with no fault must pass everything, so a catch
 * is the fault's and not the copy's.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { specArbitrary, toScenario } from "../fuzz/model.js";
import { runScenario, startCollecting, stopCollecting } from "../scenario.js";
import { SOURCE_FAULTS, type SourceFault, faultedEngine } from "./faults.js";

const scenarios = startCollecting();
const scenarioDir = join(import.meta.dirname, "../scenarios");
for (const name of readdirSync(scenarioDir).sort()) {
  if (name.endsWith(".test.ts")) {
    await import(/* @vite-ignore */ join(scenarioDir, name));
  }
}
stopCollecting();
const fuzzCases = fc
  .sample(specArbitrary(), { seed: 0x5eed, numRuns: 200 })
  .map((spec) => toScenario(spec));

async function firstCatch(
  fault: SourceFault,
): Promise<{ by: string; report: string } | null> {
  const { engine, dispose } = faultedEngine(fault);
  try {
    for (const def of [...scenarios, ...fuzzCases]) {
      const result = await runScenario(def, {
        candidates: [engine],
        divergences: [],
      });
      expect(result.nondeterministic, result.report).toEqual([]);
      if (!result.ok) {
        return { by: def.name, report: result.report };
      }
    }

    return null;
  } finally {
    dispose();
  }
}

async function expectCaught(name: string) {
  const fault = SOURCE_FAULTS.find((f) => f.name === name);
  expect(fault, `no fault named ${name}`).toBeDefined();
  const caught = await firstCatch(fault as SourceFault);
  expect(caught, `${name} (${fault?.what}) went unnoticed`).not.toBeNull();
  console.info(`[faults] ${name}: caught by "${caught?.by}"`);
}

describe("source faults", () => {
  it("collected every hand scenario", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(90);
  });

  it("control: an unfaulted copy of core passes every scenario and fuzz case", async () => {
    const { engine, dispose } = faultedEngine({
      name: "control",
      what: "no change",
      patches: [],
    });
    try {
      for (const def of [...scenarios, ...fuzzCases]) {
        const result = await runScenario(def, {
          candidates: [engine],
          divergences: [],
        });
        expect(result.ok, result.report).toBe(true);
      }
    } finally {
      dispose();
    }
  });

  it("every listed fault has a test below", () => {
    expect(SOURCE_FAULTS.map((f) => f.name).sort()).toEqual(
      [
        "f10_no_warning_dedupe",
        "f1a_silent_extra_compute",
        "f1b_compute_hook_twice",
        "f2_resolver_twice",
        "f3_notify_microtask",
        "f4_effect_order_reversed",
        "f5_glitch_stale_during_notify",
        "f5b_glitch",
        "f6a_retry_delay_plus1",
        "f6b_timeout_plus1",
        "f7_no_cleanup_on_destroy",
        "f8a_recoverable_flipped",
        "f8b_context_dropped",
        "f9a_inspect_no_hitCount",
        "f9b_inspect_no_lastDropReason",
      ].sort(),
    );
  });

  it("f1a_silent_extra_compute", () =>
    expectCaught("f1a_silent_extra_compute"));
  it("f1b_compute_hook_twice", () => expectCaught("f1b_compute_hook_twice"));
  it("f2_resolver_twice", () => expectCaught("f2_resolver_twice"));
  it("f3_notify_microtask", () => expectCaught("f3_notify_microtask"));
  it("f4_effect_order_reversed", () =>
    expectCaught("f4_effect_order_reversed"));
  it("f5_glitch_stale_during_notify", () =>
    expectCaught("f5_glitch_stale_during_notify"));
  it("f5b_glitch", () => expectCaught("f5b_glitch"));
  it("f6a_retry_delay_plus1", () => expectCaught("f6a_retry_delay_plus1"));
  it("f6b_timeout_plus1", () => expectCaught("f6b_timeout_plus1"));
  it("f7_no_cleanup_on_destroy", () =>
    expectCaught("f7_no_cleanup_on_destroy"));
  it("f8a_recoverable_flipped", () => expectCaught("f8a_recoverable_flipped"));
  it("f8b_context_dropped", () => expectCaught("f8b_context_dropped"));
  it("f9a_inspect_no_hitCount", () => expectCaught("f9a_inspect_no_hitCount"));
  it("f9b_inspect_no_lastDropReason", () =>
    expectCaught("f9b_inspect_no_lastDropReason"));
  it("f10_no_warning_dedupe", () => expectCaught("f10_no_warning_dedupe"));
});
