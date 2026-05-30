/**
 * @directive-run/timeline/matchers — causal-graph vitest matchers.
 *
 * Lets tests assert against the *causal chain* a Directive system
 * produced, not just the final state. Pair with `recordTimeline()`
 * from the package root: capture the frame stream during the test, then
 * use these matchers to describe what shape of behavior should have
 * happened.
 *
 * v0.1 ships 5 matchers covering the highest-leverage assertions
 * surfaced by the AE-review-loop innovation pass (R1.B). Each matcher
 * is a small predicate over the recorded `ObservationEvent` stream;
 * vitest's `not` modifier composes naturally for negative assertions.
 *
 * @example
 * ```ts
 * import { expect, it } from 'vitest';
 * import { recordTimeline } from '@directive-run/timeline';
 * import '@directive-run/timeline/matchers'; // side-effect: registers matchers
 *
 * it('completes in under 50ms', async () => {
 *   const t = recordTimeline(sys, { id: 'fast' });
 *   sys.start();
 *   sys.events.LOAD();
 *   await flushAsync();
 *
 *   expect(t).toReachInMs('status', 'ready', 50);
 *   expect(t).toFireConstraint('loadOnLoading');
 *   expect(t).toResolveWithinMs('initialLoader', 50);
 *   expect(t).not.toCascade();
 * });
 * ```
 */

import type { Timeline, TimelineFrame } from "./index.js";

interface MatcherResult {
  pass: boolean;
  message: () => string;
}

/**
 * Extract the observation event from a timeline-or-serialized-timeline
 * input. The matchers accept either shape so users can assert against
 * either a live `Timeline` or a `SerializedTimeline` parsed from a
 * prod-error JSON dump.
 */
function frames(input: unknown): TimelineFrame[] {
  if (input === null || typeof input !== "object") {
    throw new TypeError(
      "[timeline-matchers] expected a Timeline or SerializedTimeline",
    );
  }
  const obj = input as { frames?: unknown };
  if (!Array.isArray(obj.frames)) {
    throw new TypeError(
      "[timeline-matchers] input.frames is missing or not an array",
    );
  }
  // R2 sec C-3: filter out frames lacking a structurally-valid
  // `event.type`. Untrusted JSON (e.g. a hostile prod-error dump)
  // could embed `frames: [{ ts: 0, event: null }]` which would
  // crash matcher iteration with a bare TypeError instead of
  // producing a clean assertion result.
  return (obj.frames as unknown[]).filter(isWellFormedFrame) as TimelineFrame[];
}

/**
 * Structural deep-equality. NaN equals NaN; undefined equals undefined;
 * arrays compared by index; objects compared by enumerable own keys.
 * Avoids the false-positive matches that `JSON.stringify` equality
 * produces when values contain NaN, Infinity, or undefined fields.
 *
 * @internal
 */
function structuredEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true; // handles NaN, identity
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!structuredEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, k)) return false;
    if (!structuredEqual(aObj[k], bObj[k])) return false;
  }
  return true;
}

/**
 * Best-effort string rendering for an expected value in matcher
 * messages. Uses JSON.stringify for normal values; falls back to
 * String() for shapes JSON can't handle (BigInt, circular refs).
 *
 * @internal
 */
function formatValue(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function isWellFormedFrame(raw: unknown): raw is TimelineFrame {
  if (raw === null || typeof raw !== "object") return false;
  const f = raw as { event?: unknown };
  if (f.event === null || typeof f.event !== "object") return false;
  const ev = f.event as { type?: unknown };
  return typeof ev.type === "string";
}

// ============================================================================
// toReachInMs — assert a fact key reached a value within N ms
// ============================================================================

function toReachInMs(
  this: unknown,
  received: Timeline,
  factKey: string,
  expectedValue: unknown,
  withinMs: number,
): MatcherResult {
  const fs = frames(received);
  let firstReachTs: number | null = null;

  for (const f of fs) {
    if (f.event.type !== "fact.change") continue;
    if (f.event.key !== factKey) continue;
    // R2 sec M-2: structural equality instead of JSON.stringify.
    // JSON-roundtrip equality drops NaN/undefined/Infinity (NaN
    // coerces to null; undefined keys disappear), producing false
    // positive matches. structuredEqual compares directly.
    if (structuredEqual(f.event.next, expectedValue)) {
      firstReachTs = f.ts;
      break;
    }
  }

  if (firstReachTs === null) {
    return {
      pass: false,
      message: () =>
        `expected timeline to reach ${factKey} = ${formatValue(expectedValue)} within ${withinMs}ms — fact never reached that value`,
    };
  }

  const pass = firstReachTs <= withinMs;
  return {
    pass,
    message: () =>
      pass
        ? `expected timeline NOT to reach ${factKey} = ${formatValue(expectedValue)} within ${withinMs}ms — but reached at +${firstReachTs!.toFixed(1)}ms`
        : `expected timeline to reach ${factKey} = ${formatValue(expectedValue)} within ${withinMs}ms — reached at +${firstReachTs!.toFixed(1)}ms`,
  };
}

// ============================================================================
// toFireConstraint — assert a constraint fired (optionally N times)
// ============================================================================

interface FireConstraintOpts {
  /** Exact firing count. Mutually exclusive with `min`/`max`. */
  times?: number;
  /** Minimum firing count (inclusive). */
  min?: number;
  /** Maximum firing count (inclusive). */
  max?: number;
}

function toFireConstraint(
  this: unknown,
  received: Timeline,
  constraintId: string,
  opts: FireConstraintOpts = {},
): MatcherResult {
  const fs = frames(received);
  let count = 0;
  for (const f of fs) {
    if (
      f.event.type === "constraint.evaluate" &&
      f.event.id === constraintId &&
      f.event.active === true
    ) {
      count++;
    }
  }

  let pass: boolean;
  let expectation: string;
  if (opts.times !== undefined) {
    pass = count === opts.times;
    expectation = `exactly ${opts.times} times`;
  } else if (opts.min !== undefined || opts.max !== undefined) {
    const min = opts.min ?? 0;
    const max = opts.max ?? Number.POSITIVE_INFINITY;
    pass = count >= min && count <= max;
    expectation = `between ${min} and ${max === Number.POSITIVE_INFINITY ? "∞" : max} times`;
  } else {
    pass = count >= 1;
    expectation = "at least once";
  }

  return {
    pass,
    message: () =>
      pass
        ? `expected timeline NOT to fire constraint '${constraintId}' ${expectation} — fired ${count} times`
        : `expected timeline to fire constraint '${constraintId}' ${expectation} — fired ${count} times`,
  };
}

// ============================================================================
// toMutate — assert a mutator MUTATE was dispatched with the given kind
// ============================================================================

function toMutate(
  this: unknown,
  received: Timeline,
  kind: string,
): MatcherResult {
  const fs = frames(received);
  let count = 0;
  for (const f of fs) {
    if (f.event.type !== "fact.change") continue;
    if (f.event.key !== "pendingMutation") continue;
    const next = f.event.next as Record<string, unknown> | null;
    if (next === null) continue;
    if (next.kind === kind && next.status === "pending") count++;
  }

  const pass = count >= 1;
  return {
    pass,
    message: () =>
      pass
        ? `expected timeline NOT to mutate '${kind}' — mutated ${count} times`
        : `expected timeline to mutate '${kind}' — saw 0 dispatches`,
  };
}

// ============================================================================
// toResolveWithinMs — assert a resolver completed within an ms budget
// ============================================================================

function toResolveWithinMs(
  this: unknown,
  received: Timeline,
  resolverName: string,
  withinMs: number,
): MatcherResult {
  const fs = frames(received);
  const durations: number[] = [];
  for (const f of fs) {
    if (
      f.event.type === "resolver.complete" &&
      f.event.resolver === resolverName
    ) {
      durations.push(f.event.duration);
    }
  }

  if (durations.length === 0) {
    return {
      pass: false,
      message: () =>
        `expected resolver '${resolverName}' to resolve within ${withinMs}ms — but it never completed (timeline has 0 resolver.complete frames for it)`,
    };
  }

  const slowest = Math.max(...durations);
  const pass = slowest <= withinMs;
  return {
    pass,
    message: () =>
      pass
        ? `expected resolver '${resolverName}' NOT to resolve within ${withinMs}ms — slowest of ${durations.length} run${durations.length === 1 ? "" : "s"} took ${slowest.toFixed(1)}ms`
        : `expected resolver '${resolverName}' to resolve within ${withinMs}ms — slowest of ${durations.length} run${durations.length === 1 ? "" : "s"} took ${slowest.toFixed(1)}ms`,
  };
}

// ============================================================================
// toCascade — assert at least one constraint fired in response to a
// fact change that another constraint produced (a "cascade")
// ============================================================================

/**
 * A cascade is a constraint→fact-change→constraint chain reaction. We
 * detect it heuristically: if any `constraint.evaluate` fires AFTER a
 * `fact.change` whose causing-constraint was a different constraint
 * (within the same reconcile window), that's a cascade.
 *
 * v0.1 uses a simple "any constraint fires after the first one in a
 * reconcile cycle" predicate — coarse but correct for the common case
 * (single root cause → fan-out). v0.2 will track caused-by edges.
 */
function toCascade(this: unknown, received: Timeline): MatcherResult {
  const fs = frames(received);
  let withinReconcile = false;
  let firedThisCycle = 0;
  let cascadeDetected = false;

  for (const f of fs) {
    if (f.event.type === "reconcile.start") {
      withinReconcile = true;
      firedThisCycle = 0;
    } else if (f.event.type === "reconcile.end") {
      withinReconcile = false;
    } else if (
      f.event.type === "constraint.evaluate" &&
      f.event.active === true &&
      withinReconcile
    ) {
      firedThisCycle++;
      if (firedThisCycle >= 2) {
        cascadeDetected = true;
        break;
      }
    }
  }

  return {
    pass: cascadeDetected,
    message: () =>
      cascadeDetected
        ? "expected timeline NOT to cascade — detected ≥2 constraints firing within the same reconcile cycle"
        : "expected timeline to cascade — no reconcile cycle had ≥2 active constraints",
  };
}

// ============================================================================
// Registration — call once per test file (or in a setup file)
// ============================================================================

/**
 * Side-effect: registers all 5 matchers with vitest's `expect`. Import
 * this module from any test file (or your `vitest.setup.ts`) to make
 * the matchers available globally.
 *
 * @example
 * ```ts
 * // vitest.setup.ts
 * import '@directive-run/timeline/matchers';
 * ```
 */
// Type augmentation for vitest's `expect()` is not exported by this
// module — vitest's `Assertion` interface has a generic-parameter
// shape that varies across versions, and getting a stable
// declare-module augmentation that compiles against 1.x / 2.x / 3.x
// without breakage is its own design problem. Runtime registration
// works; consumers who want typed `.toReachInMs()` etc. on
// `expect(timeline)` can add a local declaration:
//
// ```ts
// // vitest-matchers.d.ts in your project
// import 'vitest';
// declare module 'vitest' {
//   interface Assertion<T = unknown> {
//     toReachInMs(key: string, value: unknown, ms: number): void;
//     toFireConstraint(id: string, opts?: { times?: number; min?: number; max?: number }): void;
//     toMutate(kind: string): void;
//     toResolveWithinMs(name: string, ms: number): void;
//     toCascade(): void;
//   }
// }
// ```
//
// The direct API (`matchers.toReachInMs(timeline, ...)`) is fully
// typed and recommended when type safety matters. Runtime semantics
// are identical.

interface ExpectExtendShape {
  extend(matchers: Record<string, (...args: unknown[]) => MatcherResult>): void;
}

const matcherImpls = {
  toReachInMs,
  toFireConstraint,
  toMutate,
  toResolveWithinMs,
  toCascade,
};

// Register on load. Importing this file is the only thing a consumer
// needs to do — no manual `expect.extend` call.
//
// The side-effect path used to fail silently if the runtime didn't expose
// `globalThis.__vitest_expect`, which made "matchers don't seem to be
// installed" indistinguishable from "I forgot to import the module."
// We now emit a loud warning that points at `registerMatchers(expect)`,
// so a misconfigured setup file fails noisily during the first test run
// instead of producing cryptic `toReachInMs is not a function` errors.
const REGISTRATION_HINT =
  "[Directive timeline] matchers were not auto-registered – call `registerMatchers(expect)` from your vitest.setup.ts, or import this module from a context where vitest's expect is exposed on globalThis.";

let autoRegistered = false;
try {
  const vitestModule = (globalThis as { __vitest_expect?: unknown })
    .__vitest_expect;
  if (vitestModule !== undefined) {
    (vitestModule as ExpectExtendShape).extend(
      matcherImpls as unknown as Record<
        string,
        (...args: unknown[]) => MatcherResult
      >,
    );
    autoRegistered = true;
  } else if (typeof globalThis !== "undefined") {
    console.warn(REGISTRATION_HINT);
  }
} catch (err) {
  // Bubble the error up via console.warn so the test author sees both the
  // hint and the underlying failure (e.g. vitest internals changed shape).
  console.warn(REGISTRATION_HINT, err);
}

/**
 * Whether the side-effect auto-registration found `vitest`'s expect on
 * `globalThis` and succeeded. Exposed for tests that want to assert the
 * registration ran, and for `registerMatchers` to suppress the duplicate
 * warning when the explicit path is taken.
 */
export function isAutoRegistered(): boolean {
  return autoRegistered;
}

/**
 * Explicit registration, for environments where the side-effect-on-import
 * path doesn't reach vitest's expect. Pass the imported `expect` from
 * vitest.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest';
 * import { registerMatchers } from '@directive-run/timeline/matchers';
 * registerMatchers(expect);
 * ```
 */
export function registerMatchers(expectFn: ExpectExtendShape): void {
  expectFn.extend(
    matcherImpls as unknown as Record<
      string,
      (...args: unknown[]) => MatcherResult
    >,
  );
  // Flip the flag so a subsequent re-import of this module doesn't print
  // a misleading auto-register warning.
  autoRegistered = true;
}

// Re-export the impls so consumers can call them directly without
// vitest if they want (e.g. inside a custom assertion library).
export const matchers = {
  toReachInMs,
  toFireConstraint,
  toMutate,
  toResolveWithinMs,
  toCascade,
};
