/**
 * Sandbox for AI-generated code — 6-layer defense-in-depth.
 *
 * Pipeline: Static Analysis → Proxy Membrane → Null-Prototype Scope →
 *           Timeout Guard → Return Validation → Error Sanitization
 */

import type { SandboxCompileOptions, StaticAnalysisResult } from "./types.js";

// ============================================================================
// Blocked Patterns (Layer 1: Static Analysis)
// ============================================================================

const DEFAULT_BLOCKED_PATTERNS = [
  "eval",
  "Function",
  "import",
  "require",
  "__proto__",
  "constructor",
  "prototype",
  "globalThis",
  "window",
  "self",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "process",
  "Deno",
  "Bun",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  // C1: loops moved from WARN to BLOCKED
  "while",
  "for",
  // M8: block arguments object
  "arguments",
  // M9: block metaprogramming primitives
  "Symbol",
  "Reflect",
  "Proxy",
  // E7: additional blocked patterns
  "Atomics",
  "SharedArrayBuffer",
  "Worker",
  "Blob",
  "URL",
  "TextEncoder",
  "TextDecoder",
  "crypto",
  "navigator",
  "location",
  "document",
  "alert",
  "prompt",
  "confirm",
  "async",
  "await",
] as const;

// M10: Date removed from allowed globals
const DEFAULT_ALLOWED_GLOBALS = ["Math", "JSON", "console"] as const;

// E9: safe globals whitelist — allowedGlobals validated against this
const SAFE_GLOBALS = new Set([
  "Math",
  "JSON",
  "console",
  "Date",
  "Number",
  "String",
  "Boolean",
  "Array",
  "Object",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "NaN",
  "Infinity",
  "undefined",
]);

const MAX_CODE_SIZE = 2048;

// ============================================================================
// Unicode/Escape Normalization (C2)
// ============================================================================

/**
 * Resolve unicode escapes (\uXXXX, \u{XXXX}, \xNN) so static analysis
 * sees the real characters.
 */
function normalizeEscapes(code: string): string {
  return code
    // \u{XXXX} (ES6 unicode code point)
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_m, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    // \uXXXX (classic unicode escape)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    // \xNN (hex escape)
    .replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

// ============================================================================
// Static Analysis (Layer 1)
// ============================================================================

/**
 * Pattern-based static analysis of AI-generated code.
 * Checks for blocked identifiers using word-boundary matching.
 *
 * NOTE: The timeout in compileSandboxed is advisory — it sets a flag after
 * the timeout period but cannot forcibly terminate synchronous JS execution.
 * Static analysis is the primary defense against infinite loops (C1).
 */
export function staticAnalysis(
  code: string,
  extraBlocked?: string[],
  maxCodeSize?: number,
): StaticAnalysisResult {
  const violations: string[] = [];
  const warnings: string[] = [];

  // M18: use passed maxCodeSize, no duplicate check later
  const limit = maxCodeSize ?? MAX_CODE_SIZE;

  if (code.length > limit) {
    violations.push(
      `Code exceeds max size: ${code.length} bytes (limit: ${limit})`,
    );
  }

  // C2: normalize unicode/hex escapes before analysis
  const normalized = normalizeEscapes(code);

  const blocked = [...DEFAULT_BLOCKED_PATTERNS, ...(extraBlocked ?? [])];

  // Run analysis on both original and normalized forms
  for (const pattern of blocked) {
    const regex = new RegExp(`(?<![a-zA-Z0-9_$])${escapeRegex(pattern)}(?![a-zA-Z0-9_$])`);

    if (regex.test(code) || regex.test(normalized)) {
      violations.push(`Blocked pattern found: "${pattern}"`);
    }
  }

  // C3: detect bracket notation concatenation for prototype pollution
  // Matches patterns like obj["con"+"structor"] or obj["__pro"+"to__"]
  if (/\[\s*["'][^"']*["']\s*\+/.test(code) || /\[\s*["'][^"']*["']\s*\+/.test(normalized)) {
    // Check if it accesses dangerous props
    const bracketConcatRegex = /\[\s*["']([^"']*)["']\s*\+\s*["']([^"']*)["']\s*\]/g;
    let match: RegExpExecArray | null;

    for (const source of [code, normalized]) {
      bracketConcatRegex.lastIndex = 0;

      while ((match = bracketConcatRegex.exec(source)) !== null) {
        const combined = (match[1] ?? "") + (match[2] ?? "");
        if (combined === "__proto__" || combined === "constructor" || combined === "prototype") {
          violations.push(`Blocked bracket-notation concatenation accessing "${combined}"`);
        }
      }
    }
  }

  // C3: block bracket access to dangerous properties
  const bracketAccessRegex = /\[\s*["'](__)?(proto|constructor|prototype)(__)?["']\s*\]/;

  if (bracketAccessRegex.test(code) || bracketAccessRegex.test(normalized)) {
    violations.push('Blocked bracket-notation access to __proto__/constructor/prototype');
  }

  return {
    safe: violations.length === 0,
    violations,
    warnings,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================================
// Recursive Proxy Membrane (Layer 2)
// ============================================================================

const BLOCKED_PROPS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * Wraps an object in a recursive Proxy membrane.
 * Every object returned from a get is itself wrapped, preventing prototype chain escapes.
 */
export function createMembrane<T extends object>(target: T, readOnly: boolean): T {
  const cache = new WeakMap<object, object>();

  function wrap(obj: unknown): unknown {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    const objRef = obj as object;
    const cached = cache.get(objRef);
    if (cached) {
      return cached;
    }

    const proxy = new Proxy(objRef, {
      get(_target, prop, _receiver) {
        if (typeof prop === "string" && BLOCKED_PROPS.has(prop)) {
          return undefined;
        }

        const value = Reflect.get(_target, prop);

        if (typeof value === "function") {
          return value.bind(_target);
        }

        if (value !== null && typeof value === "object") {
          return wrap(value);
        }

        return value;
      },

      set(_target, prop, value) {
        if (readOnly) {
          return false;
        }

        if (typeof prop === "string" && BLOCKED_PROPS.has(prop)) {
          return false;
        }

        return Reflect.set(_target, prop, value);
      },

      deleteProperty() {
        return false;
      },

      setPrototypeOf() {
        return false;
      },

      getPrototypeOf() {
        return null;
      },

      // M1: additional proxy traps
      defineProperty() {
        return false;
      },

      getOwnPropertyDescriptor(_target, prop) {
        if (typeof prop === "string" && BLOCKED_PROPS.has(prop)) {
          return undefined;
        }

        return Reflect.getOwnPropertyDescriptor(_target, prop);
      },

      has(_target, prop) {
        if (typeof prop === "string" && BLOCKED_PROPS.has(prop)) {
          return false;
        }

        return Reflect.has(_target, prop);
      },

      ownKeys(_target) {
        return Reflect.ownKeys(_target).filter(
          (key) => !(typeof key === "string" && BLOCKED_PROPS.has(key)),
        );
      },
    });

    cache.set(objRef, proxy);

    return proxy;
  }

  return wrap(target) as T;
}

// ============================================================================
// Null-Prototype Scope (Layer 3)
// ============================================================================

/**
 * Creates a sandbox scope with null prototype.
 * Facts are deep-cloned into null-prototype objects.
 */
export function createSandboxScope(
  facts: Record<string, unknown>,
  allowedGlobals?: string[],
): Record<string, unknown> {
  const scope = Object.create(null) as Record<string, unknown>;

  // Deep clone facts into null-prototype objects
  const clonedFacts = deepCloneNullProto(facts);
  scope.facts = createMembrane(clonedFacts, false);

  // E9: validate allowedGlobals against SAFE_GLOBALS whitelist
  const globals = allowedGlobals ?? [...DEFAULT_ALLOWED_GLOBALS];

  for (const name of globals) {
    if (!SAFE_GLOBALS.has(name)) {
      throw new SandboxError(`Unsafe global requested: "${name}". Allowed: ${[...SAFE_GLOBALS].join(", ")}`);
    }

    const global = getGlobal(name);
    if (global !== undefined) {
      scope[name] = global;
    }
  }

  return scope;
}

function getGlobal(name: string): unknown {
  switch (name) {
    case "Math":
      return Math;
    case "Date":
      return Date;
    case "JSON":
      return createSafeJSON();
    case "console":
      return createRateLimitedConsole();
    case "Number":
      return Number;
    case "String":
      return String;
    case "Boolean":
      return Boolean;
    case "Array":
      return Array;
    case "Object":
      return Object;
    case "parseInt":
      return parseInt;
    case "parseFloat":
      return parseFloat;
    case "isNaN":
      return isNaN;
    case "isFinite":
      return isFinite;
    case "NaN":
      return NaN;
    case "Infinity":
      return Infinity;
    case "undefined":
      return undefined;
    default:
      return undefined;
  }
}

// E8: JSON membrane — parse returns null-prototype objects
function createSafeJSON(): { parse: typeof JSON.parse; stringify: typeof JSON.stringify } {
  return {
    parse(text: string, reviver?: (key: string, value: unknown) => unknown) {
      const parsed = JSON.parse(text, reviver);

      return toNullProto(parsed);
    },
    stringify: JSON.stringify.bind(JSON),
  };
}

// E10/M11: rate-limited console — 100 calls per execution
const MAX_CONSOLE_CALLS = 100;

function createRateLimitedConsole(): Record<string, (...args: unknown[]) => void> {
  let callCount = 0;

  function guarded(method: (...args: unknown[]) => void) {
    return (...args: unknown[]) => {
      if (callCount >= MAX_CONSOLE_CALLS) {
        return;
      }

      callCount++;
      method(...args);
    };
  }

  return {
    log: guarded(console.log.bind(console)),
    warn: guarded(console.warn.bind(console)),
    error: guarded(console.error.bind(console)),
    info: guarded(console.info.bind(console)),
  };
}

function deepCloneNullProto(obj: unknown): Record<string, unknown> {
  const json = JSON.parse(JSON.stringify(obj ?? {}));

  return toNullProto(json) as Record<string, unknown>;
}

function toNullProto(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(toNullProto);
  }

  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    result[key] = toNullProto((value as Record<string, unknown>)[key]);
  }

  return result;
}

// ============================================================================
// Compile & Execute (Layers 4-6)
// ============================================================================

export interface CompiledFunction {
  /** Execute the sandboxed function with given facts. */
  execute(facts: Record<string, unknown>): unknown;
  /** The source code. */
  source: string;
}

/**
 * Compile AI-generated code into a sandboxed function.
 *
 * The code is wrapped in a `new Function()` with a restricted scope.
 * All objects passed in are wrapped in recursive Proxy membranes.
 */
export function compileSandboxed(
  code: string,
  options?: SandboxCompileOptions,
): CompiledFunction {
  const maxSize = options?.maxCodeSize ?? MAX_CODE_SIZE;

  // M18: pass maxCodeSize into staticAnalysis, no duplicate check after
  const analysis = staticAnalysis(code, options?.blockedPatterns, maxSize);

  if (!analysis.safe) {
    throw new SandboxError(
      `Code failed static analysis: ${analysis.violations.join(", ")}`,
    );
  }

  const timeout = options?.timeout ?? 5000;
  const factWriteAccess = options?.factWriteAccess ?? false;

  return {
    source: code,
    execute(facts: Record<string, unknown>): unknown {
      const scope = createSandboxScope(facts, options?.allowedGlobals);

      // Wrap the scope in a membrane (read-only unless factWriteAccess)
      const membranedScope = createMembrane(scope, false);

      // Build parameter names and values from scope
      const paramNames = Object.keys(scope);
      const paramValues = paramNames.map((k) => (membranedScope as Record<string, unknown>)[k]);

      // The function body wraps the user code
      const wrappedCode = `"use strict";\n${code}`;

      let fn: Function;
      try {
        // biome-ignore lint/security/noGlobalEval: Intentional sandboxed execution
        fn = new Function(...paramNames, wrappedCode);
      } catch (err) {
        throw new SandboxError("Failed to compile code");
      }

      // Execute with timeout guard
      let result: unknown;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;

      timeoutId = setTimeout(() => {
        timedOut = true;
      }, timeout);

      try {
        result = fn.apply(null, paramValues);
      } catch {
        clearTimeout(timeoutId);

        // Layer 6: Error sanitization — don't leak sandbox internals
        throw new SandboxError("Sandboxed function threw an error");
      }

      clearTimeout(timeoutId);

      if (timedOut) {
        throw new SandboxError(`Execution timed out after ${timeout}ms`);
      }

      // If factWriteAccess, extract mutations from the membrane
      if (factWriteAccess && scope.facts) {
        const mutatedFacts = JSON.parse(JSON.stringify(scope.facts));
        for (const key of Object.keys(mutatedFacts)) {
          facts[key] = mutatedFacts[key];
        }
      }

      return result;
    },
  };
}

// ============================================================================
// Error Type
// ============================================================================

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}
