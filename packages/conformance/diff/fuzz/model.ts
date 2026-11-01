/**
 * Random small systems for the differential fuzzer.
 *
 * A `FuzzSpec` is plain data (so a failing case prints, shrinks and replays)
 * describing one or two modules — numeric facts and a Date fact,
 * derivations over facts and earlier derivations (some throw), events,
 * constraint → resolver pairs with delays, failures, retries, timeouts and
 * self-retracting writes, effects (auto-tracked or with deps, some with a
 * cleanup, some throwing), an optional source with an `active` gate, and
 * system options (error boundary with every strategy including "throw",
 * history, trace) — plus a sequence of steps that also stop, start and
 * destroy the system mid-run, snapshot and restore, navigate history,
 * batch writes, write Dates twice, publish from the source, and start a
 * second system in the same engine instance.
 *
 * Every feature carries the layer that builds it (the plan's ladder,
 * `FEATURE_LAYERS`); `specLayer()` is the highest one a case uses, so a v2
 * run compares only the cases its `current` layer covers. Left alone, almost
 * every case uses something above `current`, so `specArbitrary({ ceiling })`
 * leaves out every feature above the ceiling: the fuzzer adds a share of
 * cases generated at `current` (fuzz.test.ts) and v2 takes part in them.
 * `toScenario()` turns a spec into a ScenarioDef that builds the same system
 * on whichever engine runs it.
 */

import fc from "fast-check";
import { FUZZ_TRIGGERS, type FuzzTrigger } from "../../lib/fuzz.js";
import {
  type BuildContext,
  FUZZ_SCENARIO,
  type ScenarioDef,
  type Step,
} from "../scenario.js";

export interface FuzzDerivation {
  facts: number[];
  derived: number[];
  threshold: number | null;
  /** Throws when its sum equals this value. */
  throwsAt: number | null;
}

export interface FuzzConstraint {
  fact: number;
  atLeast: number;
  /** Module b only: also require module a's fact 0 to be at least this. */
  crossAtLeast: number | null;
  priority: number;
  writes: number;
  value: number;
  delay: number;
  fails: number;
  retry: number;
  timeout: number | null;
}

export interface FuzzEffect {
  reads: number[];
  explicitDeps: boolean;
  cleanup: boolean;
  /** Throws when the first fact it reads equals this value. */
  throwsAt: number | null;
}

export interface FuzzModule {
  facts: number;
  date: boolean;
  derivations: FuzzDerivation[];
  events: Array<{ target: number; add: boolean }>;
  constraints: FuzzConstraint[];
  effects: FuzzEffect[];
  source: { gated: boolean } | null;
}

export type FuzzStep =
  | { op: "dispatch"; module: number; event: number; value: number }
  | { op: "set"; module: number; fact: number; value: number }
  | { op: "date"; module: number; ms: number }
  | { op: "batch"; module: number; writes: [number, number][] }
  | { op: "publish"; event: "own" | "unknown" | "cross"; value: number }
  | { op: "advance"; ms: number }
  | { op: "tick" }
  | { op: "settle" }
  | { op: "stop" }
  | { op: "start" }
  | { op: "destroy" }
  | { op: "snapshot" }
  | { op: "restore" }
  | { op: "back" }
  | { op: "forward" }
  | { op: "twin" };

export type Boundary = "skip" | "retry" | "retry-later" | "disable" | "throw";

export interface FuzzSpec {
  modules: FuzzModule[];
  boundary: Boundary | null;
  history: boolean;
  trace: boolean;
  steps: FuzzStep[];
}

/**
 * The layer (the plan's ladder) that builds each feature the generator can
 * use. `specLayer()` places a case by the highest one it uses and
 * `specArbitrary({ ceiling })` leaves out every feature above the ceiling;
 * both read this table, so a feature's layer is written down once. A feature
 * sits at the layer of the highest thing its generated code calls, as
 * lib/layers.ts places it (the self test pins the cases that were once wrong).
 */
export const FEATURE_LAYERS = {
  /** A second module: namespacing, wildcard events, crossModuleDeps. */
  modules: 1,
  /** Constraint and resolver pairs: delays, failures, retries, timeouts. */
  constraints: 2,
  /** An error boundary, with every strategy. */
  boundary: 3,
  /** The stop, start and destroy steps. */
  lifecycle: 3,
  /**
   * Effect cleanups. Basic effects (run, cleanup, auto-tracking) are L0 in
   * layers.rules.json (`notes.effects`); only deps, on and prev are L4.
   */
  effectCleanups: 0,
  /** Effects with explicit deps. */
  effectDeps: 4,
  /** An event source, and publishing from it. */
  sources: 5,
  /** The snapshot and restore steps (getSnapshot and restore are L6). */
  snapshots: 6,
  /** The twin step: it reads the second system's getSnapshot (L6). */
  twin: 6,
  /** The history option and the back and forward steps. */
  history: 8,
  /** The trace option. */
  trace: 9,
} as const;

type Feature = keyof typeof FEATURE_LAYERS;

/** The steps that need a feature beyond the L0 reads and writes. */
const STEP_FEATURES = {
  stop: "lifecycle",
  start: "lifecycle",
  destroy: "lifecycle",
  snapshot: "snapshots",
  restore: "snapshots",
  back: "history",
  forward: "history",
  twin: "twin",
} as const satisfies Partial<Record<FuzzStep["op"], Feature>>;

const layerNumber = (layer: string) => Number(layer.slice(1));

export interface SpecOptions {
  /**
   * The highest layer a case may use ("L1"): every feature built above it is
   * left out. Omitted, all of them are in play. With a ceiling at or above
   * the highest feature, the arbitrary is the one with no ceiling.
   */
  ceiling?: string;
}

const value = fc.integer({ min: -2, max: 6 });

function moduleArbitrary(
  cross: boolean,
  allows: (feature: Feature) => boolean,
): fc.Arbitrary<FuzzModule> {
  return fc.integer({ min: 1, max: 3 }).chain((facts) => {
    const fact = fc.integer({ min: 0, max: facts - 1 });
    const factSet = fc.uniqueArray(fact, { minLength: 1, maxLength: facts });
    const flag = (feature: Feature) =>
      allows(feature) ? fc.boolean() : fc.constant(false);

    return fc.record({
      facts: fc.constant(facts),
      date: fc.boolean(),
      derivations: fc
        .array(
          fc.record({
            facts: factSet,
            derivedSeed: fc.array(fc.nat(), { maxLength: 2 }),
            threshold: fc.option(value, { nil: null }),
            throwsAt: fc.option(fc.integer({ min: 3, max: 8 }), {
              nil: null,
              freq: 4,
            }),
          }),
          { maxLength: 3 },
        )
        .map((list) =>
          list.map((d, i) => ({
            facts: d.facts,
            derived:
              i === 0 ? [] : [...new Set(d.derivedSeed.map((n) => n % i))],
            threshold: d.threshold,
            throwsAt: d.throwsAt,
          })),
        ),
      events: fc.array(fc.record({ target: fact, add: fc.boolean() }), {
        minLength: 1,
        maxLength: 3,
      }),
      constraints: allows("constraints")
        ? fc.array(
            fc.record({
              fact,
              atLeast: fc.integer({ min: 0, max: 4 }),
              crossAtLeast: cross
                ? fc.option(fc.integer({ min: 0, max: 3 }), { nil: null })
                : fc.constant(null),
              priority: fc.integer({ min: 0, max: 3 }),
              writes: fact,
              value,
              delay: fc.constantFrom(0, 1, 5, 20),
              fails: fc.integer({ min: 0, max: 2 }),
              retry: fc.integer({ min: 0, max: 2 }),
              timeout: fc.option(fc.constantFrom(3, 10, 50), { nil: null }),
            }),
            { maxLength: 3 },
          )
        : fc.constant<FuzzConstraint[]>([]),
      effects: fc.array(
        fc.record({
          reads: factSet,
          explicitDeps: flag("effectDeps"),
          cleanup: flag("effectCleanups"),
          throwsAt: fc.option(fc.integer({ min: 3, max: 8 }), {
            nil: null,
            freq: 4,
          }),
        }),
        { maxLength: 2 },
      ),
      source: allows("sources")
        ? fc.option(fc.record({ gated: fc.boolean() }), {
            nil: null,
            freq: 2,
          })
        : fc.constant<FuzzModule["source"]>(null),
    });
  });
}

const stepArbitrary = (
  modules: number,
  allows: (feature: Feature) => boolean,
) => {
  const mod = fc.integer({ min: 0, max: modules - 1 });
  // Publishing needs a source, and the other ops each need a feature.
  const ops = (
    [
      "stop",
      "start",
      "destroy",
      "snapshot",
      "restore",
      "back",
      "forward",
      "twin",
    ] as const
  ).filter((op) => allows(STEP_FEATURES[op]));

  return fc.oneof(
    {
      weight: 4,
      arbitrary: fc.record({
        op: fc.constant("dispatch" as const),
        module: mod,
        event: fc.nat(),
        value,
      }),
    },
    {
      weight: 5,
      arbitrary: fc.record({
        op: fc.constant("set" as const),
        module: mod,
        fact: fc.nat(),
        value,
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        op: fc.constant("date" as const),
        module: mod,
        ms: fc.integer({ min: 0, max: 3 }),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        op: fc.constant("batch" as const),
        module: mod,
        writes: fc.array(fc.tuple(fc.nat(), value), {
          minLength: 1,
          maxLength: 3,
        }),
      }),
    },
    ...(allows("sources")
      ? [
          {
            weight: 2,
            arbitrary: fc.record({
              op: fc.constant("publish" as const),
              event: fc.constantFrom(
                "own" as const,
                "unknown" as const,
                "cross" as const,
              ),
              value,
            }),
          },
        ]
      : []),
    {
      weight: 3,
      arbitrary: fc.record({
        op: fc.constant("advance" as const),
        ms: fc.constantFrom(1, 5, 25, 200, 1500),
      }),
    },
    { weight: 2, arbitrary: fc.record({ op: fc.constant("tick" as const) }) },
    { weight: 3, arbitrary: fc.record({ op: fc.constant("settle" as const) }) },
    ...(ops.length > 0
      ? [
          {
            weight: 1,
            arbitrary: fc.record({ op: fc.constantFrom(...ops) }),
          },
        ]
      : []),
  ) as fc.Arbitrary<FuzzStep>;
};

export function specArbitrary(
  options: SpecOptions = {},
): fc.Arbitrary<FuzzSpec> {
  const { ceiling } = options;
  if (ceiling !== undefined && !/^L\d+$/.test(ceiling)) {
    throw new Error(`specArbitrary: ceiling "${ceiling}" is not a layer (L0…)`);
  }
  const top =
    ceiling === undefined ? Number.POSITIVE_INFINITY : layerNumber(ceiling);
  const allows = (feature: Feature) => FEATURE_LAYERS[feature] <= top;

  return fc.integer({ min: 1, max: allows("modules") ? 2 : 1 }).chain((count) =>
    fc.record({
      modules: fc.tuple(
        ...Array.from({ length: count }, (_, i) =>
          moduleArbitrary(i === 1, allows),
        ),
      ),
      boundary: allows("boundary")
        ? fc.constantFrom(
            null,
            "skip" as const,
            "retry" as const,
            "retry-later" as const,
            "disable" as const,
            "throw" as const,
          )
        : fc.constant<Boundary | null>(null),
      history: allows("history") ? fc.boolean() : fc.constant(false),
      trace: allows("trace") ? fc.boolean() : fc.constant(false),
      steps: fc.array(stepArbitrary(count, allows), {
        minLength: 1,
        maxLength: 14,
      }),
    }),
  );
}

/** The highest layer (the plan's ladder) a case uses. */
export function specLayer(spec: FuzzSpec): string {
  let n = 0;
  const use = (feature: Feature) => {
    n = Math.max(n, FEATURE_LAYERS[feature]);
  };
  if (spec.modules.length > 1) {
    use("modules");
  }
  for (const m of spec.modules) {
    if (m.constraints.length > 0) {
      use("constraints");
    }
    if (m.effects.some((e) => e.cleanup)) {
      use("effectCleanups");
    }
    if (m.effects.some((e) => e.explicitDeps)) {
      use("effectDeps");
    }
    if (m.source) {
      use("sources");
    }
  }
  if (spec.boundary) {
    use("boundary");
  }
  if (spec.trace) {
    use("trace");
  }
  if (spec.history) {
    use("history");
  }
  for (const s of spec.steps) {
    if (s.op in STEP_FEATURES) {
      use(STEP_FEATURES[s.op as keyof typeof STEP_FEATURES]);
    }
  }

  return `L${n}`;
}

const f = (i: number) => `f${i}`;

/**
 * Whether an abort's reason is the error a resolver's `timeout` rejects
 * with: `Resolver "<id>" timed out after <ms>ms`, the same message on every
 * engine.
 */
const TIMED_OUT = /^Resolver ".*" timed out after \d+ms$/;
const isTimeoutError = (reason: unknown): boolean => {
  const message = (reason as { message?: unknown } | null)?.message;

  return typeof message === "string" && TIMED_OUT.test(message);
};
const NAMES = ["a", "b"];

function moduleDef(
  { core: { createModule, t }, external, handles }: BuildContext,
  m: FuzzModule,
  index: number,
  schemas: Record<string, unknown>[],
) {
  const id = NAMES[index] as string;
  const cross = index === 1;
  // With crossModuleDeps, a module's own facts sit under `self` in
  // derivations, constraints and effects.
  const own = (fs: any) => (cross ? fs.self : fs);
  const facts: Record<string, unknown> = {};
  for (let i = 0; i < m.facts; i++) {
    facts[f(i)] = t.number();
  }
  if (m.date) {
    facts.when = t.date();
  }
  const derivations: Record<string, unknown> = {};
  const derive: Record<string, unknown> = {};
  m.derivations.forEach((d, i) => {
    derivations[`d${i}`] = d.threshold === null ? t.number() : t.boolean();
    derive[`d${i}`] = (fs: any, derived: any) => {
      let sum = 0;
      for (const k of d.facts) {
        sum += own(fs)[f(k)];
      }
      for (const k of d.derived) {
        const v = derived[`d${k}`];
        sum += typeof v === "boolean" ? Number(v) : v;
      }
      if (d.throwsAt !== null && sum === d.throwsAt) {
        throw new Error(`${id}.d${i} throws at ${sum}`);
      }

      return d.threshold === null ? sum : sum > d.threshold;
    };
  });
  const eventSchema: Record<string, unknown> = {};
  const events: Record<string, unknown> = {};
  m.events.forEach((e, i) => {
    eventSchema[`e${i}`] = { v: t.number() };
    events[`e${i}`] = (fs: any, payload: any) => {
      fs[f(e.target)] = e.add ? fs[f(e.target)] + payload.v : payload.v;
    };
  });
  const requirements: Record<string, unknown> = {};
  const constraints: Record<string, unknown> = {};
  const resolvers: Record<string, unknown> = {};
  m.constraints.forEach((c, i) => {
    let attempt = 0;
    const type = `${id.toUpperCase()}${i}`;
    requirements[type] = {};
    constraints[`c${i}`] = {
      priority: c.priority,
      when: (fs: any) =>
        own(fs)[f(c.fact)] >= c.atLeast &&
        (c.crossAtLeast === null || fs.a.f0 >= c.crossAtLeast),
      require: { type },
    };
    resolvers[`r${i}`] = {
      requirement: type,
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
        // Starts, writes and aborts are each recorded under their own kind
        // ("start", "wrote", "aborted"; the resolver's tag is data[1]), the
        // same on every engine, so the comparison pairs a start only with a
        // start, and an entry's kind does not depend on which resolver
        // (`<module>.r<index>`) a case happens to have. An abort whose
        // reason is the resolver's timeout error is a "timeout" instead:
        // 1.35 never aborts a signal on a timeout, 2.0 does (row n), and
        // under one kind the comparison paired 2.0's early timeout abort
        // with 1.35's later cancel-time abort of the same attempt, moving
        // every other run's record between the two.
        external(["start", `${id}.r${i}`, n]);
        context.signal?.addEventListener?.("abort", () =>
          external([
            isTimeoutError(context.signal.reason) ? "timeout" : "aborted",
            `${id}.r${i}`,
            n,
          ]),
        );
        if (c.delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, c.delay));
        }
        if (n <= c.fails) {
          throw new Error(`${id}.r${i} attempt ${n}`);
        }
        context.facts[f(c.writes)] = c.value;
        external(["wrote", `${id}.r${i}`, n]);
      },
    };
  });
  const effects: Record<string, unknown> = {};
  m.effects.forEach((e, i) => {
    effects[`x${i}`] = {
      ...(e.explicitDeps ? { deps: e.reads.map(f) } : {}),
      run: (fs: any) => {
        const seen = e.reads.map((k) => own(fs)[f(k)]);
        // An effect's run and its cleanup are recorded under their own kind
        // ("effect", "cleanup"; the effect's tag is data[1]), the same on
        // every engine, as resolver records are: under one kind per effect
        // tag, a quirk that adds runs (row p) needed an entry per tag.
        external(["effect", `${id}.x${i}`, seen]);
        if (e.throwsAt !== null && seen[0] === e.throwsAt) {
          throw new Error(`${id}.x${i} throws at ${seen[0]}`);
        }
        if (e.cleanup) {
          return () => external(["cleanup", `${id}.x${i}`, seen]);
        }

        return undefined;
      },
    };
  });
  const sources: Record<string, unknown> = {};
  if (m.source) {
    sources.feed = {
      ...(m.source.gated ? { active: (fs: any) => fs.f0 >= 1 } : {}),
      attach: (publish: any, reportError: any) => {
        handles.publish = publish;
        handles.reportError = reportError;
        external([`${id}.feed`, "attach"]);

        return () => external([`${id}.feed`, "detach"]);
      },
    };
  }
  const schema = {
    facts,
    derivations,
    events: eventSchema,
    requirements,
  };
  schemas[index] = schema;

  return createModule(id, {
    schema,
    ...(cross ? { crossModuleDeps: { a: schemas[0] } } : {}),
    init: (fs: any) => {
      for (let i = 0; i < m.facts; i++) {
        fs[f(i)] = 0;
      }
      if (m.date) {
        fs.when = new Date(0);
      }
    },
    derive,
    events,
    constraints,
    resolvers,
    effects,
    sources,
  } as any);
}

/**
 * A strategy the model passes in `errorBoundary`. Only a string can be read
 * here: a function strategy (which the model never passes) would need its
 * own trigger rule, so it is an error, never a guess.
 */
function strategy(value: unknown): string | undefined {
  if (typeof value === "function") {
    throw new Error(
      "specTriggers: a function error strategy cannot be read from the spec; define its trigger first",
    );
  }

  return value as string | undefined;
}

/**
 * Each trigger a fuzz case can have (lib/fuzz.ts `FUZZ_TRIGGERS`), as a test
 * of its spec. A fuzz divergence with `when` applies only to the cases that
 * have every trigger it lists (diff/scenario.ts `covers`), so each one is the
 * spec feature its quirk needs, read from the options the case really passes
 * (`options()`), never wider. Every resolver belongs to one constraint.
 */
const TRIGGERS = {
  /** `onResolverError` is "retry", and the case has a resolver. */
  resolverRetry: (spec, boundary) =>
    hasConstraint(spec) && strategy(boundary?.onResolverError) === "retry",
  /** `onResolverError` is "retry-later", and the case has a resolver. */
  resolverRetryLater: (spec, boundary) =>
    hasConstraint(spec) &&
    strategy(boundary?.onResolverError) === "retry-later",
  /**
   * `onConstraintError` is "retry-later", and the case has a constraint.
   * Never set today: the model always passes "skip" (its constraints never
   * throw), so an entry that lists it applies to no case.
   */
  constraintRetryLater: (spec, boundary) =>
    hasConstraint(spec) &&
    strategy(boundary?.onConstraintError) === "retry-later",
  /** Some resolver has a retry policy (`retry` > 0: more than one attempt). */
  retryPolicy: (spec) =>
    spec.modules.some((m) => m.constraints.some((c) => c.retry > 0)),
  /** Some resolver has a timeout. */
  timeout: (spec) =>
    spec.modules.some((m) => m.constraints.some((c) => c.timeout !== null)),
  /**
   * Some resolver can reject: it throws on its first `fails` attempts
   * (`fails` > 0), or it has a timeout no longer than its wait (`delay`), so
   * the timeout can fire before it writes. A resolver's outcome can be an
   * error only then, which row b needs (an error and a cancel for one run).
   */
  resolverRejects: (spec) =>
    spec.modules.some((m) =>
      m.constraints.some(
        (c) => c.fails > 0 || (c.timeout !== null && c.timeout <= c.delay),
      ),
    ),
  /**
   * A settle() can still be waiting when stop() or destroy() runs (row z):
   * the case has a resolver. A settle step's settle() is left waiting only
   * when its drive gives up (500 timer jumps, diff/scenario.ts `drive`)
   * while a run is in flight or re-dispatched, and a stop or destroy always
   * follows a settle step: every case ends with one, then the teardown's
   * destroy(). So the spec cannot narrow this further than "has a resolver".
   */
  settleStop: (spec) => hasConstraint(spec),
  /**
   * The steps have a `stop` step and, later, a `start` step with no
   * `destroy` step between them. A destroyed system is never restarted
   * (1.35 ignores start() after destroy), so a `destroy` before the stop
   * rules it out too.
   */
  restart: (spec) => {
    let stopped = false;
    for (const s of spec.steps) {
      if (s.op === "destroy") {
        return false;
      }
      if (s.op === "stop") {
        stopped = true;
      } else if (s.op === "start" && stopped) {
        return true;
      }
    }

    return false;
  },
  /**
   * Some error-boundary strategy is "disable" and the case has what it
   * applies to (`hasTarget`): a resolver or an effect, as the model passes
   * it to both.
   */
  disable: (spec, boundary) => usesStrategy(spec, boundary, "disable"),
  /**
   * Some error-boundary strategy is "throw" and the case has what it applies
   * to (resolvers; the model passes "skip" to effects then).
   */
  throw: (spec, boundary) => usesStrategy(spec, boundary, "throw"),
} satisfies Record<
  FuzzTrigger,
  (spec: FuzzSpec, boundary: Record<string, unknown> | undefined) => boolean
>;

function hasConstraint(spec: FuzzSpec): boolean {
  return spec.modules.some((m) => m.constraints.length > 0);
}

/**
 * Whether the case has anything an error-boundary key applies to. Every
 * resolver belongs to one constraint, so a resolver exists when a
 * constraint does. A key this table does not know throws rather than guess.
 */
function hasTarget(spec: FuzzSpec, key: string): boolean {
  switch (key) {
    case "onResolverError":
    case "onConstraintError":
      return hasConstraint(spec);
    case "onEffectError":
      return spec.modules.some((m) => m.effects.length > 0);
    case "onDerivationError":
      return spec.modules.some((m) => m.derivations.length > 0);
    default:
      throw new Error(
        `specTriggers: no target is known for the error-boundary key ${key}; add it to hasTarget first`,
      );
  }
}

/** Some strategy is `name` and the case has what that strategy applies to. */
function usesStrategy(
  spec: FuzzSpec,
  boundary: Record<string, unknown> | undefined,
  name: "disable" | "throw",
): boolean {
  return Object.entries(boundary ?? {}).some(
    ([key, value]) => strategy(value) === name && hasTarget(spec, key),
  );
}

/** The triggers a case has (`TRIGGERS` above), in `FUZZ_TRIGGERS` order. */
export function specTriggers(spec: FuzzSpec): FuzzTrigger[] {
  const boundary = (
    options(spec) as { errorBoundary?: Record<string, unknown> }
  ).errorBoundary;
  // retryLater is the retry-later settings, not a strategy.
  const strategies =
    boundary === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(boundary).filter(([key]) => key !== "retryLater"),
        );

  return FUZZ_TRIGGERS.filter((name) => TRIGGERS[name](spec, strategies));
}

function options(spec: FuzzSpec) {
  return {
    ...(spec.boundary === null
      ? {}
      : {
          errorBoundary: {
            onResolverError: spec.boundary,
            onEffectError: spec.boundary === "throw" ? "skip" : spec.boundary,
            onConstraintError: "skip",
            onDerivationError: "skip",
            retryLater: { delayMs: 50, maxRetries: 2 },
          },
        }),
    ...(spec.history ? { history: { maxSnapshots: 20 } } : {}),
    ...(spec.trace ? { trace: true } : {}),
  };
}

function build(spec: FuzzSpec) {
  return (ctx: BuildContext) => {
    const schemas: Record<string, unknown>[] = [];
    const defs = spec.modules.map((m, i) => moduleDef(ctx, m, i, schemas));
    ctx.handles.rebuild = () => {
      const again: Record<string, unknown>[] = [];
      const more = spec.modules.map((m, i) => moduleDef(ctx, m, i, again));

      return more.length === 1
        ? { module: more[0], ...options(spec) }
        : { modules: { a: more[0], b: more[1] }, ...options(spec) };
    };

    return defs.length === 1
      ? { module: defs[0], ...options(spec) }
      : { modules: { a: defs[0], b: defs[1] }, ...options(spec) };
  };
}

function steps(spec: FuzzSpec): Step[] {
  const multi = spec.modules.length > 1;
  const mod = (i: number) =>
    spec.modules[i % spec.modules.length] as FuzzModule;
  const facts = (system: any, i: number) =>
    multi
      ? system.facts[NAMES[i % spec.modules.length] as string]
      : system.facts;
  const out: Step[] = [{ op: "start" }];
  for (const s of spec.steps) {
    const label = JSON.stringify(s);
    switch (s.op) {
      case "dispatch": {
        const m = mod(s.module);
        const name = `e${s.event % m.events.length}`;
        out.push({
          op: "run",
          label,
          fn: (system) =>
            multi
              ? system.events[NAMES[s.module % 2] as string][name]({
                  v: s.value,
                })
              : system.dispatch({ type: name, v: s.value }),
        });
        break;
      }
      case "set":
        out.push({
          op: "run",
          label,
          fn: (system) => {
            facts(system, s.module)[f(s.fact % mod(s.module).facts)] = s.value;
          },
        });
        break;
      case "date":
        out.push({
          op: "run",
          label,
          fn: (system) => {
            if (mod(s.module).date) {
              facts(system, s.module).when = new Date(s.ms);
            }
          },
        });
        break;
      case "batch":
        out.push({
          op: "run",
          label,
          fn: (system) =>
            system.batch(() => {
              for (const [k, v] of s.writes) {
                facts(system, s.module)[f(k % mod(s.module).facts)] = v;
              }
            }),
        });
        break;
      case "publish":
        out.push({
          op: "run",
          label,
          fn: (_system, ctx) => {
            const publish = ctx.handles.publish;
            if (!publish) {
              return;
            }
            if (s.event === "own") {
              publish("e0", { v: s.value });
            } else if (s.event === "unknown") {
              publish("nope");
            } else {
              publish("b::e0", { v: s.value });
            }
          },
        });
        break;
      case "advance":
        out.push({ op: "advance", ms: s.ms });
        break;
      case "snapshot":
        out.push({
          op: "run",
          label,
          fn: (system, ctx) => {
            ctx.handles.snapshot = system.getSnapshot();
          },
        });
        break;
      case "restore":
        out.push({
          op: "run",
          label,
          fn: (system, ctx) => {
            // Restore what the last snapshot step captured, if any.
            if (ctx.handles.snapshot) {
              system.restore(ctx.handles.snapshot);
            }
          },
        });
        break;
      case "back":
      case "forward":
        out.push({
          op: "run",
          label,
          fn: (system) => {
            if (system.history) {
              s.op === "back"
                ? system.history.goBack()
                : system.history.goForward();
            }
          },
        });
        break;
      case "twin":
        out.push({
          op: "run",
          label,
          fn: async (_system, ctx) => {
            // A second system from the same definitions, in the same engine
            // instance: per-process state (warning dedupe) shows here.
            const twin = ctx.core.createSystem(
              ctx.handles.rebuild() as never,
            ) as any;
            twin.start();
            await twin.settle();
            ctx.external(["twin", twin.getSnapshot().facts]);
            twin.destroy();
          },
        });
        break;
      default:
        out.push({ op: s.op });
    }
  }
  out.push({ op: "settle" });

  return out;
}

export function toScenario(spec: FuzzSpec, name = FUZZ_SCENARIO): ScenarioDef {
  return {
    name,
    build: build(spec),
    steps: steps(spec),
    seed: 1,
    layer: specLayer(spec),
    triggers: specTriggers(spec),
  };
}
