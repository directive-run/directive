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

  it("does NOT misflag legitimate identifier in property-access position", () => {
    // `obj.foo` should be fine — `foo` is a property name and not in
    // DENIED_GLOBALS. This is the false-positive case the
    // property-access skip was originally added to handle. v0.3.0's
    // hardened validator still allows non-denied property names.
    const errors = validateSandboxInput([
      {
        path: "src/main.ts",
        source: "const obj = { foo: 1 };\nconsole.log(obj.foo);\n",
      },
    ]);
    expect(errors).toEqual([]);
  });

  it("DOES flag denied identifier reached via property access", () => {
    // v0.1.0/v0.2.0 incorrectly allowed `obj.process` because `process`
    // was a property name. v0.3.0 closes this — we cannot statically
    // prove `obj` is safe, so `.process` is rejected regardless of
    // receiver. This closes the property-access bypass: any denied
    // identifier was reachable simply by reading it off an object.
    const errors = validateSandboxInput([
      {
        path: "src/main.ts",
        source: "const obj = { process: 1 };\nconsole.log(obj.process);\n",
      },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("allows relative .js imports inside the payload", () => {
    const errors = validateSandboxInput([
      { path: "src/counter.ts", source: SAFE_MODULE },
      { path: "src/main.ts", source: SAFE_RUNNER },
    ]);
    expect(errors).toEqual([]);
  });

  describe("@directive-run/* allowlist (widened)", () => {
    const ALLOWED = [
      "@directive-run/core",
      "@directive-run/ai",
      "@directive-run/query",
      "@directive-run/react",
      "@directive-run/vue",
      "@directive-run/svelte",
      "@directive-run/solid",
      "@directive-run/lit",
      "@directive-run/el",
      "@directive-run/optimistic",
      "@directive-run/timeline",
      "@directive-run/mutator",
      "@directive-run/knowledge",
      "@directive-run/scaffold",
      "@directive-run/claude-plugin",
      "@directive-run/lint",
      "@directive-run/sources",
    ];

    it.each(ALLOWED)("permits `%s`", (specifier) => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source: `import * as x from "${specifier}";\nconsole.log(x);\n`,
        },
      ]);
      expect(errors).toEqual([]);
    });

    it("permits subpath imports of allowlisted packages", () => {
      // `@directive-run/ai/openai`, `@directive-run/react/hooks`, etc.
      // The validator extracts the package segment and ignores the
      // subpath when checking the allowlist.
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source: 'import { x } from "@directive-run/ai/openai";\n',
        },
      ]);
      expect(errors).toEqual([]);
    });

    it("permits `@directive-run/sources` two-segment subpaths", () => {
      // `@directive-run/sources/supabase` and `/cloudflare` ship as
      // the two adapter subpaths of the umbrella package.
      // regression: previously rejected because `sources` wasn't on
      // the allowlist.
      for (const specifier of [
        "@directive-run/sources/supabase",
        "@directive-run/sources/cloudflare",
      ]) {
        const errors = validateSandboxInput([
          {
            path: "src/main.ts",
            source: `import { x } from "${specifier}";\n`,
          },
        ]);
        expect(errors, `expected ${specifier} to be allowed`).toEqual([]);
      }
    });

    const DENIED = [
      "@directive-run/cli",
      "@directive-run/mcp",
      "@directive-run/sandbox",
      "@directive-run/vite-plugin-api-proxy",
    ];

    it.each(DENIED)("denies `%s` as build/CLI/sandbox tooling", (specifier) => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source: `import * as x from "${specifier}";\nconsole.log(x);\n`,
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]!.message).toMatch(/denied/i);
    });

    it("denies @sizls/* (no current scope)", () => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source: 'import { x } from "@sizls/somepackage";\n',
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  /**
   * Known escape chains. Each one was a working sandbox escape in
   * v0.1.0/v0.2.0; v0.3.0 must reject all of them.
   * Adding a new escape vector? Add a test here FIRST, prove it fails,
   * THEN write the fix.
   */
  describe("June 2026 security audit — property-access bypass closure", () => {
    it("rejects `globalThis.process` direct property access", () => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source: "console.log(globalThis.process.env.HOME);\n",
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.message.includes(".process"))).toBe(true);
    });

    it("rejects `globalThis.process.mainModule.require('node:fs')` chain", () => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source:
            'const fs = globalThis.process.mainModule.require("node:fs");\n',
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("rejects `globalThis.fetch` property access", () => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source: 'await globalThis.fetch("https://example.com");\n',
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.message.includes(".fetch"))).toBe(true);
    });

    it("rejects `globalThis.Buffer` (heap-cap bypass)", () => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source: "const b = globalThis.Buffer.alloc(1024);\n",
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("rejects `globalThis.setTimeout`", () => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source: "globalThis.setTimeout(() => {}, 1000);\n",
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects `Reflect.get(globalThis, "process")` smuggle', () => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source: 'const proc = Reflect.get(globalThis, "process");\n',
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.message.includes("Reflect.get"))).toBe(true);
    });

    it('rejects `Reflect.has(globalThis, "fetch")`', () => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source: 'console.log(Reflect.has(globalThis, "fetch"));\n',
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects `Object.getOwnPropertyDescriptor(globalThis, "process")`', () => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source:
            'const d = Object.getOwnPropertyDescriptor(globalThis, "process");\n',
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("rejects `({}).constructor.constructor('return process')()` Function smuggle", () => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source:
            'const F = ({}).constructor.constructor;\nconst p = F("return process")();\n',
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.message.includes(".constructor"))).toBe(true);
    });

    it("rejects free `Function(...)` call (no `new`)", () => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source: 'const f = Function("return 1+1");\n',
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects `globalThis["process"]` bracket access', () => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source: 'const p = globalThis["process"];\n',
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("rejects ANY bracket-access on globalThis with a string literal", () => {
      // Even `globalThis["Object"]` (where Object is allowlisted) is
      // denied — there's no legitimate reason for bracket syntax here.
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source: 'const x = globalThis["Object"];\n',
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects `obj["constructor"]` bracket access on any value', () => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source: 'const F = ({})["constructor"]["constructor"];\n',
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("rejects nested `.constructor` access in any chain", () => {
      const errors = validateSandboxInput([
        {
          path: "src/main.ts",
          source: 'const F = "x".constructor.constructor;\n',
        },
      ]);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("still permits legitimate property keys in object literals", () => {
      // The original false-positive case the property-access skip was
      // added for: `createSystem({ module: counter })`. `module` is an
      // OBJECT-LITERAL KEY, not a reference to Node's CJS `module`.
      // The hardened validator must not regress on this.
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

    it("still permits property access on Directive system surface", () => {
      // The legitimate use case the validator must allow:
      // `system.events.foo({})`, `system.facts.count`, `system.start()`.
      const errors = validateSandboxInput([
        { path: "src/main.ts", source: SAFE_RUNNER },
        { path: "src/counter.ts", source: SAFE_MODULE },
      ]);
      expect(errors).toEqual([]);
    });
  });
});
