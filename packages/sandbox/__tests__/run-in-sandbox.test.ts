// End-to-end coverage of the public `runInSandbox` surface. These
// tests boot a real worker_threads worker per call (no mocks) so
// they exercise the full validator → bundler → worker stack the
// way the MCP tool does.

import { describe, expect, it } from "vitest";
import { runInSandbox } from "../src/index.js";

const COUNTER_MODULE = [
  'import { createModule, t } from "@directive-run/core";',
  "",
  'export const counter = createModule("counter", {',
  "  schema: {",
  "    facts: { count: t.number() },",
  "    events: { bump: {} },",
  "  },",
  "  init: (facts) => { facts.count = 0; },",
  "  events: {",
  "    bump: (facts) => { facts.count += 1; },",
  "  },",
  "});",
  "",
].join("\n");

const COUNTER_RUNNER = [
  'import { createSystem } from "@directive-run/core";',
  'import { counter } from "./counter.js";',
  "",
  "const system = createSystem({ module: counter });",
  "system.start();",
  'console.log("[start] count=", system.facts.count);',
  "system.events.bump({});",
  "system.events.bump({});",
  "await system.settle();",
  'console.log("[settled] count=", system.facts.count);',
  "system.destroy();",
  "",
].join("\n");

describe("runInSandbox", () => {
  it("executes a paired module + runner and returns the facts snapshot", async () => {
    const result = await runInSandbox({
      files: [
        { path: "src/counter.ts", source: COUNTER_MODULE },
        { path: "src/main.ts", source: COUNTER_RUNNER },
      ],
    });
    expect(result.errors).toEqual([]);
    expect(result.timedOut).toBe(false);
    expect(result.facts.count).toBe(2);
    expect(result.logs.some((l) => l.includes("[start]"))).toBe(true);
    expect(result.logs.some((l) => l.includes("[settled]"))).toBe(true);
  });

  it("captures system.facts even when the runner throws mid-execution", async () => {
    const throwingRunner = COUNTER_RUNNER.replace(
      "system.events.bump({});\nsystem.events.bump({});",
      'throw new Error("mid-runner-boom");',
    );
    const result = await runInSandbox({
      files: [
        { path: "src/counter.ts", source: COUNTER_MODULE },
        { path: "src/main.ts", source: throwingRunner },
      ],
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/mid-runner-boom/);
    // The bundler injects an early-capture immediately after
    // createSystem(...) so the post-mortem snapshot reflects the
    // init state.
    expect(result.facts.count).toBe(0);
  });

  it("rejects oversize input (input-invalid)", async () => {
    const huge = "x".repeat(200_001);
    const result = await runInSandbox({
      files: [{ path: "src/main.ts", source: huge }],
    });
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects validator failures structurally", async () => {
    const result = await runInSandbox({
      files: [
        {
          path: "src/main.ts",
          source:
            'import { readFileSync } from "node:fs";\nreadFileSync("/etc/passwd");\n',
        },
      ],
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/node:fs/);
    expect(result.facts).toEqual({});
  });

  it("rejects timeout cleanly", async () => {
    const result = await runInSandbox({
      files: [
        {
          path: "src/main.ts",
          source: "while (true) {}",
        },
      ],
      timeoutMs: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.errors[0]).toMatch(/budget of 200ms/);
  }, 10_000);

  it("supports the single-source convenience shape", async () => {
    const result = await runInSandbox({
      source: [
        'import { createModule, createSystem, t } from "@directive-run/core";',
        "",
        'const mod = createModule("tiny", {',
        "  schema: { facts: { ok: t.boolean() } },",
        "  init: (f) => { f.ok = true; },",
        "});",
        "const system = createSystem({ module: mod });",
        "system.start();",
        "await system.settle();",
        "console.log(system.facts.ok);",
        "system.destroy();",
      ].join("\n"),
    });
    expect(result.errors).toEqual([]);
    expect(result.facts.ok).toBe(true);
  });
});
