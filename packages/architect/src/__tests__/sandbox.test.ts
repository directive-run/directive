import { describe, it, expect } from "vitest";
import {
  staticAnalysis,
  compileSandboxed,
  createMembrane,
  createSandboxScope,
  SandboxError,
} from "../sandbox.js";

describe("sandbox", () => {
  // ===========================================================================
  // Static Analysis
  // ===========================================================================

  describe("staticAnalysis", () => {
    it("passes safe code", () => {
      const result = staticAnalysis("return facts.count > 3;");

      expect(result.safe).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("blocks eval", () => {
      const result = staticAnalysis('eval("alert(1)")');

      expect(result.safe).toBe(false);
      expect(result.violations[0]).toContain("eval");
    });

    it("blocks Function constructor", () => {
      const result = staticAnalysis("new Function('return 1')");

      expect(result.safe).toBe(false);
      expect(result.violations[0]).toContain("Function");
    });

    it("blocks import", () => {
      const result = staticAnalysis('import("fs")');

      expect(result.safe).toBe(false);
      expect(result.violations[0]).toContain("import");
    });

    it("blocks require", () => {
      const result = staticAnalysis('require("fs")');

      expect(result.safe).toBe(false);
      expect(result.violations[0]).toContain("require");
    });

    it("blocks __proto__", () => {
      const result = staticAnalysis("obj.__proto__.pollute = true");

      expect(result.safe).toBe(false);
      expect(result.violations[0]).toContain("__proto__");
    });

    it("blocks prototype", () => {
      const result = staticAnalysis("Object.prototype.hack = true");

      expect(result.safe).toBe(false);
    });

    it("blocks fetch", () => {
      const result = staticAnalysis('fetch("https://evil.com")');

      expect(result.safe).toBe(false);
      expect(result.violations[0]).toContain("fetch");
    });

    it("blocks globalThis", () => {
      const result = staticAnalysis("globalThis.process");

      expect(result.safe).toBe(false);
    });

    it("blocks WebSocket", () => {
      const result = staticAnalysis("new WebSocket('ws://evil.com')");

      expect(result.safe).toBe(false);
    });

    it("blocks process", () => {
      const result = staticAnalysis("process.env.SECRET");

      expect(result.safe).toBe(false);
    });

    // C1: while and for are now BLOCKED (not just warned)
    it("blocks while loops", () => {
      const result = staticAnalysis("while (true) {}");

      expect(result.safe).toBe(false);
      expect(result.violations.some((v) => v.includes("while"))).toBe(true);
    });

    it("blocks for loops", () => {
      const result = staticAnalysis("for (let i = 0; i < 10; i++) {}");

      expect(result.safe).toBe(false);
      expect(result.violations.some((v) => v.includes("for"))).toBe(true);
    });

    it("rejects code exceeding max size", () => {
      const longCode = "x".repeat(3000);
      const result = staticAnalysis(longCode);

      expect(result.safe).toBe(false);
      expect(result.violations[0]).toContain("max size");
    });

    it("accepts custom blocked patterns", () => {
      const result = staticAnalysis("customBadThing()", ["customBadThing"]);

      expect(result.safe).toBe(false);
    });

    it("does not false-positive on substrings", () => {
      // "evaluate" contains "eval" but shouldn't trigger
      const result = staticAnalysis("const evaluate = 5;");

      expect(result.safe).toBe(true);
    });

    // M8: block arguments
    it("blocks arguments object", () => {
      const result = staticAnalysis("return arguments[0];");

      expect(result.safe).toBe(false);
      expect(result.violations.some((v) => v.includes("arguments"))).toBe(true);
    });

    // M9: block Symbol, Reflect, Proxy
    it("blocks Symbol", () => {
      const result = staticAnalysis("Symbol.iterator");

      expect(result.safe).toBe(false);
    });

    it("blocks Reflect", () => {
      const result = staticAnalysis("Reflect.get(obj, key)");

      expect(result.safe).toBe(false);
    });

    it("blocks Proxy", () => {
      const result = staticAnalysis("new Proxy({}, {})");

      expect(result.safe).toBe(false);
    });

    // E7: additional blocked patterns
    it("blocks crypto", () => {
      const result = staticAnalysis("crypto.getRandomValues()");

      expect(result.safe).toBe(false);
    });

    it("blocks navigator", () => {
      const result = staticAnalysis("navigator.userAgent");

      expect(result.safe).toBe(false);
    });

    it("blocks document", () => {
      const result = staticAnalysis("document.cookie");

      expect(result.safe).toBe(false);
    });

    it("blocks async/await", () => {
      const result = staticAnalysis("async () => { await fetch(); }");

      expect(result.safe).toBe(false);
      expect(result.violations.some((v) => v.includes("async"))).toBe(true);
    });

    it("blocks Worker", () => {
      const result = staticAnalysis("new Worker('w.js')");

      expect(result.safe).toBe(false);
    });

    it("blocks SharedArrayBuffer", () => {
      const result = staticAnalysis("new SharedArrayBuffer(8)");

      expect(result.safe).toBe(false);
    });

    // C2: unicode escape normalization
    it("blocks unicode-escaped eval (\\uXXXX)", () => {
      const result = staticAnalysis('\\u0065\\u0076\\u0061\\u006c("bad")');

      expect(result.safe).toBe(false);
      expect(result.violations.some((v) => v.includes("eval"))).toBe(true);
    });

    it("blocks hex-escaped patterns (\\xNN)", () => {
      const result = staticAnalysis('\\x65\\x76\\x61\\x6c("bad")');

      expect(result.safe).toBe(false);
    });

    it("blocks ES6 unicode escapes (\\u{XXXX})", () => {
      const result = staticAnalysis('\\u{65}\\u{76}\\u{61}\\u{6c}("bad")');

      expect(result.safe).toBe(false);
    });

    // C3: bracket notation concatenation
    it("blocks bracket-notation concatenation for __proto__", () => {
      const result = staticAnalysis('obj["__pro"+"to__"]');

      expect(result.safe).toBe(false);
      expect(result.violations.some((v) => v.includes("bracket-notation"))).toBe(true);
    });

    it("blocks bracket-notation concatenation for constructor", () => {
      const result = staticAnalysis('obj["con"+"structor"]');

      expect(result.safe).toBe(false);
    });

    it("blocks bracket access to __proto__", () => {
      const result = staticAnalysis('obj["__proto__"]');

      expect(result.safe).toBe(false);
    });

    it("blocks bracket access to constructor", () => {
      const result = staticAnalysis('obj["constructor"]');

      expect(result.safe).toBe(false);
    });

    // M18: maxCodeSize parameter
    it("accepts custom maxCodeSize via parameter", () => {
      const code = "x".repeat(100);
      const result = staticAnalysis(code, undefined, 50);

      expect(result.safe).toBe(false);
      expect(result.violations[0]).toContain("max size");
    });
  });

  // ===========================================================================
  // Recursive Proxy Membrane
  // ===========================================================================

  describe("createMembrane", () => {
    it("allows reading properties", () => {
      const obj = { a: 1, b: { c: 2 } };
      const wrapped = createMembrane(obj, true);

      expect(wrapped.a).toBe(1);
      expect(wrapped.b.c).toBe(2);
    });

    it("blocks __proto__ access", () => {
      const obj = { value: 1 };
      const wrapped = createMembrane(obj, true);

      expect((wrapped as Record<string, unknown>).__proto__).toBeUndefined();
    });

    it("blocks constructor access", () => {
      const obj = { value: 1 };
      const wrapped = createMembrane(obj, true);

      expect((wrapped as Record<string, unknown>).constructor).toBeUndefined();
    });

    it("blocks prototype access", () => {
      const obj = { value: 1 };
      const wrapped = createMembrane(obj, true);

      expect((wrapped as Record<string, unknown>).prototype).toBeUndefined();
    });

    it("prevents writes in read-only mode", () => {
      const obj = { a: 1 };
      const wrapped = createMembrane(obj, true);

      expect(() => {
        (wrapped as Record<string, unknown>).a = 2;
      }).toThrow();
    });

    it("allows writes in read-write mode", () => {
      const obj = { a: 1 };
      const wrapped = createMembrane(obj, false);

      wrapped.a = 2;

      expect(wrapped.a).toBe(2);
    });

    it("blocks setPrototypeOf", () => {
      const obj = { a: 1 };
      const wrapped = createMembrane(obj, false);

      expect(() =>
        Object.setPrototypeOf(wrapped, { hacked: true }),
      ).toThrow();
      expect(Object.getPrototypeOf(wrapped)).toBeNull();
    });

    it("wraps nested objects recursively", () => {
      const obj = { nested: { deep: { value: 42 } } };
      const wrapped = createMembrane(obj, true);

      expect(wrapped.nested.deep.value).toBe(42);
      // Verify nested objects also block proto access
      expect(
        (wrapped.nested as Record<string, unknown>).__proto__,
      ).toBeUndefined();
    });

    // M1: defineProperty trap
    it("blocks defineProperty", () => {
      const obj = { a: 1 };
      const wrapped = createMembrane(obj, false);

      expect(() => {
        Object.defineProperty(wrapped, "hack", { value: 1 });
      }).toThrow();
    });

    // M1: getOwnPropertyDescriptor blocks dangerous props
    it("returns undefined descriptor for blocked props", () => {
      const obj = { a: 1 };
      const wrapped = createMembrane(obj, true);

      expect(Object.getOwnPropertyDescriptor(wrapped, "__proto__")).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(wrapped, "constructor")).toBeUndefined();
    });

    // M1: has trap
    it("hides blocked props from 'in' operator", () => {
      const obj = { a: 1 };
      const wrapped = createMembrane(obj, true);

      expect("a" in wrapped).toBe(true);
      expect("__proto__" in (wrapped as Record<string, unknown>)).toBe(false);
      expect("constructor" in (wrapped as Record<string, unknown>)).toBe(false);
    });

    // M1: ownKeys trap
    it("filters blocked props from Object.keys", () => {
      const obj = { a: 1, b: 2 };
      const wrapped = createMembrane(obj, true);

      const keys = Object.keys(wrapped);

      expect(keys).toContain("a");
      expect(keys).toContain("b");
      expect(keys).not.toContain("__proto__");
      expect(keys).not.toContain("constructor");
    });
  });

  // ===========================================================================
  // Sandbox Scope
  // ===========================================================================

  describe("createSandboxScope", () => {
    it("provides deep-cloned facts", () => {
      const facts = { count: 5, nested: { value: 10 } };
      const scope = createSandboxScope(facts);

      // Verify facts are accessible
      expect((scope.facts as Record<string, unknown>).count).toBe(5);

      // Verify deep clone (not same reference)
      (scope.facts as Record<string, Record<string, unknown>>).nested.value = 99;

      expect(facts.nested.value).toBe(10); // original unchanged
    });

    it("provides allowed globals", () => {
      const scope = createSandboxScope({});

      expect(scope.Math).toBe(Math);
      expect(scope.JSON).toBeDefined();
      expect(scope.console).toBeDefined();
    });

    // M10: Date no longer in defaults
    it("does not provide Date by default", () => {
      const scope = createSandboxScope({});

      expect(scope.Date).toBeUndefined();
    });

    it("provides Date when explicitly requested", () => {
      const scope = createSandboxScope({}, ["Math", "JSON", "console", "Date"]);

      expect(scope.Date).toBe(Date);
    });

    it("supports custom allowed globals", () => {
      const scope = createSandboxScope({}, ["Math"]);

      expect(scope.Math).toBe(Math);
      expect(scope.JSON).toBeUndefined();
    });

    // E9: validates allowedGlobals against safe whitelist
    it("throws on unsafe global", () => {
      expect(() => {
        createSandboxScope({}, ["eval"]);
      }).toThrow(SandboxError);
      expect(() => {
        createSandboxScope({}, ["eval"]);
      }).toThrow("Unsafe global");
    });

    // E8: JSON membrane returns null-prototype objects
    it("JSON.parse returns null-prototype objects", () => {
      const scope = createSandboxScope({});
      const json = scope.JSON as { parse: typeof JSON.parse };
      const parsed = json.parse('{"a": 1}') as Record<string, unknown>;

      expect(parsed.a).toBe(1);
      expect(Object.getPrototypeOf(parsed)).toBeNull();
    });

    // E10/M11: rate-limited console
    it("rate-limits console calls", () => {
      const scope = createSandboxScope({});
      const cons = scope.console as Record<string, (...args: unknown[]) => void>;

      // Should not throw even after many calls
      for (let i = 0; i < 150; i++) {
        cons.log("test");
      }
      // Just verifying no crash — silently drops after 100
    });
  });

  // ===========================================================================
  // Compile & Execute
  // ===========================================================================

  describe("compileSandboxed", () => {
    it("compiles and executes safe code", () => {
      const compiled = compileSandboxed("return facts.count > 3;");
      const result = compiled.execute({ count: 5 });

      expect(result).toBe(true);
    });

    it("returns false for unmet condition", () => {
      const compiled = compileSandboxed("return facts.count > 10;");
      const result = compiled.execute({ count: 5 });

      expect(result).toBe(false);
    });

    it("throws SandboxError on blocked code", () => {
      expect(() => compileSandboxed('eval("bad")')).toThrow(SandboxError);
    });

    it("throws SandboxError on oversized code", () => {
      const longCode = `return "${"x".repeat(3000)}";`;

      expect(() => compileSandboxed(longCode)).toThrow(SandboxError);
    });

    it("throws SandboxError when function throws", () => {
      const compiled = compileSandboxed('throw new Error("boom");');

      expect(() => compiled.execute({})).toThrow(SandboxError);
      expect(() => compiled.execute({})).toThrow("Sandboxed function threw an error");
    });

    it("preserves source code on compiled function", () => {
      const code = "return facts.x + 1;";
      const compiled = compileSandboxed(code);

      expect(compiled.source).toBe(code);
    });

    it("allows Math in sandbox", () => {
      const compiled = compileSandboxed("return Math.max(facts.a, facts.b);");
      const result = compiled.execute({ a: 3, b: 7 });

      expect(result).toBe(7);
    });

    it("respects custom max code size", () => {
      const code = "return 1;";

      expect(() =>
        compileSandboxed(code, { maxCodeSize: 5 }),
      ).toThrow(SandboxError);
    });
  });

  // ===========================================================================
  // C1: Worker Sandbox Defense Layers
  // ===========================================================================

  describe("createWorkerSandbox", () => {
    it("C1: worker code includes dangerous global deletion", async () => {
      const { createWorkerSandbox } = await import("../sandbox.js");

      // The worker sandbox should include defense layers even though
      // we can't easily test the actual Worker execution in a test.
      // Verify the function exists and handles static analysis.
      expect(() => createWorkerSandbox("return facts.x;")).not.toThrow();
    });

    it("C1: worker sandbox rejects unsafe code via static analysis", async () => {
      const { createWorkerSandbox } = await import("../sandbox.js");

      expect(() => createWorkerSandbox('eval("bad")')).toThrow(SandboxError);
    });
  });
});
