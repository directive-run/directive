/**
 * Random small systems for the differential fuzzer.
 *
 * A `FuzzSpec` is plain data (so a failing case prints, shrinks and replays)
 * describing one module — numeric facts, derivations over facts and earlier
 * derivations, events, constraint → resolver pairs with delays, failures,
 * retries, timeouts and self-retracting writes, effects — plus a sequence of
 * steps. `toScenario()` turns it into a ScenarioDef that builds the same
 * module on whichever engine runs it.
 */

import fc from "fast-check";
import type { BuildContext, ScenarioDef, Step } from "../scenario.js";

export interface FuzzDerivation {
  /** Facts summed. */
  facts: number[];
  /** Earlier derivations added (by index, always lower than this one). */
  derived: number[];
  /** Compare the sum against this threshold instead of returning it. */
  threshold: number | null;
}

export interface FuzzConstraint {
  /** Active while fact `fact` is at least `atLeast`. */
  fact: number;
  atLeast: number;
  priority: number;
  /** The resolver writes `value` into fact `writes` (may be `fact`). */
  writes: number;
  value: number;
  delay: number;
  /** The first `fails` attempts throw. */
  fails: number;
  retry: number;
  timeout: number | null;
}

export interface FuzzEffect {
  reads: number[];
  /** Declare `deps` instead of auto-tracking. */
  explicitDeps: boolean;
}

export type FuzzStep =
  | { op: "dispatch"; event: number; value: number }
  | { op: "set"; fact: number; value: number }
  | { op: "advance"; ms: number }
  | { op: "tick" }
  | { op: "settle" };

export interface FuzzSpec {
  facts: number;
  derivations: FuzzDerivation[];
  /** Event i writes its payload into fact `target`, or adds it. */
  events: Array<{ target: number; add: boolean }>;
  constraints: FuzzConstraint[];
  effects: FuzzEffect[];
  boundary: "skip" | "retry" | "retry-later" | "disable" | null;
  steps: FuzzStep[];
}

const value = fc.integer({ min: -2, max: 6 });

export function specArbitrary(): fc.Arbitrary<FuzzSpec> {
  return fc.integer({ min: 1, max: 4 }).chain((facts) => {
    const fact = fc.integer({ min: 0, max: facts - 1 });
    const factSet = fc.uniqueArray(fact, { minLength: 1, maxLength: facts });

    return fc.record({
      facts: fc.constant(facts),
      derivations: fc
        .array(
          fc.record({
            facts: factSet,
            derivedSeed: fc.array(fc.nat(), { maxLength: 2 }),
            threshold: fc.option(value, { nil: null }),
          }),
          { maxLength: 3 },
        )
        .map((list) =>
          list.map((d, i) => ({
            facts: d.facts,
            derived:
              i === 0 ? [] : [...new Set(d.derivedSeed.map((n) => n % i))],
            threshold: d.threshold,
          })),
        ),
      events: fc.array(fc.record({ target: fact, add: fc.boolean() }), {
        minLength: 1,
        maxLength: 3,
      }),
      constraints: fc.array(
        fc.record({
          fact,
          atLeast: fc.integer({ min: 0, max: 4 }),
          priority: fc.integer({ min: 0, max: 3 }),
          writes: fact,
          value,
          delay: fc.constantFrom(0, 1, 5, 20),
          fails: fc.integer({ min: 0, max: 2 }),
          retry: fc.integer({ min: 0, max: 2 }),
          timeout: fc.option(fc.constantFrom(3, 10, 50), { nil: null }),
        }),
        { maxLength: 3 },
      ),
      effects: fc.array(
        fc.record({ reads: factSet, explicitDeps: fc.boolean() }),
        { maxLength: 2 },
      ),
      boundary: fc.constantFrom(
        null,
        "skip" as const,
        "retry" as const,
        "retry-later" as const,
        "disable" as const,
      ),
      steps: fc.array(
        fc.oneof(
          fc.record({
            op: fc.constant("dispatch" as const),
            event: fc.nat(),
            value,
          }),
          fc.record({ op: fc.constant("set" as const), fact, value }),
          fc.record({
            op: fc.constant("advance" as const),
            ms: fc.constantFrom(1, 5, 25, 200),
          }),
          fc.record({ op: fc.constant("tick" as const) }),
          fc.record({ op: fc.constant("settle" as const) }),
        ),
        { minLength: 1, maxLength: 12 },
      ),
    });
  });
}

const f = (i: number) => `f${i}`;

function build(spec: FuzzSpec) {
  return ({ core: { createModule, t }, external }: BuildContext) => {
    const facts: Record<string, unknown> = {};
    for (let i = 0; i < spec.facts; i++) {
      facts[f(i)] = t.number();
    }
    const derivations: Record<string, unknown> = {};
    const derive: Record<string, unknown> = {};
    spec.derivations.forEach((d, i) => {
      derivations[`d${i}`] = d.threshold === null ? t.number() : t.boolean();
      derive[`d${i}`] = (fs: any, derived: any) => {
        let sum = 0;
        for (const k of d.facts) {
          sum += fs[f(k)];
        }
        for (const k of d.derived) {
          const v = derived[`d${k}`];
          sum += typeof v === "boolean" ? Number(v) : v;
        }

        return d.threshold === null ? sum : sum > d.threshold;
      };
    });
    const eventSchema: Record<string, unknown> = {};
    const events: Record<string, unknown> = {};
    spec.events.forEach((e, i) => {
      eventSchema[`e${i}`] = { v: t.number() };
      events[`e${i}`] = (fs: any, payload: any) => {
        fs[f(e.target)] = e.add ? fs[f(e.target)] + payload.v : payload.v;
      };
    });
    const requirements: Record<string, unknown> = {};
    const constraints: Record<string, unknown> = {};
    const resolvers: Record<string, unknown> = {};
    spec.constraints.forEach((c, i) => {
      let attempt = 0;
      requirements[`R${i}`] = {};
      constraints[`c${i}`] = {
        priority: c.priority,
        when: (fs: any) => fs[f(c.fact)] >= c.atLeast,
        require: { type: `R${i}` },
      };
      resolvers[`r${i}`] = {
        requirement: `R${i}`,
        ...(c.retry > 0
          ? {
              retry: {
                attempts: c.retry + 1,
                backoff: "linear",
                initialDelay: 2,
              },
            }
          : {}),
        ...(c.timeout === null ? {} : { timeout: c.timeout }),
        resolve: async (_req: unknown, context: any) => {
          attempt += 1;
          const n = attempt;
          external(["r", i, "start", n]);
          if (c.delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, c.delay));
          }
          if (n <= c.fails) {
            throw new Error(`r${i} attempt ${n}`);
          }
          context.facts[f(c.writes)] = c.value;
          external(["r", i, "wrote", n]);
        },
      };
    });
    const effects: Record<string, unknown> = {};
    spec.effects.forEach((e, i) => {
      effects[`x${i}`] = {
        ...(e.explicitDeps ? { deps: e.reads.map(f) } : {}),
        run: (fs: any) => external(["x", i, e.reads.map((k) => fs[f(k)])]),
      };
    });

    return {
      module: createModule("fz", {
        schema: {
          facts,
          derivations,
          events: eventSchema,
          requirements,
        },
        init: (fs: any) => {
          for (let i = 0; i < spec.facts; i++) {
            fs[f(i)] = 0;
          }
        },
        derive,
        events,
        constraints,
        resolvers,
        effects,
      } as any),
      ...(spec.boundary === null
        ? {}
        : {
            errorBoundary: {
              onResolverError: spec.boundary,
              onEffectError: "skip",
              onConstraintError: "skip",
              onDerivationError: "skip",
              retryLater: { delayMs: 50, maxRetries: 2 },
            },
          }),
    };
  };
}

function steps(spec: FuzzSpec): Step[] {
  const out: Step[] = [{ op: "start" }];
  for (const s of spec.steps) {
    switch (s.op) {
      case "dispatch":
        out.push({
          op: "dispatch",
          event: { type: `e${s.event % spec.events.length}`, v: s.value },
        });
        break;
      case "set":
        out.push({ op: "set", key: f(s.fact), value: s.value });
        break;
      case "advance":
        out.push({ op: "advance", ms: s.ms });
        break;
      default:
        out.push({ op: s.op });
    }
  }
  out.push({ op: "settle" });

  return out;
}

export function toScenario(spec: FuzzSpec, name = "fuzz"): ScenarioDef {
  return { name, build: build(spec), steps: steps(spec), seed: 1 };
}
