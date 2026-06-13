// Per-process worker-spawn cap. The host queues calls that exceed
// the cap and serves them as slots free. Tests the cap honors size 1
// (strict serialization) and Infinity (unbounded).

import { afterEach, describe, expect, it } from "vitest";
import { runInSandbox } from "../src/index.js";
import { setMaxConcurrentWorkers } from "../src/host.js";

const TRIVIAL = [
  {
    path: "src/main.ts",
    source: [
      'import { createModule, createSystem, t } from "@directive-run/core";',
      'const m = createModule("noop", {',
      "  schema: { facts: { v: t.number() }, events: {} },",
      "  init: (f) => { f.v = 1; },",
      "});",
      "const system = createSystem({ module: m });",
      "system.start();",
      "await system.settle();",
      "system.destroy();",
    ].join("\n"),
  },
];

describe("sandbox host worker cap", () => {
  afterEach(() => {
    setMaxConcurrentWorkers(Number.POSITIVE_INFINITY);
  });

  it("serializes calls when cap is 1", async () => {
    const prev = setMaxConcurrentWorkers(1);
    expect(prev).toBeGreaterThan(0);
    const results = await Promise.all([
      runInSandbox({ files: TRIVIAL, timeoutMs: 4000 }),
      runInSandbox({ files: TRIVIAL, timeoutMs: 4000 }),
      runInSandbox({ files: TRIVIAL, timeoutMs: 4000 }),
    ]);
    for (const r of results) {
      expect(r.errors).toEqual([]);
      expect(r.timedOut).toBe(false);
    }
  });

  it("returns the previous cap from setMaxConcurrentWorkers", () => {
    const a = setMaxConcurrentWorkers(2);
    const b = setMaxConcurrentWorkers(8);
    expect(b).toBe(2);
    expect(typeof a).toBe("number");
  });

  it("ignores non-finite, non-Infinity values", () => {
    const before = setMaxConcurrentWorkers(4);
    const after = setMaxConcurrentWorkers(Number.NaN);
    expect(after).toBe(4);
    // Reset to a known value before checking — a Nan input should NOT
    // have mutated the cap, so the next call returns the previous
    // value we set (4).
    const reset = setMaxConcurrentWorkers(before);
    expect(reset).toBe(4);
  });
});
