/**
 * Random small systems for the differential fuzzer.
 *
 * A `FuzzSpec` is plain data (so a failing case prints, shrinks and replays)
 * describing one or two modules — numeric facts and a Date fact,
 * derivations over facts and earlier derivations (some throw), events,
 * constraint → resolver pairs with delays, failures, retries, timeouts and
 * self-retracting writes, effects (auto-tracked or with deps, some with a
 * cleanup, some throwing), an optional source with an `active` gate, an
 * optional batched resolver fed by one or two constraints, and
 * system options (error boundary with every strategy including "throw",
 * history, trace) — plus a sequence of steps that also stop, start and
 * destroy the system mid-run, snapshot and restore, navigate history,
 * batch writes, write Dates twice, publish from the source, and start a
 * second system in the same engine instance. A case with history (L8) also
 * draws, after everything else, the history steps of the L8 RFC's reach
 * table (`HistoryStep`: back and forward by one to three steps, goTo,
 * replay, an export and import round trip, changesets, pause and resume),
 * `maxSnapshots`, `respectsAbort`, a module's `snapshotEvents` and an
 * effect's `onNavigate: "skip"`, and records the history's state after each
 * history step (`historyRecord`).
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
  type AnySystem,
  type BuildContext,
  FUZZ_SCENARIO,
  type ScenarioDef,
  type SettleDrain,
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
  /**
   * L8, history cases only: `onNavigate: "skip"`, so a navigation that
   * restores a fact the effect reads does not run it again (the RFC's N6).
   * Absent, the effect re-runs (1.35's default "rerun").
   */
  onNavigate?: "skip";
}

export interface FuzzModule {
  facts: number;
  date: boolean;
  derivations: FuzzDerivation[];
  events: Array<{ target: number; add: boolean }>;
  constraints: FuzzConstraint[];
  effects: FuzzEffect[];
  source: { gated: boolean } | null;
  /**
   * L8, history cases only: the module's `history.snapshotEvents`, by event
   * index, so only those events take a snapshot; a direct write always does
   * (the RFC's T2). Absent, every event does.
   */
  snapshotEvents?: number[];
  /**
   * L9, meta cases only (the L9 RFC's B1): each fact's `meta.tags`, by fact
   * index, drawn from `FUZZ_TAGS`; an empty list or a missing index is a
   * fact without meta. Absent, no fact has meta.
   */
  factTags?: FuzzTag[][];
  /**
   * L9, meta cases only: the derivations, by index, whose meta says
   * `tagBoundary: true`, so a tag stops there instead of being inherited.
   */
  boundaries?: number[];
}

/** The tags a meta case may put on a fact (L9). */
export const FUZZ_TAGS = ["pii", "billing"] as const;
export type FuzzTag = (typeof FUZZ_TAGS)[number];

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
  | HistoryStep
  | { op: "twin" }
  /**
   * L9: a `meta` record (`metaRecord`): `byTag` for each tag the case's
   * facts carry, and `carriesTag` for every id those rows name and every
   * fact and derivation of the first module.
   */
  | { op: "meta" }
  | DynamicStep;

/** The four registries a `define` step reaches (L10). */
export const DYNAMIC_KINDS = [
  "derive",
  "constraints",
  "resolvers",
  "effects",
] as const;
export type DynamicKind = (typeof DYNAMIC_KINDS)[number];

/**
 * The dynamic-definition steps (L10; the L10 RFC's "The fuzz, designed in
 * up front", B1 and harness rules 1 to 3).
 *
 * - `define`: `register`, `assign`, `unregister` or `call` on one registry,
 *   with the id drawn from a pool of four per kind (`dynamicId`): module
 *   a's two static ids and two dynamic ones (rule 1), so refusals (D2, D3)
 *   happen as often as success. `variant` picks the definition
 *   (`dynamicDef`). `deferred` makes the call from inside a pass instead,
 *   through module a's `zq` effect (D5, the queue).
 * - `inflight`: register a constraint and a 30 ms resolver, let the
 *   resolver start, and unregister the constraint `at` ms later (K4, U9a);
 *   `bound` gives the constraint an `abortOn` (U9b).
 * - `module`: `registerModule` or `unregisterModule` of a second module
 *   `z` (M1 to M7), single-module or namespaced as the case is, with a
 *   resolver that runs while it is retired.
 */
export type DynamicStep =
  | {
      op: "define";
      action: "register" | "assign" | "unregister" | "call";
      kind: DynamicKind;
      id: number;
      variant: number;
      deferred: boolean;
    }
  | { op: "inflight"; bound: boolean; at: 1 | 5 }
  | { op: "module"; action: "register" | "unregister"; variant: number };

/** The L10 step ops, for `withoutDynamic` and the reach tests. */
export const DYNAMIC_OPS = ["define", "inflight", "module"] as const;

/**
 * The history steps (L8; the RFC's "The fuzz, designed in up front"). Each
 * calls the 1.35 `HistoryAPI` the way the RFC's probes do, and is followed
 * by a `history` record (`historyRecord`). `back` and `forward` without
 * `steps` (a spec written before L8-pre) call `goBack()` and `goForward()`.
 * `goTo` picks the snapshot at `position` (modulo the list's length) in the
 * list each engine holds when the step runs, so the id is read on each
 * engine. `roundtrip` exports the history and imports it into the same
 * system. `begin` and `end` open and close a changeset.
 */
export type HistoryStep =
  | { op: "back"; steps?: number }
  | { op: "forward"; steps?: number }
  | { op: "goTo"; position: number }
  | { op: "replay" }
  | { op: "roundtrip" }
  | { op: "begin" }
  | { op: "end" }
  | { op: "pause" }
  | { op: "resume" };

/** The history step ops: each needs the history option, and each is L8. */
export const HISTORY_OPS = [
  "back",
  "forward",
  "goTo",
  "replay",
  "roundtrip",
  "begin",
  "end",
  "pause",
  "resume",
] as const satisfies readonly HistoryStep["op"][];

/** The history steps that restore a snapshot into the facts (`navigated`). */
const NAVIGATIONS: ReadonlySet<string> = new Set([
  "back",
  "forward",
  "goTo",
  "replay",
  "roundtrip",
]);

export type Boundary = "skip" | "retry" | "retry-later" | "disable" | "throw";

/**
 * One constraint that feeds the batched resolver. While its fact is at least
 * `atLeast` it raises one requirement per item: items 0 and 1 need the fact
 * at `atLeast`, so an active source of two or more items puts two into one
 * call (quirk i needs one item to fail and another to succeed), and item
 * `i` from 2 on needs `atLeast + i - 1`, so a falling fact retracts the
 * later items first and keeps the rest: a write can take one requirement
 * out of a running batch and leave its siblings wanted (quirk g). With
 * `abortOn`, the constraint binds its runs to the fact the handler writes.
 */
export interface FuzzBatchSource {
  fact: number;
  atLeast: number;
  items: number;
  abortOn: boolean;
}

/**
 * A batched resolver in the first module (L7). One or two sources raise its
 * requirements, so a batch can mix constraints (quirk k). `handler` picks
 * `resolveBatch`, `resolveBatchWithResults` (on a failing attempt, every
 * item fails, or every second one: quirks h and i) or the resolve()
 * fallback. Its first `fails` calls fail; it waits `delay`, then writes
 * `value` to fact `writes`. Fact indices wrap at the module's fact count.
 */
export interface FuzzBatch {
  sources: FuzzBatchSource[];
  handler: "batch" | "results" | "fallback";
  failing: "all" | "some";
  windowMs: number;
  maxSize: number | null;
  delay: number;
  fails: number;
  retry: number;
  timeout: number | null;
  writes: number;
  value: number;
}

export interface FuzzSpec {
  modules: FuzzModule[];
  boundary: Boundary | null;
  history: boolean;
  trace: boolean;
  steps: FuzzStep[];
  /**
   * Optional so that a spec written before L7 (diff/fuzz/pinned.json) still
   * reads as one with no batch. The generator draws it last, so every other
   * part of a seed's cases is drawn as before.
   */
  batch?: FuzzBatch | null;
  /**
   * L8, history cases only: the history option's `maxSnapshots`, drawn from
   * 3, 5 and 20 so the ring buffer drops snapshots (the RFC's T4, N10).
   * Absent (a spec written before L8-pre), 20.
   */
  maxSnapshots?: 3 | 5 | 20;
  /**
   * L8, history cases only (the RFC's rule 9): every resolver handler, the
   * batched one too, stops after its wait when its signal was aborted, and
   * writes nothing. Drawn true three times in four: with history on, a late
   * write is a snapshot, so the engines could differ in snapshot count for
   * a reason that has nothing to do with history. Absent or false, every
   * handler ignores its abort and writes late, as before L8-pre: the only way
   * the oracle tests the late-write rows (g), n and 2/352, so a case without
   * history never draws it.
   *
   * Drawn only where the engines' aborts agree (`abortsAgree`): never true in
   * a case with a resolver `timeout` (row n: 2.0 aborts a timed-out attempt's
   * signal, 1.35 never does) or a batched resolver (quirk g: 2.0 aborts
   * only the retracted requirement's signal, 1.35 the whole batch's). There a
   * respecting handler stops on 2.0 and writes late on 1.35, so everything
   * after that write would differ for a reason the late-write entries (which
   * list `ignoresAbort`) do not cover. Jason, 2026-11-14: "Obey only where
   * aborts agree (Recommended)". The draw is made as before and then set
   * false there, so no other part of a case moves.
   */
  respectsAbort?: boolean;
  /**
   * L9, trace cases only (the L9 RFC's B1): the trace option's `maxRuns`,
   * drawn from 1, 3 and 100 so the ring drops runs, a pending one too (R2,
   * R6). Absent (a spec written before L9-pre), the option is `true`.
   */
  maxRuns?: 1 | 3 | 100;
  /**
   * L10, dynamic cases only (the L10 RFC's B1): present when the case
   * draws dynamic-definition steps. Module a then gains the facts `zf` (the
   * deferred queue's trigger) and `zw` (what dynamic resolvers write), the
   * requirement DYN, and the effect `zq` that runs queued `define` steps
   * inside a pass. With `readers`, module a also gains the derivation `zin`
   * and the constraint `zgate`, which ask `"z0" in derived` before `z0` is
   * registered (I1). Absent (a spec written before L10-pre), none of it.
   */
  dynamic?: { readers: boolean };
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
  /** A batched resolver (`resolvers.<id>.batch` is L7 in lib/layers.ts). */
  batch: 7,
  /**
   * The history option and its steps (`HISTORY_OPS`), and the options drawn
   * only with it: `maxSnapshots`, `respectsAbort`, a module's
   * `snapshotEvents` and an effect's `onNavigate: "skip"`.
   */
  history: 8,
  /** The trace option, and `maxRuns`, drawn only with it. */
  trace: 9,
  /** Fact tags, `tagBoundary` derivations and the `meta` step. */
  meta: 9,
  /**
   * Dynamic definitions (L10): the `define`, `inflight` and `module` steps
   * and the `dynamic` spec field. Drawn after everything else
   * (`dynamicDraws`), so a case below L10 is the one L9-pre drew. L11's
   * draws, when they come, chain after these the same way.
   */
  dynamic: 10,
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
  goTo: "history",
  replay: "history",
  roundtrip: "history",
  begin: "history",
  end: "history",
  pause: "history",
  resume: "history",
  twin: "twin",
  meta: "meta",
  define: "dynamic",
  inflight: "dynamic",
  module: "dynamic",
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

  const drawn = fc
    .integer({ min: 1, max: allows("modules") ? 2 : 1 })
    .chain((count) =>
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
        // Drawn last, so the draws above are the ones a seed made before L7. A
        // third of the cases get one: each moves the case to L7, where v2
        // does not run it until `current` is L7.
        batch: allows("batch")
          ? fc.oneof(
              { weight: 2, arbitrary: fc.constant<FuzzBatch | null>(null) },
              { weight: 1, arbitrary: batchArbitrary },
            )
          : fc.constant<FuzzBatch | null>(null),
      }),
    );

  // Below L8 nothing is chained, so a case is drawn exactly as before
  // L8-pre. At L8 a case with history draws its history additions after
  // everything else (`historyDraws`), so the rest of it is drawn as before
  // too, and a case without history is the same case. At L9 the trace and
  // meta additions are drawn after those, the same way (`traceDraws`,
  // `metaDraws`): below L9 a case is the one L8-pre drew.
  const withHistory = allows("history")
    ? drawn.chain((spec) =>
        spec.history ? historyDraws(spec) : fc.constant(spec),
      )
    : drawn;
  const withTrace = allows("trace")
    ? withHistory.chain((spec) =>
        spec.trace ? traceDraws(spec) : fc.constant(spec),
      )
    : withHistory;

  const withMeta = allows("meta") ? withTrace.chain(metaDraws) : withTrace;

  // At L10 the dynamic additions are drawn last (`dynamicDraws`), so below
  // L10 a case is the one L9-pre drew, digest for digest
  // (diff/self/abort-draw.test.ts).
  return allows("dynamic") ? withMeta.chain(dynamicDraws) : withMeta;
}

/** One dynamic step (L10-pre; the RFC's reach table). */
const dynamicStep: fc.Arbitrary<DynamicStep> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      op: fc.constant("define" as const),
      action: fc.constantFrom(
        "register" as const,
        "assign" as const,
        "unregister" as const,
        "call" as const,
      ),
      kind: fc.constantFrom(...DYNAMIC_KINDS),
      id: fc.integer({ min: 0, max: 3 }),
      variant: fc.integer({ min: 0, max: 3 }),
      // One in four from inside a pass (D5).
      deferred: fc.oneof(
        { weight: 3, arbitrary: fc.constant(false) },
        { weight: 1, arbitrary: fc.constant(true) },
      ),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant("inflight" as const),
      bound: fc.boolean(),
      at: fc.constantFrom(1 as const, 5 as const),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant("module" as const),
      action: fc.constantFrom("register" as const, "unregister" as const),
      variant: fc.integer({ min: 0, max: 3 }),
    }),
  },
);

/**
 * What a dynamic case adds (L10-pre): one case in three draws one to six
 * dynamic steps, put in among its steps, and whether module a asks about
 * `z0` before it exists (`readers`). The other two in three are the case as
 * drawn without them.
 */
function dynamicDraws(spec: FuzzSpec): fc.Arbitrary<FuzzSpec> {
  const drawn = fc.record({
    readers: fc.boolean(),
    inserts: fc.array(fc.tuple(fc.nat(), dynamicStep), {
      minLength: 1,
      maxLength: 6,
    }),
  });

  return fc.oneof(
    { weight: 2, arbitrary: fc.constant(spec) },
    {
      weight: 1,
      arbitrary: drawn.map((d) => {
        const steps: FuzzStep[] = [...spec.steps];
        for (const [at, step] of d.inserts) {
          steps.splice(at % (steps.length + 1), 0, step);
        }

        return { ...spec, dynamic: { readers: d.readers }, steps };
      }),
    },
  );
}

/**
 * A drawn spec with no dynamic definitions: the `dynamic` field and the
 * dynamic steps taken out, so what is left is the case as drawn before
 * L10-pre (diff/self/abort-draw.test.ts).
 */
export function withoutDynamic(spec: FuzzSpec): FuzzSpec {
  const { dynamic: _dynamic, ...rest } = spec;

  return {
    ...rest,
    steps: spec.steps.filter(
      (s) => !(DYNAMIC_OPS as readonly string[]).includes(s.op),
    ),
  };
}

/** What a trace case adds (L9-pre; the RFC's reach table): `maxRuns`. */
function traceDraws(spec: FuzzSpec): fc.Arbitrary<FuzzSpec> {
  return fc
    .constantFrom(1 as const, 3 as const, 100 as const)
    .map((maxRuns) => ({ ...spec, maxRuns }));
}

/**
 * What a meta case adds (L9-pre; the RFC's reach table): one case in three
 * tags its facts (each fact none, one or both of `FUZZ_TAGS`), marks some
 * derivations `tagBoundary`, and puts one to three `meta` steps in among its
 * steps. The other two in three are the case as drawn without meta.
 */
function metaDraws(spec: FuzzSpec): fc.Arbitrary<FuzzSpec> {
  const tagged = fc.record({
    factTags: fc.tuple(
      ...spec.modules.map((m) =>
        fc.array(fc.subarray([...FUZZ_TAGS]), {
          minLength: m.facts,
          maxLength: m.facts,
        }),
      ),
    ),
    boundaries: fc.tuple(
      ...spec.modules.map((m) => fc.subarray(m.derivations.map((_, i) => i))),
    ),
    inserts: fc.array(fc.nat(), { minLength: 1, maxLength: 3 }),
  });

  return fc.oneof(
    { weight: 2, arbitrary: fc.constant(spec) },
    {
      weight: 1,
      arbitrary: tagged.map((d) => {
        const steps: FuzzStep[] = [...spec.steps];
        for (const at of d.inserts) {
          steps.splice(at % (steps.length + 1), 0, { op: "meta" });
        }

        return {
          ...spec,
          modules: spec.modules.map((m, i) => ({
            ...m,
            factTags: d.factTags[i] as FuzzTag[][],
            boundaries: d.boundaries[i] as number[],
          })),
          steps,
        };
      }),
    },
  );
}

/**
 * A drawn spec with no trace and no meta: the options, the steps and the
 * module fields drawn only with them taken out, so what is left is the case
 * as drawn before L9-pre (diff/self/tamper.test.ts).
 */
export function withoutIntrospection(spec: FuzzSpec): FuzzSpec {
  const { maxRuns: _runs, ...rest } = spec;

  return {
    ...rest,
    trace: false,
    modules: spec.modules.map(
      ({ factTags: _tags, boundaries: _bounds, ...m }) => m,
    ),
    steps: spec.steps.filter((s) => s.op !== "meta"),
  };
}

const navSteps = fc.integer({ min: 1, max: 3 });

const historyStep: fc.Arbitrary<HistoryStep> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      op: fc.constantFrom("back" as const, "forward" as const),
      steps: navSteps,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant("goTo" as const),
      position: fc.nat({ max: 5 }),
    }),
  },
  ...(["replay", "roundtrip", "begin", "end", "pause", "resume"] as const).map(
    (op) => ({ weight: 1, arbitrary: fc.record({ op: fc.constant(op) }) }),
  ),
) as fc.Arbitrary<HistoryStep>;

/** A minority draw: `rare` once in `1 + common` draws. */
const minority = <T>(common: T, rare: T, weight = 2) =>
  fc.oneof(
    { weight, arbitrary: fc.constant(common) },
    { weight: 1, arbitrary: fc.constant(rare) },
  );

/**
 * What a case with history adds (L8-pre; the RFC's reach table): `steps`
 * for each `back` and `forward` it drew, up to four more history steps put
 * in among its steps, `maxSnapshots`, `respectsAbort` (true only where
 * `abortsAgree`), a module's `snapshotEvents` and an effect's
 * `onNavigate: "skip"`.
 */
function historyDraws(spec: FuzzSpec): fc.Arbitrary<FuzzSpec> {
  const navs = spec.steps.filter(
    (s) => s.op === "back" || s.op === "forward",
  ).length;

  return fc
    .record({
      navSteps: fc.array(navSteps, { minLength: navs, maxLength: navs }),
      inserts: fc.array(fc.record({ at: fc.nat(), step: historyStep }), {
        maxLength: 4,
      }),
      maxSnapshots: fc.constantFrom(3 as const, 5 as const, 20 as const),
      respectsAbort: minority(true, false, 3),
      snapshotEvents: fc.tuple(
        ...spec.modules.map((m) =>
          fc.oneof(
            { weight: 2, arbitrary: fc.constant<number[] | null>(null) },
            {
              weight: 1,
              arbitrary: fc.uniqueArray(fc.nat({ max: m.events.length - 1 }), {
                maxLength: m.events.length,
              }),
            },
          ),
        ),
      ),
      skips: fc.tuple(
        ...spec.modules.map((m) =>
          fc.tuple(...m.effects.map(() => minority(false, true))),
        ),
      ),
    })
    .map((d) => {
      let nav = 0;
      const steps: FuzzStep[] = spec.steps.map((s) =>
        s.op === "back" || s.op === "forward"
          ? { op: s.op, steps: d.navSteps[nav++] as number }
          : s,
      );
      for (const { at, step } of d.inserts) {
        steps.splice(at % (steps.length + 1), 0, step);
      }

      return {
        ...spec,
        modules: spec.modules.map((m, i) => {
          const events = d.snapshotEvents[i] ?? null;

          return {
            ...m,
            effects: m.effects.map((e, j) =>
              d.skips[i]?.[j] ? { ...e, onNavigate: "skip" as const } : e,
            ),
            ...(events === null ? {} : { snapshotEvents: events }),
          };
        }),
        steps,
        maxSnapshots: d.maxSnapshots,
        // Drawn above exactly as before, then set false where the engines'
        // aborts differ, so the random stream and every other field of the
        // case are the ones a seed made before this rule.
        respectsAbort: d.respectsAbort && abortsAgree(spec),
      };
    });
}

/**
 * A drawn spec with no history: the option, its steps and the options drawn
 * only with it taken out, so what is left is the case as drawn before L8-pre
 * (diff/self/tamper.test.ts, the RFC's U16).
 */
export function withoutHistory(spec: FuzzSpec): FuzzSpec {
  const { maxSnapshots: _max, respectsAbort: _respects, ...rest } = spec;

  return {
    ...rest,
    history: false,
    modules: spec.modules.map(({ snapshotEvents: _events, ...m }) => ({
      ...m,
      effects: m.effects.map(({ onNavigate: _skip, ...e }) => e),
    })),
    steps: spec.steps.filter(
      (s) => !(HISTORY_OPS as readonly string[]).includes(s.op),
    ),
  };
}

const batchArbitrary: fc.Arbitrary<FuzzBatch> = fc.record({
  sources: fc.array(
    fc.record({
      fact: fc.nat({ max: 2 }),
      atLeast: fc.integer({ min: 0, max: 3 }),
      items: fc.integer({ min: 1, max: 3 }),
      abortOn: fc.boolean(),
    }),
    { minLength: 1, maxLength: 2 },
  ),
  handler: fc.constantFrom(
    "batch" as const,
    "results" as const,
    "fallback" as const,
  ),
  failing: fc.constantFrom("all" as const, "some" as const),
  windowMs: fc.constantFrom(0, 1, 5),
  maxSize: fc.option(fc.constantFrom(1, 2), { nil: null, freq: 3 }),
  delay: fc.constantFrom(0, 1, 5, 20),
  fails: fc.integer({ min: 0, max: 2 }),
  retry: fc.integer({ min: 0, max: 2 }),
  timeout: fc.option(fc.constantFrom(3, 10, 50), { nil: null, freq: 3 }),
  writes: fc.nat({ max: 2 }),
  value,
});

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
    if (
      m.snapshotEvents !== undefined ||
      m.effects.some((e) => e.onNavigate !== undefined)
    ) {
      use("history");
    }
    if (m.factTags !== undefined || m.boundaries !== undefined) {
      use("meta");
    }
  }
  if (spec.boundary) {
    use("boundary");
  }
  if (spec.trace || spec.maxRuns !== undefined) {
    use("trace");
  }
  if (
    spec.history ||
    spec.maxSnapshots !== undefined ||
    spec.respectsAbort !== undefined
  ) {
    use("history");
  }
  for (const s of spec.steps) {
    if (s.op in STEP_FEATURES) {
      use(STEP_FEATURES[s.op as keyof typeof STEP_FEATURES]);
    }
  }
  if (spec.batch) {
    use("batch");
  }
  if (spec.dynamic !== undefined) {
    use("dynamic");
  }

  return `L${n}`;
}

const f = (i: number) => `f${i}`;

/**
 * Whether an abort's reason is the error a resolver's `timeout` rejects
 * with: `Resolver "<id>" timed out after <ms>ms`, the same message on every
 * engine.
 */
const TIMED_OUT = /^(?:Batch r|R)esolver ".*" timed out after \d+ms$/;
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
  batch: FuzzBatch | null = null,
  respectsAbort = false,
  dynamic: FuzzSpec["dynamic"] = undefined,
) {
  const id = NAMES[index] as string;
  const cross = index === 1;
  // With crossModuleDeps, a module's own facts sit under `self` in
  // derivations, constraints and effects.
  const own = (fs: any) => (cross ? fs.self : fs);
  const facts: Record<string, unknown> = {};
  for (let i = 0; i < m.facts; i++) {
    const tags = m.factTags?.[i] ?? [];
    facts[f(i)] = tags.length > 0 ? t.number().meta({ tags }) : t.number();
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
  // L9: a `tagBoundary` derivation is the same compute, given as an object
  // with meta, so a tag it reads stops there.
  for (const i of m.boundaries ?? []) {
    if (derive[`d${i}`]) {
      derive[`d${i}`] = {
        compute: derive[`d${i}`],
        meta: { tagBoundary: true },
      };
    }
  }
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
          await ownDelay(ledgerOf(handles), c.delay);
        }
        // A handler that respects its abort (`respectsAbort`, the RFC's
        // rule 9) stops here, and writes nothing.
        if (respectsAbort && context.signal?.aborted === true) {
          return;
        }
        if (n <= c.fails) {
          throw new Error(`${id}.r${i} attempt ${n}`);
        }
        // A write while the run's signal is aborted: the handler ignores
        // its cancel (counted for the shared wait, `writeAfterAbort`).
        if (context.signal?.aborted === true) {
          ledgerOf(handles).writeAfterAbort += 1;
        }
        context.facts[f(c.writes)] = c.value;
        external(["wrote", `${id}.r${i}`, n]);
      },
    };
  });
  if (batch) {
    batchedResolver(batch, id, m.facts, respectsAbort, {
      ledger: ledgerOf(handles),
      t,
      external,
      requirements,
      constraints,
      resolvers,
    });
  }
  const effects: Record<string, unknown> = {};
  m.effects.forEach((e, i) => {
    effects[`x${i}`] = {
      ...(e.explicitDeps ? { deps: e.reads.map(f) } : {}),
      ...(e.onNavigate === undefined ? {} : { onNavigate: e.onNavigate }),
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
  // L10, dynamic cases, module a only: the queue's trigger `zf`, what
  // dynamic resolvers write (`zw`), DYN, the `zq` effect that runs queued
  // `define` steps inside a pass (D5), and with `readers` the two readers
  // that ask about `z0` before it exists (I1).
  if (dynamic !== undefined) {
    facts.zf = t.number();
    facts.zw = t.number();
    requirements.DYN = {};
    effects.zq = {
      run: (fs: any) => {
        void own(fs).zf;
        const queue = handles.queue as QueuedDefine[] | undefined;
        if (!queue || queue.length === 0 || !handles.system) {
          return undefined;
        }
        for (const q of queue.splice(0)) {
          runDefine(
            handles.system,
            q.step,
            { external, handles },
            q.multi,
            `${q.label} inside the pass`,
          );
        }

        return undefined;
      },
    };
    if (dynamic.readers) {
      derivations.zin = t.number();
      derive.zin = (_fs: any, derived: any) =>
        "z0" in derived ? Number(derived.z0) : -1;
      constraints.zgate = {
        when: (_fs: any, derived: any) => "z0" in derived,
        require: { type: "DYN" },
      };
    }
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
    ...(m.snapshotEvents === undefined
      ? {}
      : { history: { snapshotEvents: m.snapshotEvents.map((e) => `e${e}`) } }),
    init: (fs: any) => {
      for (let i = 0; i < m.facts; i++) {
        fs[f(i)] = 0;
      }
      if (m.date) {
        fs.when = new Date(0);
      }
      if (dynamic !== undefined) {
        fs.zf = 0;
        fs.zw = 0;
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
 * One call of the batched handler, as the shared wait (`batchDrain`) reads
 * it: when it started, its signal, which attempt it is on that signal (1.35
 * keeps one controller for every attempt of a batch, and one per
 * requirement in the fallback), and when and how it returned.
 */
interface BatchCall {
  start: number;
  signal: AbortSignal | undefined;
  attempt: number;
  end?: number;
  threw?: boolean;
}

/** What the shared wait reads of one run (one per run: `ctx.handles` is). */
interface BatchLedger {
  /** The model's own timers (the resolvers' `delay` waits) still pending. */
  own: number;
  calls: Set<BatchCall>;
  /** The latest attempt made on each signal. */
  attempts: WeakMap<object, number>;
  /**
   * Writes a handler made while its signal was aborted (the batched
   * handler's `run` and the single resolvers alike): a canceled handler
   * that ignores its abort. The shared wait reports it (`writeAfterAbort`),
   * as an annotation only: no verdict reads it since Jason, 2026-11-08:
   * "Use 'Discard after the stop' (Recommended)".
   */
  writeAfterAbort: number;
}

/** The run's ledger. */
function ledgerOf(handles: BuildContext["handles"]): BatchLedger {
  handles.batchLedger ??= {
    own: 0,
    calls: new Set(),
    attempts: new WeakMap(),
    writeAfterAbort: 0,
  };

  return handles.batchLedger as BatchLedger;
}

/** A resolver's own wait, counted so the drain can tell it from the engine's timers. */
function ownDelay(ledger: BatchLedger, ms: number): Promise<void> {
  ledger.own += 1;

  return new Promise((resolve) =>
    setTimeout(() => {
      ledger.own -= 1;
      resolve();
    }, ms),
  );
}

/**
 * Fake ms the drain may wait after `settle()` resolves: 2.0's `settle()`
 * gives up at its 5 s `maxWait` (row (as)), so a batch still live past
 * that has no point at which both engines can be compared.
 */
export const DRAIN_BOUND_MS = 5000;

/**
 * The shared wait's reading of a case with the batched resolver
 * (diff/scenario.ts `SettleDrain`; Jason, 2026-11-07: "One shared wait
 * (Recommended)", which replaced the separate drains). Once an engine's
 * `settle()` has resolved, it reads a batch as live while one of these
 * holds, each 1.35's own schedule (packages/core/src/core/resolvers.ts):
 *
 * - a call of the batched handler has not returned and its timeout has
 *   not passed (a timer due exactly at it has yet to run, so the bound is
 *   inclusive), even if its signal was aborted: 1.35 clears a call's
 *   timeout timer only when the call settles or the timer fires
 *   (`withTimeout`), so a clobbered or retracted call's timeout still fires
 *   (the coordinator's reading of "until neither has a batch still
 *   running", 2026-11-08); with no timeout, an aborted call is an orphan,
 *   as a canceled single run is. 1.35 ends a `resolveBatch` or
 *   `resolveBatchWithResults` call at `batch.timeoutMs` and never aborts
 *   its signal (row n); the fallback runs each requirement on the single
 *   run path, which reads the resolver's `timeout`, never set here;
 * - a call threw or timed out, its signal is not aborted, attempts are
 *   left, and no later attempt has started: 1.35 waits the retry's backoff
 *   (linear from `initialDelay` 2: 2 ms times the attempt, its end
 *   inclusive, as the timeout's is), then retries,
 *   or ends the batch if it was satisfied meanwhile;
 * - the system is not settled (`isSettled`): a queued batch, a single run
 *   a batch's write started, or a reconcile, as `settle()` would wait for.
 *
 * Each wait a live 1.35 batch makes is one of these. What it does not wait
 * for is what neither engine's `settle()` waits for: the model's own waits
 * of canceled or timed-out calls and runs. With no timer left nothing can
 * move, so the drain ends, unless a call is still live (it stalls).
 *
 * On v2 the same calls are read, in the same shared wait (Jason,
 * 2026-11-07: "One shared wait (Recommended)"): v2 joins it only when its
 * `settle()` resolved with nothing attached left (`attached`: settled, no
 * run in flight), so a call still live can only be a detached run's (a
 * bound run whose requirement was retracted, RFC-0003). With attached work
 * left, v2 takes no part, and its checkpoint differs.
 *
 * `writeAfterAbort` counts the handlers' writes made while their signal
 * was aborted (`BatchLedger.writeAfterAbort`), for the report only (Jason,
 * 2026-11-08: "Use 'Discard after the stop' (Recommended)" replaced the
 * write-after-cancel verdict; diff/scenario.ts `runScenario`).
 */
export function batchDrain(b: FuzzBatch): SettleDrain {
  const callTimeout = b.handler === "fallback" ? null : b.timeout;
  const attempts = b.retry + 1;
  const busy = (ctx: BuildContext, system: AnySystem): string | false => {
    const reason = liveCall(ctx);

    return reason || (system.isSettled ? false : "the system is not settled");
  };
  /** Why a call of the batched handler is still live, or false. */
  const liveCall = (ctx: BuildContext): string | false => {
    const ledger = ledgerOf(ctx.handles);
    const now = Date.now();
    let reason: string | false = false;
    for (const call of ledger.calls) {
      const timedOutAt =
        callTimeout === null
          ? Number.POSITIVE_INFINITY
          : call.start + callTimeout;
      const aborted = call.signal?.aborted === true;
      // Inclusive: the timer due at `timedOutAt` (or at the backoff's end)
      // is still the batch's own, and the wait stops only once it has run.
      // An aborted call (a clobber or a retraction aborted its signal) is
      // still live while its timeout timer is pending: 1.35's `withTimeout`
      // clears that timer only when the call settles or the timer fires,
      // never on abort. With no timeout, an aborted call is an orphan.
      if (
        call.end === undefined &&
        (!aborted || Number.isFinite(timedOutAt)) &&
        now <= timedOutAt
      ) {
        return `a call of the batched handler (attempt ${call.attempt}, started at ${call.start} ms) is live`;
      }
      const failedAt =
        call.end !== undefined && call.end < timedOutAt
          ? call.threw
            ? call.end
            : undefined
          : Number.isFinite(timedOutAt)
            ? timedOutAt
            : undefined;
      const retries =
        failedAt !== undefined &&
        !aborted &&
        call.attempt < attempts &&
        ledger.attempts.get(call.signal ?? ledger) === call.attempt;
      if (retries && now <= (failedAt as number) + 2 * call.attempt) {
        reason ||= `attempt ${call.attempt} failed at ${failedAt} ms and its retry's backoff runs to ${(failedAt as number) + 2 * call.attempt} ms`;
      } else if (call.end !== undefined || aborted) {
        ledger.calls.delete(call);
      }
    }

    return reason;
  };

  return {
    boundMs: DRAIN_BOUND_MS,
    busy,
    writeAfterAbort: (ctx) => ledgerOf(ctx.handles).writeAfterAbort,
    attached(_ctx, system) {
      if (!system.isSettled) {
        return "the system is not settled";
      }
      const inflight = system.inspect().inflight.length;

      return inflight > 0 ? `${inflight} run(s) in flight` : false;
    },
  };
}

/**
 * Adds the batched resolver `rb` and its source constraints `b<n>` to a
 * module's definitions. Its records are the single resolvers' kinds
 * ("start", "wrote", "aborted", "timeout") under the tag `<module>.rb`, with
 * the call's items last, so the comparison pairs them as it pairs a single
 * run's; `n` counts the handler's calls (each fallback run is a call).
 */
function batchedResolver(
  b: FuzzBatch,
  id: string,
  factCount: number,
  respectsAbort: boolean,
  out: {
    ledger: BatchLedger;
    t: any;
    external: (data: unknown) => void;
    requirements: Record<string, unknown>;
    constraints: Record<string, unknown>;
    resolvers: Record<string, unknown>;
  },
) {
  const type = `${id.toUpperCase()}B`;
  const tag = `${id}.rb`;
  const writes = f(b.writes % factCount);
  out.requirements[type] = { item: out.t.string() };
  b.sources.forEach((src, s) => {
    const fact = f(src.fact % factCount);
    out.constraints[`b${s}`] = {
      when: (fs: any) => fs[fact] >= src.atLeast,
      require: (fs: any) => {
        const reqs: Array<{ type: string; item: string }> = [];
        for (let i = 0; i < src.items; i++) {
          if (fs[fact] >= src.atLeast + Math.max(0, i - 1)) {
            reqs.push({ type, item: `${s}.${i}` });
          }
        }

        return reqs;
      },
      ...(src.abortOn ? { abortOn: [writes] } : {}),
    };
  });
  let calls = 0;
  // One call: report its start and any abort, wait, then fail (a thrown
  // batch or run) or write. Returns the call's number.
  const run = async (items: string[], context: any, throws: boolean) => {
    calls += 1;
    const n = calls;
    // Live for the shared wait (toScenario) until the call ends.
    const signal = context.signal as AbortSignal | undefined;
    const key = signal ?? out.ledger;
    const call: BatchCall = {
      start: Date.now(),
      signal,
      attempt: (out.ledger.attempts.get(key) ?? 0) + 1,
    };
    out.ledger.attempts.set(key, call.attempt);
    out.ledger.calls.add(call);
    try {
      out.external(["start", tag, n, items]);
      context.signal?.addEventListener?.("abort", () =>
        out.external([
          isTimeoutError(context.signal.reason) ? "timeout" : "aborted",
          tag,
          n,
          items,
        ]),
      );
      if (b.delay > 0) {
        await ownDelay(out.ledger, b.delay);
      }
      // A handler that respects its abort (`respectsAbort`, the RFC's
      // rule 9) stops here, and writes nothing.
      if (respectsAbort && context.signal?.aborted === true) {
        return n;
      }
      if (throws && n <= b.fails) {
        throw new Error(`${tag} attempt ${n}`);
      }
      // A write while the call's signal is aborted (a retraction or a
      // clobber canceled it): counted for the shared wait.
      if (context.signal?.aborted === true) {
        out.ledger.writeAfterAbort += 1;
      }
      context.facts[writes] = b.value;
      out.external(["wrote", tag, n, items]);

      return n;
    } catch (error) {
      call.threw = true;
      throw error;
    } finally {
      call.end = Date.now();
    }
  };
  const handler =
    b.handler === "batch"
      ? {
          resolveBatch: async (reqs: Array<{ item: string }>, context: any) => {
            await run(
              reqs.map((r) => r.item),
              context,
              true,
            );
          },
        }
      : b.handler === "results"
        ? {
            resolveBatchWithResults: async (
              reqs: Array<{ item: string }>,
              context: any,
            ) => {
              const n = await run(
                reqs.map((r) => r.item),
                context,
                false,
              );

              return reqs.map((r, i) =>
                n <= b.fails && (b.failing === "all" || i % 2 === 1)
                  ? {
                      success: false,
                      error: new Error(`${tag} ${r.item} attempt ${n}`),
                    }
                  : { success: true },
              );
            },
          }
        : {
            resolve: async (req: { item: string }, context: any) => {
              await run([req.item], context, true);
            },
          };
  out.resolvers.rb = {
    requirement: type,
    batch: {
      enabled: true,
      windowMs: b.windowMs,
      ...(b.maxSize === null ? {} : { maxSize: b.maxSize }),
      ...(b.timeout === null ? {} : { timeoutMs: b.timeout }),
    },
    ...(b.retry > 0
      ? {
          retry: {
            attempts: b.retry + 1,
            backoff: "linear",
            initialDelay: 2,
          },
        }
      : {}),
    ...handler,
  };
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
 * Whether the engines' aborts agree in a case, so a handler that obeys its
 * abort (`respectsAbort`) behaves the same on both: the case has no resolver
 * with a `timeout` (row n: 2.0 aborts a timed-out attempt's signal, 1.35
 * leaves it clean) and no batched resolver (quirk g: 2.0 aborts only the
 * retracted requirement, 1.35 the whole batch). Read from the `timeout` and
 * `batched` triggers themselves, so the rule cannot drift from the facts the
 * entries' `when` lists test. Jason, 2026-11-14: "Obey only where aborts
 * agree (Recommended)".
 */
export function abortsAgree(spec: FuzzSpec): boolean {
  return !(TRIGGERS.timeout(spec) || TRIGGERS.batched(spec));
}

/**
 * Each trigger a fuzz case can have (lib/fuzz.ts `FUZZ_TRIGGERS`), as a test
 * of its spec. A fuzz divergence with `when` applies only to the cases that
 * have every trigger it lists (diff/scenario.ts `covers`), so each one is the
 * spec feature its quirk needs, read from the options the case really passes
 * (`options()`), never wider. Every resolver belongs to a constraint: a
 * single resolver to its pair, the batched one to its one or two sources.
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
    spec.modules.some((m) => m.constraints.some((c) => c.retry > 0)) ||
    (spec.batch?.retry ?? 0) > 0,
  /** Some resolver has a timeout. */
  timeout: (spec) =>
    spec.modules.some((m) => m.constraints.some((c) => c.timeout !== null)) ||
    (spec.batch != null && spec.batch.timeout !== null),
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
    ) ||
    (spec.batch != null &&
      (spec.batch.fails > 0 ||
        (spec.batch.timeout !== null &&
          spec.batch.timeout <= spec.batch.delay))),
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
  /**
   * A Date is written to a fact of a namespaced module, where 1.35 warns of
   * the non-JSON write twice (row o: by `a.when` and again by `a::when`).
   * The model namespaces its modules (as a and b) only when it has two, and
   * a module's Date fact is `when`, which its init sets to `new Date(0)`
   * whenever the module has one: every case starts its system, so a case of
   * two modules with a Date fact always writes one. The spec cannot narrow
   * it further.
   */
  namespacedDateWrite: (spec) =>
    spec.modules.length > 1 && spec.modules.some((m) => m.date),
  /**
   * Some resolver's write can retract its own constraint (row t's third
   * path: the run reported complete, and a write made the condition false
   * before it left flight), directly or through one other constraint. A
   * constraint's condition reads its own fact `fact` (and, in module b with
   * `crossAtLeast`, module a's fact 0, which b's resolvers never write), and
   * its resolver writes `value` to its own fact `writes`. Directly: the
   * write is to the fact the condition reads and the value is below
   * `atLeast`. Through another constraint of the same module (fuzz seed
   * 24301 case 49): the write is to the fact that one reads, of a value
   * that meets its `atLeast`, so it can activate it, and its resolver's
   * write is to the fact the first reads, of a value below the first's
   * `atLeast`. A resolver writes only its own module's facts, and module
   * a's conditions read only module a's, so no other path reaches across
   * modules in one step.
   */
  /**
   * Row t's error shape through the `disable` strategy (deep fuzz case
   * 1:all#4038): `onResolverError` is "disable", and some single resolver
   * with a timeout can reject (it throws on its first `fails` attempts, or
   * its timeout is no longer than its wait). The error disables the
   * resolver's constraint, so the next pass retracts its requirement: 1.35
   * then reports a cancel for the run after its error, 2.0 the error only.
   * A resolver with no timeout leaves flight before that pass on both
   * engines, so it is outside the trigger. `writeRetracts` reads only
   * writes, so it never names this.
   */
  disableRetracts: (spec, boundary) =>
    strategy(boundary?.onResolverError) === "disable" &&
    spec.modules.some((m) =>
      m.constraints.some(
        (c) => c.timeout !== null && (c.fails > 0 || c.timeout <= c.delay),
      ),
    ),
  writeRetracts: (spec) =>
    spec.modules.some((m) =>
      m.constraints.some(
        (c) =>
          (c.writes === c.fact && c.value < c.atLeast) ||
          m.constraints.some(
            (d) =>
              d !== c &&
              d.fact === c.writes &&
              c.value >= d.atLeast &&
              d.writes === c.fact &&
              d.value < c.atLeast,
          ),
      ),
    ),
  /**
   * The case has the batched resolver (L7): quirk g, rows (ap), (as) and
   * (au) need nothing more of the spec. Each of them shows wherever a batch
   * runs: a retraction, a later add or a settle step can reach any batch,
   * and which one a case makes depends on its steps' timing.
   */
  batched: (spec) => spec.batch != null,
  /** The batched resolver is `resolveBatchWithResults` (quirks h and i, row (ar)). */
  batchWithResults: (spec) => spec.batch?.handler === "results",
  /** The batched resolver has only `resolve()`, the fallback (row (at)). */
  batchFallback: (spec) => spec.batch?.handler === "fallback",
  /** Two constraints feed the batched resolver, so a batch can mix them (quirk k). */
  batchMixed: (spec) => (spec.batch?.sources.length ?? 0) > 1,
  /** Some constraint that feeds the batched resolver has `abortOn` (quirk k, RFC B-1). */
  batchAbortOn: (spec) =>
    spec.batch?.sources.some((src) => src.abortOn) ?? false,
  /**
   * The sources can raise two requirements at once (their items add up to
   * more than one), so a batch can hold a requirement and a sibling: a
   * write can retract one and keep the other wanted (quirk g).
   */
  batchSiblings: (spec) =>
    (spec.batch?.sources.reduce((n, src) => n + src.items, 0) ?? 0) > 1,
  /**
   * Some call of the batched resolver fails (`fails` > 0): a thrown batch
   * or fallback run, or failed items of a with-results call.
   */
  batchFails: (spec) => (spec.batch?.fails ?? 0) > 0,
  /**
   * A with-results call fails every item (`failing` "all", `fails` > 0):
   * an all-failed with-results batch (quirk h, row (ar)).
   */
  batchAllFail: (spec) =>
    spec.batch?.handler === "results" &&
    spec.batch.failing === "all" &&
    spec.batch.fails > 0,
  /**
   * A with-results call can fail some items and not others (quirk i): it
   * fails every second item (`failing` "some", `fails` > 0), so it needs a
   * call of two or more, and the sources must be able to raise two.
   */
  batchSomeFail: (spec) =>
    spec.batch?.handler === "results" &&
    spec.batch.failing === "some" &&
    spec.batch.fails > 0 &&
    spec.batch.sources.reduce((n, src) => n + src.items, 0) > 1,
  /** The batched resolver has a retry policy (`retry` > 0: more than one attempt). */
  batchRetry: (spec) => (spec.batch?.retry ?? 0) > 0,
  /** The batched resolver has a timeout (`timeoutMs`). */
  batchTimeout: (spec) => spec.batch != null && spec.batch.timeout !== null,
  /**
   * The batch has a `maxSize` (1 or 2): a queue that holds a requirement
   * twice (row (av) on 1.35) can fill it and flush a step before the other
   * engine's window timer does.
   */
  batchMaxSize: (spec) => spec.batch != null && spec.batch.maxSize !== null,
  /**
   * Row t's batch path (B-4; deep fuzz case 24301:all#3397): the batched
   * resolver's own write retracts every requirement of a source that feeds
   * it, so the write lands while its call still owns them. The batch lives
   * in module a (`build`); a source's condition reads fact `fact` (mod the
   * module's facts) at or above `atLeast`, and the handler writes `value` to
   * fact `writes` (the same mod), so the write retracts that source's items
   * when it is to the fact the source reads and below `atLeast`, the lowest
   * item's bar. `writeRetracts` reads only the single resolvers' writes, so
   * it never names this.
   */
  /**
   * Row (ap) through a clobber (fuzz case 18:all#156): a source that feeds
   * the batch has `abortOn`, which names the fact the batched handler writes
   * (`writes`, mod module a's facts), and a single resolver of module a
   * writes that fact too, so another run's write clobbers the bound
   * requirement while it waits and each reconcile pass raises it again.
   * 1.35 restarts its window on every add; 2.0 with (ap) does not, so its
   * call starts a pass earlier.
   */
  batchClobbered: (spec) => {
    const b = spec.batch;
    const m = spec.modules[0];
    if (b == null || m === undefined || m.facts === 0) {
      return false;
    }

    return (
      b.sources.some((src) => src.abortOn) &&
      m.constraints.some((c) => c.writes % m.facts === b.writes % m.facts)
    );
  },
  batchWriteRetracts: (spec) => {
    const b = spec.batch;
    const n = spec.modules[0]?.facts ?? 0;
    if (b == null || n === 0) {
      return false;
    }

    return b.sources.some(
      (src) => src.fact % n === b.writes % n && b.value < src.atLeast,
    );
  },
  /**
   * The case has history on and a step that restores a snapshot into the
   * facts (L8): `back`, `forward`, `goTo`, `replay`, or `roundtrip`, whose
   * import restores the current snapshot.
   */
  navigated: (spec) =>
    spec.history && spec.steps.some((s) => NAVIGATIONS.has(s.op)),
  /**
   * A navigation can run while work is in flight (L8; U14 pins 1.35's
   * shapes by hand, the RFC's rule 3): the case has a resolver, and some
   * navigation is not preceded by a settle step. Every case starts its
   * system first, and its init facts can raise a requirement at once, so a
   * navigation before any settle step counts. A history step neither starts
   * work nor waits for it, so it does not end the window; a settle step does.
   */
  navigatedBusy: (spec) => {
    if (!spec.history || !hasConstraint(spec)) {
      return false;
    }
    let busy = true;
    for (const s of spec.steps) {
      if (NAVIGATIONS.has(s.op) && busy) {
        return true;
      }
      if (s.op === "settle") {
        busy = false;
      } else if (!(HISTORY_OPS as readonly string[]).includes(s.op)) {
        busy = true;
      }
    }

    return false;
  },
  /**
   * Every resolver handler ignores its abort (the RFC's rule 9): true unless
   * the case drew `respectsAbort`, which only a history case (L8) draws, and
   * only where the engines' aborts agree (`abortsAgree`: no `timeout`, no
   * `batched`; Jason, 2026-11-14: "Obey only where aborts agree
   * (Recommended)"). The late-write entries (row n, 2/352, quirk g) list it,
   * so a respecting handler's case is never covered by them; below L8 every
   * case has it, and every timeout or batched case has it at L8 too.
   */
  ignoresAbort: (spec) => spec.respectsAbort !== true,
  /**
   * Row (bi), every run reports `onTraceComplete` once (L9): the trace is on
   * with a ring of 1 or 3 runs (`maxRuns`), which a fuzz case can fill, so
   * a run that started a resolver can be pushed out while it is in flight.
   * With the default ring of 100 no fuzz case makes enough runs. The spec
   * says the ring can drop a run, not that one was dropped: the entry's
   * bound (`traceRunWithResolvers`) carries the rest.
   */
  traceRing: (spec) => spec.trace && (spec.maxRuns === 1 || spec.maxRuns === 3),
  /**
   * Row (ay), a navigation keeps a pause: some navigation runs while a
   * `pause` step's pause is set, with no `resume` step since it. A
   * navigation does not end the pause here: 1.35 clears it (N5), 2.0 with
   * (ay) keeps it, and the trigger names the shape both start from.
   */
  navigatedPaused: (spec) => {
    if (!spec.history) {
      return false;
    }
    let paused = false;
    for (const s of spec.steps) {
      if (s.op === "pause") {
        paused = true;
      } else if (s.op === "resume") {
        paused = false;
      } else if (paused && NAVIGATIONS.has(s.op)) {
        return true;
      }
    }

    return false;
  },
  /**
   * Row (az), `replay()` and `import()` tell listeners: history is on and
   * the steps have a `replay` or a `roundtrip` (its import), the two calls
   * 1.35 makes without `onHistoryNavigate` or `onHistoryChange` (N3, E4).
   */
  replayedOrImported: (spec) =>
    spec.history &&
    spec.steps.some((s) => s.op === "replay" || s.op === "roundtrip"),
  /**
   * Row (ba), ids continue after an import: history is on and the steps
   * import (`roundtrip`). The collision (E3) needs a system whose counter is
   * behind the imported ids, and the model imports only into the system
   * that exported them, whose counter is past every id it took (the newest
   * snapshot is always in the list), so 1.35 repeats no id in a fuzz case:
   * the class `snapshotIdsRepeated` (diff/fingerprint.ts) is what an entry
   * for the row must bound by, and with this trigger a case the row cannot
   * reach stays outside it.
   */
  imported: (spec) =>
    spec.history && spec.steps.some((s) => s.op === "roundtrip"),
  /**
   * Row (bb), changesets follow the buffer, the redo cut and import: a
   * changeset that can record a range is closed (`afterRecordedChangeset`;
   * an empty one records none), then a step that can move
   * snapshots under its range (a step other than a history step, whose
   * write takes a snapshot that can drop the oldest one or cut off redo, or
   * a `roundtrip`, whose import keeps 1.35's ranges), and after that a
   * `back` or `forward`, which reads the range (N10, E3).
   */
  changesetMoved: (spec) => {
    if (!spec.history) {
      return false;
    }
    let moved = false;
    for (const s of spec.steps.slice(afterRecordedChangeset(spec.steps))) {
      if (
        s.op === "roundtrip" ||
        !(HISTORY_OPS as readonly string[]).includes(s.op)
      ) {
        moved = true;
      } else if (moved && (s.op === "back" || s.op === "forward")) {
        return true;
      }
    }

    return false;
  },
  /**
   * Row (bc), an import with an index outside the list fails: the model's
   * only such import. A module with `snapshotEvents` makes 1.35 snapshot a
   * pass only for a listed event, so the start takes none and the history
   * can still be empty at a `roundtrip`: its export holds no snapshot and
   * `currentIndex` -1, which 1.35 imports (E2). The trigger is that shape's
   * spec: history on, some module with `snapshotEvents`, and a `roundtrip`.
   */
  importedEmpty: (spec) =>
    spec.history &&
    spec.modules.some((m) => m.snapshotEvents !== undefined) &&
    spec.steps.some((s) => s.op === "roundtrip"),
  /**
   * Row (bd), stored snapshots are not shared: some module has the Date
   * fact `when` (the model's only fact that holds an object) and the steps
   * navigate twice. 1.35's first restore writes the stored Date into the
   * live fact, so the two share it (T8, H4b); a later restore of the same
   * snapshot writes that same object back, where 2.0 with (bd) writes a
   * copy. A number restores the same on both.
   */
  restoredTwice: (spec) =>
    spec.history &&
    spec.modules.some((m) => m.date) &&
    spec.steps.filter((s) => NAVIGATIONS.has(s.op)).length > 1,
  /**
   * Row (be), a changeset counts as one of the steps: a changeset that can
   * record a range is closed (`afterRecordedChangeset`; an empty one records
   * none), and a later `back` or `forward` takes two or
   * three steps. One step lands the same on both engines (inside, at the
   * start, and outside a changeset); only the steps left after the first
   * differ (N10, U8).
   */
  changesetSteps: (spec) =>
    spec.history &&
    spec.steps
      .slice(afterRecordedChangeset(spec.steps))
      .some(
        (s) => (s.op === "back" || s.op === "forward") && (s.steps ?? 1) > 1,
      ),
} satisfies Record<
  FuzzTrigger,
  (spec: FuzzSpec, boundary: Record<string, unknown> | undefined) => boolean
>;

/**
 * Where the steps go on after the first changeset that can record a range,
 * for `changesetMoved` and `changesetSteps`; past the end when there is none.
 * 1.35's `endChangeset` records a range only if the index rose since
 * `beginChangeset` (utils/history.ts:598–609; U18), so a changeset with no
 * step that can raise it records none, and no later navigation reads it.
 * A step that can: one that is not a history step, with no pause set (its
 * pass can take a snapshot), or a `forward` or `goTo`. A navigation counts
 * as clearing the pause: 1.35 clears it on a real restore (N5), and 2.0
 * keeps it with (ay), so this is the wider reading. A second `begin`
 * starts over, as 1.35's does. The rule is not exact. It is wider where
 * the index can end where it began (a full ring buffer, or a `back` and
 * then a write), and narrower where a late write from in-flight work lands
 * inside a history step's flush between `begin` and `end`. The narrow case
 * fails a case loudly rather than hiding a difference. It is never wider
 * than the old rule, which matched any `begin` and `end`.
 */
function afterRecordedChangeset(steps: FuzzSpec["steps"]): number {
  let open = false;
  let rises = false;
  let paused = false;
  for (const [i, s] of steps.entries()) {
    if (s.op === "begin") {
      open = true;
      rises = false;
    } else if (s.op === "end") {
      if (open && rises) {
        return i + 1;
      }
      open = false;
    } else if (s.op === "pause") {
      paused = true;
    } else if (s.op === "resume") {
      paused = false;
    } else if (NAVIGATIONS.has(s.op)) {
      paused = false;
      rises ||= s.op === "forward" || s.op === "goTo";
    } else if (!paused) {
      rises = true;
    }
  }

  return steps.length;
}

/** A constraint, and so a resolver: a pair, or the batched resolver's sources. */
function hasConstraint(spec: FuzzSpec): boolean {
  return (
    spec.modules.some((m) => m.constraints.length > 0) || spec.batch != null
  );
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
    ...(spec.history
      ? { history: { maxSnapshots: spec.maxSnapshots ?? 20 } }
      : {}),
    ...(spec.trace
      ? { trace: spec.maxRuns === undefined ? true : { maxRuns: spec.maxRuns } }
      : {}),
  };
}

function build(spec: FuzzSpec) {
  return (ctx: BuildContext) => {
    const schemas: Record<string, unknown>[] = [];
    const batch = spec.batch ?? null;
    const respects = spec.respectsAbort === true;
    const defs = spec.modules.map((m, i) =>
      moduleDef(
        ctx,
        m,
        i,
        schemas,
        i === 0 ? batch : null,
        respects,
        i === 0 ? spec.dynamic : undefined,
      ),
    );
    ctx.handles.rebuild = () => {
      const again: Record<string, unknown>[] = [];
      const more = spec.modules.map((m, i) =>
        moduleDef(
          ctx,
          m,
          i,
          again,
          i === 0 ? batch : null,
          respects,
          i === 0 ? spec.dynamic : undefined,
        ),
      );

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
  // A case with history counts its `onHistoryChange` calls from before the
  // start, for the `history` record (`historyRecord`).
  const out: Step[] = spec.history
    ? [
        {
          op: "run",
          label: "listen for history changes",
          fn: (system, ctx) => {
            ctx.handles.historyChanges = 0;
            system.onHistoryChange?.(() => {
              ctx.handles.historyChanges += 1;
            });
          },
        },
        { op: "start" },
      ]
    : [{ op: "start" }];
  // A dynamic case hands its system to module a's `zq` effect first, for
  // the deferred `define` steps.
  if (spec.dynamic !== undefined) {
    out.unshift({
      op: "run",
      label: "hand the dynamic steps the system",
      fn: (system, ctx) => {
        ctx.handles.system = system;
      },
    });
  }
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
      case "goTo":
      case "replay":
      case "roundtrip":
      case "begin":
      case "end":
      case "pause":
      case "resume":
        out.push({
          op: "run",
          label,
          fn: (system, ctx) => {
            if (system.history) {
              historyStepRun(system.history, s);
              historyRecord(system.history, ctx);
            }
          },
        });
        break;
      case "meta":
        out.push({
          op: "run",
          label,
          fn: (system, ctx) => metaRecord(system, spec, ctx),
        });
        break;
      case "define":
        out.push({
          op: "run",
          label,
          fn: (system, ctx) => {
            if (!s.deferred) {
              runDefine(system, s, ctx, multi, label);

              return;
            }
            // D5: queued for module a's `zq` effect, which a write to `zf`
            // runs inside the next pass.
            ((ctx.handles.queue ??= []) as QueuedDefine[]).push({
              step: s,
              multi,
              label,
            });
            ctx.external([
              label,
              "queued",
              attempt(() => {
                const fs = facts(system, 0);
                fs.zf = fs.zf + 1;
              }),
            ]);
          },
        });
        break;
      case "inflight":
        out.push(
          {
            op: "run",
            label,
            fn: (system, ctx) => inflightStart(system, s, ctx, multi, label),
          },
          { op: "advance", ms: s.at },
          {
            op: "run",
            label: `${label} unregister`,
            fn: (system, ctx) =>
              ctx.external([
                `${label} unregister`,
                attempt(() => {
                  system.constraints.unregister("zk");

                  return system.constraints.isDynamic("zk");
                }),
              ]),
          },
        );
        break;
      case "module":
        out.push({
          op: "run",
          label,
          fn: (system, ctx) => moduleStep(system, s, ctx, multi, label),
        });
        break;
      case "twin":
        // A second system from the same definitions, in the same engine
        // instance: per-process state (warning dedupe) shows here. Its
        // settle() goes through the shared wait, as a settle step's does
        // (diff/scenario.ts `settleShared`; L7 follow-ups: 2.0's settle()
        // waits for the twin's batch, row (as), and 1.35's does not).
        out.push({
          op: "twin",
          label,
          open: (_system, ctx) => {
            const twin = ctx.core.createSystem(
              ctx.handles.rebuild() as never,
            ) as any;
            twin.start();

            return twin;
          },
          close: (twin, ctx) => {
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

/** One history step, on the 1.35 `HistoryAPI` as the RFC's probes call it. */
function historyStepRun(history: any, s: HistoryStep): void {
  switch (s.op) {
    case "back":
      s.steps === undefined ? history.goBack() : history.goBack(s.steps);
      break;
    case "forward":
      s.steps === undefined ? history.goForward() : history.goForward(s.steps);
      break;
    case "goTo": {
      const list = history.snapshots;
      if (list.length > 0) {
        history.goTo(list[s.position % list.length].id);
      }
      break;
    }
    case "replay":
      history.replay();
      break;
    case "roundtrip":
      history.import(history.export());
      break;
    case "begin":
      history.beginChangeset("fuzz");
      break;
    case "end":
      history.endChangeset();
      break;
    case "pause":
      history.pause();
      break;
    case "resume":
      history.resume();
      break;
  }
}

/**
 * The `history` record after each history step (the RFC's reach table): the
 * index, the length, the snapshot ids, `isPaused`, and how many times the
 * case's `onHistoryChange` listener has been called. Snapshot timestamps
 * come from `Date.now`, and the two engines' fake clocks can end a wait at
 * different times (L7 run 5, seed 4), so they are compared by order, not
 * value (rule 4): `ordered` says each is at or after the one before it.
 */
function historyRecord(history: any, ctx: BuildContext): void {
  const list = history.snapshots as Array<{ id: number; timestamp: number }>;
  ctx.external([
    "history",
    {
      index: history.currentIndex,
      length: list.length,
      ids: list.map((snapshot) => snapshot.id),
      paused: history.isPaused,
      changes: ctx.handles.historyChanges ?? 0,
      ordered: list.every(
        (snapshot, i) =>
          i === 0 || snapshot.timestamp >= (list[i - 1]?.timestamp ?? 0),
      ),
    },
  ]);
}

/**
 * The `meta` step's record (L9): for each tag some fact of the case carries,
 * `byTag(tag)` as kind, id and `tagOrigin` (authored or inherited; the
 * row's own meta is the definition's, compared through `meta.fact` and
 * `meta.derivation` instead), then `carriesTag` for each id those rows name
 * and for every fact and derivation of the first module, by kind. A query
 * that throws is recorded as the throw.
 */
function metaRecord(system: any, spec: FuzzSpec, ctx: BuildContext): void {
  const tags = FUZZ_TAGS.filter((tag) =>
    spec.modules.some((m) => (m.factTags ?? []).some((t) => t.includes(tag))),
  );
  const ask = (fn: () => unknown): unknown => {
    try {
      return fn();
    } catch (error) {
      return { threw: String((error as Error)?.message ?? error) };
    }
  };
  const first = spec.modules[0] as FuzzModule;
  for (const tag of tags) {
    const rows = ask(() =>
      (system.meta.byTag(tag) as any[]).map((r) => [
        r.kind,
        r.id,
        r.tagOrigin ?? null,
      ]),
    );
    const ids: [string, string][] = Array.isArray(rows)
      ? rows.map((r) => [r[0], r[1]])
      : [];
    for (let i = 0; i < first.facts; i++) {
      ids.push(["fact", f(i)]);
    }
    first.derivations.forEach((_, i) => {
      ids.push(["derivation", `d${i}`]);
    });
    ctx.external([
      "meta",
      tag,
      {
        byTag: rows,
        carries: ids.map(([kind, id]) => [
          kind,
          id,
          ask(() => system.meta.carriesTag(kind, id, tag)) ?? null,
        ]),
      },
    ]);
  }
}

/** A `define` step queued for module a's `zq` effect (L10, D5). */
interface QueuedDefine {
  step: Extract<FuzzStep, { op: "define" }>;
  multi: boolean;
  label: string;
}

type DynamicIo = Pick<BuildContext, "external" | "handles">;

const messageOf = (error: unknown) =>
  String((error as Error)?.message ?? error);

/** `fn`'s answer, or what it throws as `{ threw }` (L10 records). */
function attempt(fn: () => unknown): unknown {
  try {
    return fn() ?? null;
  } catch (error) {
    return { threw: messageOf(error) };
  }
}

/**
 * A promise is recorded when it settles, under `label`, and stands as
 * "pending" in the step's own record; anything else is itself. The promise
 * is never awaited: a teardown or a resolver waits on the fake clock, which
 * only later steps move.
 */
function later(io: DynamicIo, label: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Promise<unknown>).then === "function"
  ) {
    (value as Promise<unknown>).then(
      (v) => io.external([label, "resolved", v ?? null]),
      (e) => io.external([label, "rejected", messageOf(e)]),
    );

    return "pending";
  }

  return value ?? null;
}

/** The static name each kind's pool draws from in module a (rule 1). */
const POOL_STATIC = {
  derive: "d",
  constraints: "c",
  resolvers: "r",
  effects: "x",
} as const;

/**
 * Pool id `id` of `kind` (the RFC's rule 1): 0 and 1 are module a's static
 * ids (namespaced as `a::` in a two-module case, where 1.35 refuses `::`),
 * 2 and 3 the dynamic `z0` and `z1`.
 */
export function dynamicId(
  kind: DynamicKind,
  id: number,
  multi: boolean,
): string {
  if (id >= 2) {
    return `z${id - 2}`;
  }
  const name = `${POOL_STATIC[kind]}${id}`;

  return multi ? `a::${name}` : name;
}

/** Module a's fact `key` as a dynamic definition reads it (0 if absent). */
const factOf = (fs: any, key: string, multi: boolean): number => {
  const v = multi ? (fs?.a?.[key] ?? fs?.[key]) : fs?.[key];

  return typeof v === "number" ? v : 0;
};

/**
 * A dynamic resolver for DYN: records its start, its abort and its write
 * (to `zw`), after `delay` ms on the model's own clock. It ignores its
 * signal, as 1.35 lets an aborted write land (K4).
 */
function dynamicResolve(
  io: DynamicIo,
  tag: string,
  delay: number,
  value: number,
  multi: boolean,
) {
  return async (_req: unknown, context: any) => {
    io.external(["dyn start", tag]);
    context.signal?.addEventListener?.("abort", () =>
      io.external(["dyn aborted", tag]),
    );
    if (delay > 0) {
      await ownDelay(ledgerOf(io.handles), delay);
    }
    io.external([
      "dyn wrote",
      tag,
      attempt(() => {
        const fs = context.facts;
        if (multi && fs.a && typeof fs.a === "object") {
          fs.a.zw = value;
        } else {
          fs.zw = value;
        }
      }),
    ]);
  };
}

/**
 * The definition a `define` step registers or assigns (L10): `variant`
 * scales a derivation (3 is the object form, K2's row (bl)), sets a
 * constraint's threshold (odd, or the pool's `z1`, binds it with `abortOn`
 * in a one-module case, U9b), a resolver's delay and value, and an effect's
 * tag.
 */
export function dynamicDef(
  kind: DynamicKind,
  tag: string,
  variant: number,
  io: DynamicIo,
  multi: boolean,
): unknown {
  switch (kind) {
    case "derive": {
      const compute = (fs: any) => factOf(fs, "f0", multi) * (variant + 2);

      return variant === 3 ? { compute, meta: { label: tag } } : compute;
    }
    case "constraints":
      return {
        when: (fs: any) => factOf(fs, "f0", multi) >= variant - 1,
        require: { type: "DYN" },
        ...(!multi && (tag === "z1" || variant % 2 === 1)
          ? { abortOn: ["f0"] }
          : {}),
      };
    case "resolvers":
      return {
        requirement: "DYN",
        resolve: dynamicResolve(io, tag, variant * 5, variant, multi),
      };
    case "effects":
      return {
        run: (fs: any) => {
          io.external(["dyn effect", tag, variant, factOf(fs, "f0", multi)]);
        },
      };
  }
}

/**
 * One `define` step (L10): the call, then the answer (or the refusal, its
 * text compared exactly), `isDynamic` and `listDynamic`.
 */
function runDefine(
  system: any,
  s: Extract<FuzzStep, { op: "define" }>,
  io: DynamicIo,
  multi: boolean,
  label: string,
): void {
  const tag = dynamicId(s.kind, s.id, multi);
  const registry = system[s.kind];
  const answer = attempt(() => {
    switch (s.action) {
      case "register":
        return later(
          io,
          label,
          registry.register(tag, dynamicDef(s.kind, tag, s.variant, io, multi)),
        );
      case "assign":
        return later(
          io,
          label,
          registry.assign(tag, dynamicDef(s.kind, tag, s.variant, io, multi)),
        );
      case "unregister":
        return later(io, label, registry.unregister(tag));
      case "call":
        return later(
          io,
          label,
          s.kind === "resolvers"
            ? registry.call(tag, { type: "DYN" })
            : registry.call(tag),
        );
    }
  });
  io.external([
    label,
    answer,
    attempt(() => registry.isDynamic(tag)),
    attempt(() => registry.listDynamic()),
  ]);
}

/**
 * The `inflight` step's first half (K4, U9a, U9b): the resolver `zr` (30
 * ms) and the constraint `zk`, always true, for DYN; `bound`, in a
 * one-module case, gives `zk` an `abortOn`. The step's second half
 * unregisters `zk` once its resolver runs.
 */
function inflightStart(
  system: any,
  s: Extract<FuzzStep, { op: "inflight" }>,
  io: DynamicIo,
  multi: boolean,
  label: string,
): void {
  io.external([
    label,
    attempt(() =>
      system.resolvers.register("zr", {
        requirement: "DYN",
        resolve: dynamicResolve(io, "zr", 30, 7, multi),
      }),
    ),
    attempt(() =>
      system.constraints.register("zk", {
        when: () => true,
        require: { type: "DYN" },
        ...(s.bound && !multi ? { abortOn: ["zf"] } : {}),
      }),
    ),
  ]);
}

/**
 * The second module a `module` step registers (M1 to M7): facts `g0`
 * (`variant`) and `g1`, a derivation `h0`, an odd variant in a one-module
 * case also a `d0` over module a's (M2), and a constraint, a 10 ms
 * resolver and an effect, so a teardown meets work in flight.
 */
function extraModule(io: BuildContext, variant: number, multi: boolean) {
  const { createModule, t } = io.core;
  const over = variant % 2 === 1 && !multi;

  return createModule("z", {
    schema: {
      facts: { g0: t.number(), g1: t.number() },
      derivations: { h0: t.number(), ...(over ? { d0: t.number() } : {}) },
      events: {},
      requirements: { ZW: {} },
    },
    init: (fs: any) => {
      fs.g0 = variant;
      fs.g1 = 0;
    },
    derive: {
      h0: (fs: any) => fs.g0 * 2,
      ...(over ? { d0: () => -1 } : {}),
    },
    constraints: {
      zm: { when: (fs: any) => fs.g0 >= 1, require: { type: "ZW" } },
    },
    resolvers: {
      zmr: {
        requirement: "ZW",
        resolve: async (_req: unknown, context: any) => {
          io.external(["module start"]);
          context.signal?.addEventListener?.("abort", () =>
            io.external(["module aborted"]),
          );
          await ownDelay(ledgerOf(io.handles), 10);
          io.external([
            "module wrote",
            attempt(() => {
              context.facts.g1 = 1;
            }),
          ]);
        },
      },
    },
    effects: {
      zme: {
        run: (fs: any) => {
          io.external(["module effect", fs.g0]);
        },
      },
    },
  } as any);
}

/** One `module` step (L10): register or retire module `z`. */
function moduleStep(
  system: any,
  s: Extract<FuzzStep, { op: "module" }>,
  io: BuildContext,
  multi: boolean,
  label: string,
): void {
  io.external([
    label,
    attempt(() =>
      s.action === "register"
        ? later(
            io,
            label,
            multi
              ? system.registerModule("z", extraModule(io, s.variant, multi))
              : system.registerModule(extraModule(io, s.variant, multi)),
          )
        : later(io, label, system.unregisterModule("z")),
    ),
  ]);
}

export function toScenario(spec: FuzzSpec, name = FUZZ_SCENARIO): ScenarioDef {
  return {
    name,
    build: build(spec),
    steps: steps(spec),
    seed: 1,
    layer: specLayer(spec),
    triggers: specTriggers(spec),
    ...(spec.batch ? { settleDrain: batchDrain(spec.batch) } : {}),
  };
}
