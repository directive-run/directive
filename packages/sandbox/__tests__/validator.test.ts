import { describe, expect, it } from "vitest";
import { validateSandboxInput } from "../src/validator.js";

const SAFE_MODULE = [
  'import { createModule, t } from "@directive-run/core";',
  "",
  'export const counter = createModule("counter", {',
  "  schema: { facts: { count: t.number() } },",
  "  init: (facts) => { facts.count = 0; },",
  "});",
  "",
].join("\n");

const SAFE_RUNNER = [
  'import { createSystem } from "@directive-run/core";',
  'import { counter } from "./counter.js";',
  "",
  "const system = createSystem({ module: counter });",
  "system.start();",
  "console.log(system.facts);",
  "await system.settle();",
  "system.destroy();",
  "",
].join("\n");

describe("validateSandboxInput", () => {
  it("accepts the canonical paired runner shape", () => {
    const errors = validateSandboxInput([
      { path: "src/counter.ts", source: SAFE_MODULE },
      { path: "src/main.ts", source: SAFE_RUNNER },
    ]);
    expect(errors).toEqual([]);
  });

  it("rejects non-allowlist imports (Node FS)", () => {
    const errors = validateSandboxInput([
      {
        path: "src/main.ts",
        source:
          'import { readFileSync } from "node:fs";\nreadFileSync("/etc/passwd");\n',
      },
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toMatch(/node:fs/);
  });

  it("rejects bare-package imports outside @directive-run/*", () => {
    const errors = validateSandboxInput([
      {
        path: "src/main.ts",
        source: 'import express from "express";\n',
      },
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toMatch(/express/);
  });

  it("rejects dynamic import()", () => {
    const errors = validateSandboxInput([
      {
        path: "src/main.ts",
        source: 'const x = await import("node:fs");\n',
      },
    ]);
    expect(errors.some((e) => e.message.includes("dynamic import"))).toBe(true);
  });

  it("rejects new Function(...)", () => {
    const errors = validateSandboxInput([
      {
        path: "src/main.ts",
        source: 'const f = new Function("return 1+1");\n',
      },
    ]);
    expect(errors.some((e) => e.message.includes("new Function"))).toBe(true);
  });

  it("rejects denied globals (process)", () => {
    const errors = validateSandboxInput([
      {
        path: "src/main.ts",
        source: "console.log(process.env.HOME);\n",
      },
    ]);
    expect(errors.some((e) => e.message.includes('"process"'))).toBe(true);
  });

  it("rejects fetch()", () => {
    const errors = validateSandboxInput([
      {
        path: "src/main.ts",
        source: 'await fetch("https://example.com");\n',
      },
    ]);
    expect(errors.some((e) => e.message.includes('"fetch"'))).toBe(true);
  });

  it("does NOT misflag identifier in property-key position", () => {
    // The runner does `createSystem({ module: counter })`. The `module`
    // here is an OBJECT-LITERAL KEY, not a reference to Node's CJS
    // `module` global. The validator must not reject this.
    const errors = validateSandboxInput([
      {
        path: "src/main.ts",
        source: SAFE_RUNNER.replace(
          "createSystem({ module: counter });",
          "createSystem({ module: counter, plugins: [] });",
        ),
      },
      { path: "src/counter.ts", source: SAFE_MODULE },
    ]);
    expect(errors).toEqual([]);
  });

  it("does NOT misflag identifier in property-access position", () => {
    // `obj.process` should be fine — `process` is a property name, not
    // a reference to the global.
    const errors = validateSandboxInput([
      {
        path: "src/main.ts",
        source: "const obj = { process: 1 };\nconsole.log(obj.process);\n",
      },
    ]);
    expect(errors).toEqual([]);
  });

  it("allows relative .js imports inside the payload", () => {
    const errors = validateSandboxInput([
      { path: "src/counter.ts", source: SAFE_MODULE },
      { path: "src/main.ts", source: SAFE_RUNNER },
    ]);
    expect(errors).toEqual([]);
  });
});
