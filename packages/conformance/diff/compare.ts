/**
 * Compare two traces stream by stream.
 *
 * A trace interleaves several independent streams. Comparing it as one
 * array made a single extra hook shift every later index and report
 * hundreds of differences. Instead each entry is filed under
 *
 *   stream — hook | observe | notify | console | error | external | state | timers
 *   kind   — the hook name, observe event type, notified id, console level,
 *            error site, external tag, checkpoint label
 *   step   — the scenario step it happened in, and whether it happened
 *            synchronously inside the step's call (`sync`) or after it
 *            returned (`async`): a notification that moves from inside
 *            the write to a later microtask is a behaviour change
 *
 * and each stream is aligned with a longest-common-subsequence over those
 * keys (in the console stream, of the longest pairings the one with the
 * most records of identical text, so, when the records both engines print
 * appear in the same order, an unmatched record is the one the other engine
 * did not print; when shared records swap order, no order-keeping pairing
 * can pair them all, and a printed record can be left unmatched). Matched entries are compared field by field; unmatched ones are
 * reported as `missing` (reference only) or `extra` (candidate only). One
 * inserted hook is one difference.
 *
 * Contract vs incidental (README "What the trace freezes"): before
 * comparing, `contract()` masks the parts of an entry that are not a
 * contract — inspect() counters and timestamps, console text, class names —
 * keeping their presence and type so the shape stays strict. Differences in
 * the masked parts, and in how the streams interleave, are reported as
 * advisory: printed, never failing.
 *
 * One kind of value is masked only because a scenario marks it: a delay
 * drawn at random by a retry's `jitter`. The scenario reports each wait as
 * `[resolverId, attempt, { $draw, min, max }]` in an `external` entry (a
 * three-element array, the marker at index 2 with exactly those three keys:
 * `drawMarker`). Two valid engines may draw different numbers from the same
 * seed, so the `$draw` value is advisory, as is the `duration` the engine
 * reports when that resolver completes (the sum of its waits), in both the
 * `onResolverComplete` hook (argument 2) and the `resolver.complete`
 * observe event. Those are the only values masked, and `drawProblems`
 * checks every one of them, on every engine (the reference too): the draw
 * lies in [min, max] and each completion duration in the sum of its
 * resolver's bounds. `min` and `max` are compared exactly. A `$draw`
 * anywhere else is a scenario error: it is neither masked nor checked, so a
 * marker can never hide a value that is not bounds-checked.
 *
 * Every difference also carries when it happens (`Position`, from the
 * alignment) and the shared match point before it (`SharedPoint`), so a
 * fuzz case can be compared exactly up to a difference a signed `ends`
 * divergence covers and no further (scenario.ts `explain`).
 */

import { isLogLine } from "./log-projection.js";
import type { Json } from "./normalize.js";
import type { TraceEntry } from "./record.js";

export const STREAMS = [
  "hook",
  "observe",
  "notify",
  "console",
  "error",
  "external",
  "state",
  "timers",
] as const;
export type Stream = (typeof STREAMS)[number];

export interface Keyed {
  stream: Stream;
  kind: string;
  step: number;
  phase: "setup" | "sync" | "async";
  /** Position in the whole trace. */
  index: number;
  entry: TraceEntry;
}

export interface Difference {
  /** The engine compared against the reference. */
  engine: string;
  stream: Stream;
  kind: string;
  step: number;
  phase: Keyed["phase"];
  /**
   * `moved` (diff/scenario.ts `fileMoves`): a record missing on the engine
   * under test in step N that it has, of the same stream and kind, as an
   * extra record in step N + 1, filed as one record that came one step
   * later, never as an absence, and only where a signed `moved` entry
   * covers that move. Only the step moved: any field that differs between
   * the two records is a `changed` difference of its own. `step` and
   * `phase` are the reference's; the payload is the reference's record
   * (`reference`; `candidate` holds the engine's).
   */
  op: "missing" | "extra" | "changed" | "moved";
  /**
   * For `moved` only: -1 when the engine's record came one step earlier
   * (in step N - 1), 0 when it came earlier in the same step (L12 gate run
   * 4); absent when it came one step later, the default.
   */
  by?: -1 | 0;
  /**
   * Set by `markStale` (diff/scenario.ts) on a fuzz difference of a
   * derivation's record (its compute, invalidation or notify) when, on the
   * reference at that point, the derivation's last compute threw or it has
   * never computed. Only an entry with `stale` reads it.
   */
  stale?: true;
  /**
   * Set by `markAfterMet` (diff/scenario.ts) on a fuzz difference of a
   * requirement's cancel record the engine lacks (onResolverCancel,
   * onRequirementCanceled, requirement.canceled) when, just before it, the
   * requirement's last lifecycle record on both engines reported it met.
   * Only an entry with `afterMet` reads it.
   */
  afterMet?: true;
  /**
   * Set by `markAfterError` (diff/scenario.ts) on a fuzz difference of a
   * requirement's cancel record the engine lacks (onResolverCancel,
   * onRequirementCanceled, requirement.canceled) when, just before it, the
   * requirement's last lifecycle record on both engines is its
   * onResolverError, from the same resolver. Only an entry with
   * `afterError` reads it.
   */
  afterError?: true;
  /**
   * Set by `markAfterCancel` (diff/scenario.ts) on a fuzz difference of a
   * requirement's cancel record the engine lacks (onResolverCancel,
   * onRequirementCanceled, requirement.canceled) when the requirement's
   * lifecycle hooks end, on the reference just before it and on the engine
   * at the same place in its own record order, with its run's outcome (its
   * completion and its met, or its error) and one cancel of it (one or
   * more on the reference), from the same resolver. Only an entry with
   * `afterCancel` reads it.
   */
  afterCancel?: true;
  /** For `changed`: where inside the entry. */
  path?: string;
  /**
   * For `changed` only: 1.35's whole record (as compared), the record the
   * change is in. Only a fuzz bound's changed pattern with a `record` reads
   * it (diff/fingerprint.ts `Bound`), so an entry can excuse a change only
   * inside a record of a given shape.
   */
  record?: Json;
  /**
   * For `changed` only: the engine under test's whole record (as compared).
   * Only a fuzz bound's changed pattern with a `pair` reads it
   * (diff/fingerprint.ts `PAIR`), which judges the two whole records
   * together, never one field alone.
   */
  candidateRecord?: Json;
  reference?: Json;
  candidate?: Json;
  /**
   * For a missing or extra console record only: the record as printed,
   * before `contract()` masked its wording. `reference`, `candidate`, the
   * report and the advisories all see the masked record; only a fuzz
   * bound's `$text` pattern reads this (diff/fingerprint.ts `TEXT`), so an
   * entry can name the one development warning it was approved for. It
   * names the record the other engine did not print because the console
   * alignment breaks ties by text (`lcs`): of the longest pairings it takes
   * the one that pairs the most records of identical text, so 1.35 printing
   * [X, Y] and 2.0 [Y] leaves X unpaired, not Y. That holds when the records
   * both engines print appear in the same relative order. When they swap
   * (1.35 [X, Y, Z], 2.0 [Y, X]), a printed record is left unpaired, so a
   * `$text` class must name a wording the other engine never prints, as
   * row o's `dateWriteByKey` does (2.0 never prints a `::` key).
   */
  raw?: Json;
  /**
   * For `missing` only: a dropped repeat. The reference made this record
   * (as compared) more times in its step than the engine under test did,
   * and the engine made it at least once there: 1.35 made it again, never
   * an absence. Only an entry with `repeats` reads it (diff/scenario.ts
   * `covers`): row (av)'s stop-step cancel of a requirement 1.35's queue
   * held twice (PR seed 15).
   */
  repeat?: true;
  /** Trace positions, for context. */
  at: { reference?: number; candidate?: number };
  /**
   * When it happens: the `Position` of its record in each trace it is in.
   * A missing entry is in the reference only, an extra one in the candidate
   * only, a changed one in both (`isPastStop` sets one against a stop).
   */
  where: { reference?: Position; candidate?: Position };
  /**
   * The shared match point before it (`SharedPoint`): if an `ends`
   * divergence stops the case here, every stream's unmatched records after
   * this point are not compared (`isPastSharedPoint`), nor a changed record
   * after it with either record past the stop (`straddlesStop`).
   */
  shared: SharedPoint;
}

// ---------------------------------------------------------------------------
// Trace position

/**
 * Where in a trace a record happens: `[step, phase, matched, after]`,
 * compared left to right within its trace, and without `after` across the
 * two traces of a comparison (below).
 *
 * - `step` and `phase` (setup 0, sync 1, async 2) are the record's segment:
 *   every step marker is in both traces, so a record in an earlier step
 *   happened earlier, whatever came before it.
 * - `matched` counts the records of its trace, up to and including it, that
 *   the alignment matched with one in the other trace (any stream). Both
 *   traces hold the same matched records in every segment, so this is the
 *   shared clock: the same in both traces up to the first difference, and
 *   it is not thrown off by records one trace has and the other lacks.
 * - `after` is 0 for a matched record; for an unmatched one, how many
 *   records of its own trace it comes after since the last matched record
 *   (or the segment's start): the first record a trace has that the other
 *   lacks is 1, the next 2.
 *
 * Within one trace the whole position is the trace order. Across the two
 * traces `after` means nothing: it counts records one trace has and the
 * other lacks, so the third such record of one trace and the first of the
 * other are in the same gap between two matched records, and neither
 * happened before the other. Across traces only `[step, phase, matched]`
 * orders two records, and only when strictly later: a record whose
 * `matched` is higher than another's (same segment) has a matched record M
 * at or before it that the other trace has after its record (its trace has
 * more matched records up to it than the other trace has up to the other
 * record), so M separates them. Equal `[step, phase, matched]` across
 * traces is the same gap: unordered (`isPastStop` counts a record in an
 * unmatched stop's gap as past the stop).
 */
export type Position = readonly [
  step: number,
  phase: number,
  matched: number,
  after: number,
];

const PHASE_RANK: Record<Keyed["phase"], number> = {
  setup: 0,
  sync: 1,
  async: 2,
};

/**
 * Negative when `a` is earlier than `b`, zero at the same position, over
 * the first `fields` of the position: all four within one trace, three
 * (no `after`) across the two traces.
 */
export function comparePositions(
  a: Position,
  b: Position,
  fields: 3 | 4 = 4,
): number {
  for (let i = 0; i < fields; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) {
      return d;
    }
  }

  return 0;
}

const TRACES = ["reference", "candidate"] as const;

/**
 * Whether record position `p` is past the stop's record `s`: strictly after
 * it (`same`: the two are in one trace, so the whole position orders them;
 * otherwise only `[step, phase, matched]`, strictly), or in the same gap as
 * an unmatched stop, in either trace: an unmatched record between the same
 * two matched records (equal `[step, phase, matched]`, `after` above 0 in
 * both). A matched record is never in a gap: at the stop's `[step, phase,
 * matched]` it is the matched record that opens the gap, before it.
 */
function pastStop(p: Position, s: Position, same: boolean): boolean {
  const order = comparePositions(p, s, same ? 4 : 3);
  if (order > 0) {
    return true;
  }
  // The stop's own record (one trace, the whole position) is not past it.
  if (same && order === 0) {
    return false;
  }

  return p[3] > 0 && s[3] > 0 && comparePositions(p, s, 3) === 0;
}

/**
 * Whether difference `d` is past `stop` (an `ends` divergence's difference)
 * in every trace `d` is in: each record of `d` is set against `stop`'s record
 * in the same trace when `stop` has one there (a changed `stop` has a record
 * in both), and otherwise against `stop`'s record in the other trace
 * (`pastStop`). So a record after the stop, or in the stop's gap (records
 * one trace has and the other lacks, between the same two matched records,
 * which no record orders against the stop: where an approved quirk adds or
 * removes a run, the records around it fall into that gap in an order of
 * their own), is past it; a record before the gap is not, and `d` is past
 * `stop` only if every one of its records is.
 */
export function isPastStop(d: Difference, stop: Difference): boolean {
  return TRACES.every((trace) => recordPastStop(d, stop, trace) !== false);
}

/**
 * Whether `d`'s record in `trace` is past `stop`: set against `stop`'s record
 * in the same trace when `stop` has one there, and otherwise against its
 * record in the other trace (`pastStop`). Undefined when `d` has no record
 * in `trace`.
 */
function recordPastStop(
  d: Difference,
  stop: Difference,
  trace: (typeof TRACES)[number],
): boolean | undefined {
  const p = d.where[trace];
  if (!p) {
    return undefined;
  }
  const same = stop.where[trace];
  if (same) {
    return pastStop(p, same, true);
  }
  const other = stop.where[trace === "reference" ? "candidate" : "reference"];

  return other !== undefined && pastStop(p, other, false);
}

// ---------------------------------------------------------------------------
// The shared match point

/**
 * The last record both engines matched before a difference, as a pair of
 * trace indexes (the index of a record in its whole trace, `Keyed.index`;
 * -1 for the start of the trace): every record of a trace up to and
 * including its index is before the point, every later one past it.
 *
 * The global record order is each trace's own order: every stream's
 * records, the step and async markers among them, sit in one array, so
 * within a trace any two records are ordered whatever their streams. Across
 * the two traces the only links are the records both have: each pair the
 * alignment matched (any stream, `lcs`), and each step and async marker,
 * paired with the same marker in the other trace (every step is in both
 * traces). A pair of indexes `(r, c)` is a shared match point when it is
 * such a link and the two prefixes it closes agree on what they hold: every
 * link with its reference record at or before `r` has its candidate record
 * at or before `c`, and the other way round. Each stream is aligned on its
 * own, so its matches can cross another stream's (1.35's error paired with
 * a later 2.0 error, while 2.0's records between them pair with 1.35's
 * after it); no point is set inside a crossing, so a record before the
 * point in one trace is never paired with one past it in the other.
 *
 * The shared points form one chain, later in both traces at once (a link
 * that closes two agreeing prefixes is the latest record of each). A
 * difference's point is the latest one before it in every trace it is in:
 * strictly before its record in that trace (a changed difference has one
 * in each, a missing one in the reference only, an extra one in the
 * candidate only). The start of both traces, (-1, -1), is always one.
 */
export interface SharedPoint {
  reference: number;
  candidate: number;
}

/**
 * The shared match points of a comparison, in order (see `SharedPoint`),
 * from its links: pairs of trace indexes, one record in each trace.
 */
function sharedChain(links: [number, number][]): SharedPoint[] {
  const byRef = [...links].sort((x, y) => x[0] - y[0]);
  const rankInCandidate = new Map(
    [...links]
      .sort((x, y) => x[1] - y[1])
      .map(([, c], rank) => [c, rank] as const),
  );
  const chain: SharedPoint[] = [{ reference: -1, candidate: -1 }];
  let latest = -1;
  byRef.forEach(([r, c], rank) => {
    latest = Math.max(latest, c);
    // The first rank+1 links in reference order are the first rank+1 in
    // candidate order: this link is the latest of each prefix.
    if (latest === c && rankInCandidate.get(c) === rank) {
      chain.push({ reference: r, candidate: c });
    }
  });

  return chain;
}

/** The latest shared match point strictly before the records `at` names. */
function sharedBefore(chain: SharedPoint[], at: Difference["at"]): SharedPoint {
  let found = chain[0] as SharedPoint;
  for (const point of chain) {
    if (
      (at.reference === undefined || point.reference < at.reference) &&
      (at.candidate === undefined || point.candidate < at.candidate)
    ) {
      found = point;
    } else {
      break;
    }
  }

  return found;
}

/**
 * Whether difference `d` is an unmatched record past `stop`'s shared match
 * point (an `ends` divergence's difference): a missing record after the
 * point's reference index, or an extra one after its candidate index. This
 * is the owner's rule (2026-11-01): when an approved quirk ends a case,
 * every stream's unmatched records after the last record both engines
 * matched before the stop are dropped. A changed difference (a matched
 * pair) is never dropped by this rule; `isPastStop` and `straddlesStop`
 * decide it.
 */
export function isPastSharedPoint(d: Difference, stop: Difference): boolean {
  // The stop itself is not past it: it passes, covered.
  if (d === stop) {
    return false;
  }
  if (d.op === "missing") {
    return (d.at.reference as number) > stop.shared.reference;
  }
  if (d.op === "extra") {
    return (d.at.candidate as number) > stop.shared.candidate;
  }
  if (d.op === "moved") {
    // Two unmatched records: dropped only when each would be on its own.
    return (
      (d.at.reference as number) > stop.shared.reference &&
      (d.at.candidate as number) > stop.shared.candidate
    );
  }

  return false;
}

/**
 * Whether difference `d` is a changed record (a matched pair) that straddles
 * `stop` (an `ends` divergence's difference): after `stop`'s shared match
 * point, with either of its two records past the stop in its own trace
 * (`recordPastStop`, as `isPastStop` sets each record). This is the owner's
 * rule (Jason, 2026-11-01): "a changed record whose 2.0 half or 1.35 half is
 * past the stop, and that sits after the shared match point, is dropped, as
 * its two halves would be if left unpaired. A pair with both halves before
 * the stop is still checked, so no difference from before the quirk is
 * hidden."
 *
 * "After the point" is after it in both traces: the point closes two trace
 * prefixes that hold the same pairs, so a matched pair has both records
 * before it or both after it. A pair at or before the point is never
 * dropped by this rule; from a real comparison it is never past the stop
 * either (the point is before the stop in every trace the stop is in, and
 * the matched records up to the point are the same in both traces, so no
 * matched record before it is ordered after the stop).
 */
export function straddlesStop(d: Difference, stop: Difference): boolean {
  if (d === stop || d.op !== "changed") {
    return false;
  }
  const afterPoint =
    (d.at.reference as number) > stop.shared.reference &&
    (d.at.candidate as number) > stop.shared.candidate;

  return (
    afterPoint &&
    TRACES.some((trace) => recordPastStop(d, stop, trace) === true)
  );
}

/** The latest position `d` has in the traces it is in (a total order, for picking a stop). */
export function latestPosition(d: Difference): Position {
  const [a, b] = [d.where.reference, d.where.candidate];
  if (!a || !b) {
    return (a ?? b) as Position;
  }

  return comparePositions(a, b) >= 0 ? a : b;
}

/** Each keyed record's position, given which of them the alignment matched. */
function positions(
  keyed: Keyed[],
  matched: ReadonlySet<Keyed>,
): Map<Keyed, Position> {
  const out = new Map<Keyed, Position>();
  let count = 0;
  let after = 0;
  let segment = "";
  for (const k of keyed) {
    const key = `${k.step}\u0000${k.phase}`;
    if (key !== segment) {
      segment = key;
      after = 0;
    }
    if (matched.has(k)) {
      count++;
      after = 0;
    } else {
      after++;
    }
    out.set(k, [k.step, PHASE_RANK[k.phase], count, after]);
  }

  return out;
}

function kindOf(entry: TraceEntry): [Stream, string] | null {
  switch (entry.k) {
    case "hook":
      return ["hook", entry.hook];
    case "observe": {
      const type = (entry.event as { type?: unknown } | null)?.type;

      return ["observe", typeof type === "string" ? type : "?"];
    }
    case "notify":
      return ["notify", entry.id];
    case "console":
      return ["console", entry.level];
    case "threw":
      return ["error", `threw ${entry.where}`];
    case "unhandled":
      return ["error", "unhandled"];
    case "external": {
      // The logging plugin's lines are checked per engine, against the hook
      // records they report (diff/log-projection.ts; owner, 2026-11-22:
      // "Project, don't sign copies (Recommended)"), and not compared here.
      if (isLogLine(entry)) {
        return null;
      }
      const tag = Array.isArray(entry.data) ? entry.data[0] : entry.data;

      return ["external", typeof tag === "string" ? tag : "external"];
    }
    case "state":
      return ["state", entry.label];
    case "timers":
      return ["timers", entry.at];
    case "step":
    case "async":
      return null;
  }
}

/** File every entry under its stream, kind, step and phase. */
export function keyTrace(trace: TraceEntry[]): Keyed[] {
  const out: Keyed[] = [];
  let step = -1;
  let phase: Keyed["phase"] = "setup";
  for (const [index, entry] of trace.entries()) {
    if (entry.k === "step") {
      step = entry.i;
      phase = "sync";
      continue;
    }
    if (entry.k === "async") {
      phase = "async";
      continue;
    }
    const sk = kindOf(entry);
    if (sk) {
      out.push({ stream: sk[0], kind: sk[1], step, phase, index, entry });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Contract projection

/** inspect() fields that are counters or timestamps of internal work. */
export const INCIDENTAL_INSPECT_FIELDS = [
  "pendingInvalidations",
  "observedDerivations",
  "hitCount",
  "lastActiveAt",
] as const;

function tag(value: Json | undefined): Json {
  if (value === null) {
    return { $incidental: "null" };
  }
  if (Array.isArray(value)) {
    return { $incidental: "array" };
  }

  return { $incidental: typeof value };
}

/** Keep shape, mask values at `fields` (any depth) and `$class` names. */
function mask(value: Json, fields: ReadonlySet<string>): Json {
  if (Array.isArray(value)) {
    return value.map((v) => mask(v, fields));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === "$class") {
      out[key] = true;
    } else if (fields.has(key)) {
      out[key] = tag(v);
    } else {
      out[key] = mask(v, fields);
    }
  }

  return out;
}

const INSPECT_FIELDS = new Set<string>(INCIDENTAL_INSPECT_FIELDS);
const NONE = new Set<string>();

const isObject = (v: Json | undefined): v is Record<string, Json> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A drawn retry wait, as a scenario reports it (see the header). */
interface DrawMarker {
  resolver: string;
  attempt: number;
  draw: number;
  min: number;
  max: number;
}

/**
 * The one position a `$draw` is allowed: an `external` entry whose data is
 * exactly `[resolverId, attempt, { $draw, min, max }]`. Masking and the
 * bounds check both start here, so they cover the same set.
 */
function drawMarker(entry: TraceEntry): DrawMarker | null {
  if (
    entry.k !== "external" ||
    !Array.isArray(entry.data) ||
    entry.data.length !== 3
  ) {
    return null;
  }
  const [resolver, attempt, marker] = entry.data;
  if (
    typeof resolver !== "string" ||
    typeof attempt !== "number" ||
    !isObject(marker) ||
    Object.keys(marker).sort().join() !== "$draw,max,min"
  ) {
    return null;
  }
  const { $draw: draw, min, max } = marker;
  if (
    typeof draw !== "number" ||
    typeof min !== "number" ||
    typeof max !== "number"
  ) {
    return null;
  }

  return { resolver, attempt, draw, min, max };
}

/** Whether `$draw` appears as a key anywhere inside `value`. */
function hasDraw(value: Json | undefined): boolean {
  if (Array.isArray(value)) {
    return value.some(hasDraw);
  }
  if (isObject(value)) {
    return Object.entries(value).some(([k, v]) => k === "$draw" || hasDraw(v));
  }

  return false;
}

/** Position of the duration in `onResolverComplete(resolver, req, duration)`. */
const HOOK_DURATION_ARG = 2;

/** A resolver completion, in either stream, and the duration it reports. */
function completion(entry: TraceEntry): {
  via: "hook" | "observe";
  resolver: string;
  duration: Json | undefined;
} | null {
  if (
    entry.k === "hook" &&
    entry.hook === "onResolverComplete" &&
    typeof entry.args[0] === "string"
  ) {
    return {
      via: "hook",
      resolver: entry.args[0],
      duration: entry.args[HOOK_DURATION_ARG],
    };
  }
  if (
    entry.k === "observe" &&
    isObject(entry.event) &&
    entry.event.type === "resolver.complete" &&
    typeof entry.event.resolver === "string"
  ) {
    return {
      via: "observe",
      resolver: entry.event.resolver,
      duration: entry.event.duration,
    };
  }

  return null;
}

/** Resolvers whose retry waits a scenario reports as drawn (see the header). */
export function drawnResolvers(trace: TraceEntry[]): Set<string> {
  const out = new Set<string>();
  for (const entry of trace) {
    const marker = drawMarker(entry);
    if (marker) {
      out.add(marker.resolver);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Trace timing (L9; the L9 RFC's harness rule 1)

/** A duration anomaly's text, `Duration 12ms is 5x+ above average (2ms)`. */
const DURATION_ANOMALY = /^Duration .*above average/;

/** The milliseconds a causal chain prints, as in `charge resolved (5ms)`. */
const CHAIN_MS = /\(\d+(?:\.\d+)?ms\)/g;

/**
 * A time a trace run reports, by contract: a finite number at or above 0 on
 * each engine, never compared for equality. Anything else keeps its value,
 * so a NaN, a negative or a missing time is still a difference.
 */
function traceTime(value: Json | undefined): Json {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { $time: "finite, at or above 0" }
    : { $time: value === undefined ? "absent" : value };
}

/**
 * One trace run (an `onTraceComplete` entry, or a row of `inspect().trace`)
 * with its timing projected (rule 1): `timestamp`, `duration` and each
 * `resolversCompleted` row's `duration` by contract (`traceTime`); the
 * causal chain's "(Nms)" replaced by a placeholder; a duration anomaly
 * dropped, so its presence is not compared (it depends on time, the RFC's
 * U13), and `anomalies` left out when nothing else is in it, as 1.35 leaves
 * it out; the run's `id` by its place in the list and the stream, not its
 * value. Every other field is compared exactly, the order of every list too,
 * so an order difference is a case and not a silent mask.
 */
export function traceRunContract(run: Json): Json {
  if (!isObject(run)) {
    return run;
  }
  const out: Record<string, Json> = { ...run };
  if ("id" in out) {
    out.id = tag(out.id);
  }
  for (const key of ["timestamp", "duration"]) {
    if (key in out) {
      out[key] = traceTime(out[key]);
    }
  }
  if (typeof out.causalChain === "string") {
    out.causalChain = out.causalChain.replace(CHAIN_MS, "(Nms)");
  }
  if (Array.isArray(out.resolversCompleted)) {
    out.resolversCompleted = out.resolversCompleted.map((row) =>
      isObject(row) && "duration" in row
        ? { ...row, duration: traceTime(row.duration) }
        : row,
    );
  }
  // Only a list that held a duration anomaly and nothing else is left out:
  // 1.35 writes `anomalies` only when it has one (packages/core/src/core/
  // engine-trace.ts:345), so an engine's empty list is not 1.35's absent
  // field, and stays a difference (L9 gate; #392's review).
  if (Array.isArray(out.anomalies) && out.anomalies.length > 0) {
    const kept = out.anomalies.filter(
      (a) => !(typeof a === "string" && DURATION_ANOMALY.test(a)),
    );
    if (kept.length > 0) {
      out.anomalies = kept;
    } else {
      delete out.anomalies;
    }
  }

  return out;
}

/**
 * Trace ids by order (the L9 RFC's harness rule 1: "Trace ids are compared
 * by order"). `traceRunContract` masks an id's value, so this checks the
 * order on every engine, the reference too, as `drawProblems` checks draws:
 * each `inspect().trace` list holds integer ids in strictly increasing order
 * (a repeated or a non-monotonic id fails), and no run is reported to
 * `onTraceComplete` twice. Self-test: diff/self/trace-contract.test.ts.
 */
export function traceIdProblems(trace: TraceEntry[]): string[] {
  const out: string[] = [];
  const reported = new Map<Json, number>();
  for (const [index, entry] of trace.entries()) {
    if (entry.k === "hook" && entry.hook === "onTraceComplete") {
      const run = entry.args[0];
      const id = isObject(run) ? run.id : undefined;
      if (typeof id !== "number" || !Number.isInteger(id)) {
        out.push(
          `hook #${index}: onTraceComplete's run id ${JSON.stringify(id ?? null)} is not an integer`,
        );
      } else if (reported.has(id)) {
        out.push(
          `hook #${index}: onTraceComplete reports run ${id} again (first at #${reported.get(id)})`,
        );
      } else {
        reported.set(id, index);
      }
    }
    if (entry.k === "state" && isObject(entry.inspect)) {
      const runs = entry.inspect.trace;
      if (!Array.isArray(runs)) {
        continue;
      }
      let last: number | undefined;
      for (const [i, run] of runs.entries()) {
        const id = isObject(run) ? run.id : undefined;
        if (typeof id !== "number" || !Number.isInteger(id)) {
          out.push(
            `state #${index}: inspect().trace[${i}].id ${JSON.stringify(id ?? null)} is not an integer`,
          );
        } else if (last !== undefined && id <= last) {
          out.push(
            `state #${index}: inspect().trace[${i}].id ${id} is not above the id before it (${last}): run ids must be unique and increasing`,
          );
        }
        last = typeof id === "number" ? id : last;
      }
    }
  }

  return out;
}

/** `inspect()` with each `trace` row projected (`traceRunContract`). */
function inspectContract(inspect: Json): Json {
  return isObject(inspect) && Array.isArray(inspect.trace)
    ? { ...inspect, trace: inspect.trace.map(traceRunContract) }
    : inspect;
}

/** The part of an entry that is a contract. */
export function contract(
  entry: TraceEntry,
  drawn: ReadonlySet<string> = new Set(),
): Json {
  switch (entry.k) {
    case "external": {
      // Only the checked position is masked: the marker's `$draw` value.
      const marker = drawMarker(entry);
      if (marker) {
        return {
          k: "external",
          data: [
            marker.resolver,
            marker.attempt,
            { $draw: tag(marker.draw), min: marker.min, max: marker.max },
          ],
        };
      }

      return mask(entry as unknown as Json, NONE);
    }
    case "hook":
    case "observe": {
      if (entry.k === "hook" && entry.hook === "onTraceComplete") {
        return mask(
          {
            k: "hook",
            hook: entry.hook,
            args: entry.args.map((a, i) => (i === 0 ? traceRunContract(a) : a)),
          },
          NONE,
        );
      }
      // How long a drawn resolver took is the sum of its drawn waits.
      const done = completion(entry);
      if (!done || !drawn.has(done.resolver)) {
        return mask(entry as unknown as Json, NONE);
      }
      if (entry.k === "hook") {
        return {
          k: "hook",
          hook: entry.hook,
          args: entry.args.map((a, i) =>
            i === HOOK_DURATION_ARG ? tag(a) : a,
          ),
        };
      }

      return {
        k: "observe",
        event: {
          ...(entry.event as Record<string, Json>),
          duration: tag(done.duration),
        },
      };
    }
    case "state":
      return mask(
        {
          k: "state",
          label: entry.label,
          facts: entry.facts,
          derived: entry.derived,
          inspect: mask(inspectContract(entry.inspect), INSPECT_FIELDS),
        },
        NONE,
      );
    case "console":
      // That a message of this level was printed, with how many arguments,
      // is behaviour; its wording is not.
      return {
        k: "console",
        level: entry.level,
        args: entry.args.map((a) => tag(a)),
      };
    default:
      return mask(entry as unknown as Json, NONE);
  }
}

// ---------------------------------------------------------------------------
// Drawn values

/**
 * What is still asserted of a drawn value, on every trace passed in (the
 * reference's too), for exactly the values `contract` masks:
 *
 * - each drawn-delay marker (`[resolverId, attempt, { $draw, min, max }]`)
 *   lies inside [min, max];
 * - the duration a drawn resolver reports when it completes lies inside the
 *   sum of that resolver's bounds, in the `onResolverComplete` hook and in
 *   the `resolver.complete` observe event alike (a resolver completing twice
 *   in one stream is an error: the sum would span two chains);
 * - a `$draw` anywhere else is an error, so it cannot be masked unchecked.
 *
 * `drawn` is the set `contract` masks (the reference's drawn resolvers);
 * this trace's own drawn resolvers are checked too.
 */
export function drawProblems(
  trace: TraceEntry[],
  drawn: ReadonlySet<string> = drawnResolvers(trace),
): string[] {
  const out: string[] = [];
  const sums = new Map<string, [number, number]>();
  const watched = new Set(drawn);
  for (const [index, entry] of trace.entries()) {
    const marker = drawMarker(entry);
    if (!marker) {
      if (hasDraw(entry as unknown as Json)) {
        out.push(
          `${entry.k} #${index}: ${JSON.stringify(entry)} has a "$draw" outside [resolverId, attempt, { $draw, min, max }] in an external entry, where it would be unchecked`,
        );
      }
      continue;
    }
    watched.add(marker.resolver);
    if (!(marker.min <= marker.draw && marker.draw <= marker.max)) {
      out.push(
        `external #${index}: ${JSON.stringify((entry as { data: Json }).data)} is outside [min, max]`,
      );
    }
    const sum = sums.get(marker.resolver) ?? [0, 0];
    sums.set(marker.resolver, [sum[0] + marker.min, sum[1] + marker.max]);
  }
  const seen = new Set<string>();
  for (const [index, entry] of trace.entries()) {
    const done = completion(entry);
    if (!done || !watched.has(done.resolver)) {
      continue;
    }
    const key = `${done.via} ${done.resolver}`;
    if (seen.has(key)) {
      out.push(
        `${done.via} #${index}: resolver "${done.resolver}" completed more than once; its drawn waits' sum would span two chains`,
      );
      continue;
    }
    seen.add(key);
    const [low, high] = sums.get(done.resolver) ?? [0, 0];
    const took = done.duration;
    if (typeof took !== "number" || took < low || took > high) {
      out.push(
        `${done.via} #${index}: resolver "${done.resolver}" took ${JSON.stringify(took)} ms, outside its drawn waits' [${low}, ${high}]`,
      );
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Alignment

const keyOf = (k: Keyed) => `${k.kind}\u0000${k.step}\u0000${k.phase}`;

/** A console record's arguments as printed (unmasked): `lcs` ties broken by text. */
const printed = (k: Keyed) =>
  k.entry.k === "console" ? JSON.stringify(k.entry.args) : "";

/**
 * In the hook stream, an `onTraceComplete` record's run as compared (the
 * projection's text), and "" for every other hook: `lcs` breaks ties by it,
 * so of the longest pairings the one that pairs the most identical runs is
 * taken. Row (bi) makes 2.0 report a run 1.35 dropped from its ring, in the
 * same step and phase as the runs both report: by keys alone the extra
 * report took the first run's place and every later report was paired with
 * the one before it, a `changed` on each field (fuzz cases 8:all#181,
 * 12:all#149). The pairing is still a longest one, so no record that is
 * missing or extra by keys pairs. Self-test: diff/self/trace-contract.test.ts.
 */
const traceRunText = (k: Keyed, project: (entry: TraceEntry) => Json) =>
  k.entry.k === "hook" && k.entry.hook === "onTraceComplete"
    ? JSON.stringify(project(k.entry))
    : "";

/**
 * A derivation compute's id (`onDerivationCompute`'s first argument, a
 * `derivation.compute` observation's `id`), and "" for every other record:
 * `lcs` breaks ties by it, as for `traceRunText`. By keys alone, 1.35's
 * [b::d0, z::h0] in one step against 2.0's [b::d0] (2.0 computed z::h0 a
 * step earlier, row (bx)'s knock-on) could pair 1.35's z::h0 with 2.0's
 * b::d0, a `changed` on every field, and leave 1.35's b::d0 to a move
 * against 2.0's z::h0 (L12 gate run 3, PR seed 19). The pairing is still a
 * longest one, so no record that is missing or extra by keys pairs.
 * Self-test: diff/self/l12-gate-run4.test.ts.
 */
const computeIdText = (k: Keyed) => {
  const e = k.entry;
  const id =
    e.k === "hook" && e.hook === "onDerivationCompute"
      ? e.args[0]
      : e.k === "observe" &&
          (e.event as { type?: unknown } | null)?.type === "derivation.compute"
        ? (e.event as { id?: Json }).id
        : undefined;

  return typeof id === "string" ? `compute ${id}` : "";
};

/**
 * Longest common subsequence of keys: pairs of matched indexes.
 *
 * With `text` (the console stream: each record's printed arguments, which
 * the contract masks), the pairing is still a longest one, so as many
 * records pair, in each step and phase, as by keys alone; of the longest it
 * takes the one that pairs the most records of identical text. Keys alone
 * paired 2.0's [Y] with the first of 1.35's [X, Y] and left Y unpaired,
 * so `Difference.raw` named the wrong record. Without `text` it is the
 * plain LCS, unchanged.
 */
export function lcs(
  a: string[],
  b: string[],
  text?: [string[], string[]],
  /** Test-only: take the band whenever it fits (diff/self/lcs-bounded.test.ts). */
  alwaysBand = false,
): [number, number][] {
  const n = a.length;
  const m = b.length;
  const sameText = (i: number, j: number) =>
    text === undefined || text[0][i] === text[1][j];
  // Trim the common prefix and suffix: traces mostly agree. Only records
  // identical in key and text are trimmed: some longest pairing with the
  // most identical texts pairs them.
  let start = 0;
  while (
    start < n &&
    start < m &&
    a[start] === b[start] &&
    sameText(start, start)
  ) {
    start++;
  }
  let endA = n;
  let endB = m;
  while (
    endA > start &&
    endB > start &&
    a[endA - 1] === b[endB - 1] &&
    sameText(endA - 1, endB - 1)
  ) {
    endA--;
    endB--;
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i < start; i++) {
    pairs.push([i, i]);
  }
  const rows = endA - start;
  const cols = endB - start;
  if (rows > 0 && cols > 0) {
    alignMiddle(a, b, text, start, rows, cols, pairs, alwaysBand);
  }
  for (let k = 0; k < n - endA; k++) {
    pairs.push([endA + k, endB + k]);
  }

  return pairs;
}

/**
 * The most band cells `alignMiddle` fills (one byte each) before it throws
 * rather than run for minutes: about 2 GB, and well past any trace the suite
 * makes.
 */
export const ALIGN_CELL_LIMIT = 2 ** 31;

/** The most full-table cells (four bytes each, about 2 GB). */
export const TABLE_CELL_LIMIT = 2 ** 29;

/** Tables up to this many cells run whole, without Myers or the band. */
const SMALL_TABLE = 2 ** 22;

/**
 * The middle of `lcs` (rows x cols records past the trimmed prefix and
 * suffix), with the same pairings as the full suffix table it replaced,
 * which filled rows x cols cells synchronously (5.3e9 for a 72k-record
 * fuzz trace: it never finished, and a timeout cannot fire on it).
 *
 * 1. Myers' O((N+M)D) pass finds D, the fewest insertions and deletions
 *    that turn one key list into the other (D = rows + cols - 2L, L the
 *    LCS length). Every longest pairing, with or without `text`, has L
 *    pairs, so D indels; a path through cell (i, j) spends at least
 *    |i - j| indels before it and |(rows - cols) - (i - j)| after, so every
 *    optimal path lies in the band of diagonals where their sum is <= D
 *    (D + 1 diagonals).
 * 2. The suffix table is filled inside the band only, reading 0 for cells
 *    outside it. Values never exceed the full table's (every value is >= 0),
 *    and equal it on every cell of an optimal path, since that path's tail
 *    stays in the band. Each cell keeps only the walk's choice (pair, down,
 *    right), taken with the old rule; two rows of scores are kept.
 * 3. The walk from (0, 0) visits only cells of an optimal path, where the
 *    band value is exact. At such a cell the old rule compares the table at
 *    (i+1, j+1) + score with (i, j), and (i+1, j) with (i, j+1): a neighbour
 *    whose full value is optimal is on an optimal path (exact), and one that
 *    is not has band value <= full value < optimal. So every comparison has
 *    the outcome it had in the full table, and the pairs are identical.
 *    Self-test: diff/self/lcs-bounded.test.ts (the old table as reference).
 *
 * Cost O((rows + cols) D) time and rows x (D + 1) bytes: mostly-equal traces
 * are fast. Tables up to SMALL_TABLE cells run whole. The band is taken
 * only when D <= cols / 4 (a quarter of the
 * table or less; Myers stops there), or when the full table would pass
 * TABLE_CELL_LIMIT; otherwise the old full table runs as it was (`fullTable`),
 * so streams that differ a lot cost what they did. Past both limits it
 * throws, naming the sizes, instead of running on.
 */
function alignMiddle(
  a: string[],
  b: string[],
  text: [string[], string[]] | undefined,
  start: number,
  rows: number,
  cols: number,
  pairs: [number, number][],
  alwaysBand: boolean,
): void {
  // Integer ids for the keys, so comparisons are cheap.
  const ids = new Map<string, number>();
  const idOf = (key: string) => {
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    return id;
  };
  const ka = new Int32Array(rows);
  const kb = new Int32Array(cols);
  for (let i = 0; i < rows; i++) {
    ka[i] = idOf(a[start + i] as string);
  }
  for (let j = 0; j < cols; j++) {
    kb[j] = idOf(b[start + j] as string);
  }

  const tableFits = rows * cols <= TABLE_CELL_LIMIT;
  // A small table (about 10 ms) is cheaper than Myers and the band.
  if (rows * cols <= SMALL_TABLE && !alwaysBand) {
    fullTable(ka, kb, text, start, rows, cols, pairs);

    return;
  }
  const bandMost = Math.floor(ALIGN_CELL_LIMIT / rows) - 1;
  const maxD =
    tableFits && !alwaysBand
      ? Math.min(bandMost, Math.floor(cols / 4))
      : bandMost;
  // D >= |rows - cols|: past maxD already, Myers would only spend time.
  const d = Math.abs(rows - cols) > maxD ? -1 : editDistance(ka, kb, maxD);
  if (d < 0 && tableFits) {
    fullTable(ka, kb, text, start, rows, cols, pairs);

    return;
  }
  if (d < 0) {
    throw new Error(
      `lcs: ${rows} x ${cols} records differ by more than ${maxD} insertions and deletions; the alignment would pass ${ALIGN_CELL_LIMIT} cells`,
    );
  }

  const delta = rows - cols;
  const half = (d - Math.abs(delta)) / 2;
  const kMin = Math.min(0, delta) - half;
  const kMax = Math.max(0, delta) + half;
  const width = kMax - kMin + 1;
  const PAIR = 0;
  const DOWN = 1;
  const RIGHT = 2;
  const choice = new Uint8Array(rows * width);

  const sameText = (i: number, j: number) =>
    text === undefined || text[0][start + i] === text[1][start + j];
  const unit = text === undefined ? 1 : Math.min(rows, cols) + 1;
  // Scores pass 2^32 on large traces: doubles are exact to 2^53.
  let next = new Float64Array(cols + 1);
  let cur = new Float64Array(cols + 1);
  const inBand = (i: number, j: number) =>
    i < rows && j < cols && i - j >= kMin && i - j <= kMax;
  for (let i = rows - 1; i >= 0; i--) {
    const jLo = Math.max(0, i - kMax);
    const jHi = Math.min(cols - 1, i - kMin);
    for (let j = jHi; j >= jLo; j--) {
      const down = inBand(i + 1, j) ? (next[j] as number) : 0;
      const right = inBand(i, j + 1) ? (cur[j + 1] as number) : 0;
      const skip = Math.max(down, right);
      let value = skip;
      let pick = down >= right ? DOWN : RIGHT;
      if (ka[i] === kb[j]) {
        const diag =
          (inBand(i + 1, j + 1) ? (next[j + 1] as number) : 0) +
          unit +
          (text !== undefined && sameText(i, j) ? 1 : 0);
        if (diag >= skip) {
          value = diag;
          pick = PAIR;
        }
      }
      cur[j] = value;
      choice[i * width + (j - i + kMax)] = pick;
    }
    const swap = next;
    next = cur;
    cur = swap;
  }

  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (!inBand(i, j)) {
      throw new Error(`lcs: the walk left the band at ${i}, ${j}`);
    }
    const pick = choice[i * width + (j - i + kMax)];
    if (pick === PAIR) {
      pairs.push([start + i, start + j]);
      i++;
      j++;
    } else if (pick === DOWN) {
      i++;
    } else {
      j++;
    }
  }
}

/** The full suffix table and walk, as `lcs` had them before the band. */
function fullTable(
  ka: Int32Array,
  kb: Int32Array,
  text: [string[], string[]] | undefined,
  start: number,
  rows: number,
  cols: number,
  pairs: [number, number][],
): void {
  const width = cols + 1;
  // A pair scores `unit`, and one more with identical text: `unit` is above
  // the most identical texts a pairing can have, so a longer pairing always
  // scores higher. Without text every pair scores 1 (the plain LCS). The
  // largest score, about min(rows, cols)^2, fits 32 bits within
  // TABLE_CELL_LIMIT.
  const unit = text === undefined ? 1 : Math.min(rows, cols) + 1;
  const score = (i: number, j: number) =>
    unit +
    (text !== undefined && text[0][start + i] === text[1][start + j] ? 1 : 0);
  const table = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      const skip = Math.max(
        table[(i + 1) * width + j] as number,
        table[i * width + j + 1] as number,
      );
      table[i * width + j] =
        ka[i] === kb[j]
          ? Math.max(
              (table[(i + 1) * width + j + 1] as number) + score(i, j),
              skip,
            )
          : skip;
    }
  }
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (
      ka[i] === kb[j] &&
      table[i * width + j] ===
        (table[(i + 1) * width + j + 1] as number) + score(i, j)
    ) {
      pairs.push([start + i, start + j]);
      i++;
      j++;
    } else if (
      (table[(i + 1) * width + j] as number) >=
      (table[i * width + j + 1] as number)
    ) {
      i++;
    } else {
      j++;
    }
  }
}

/**
 * Myers' greedy pass: the fewest insertions and deletions turning `a` into
 * `b`, or -1 past `limit`. O((N + M) D) time, O(N + M) memory.
 */
function editDistance(a: Int32Array, b: Int32Array, limit: number): number {
  const n = a.length;
  const m = b.length;
  const most = Math.min(n + m, limit);
  const offset = most + 1;
  const v = new Int32Array(2 * most + 3);
  for (let d = 0; d <= most; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d ||
        (k !== d &&
          (v[offset + k - 1] as number) < (v[offset + k + 1] as number))
          ? (v[offset + k + 1] as number)
          : (v[offset + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        return d;
      }
    }
  }

  return -1;
}

export function diffJson(
  a: Json | undefined,
  b: Json | undefined,
  path: string,
  out: Array<{ path: string; reference?: Json; candidate?: Json }>,
): void {
  if (a === b) {
    return;
  }
  const isObj = (v: unknown): v is Record<string, Json> | Json[] =>
    typeof v === "object" && v !== null;
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) {
    out.push({ path, reference: a, candidate: b });

    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      diffJson(a[i], b[i], `${path}[${i}]`, out);
    }

    return;
  }
  const ao = a as Record<string, Json>;
  const bo = b as Record<string, Json>;
  for (const key of [
    ...new Set([...Object.keys(ao), ...Object.keys(bo)]),
  ].sort()) {
    diffJson(ao[key], bo[key], path ? `${path}.${key}` : key, out);
  }
}

type Project = (entry: TraceEntry) => Json;

function compareWith(
  reference: TraceEntry[],
  candidate: TraceEntry[],
  engine: string,
  project: Project,
): Difference[] {
  const left = keyTrace(reference);
  const right = keyTrace(candidate);
  const aligned = STREAMS.map((stream) => {
    const a = left.filter((k) => k.stream === stream);
    const b = right.filter((k) => k.stream === stream);

    const runText = (k: Keyed) => traceRunText(k, project) || computeIdText(k);
    const hasCompute = (list: Keyed[]) =>
      list.some((k) => computeIdText(k) !== "");
    const text =
      stream === "console"
        ? ([a.map(printed), b.map(printed)] as [string[], string[]])
        : stream === "hook" &&
            ((a.some((k) => k.kind === "onTraceComplete") &&
              b.some((k) => k.kind === "onTraceComplete")) ||
              (hasCompute(a) && hasCompute(b)))
          ? ([a.map(runText), b.map(runText)] as [string[], string[]])
          : stream === "observe" && hasCompute(a) && hasCompute(b)
            ? ([a.map(computeIdText), b.map(computeIdText)] as [
                string[],
                string[],
              ])
            : undefined;

    return { stream, a, b, pairs: lcs(a.map(keyOf), b.map(keyOf), text) };
  });
  const matchedLeft = new Set<Keyed>();
  const matchedRight = new Set<Keyed>();
  for (const { a, b, pairs } of aligned) {
    for (const [i, j] of pairs) {
      matchedLeft.add(a[i] as Keyed);
      matchedRight.add(b[j] as Keyed);
    }
  }
  const at = new Map([
    ...positions(left, matchedLeft),
    ...positions(right, matchedRight),
  ]);
  const chain = sharedChain(links(reference, candidate, aligned));
  const out: Omit<Difference, "shared">[] = [];
  for (const { stream, a, b, pairs } of aligned) {
    const matchedA = new Set(pairs.map(([i]) => i));
    const matchedB = new Set(pairs.map(([, j]) => j));
    // How many records of `ks` in `k`'s step equal `k` as compared.
    const copies = (ks: Keyed[], k: Keyed) => {
      const record = project(k.entry);

      return ks.filter((x) => {
        if (x.step !== k.step || x.kind !== k.kind) {
          return false;
        }
        const fields: Array<{ path: string }> = [];
        diffJson(project(x.entry), record, "", fields);

        return fields.length === 0;
      }).length;
    };
    const base = (k: Keyed) => ({
      engine,
      stream,
      kind: k.kind,
      step: k.step,
      phase: k.phase,
    });
    for (const [i, j] of pairs) {
      const ka = a[i] as Keyed;
      const kb = b[j] as Keyed;
      const fields: Array<{
        path: string;
        reference?: Json;
        candidate?: Json;
      }> = [];
      diffJson(project(ka.entry), project(kb.entry), "", fields);
      const where = {
        reference: at.get(ka) as Position,
        candidate: at.get(kb) as Position,
      };
      for (const f of fields) {
        out.push({
          ...base(ka),
          op: "changed",
          ...f,
          record: project(ka.entry),
          candidateRecord: project(kb.entry),
          at: { reference: ka.index, candidate: kb.index },
          where,
        });
      }
    }
    a.forEach((k, i) => {
      if (!matchedA.has(i)) {
        out.push({
          ...base(k),
          op: "missing",
          reference: project(k.entry),
          ...(stream === "console" ? { raw: k.entry as unknown as Json } : {}),
          ...(copies(b, k) >= 1 && copies(a, k) > copies(b, k)
            ? { repeat: true as const }
            : {}),
          at: { reference: k.index },
          where: { reference: at.get(k) as Position },
        });
      }
    });
    b.forEach((k, j) => {
      if (!matchedB.has(j)) {
        out.push({
          ...base(k),
          op: "extra",
          candidate: project(k.entry),
          ...(stream === "console" ? { raw: k.entry as unknown as Json } : {}),
          at: { candidate: k.index },
          where: { candidate: at.get(k) as Position },
        });
      }
    });
  }

  return out
    .map((d) => ({ ...d, shared: sharedBefore(chain, d.at) }))
    .sort(
      (x, y) =>
        Math.min(x.at.reference ?? 1e9, x.at.candidate ?? 1e9) -
        Math.min(y.at.reference ?? 1e9, y.at.candidate ?? 1e9),
    );
}

/**
 * The records both traces have, as pairs of trace indexes: each pair the
 * alignment matched, and each step and async marker with the same marker
 * in the other trace (`SharedPoint`).
 */
function links(
  reference: TraceEntry[],
  candidate: TraceEntry[],
  aligned: { a: Keyed[]; b: Keyed[]; pairs: [number, number][] }[],
): [number, number][] {
  const out: [number, number][] = [];
  for (const { a, b, pairs } of aligned) {
    for (const [i, j] of pairs) {
      out.push([(a[i] as Keyed).index, (b[j] as Keyed).index]);
    }
  }
  const markers = (trace: TraceEntry[]) => {
    const found = new Map<string, number>();
    for (const [index, entry] of trace.entries()) {
      if (entry.k === "step" || entry.k === "async") {
        found.set(`${entry.k} ${entry.i}`, index);
      }
    }

    return found;
  };
  const inCandidate = markers(candidate);
  for (const [marker, index] of markers(reference)) {
    const other = inCandidate.get(marker);
    if (other !== undefined) {
      out.push([index, other]);
    }
  }

  return out;
}

/** Contract differences: these fail unless a divergence covers them. */
export function compareContract(
  reference: TraceEntry[],
  candidate: TraceEntry[],
  engine: string,
): Difference[] {
  const drawn = drawnResolvers(reference);

  return compareWith(reference, candidate, engine, (e) => contract(e, drawn));
}

/** Every difference, incidental parts included (for determinism and advisories). */
export function compareFull(
  reference: TraceEntry[],
  candidate: TraceEntry[],
  engine: string,
): Difference[] {
  return compareWith(reference, candidate, engine, (e) => e as unknown as Json);
}

/**
 * Where the streams interleave differently: the first position at which the
 * merged order of (stream, kind) keys differs, or null. Advisory only.
 */
export function interleaving(
  reference: TraceEntry[],
  candidate: TraceEntry[],
): string | null {
  const order = (t: TraceEntry[]) =>
    keyTrace(t).map((k) => `${k.stream}:${k.kind}@${k.step}/${k.phase}`);
  const a = order(reference);
  const b = order(candidate);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return `#${i}: ${a[i] ?? "(end)"} vs ${b[i] ?? "(end)"}`;
    }
  }

  return null;
}
