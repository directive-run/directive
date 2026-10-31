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
 * keys. Matched entries are compared field by field; unmatched ones are
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
 * alignment), so a fuzz case can be compared exactly up to a difference a
 * signed `ends` divergence covers and no further (scenario.ts `explain`).
 */

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
  op: "missing" | "extra" | "changed";
  /** For `changed`: where inside the entry. */
  path?: string;
  reference?: Json;
  candidate?: Json;
  /** Trace positions, for context. */
  at: { reference?: number; candidate?: number };
  /**
   * When it happens (`Position`): the earliest and the latest of the
   * positions its records have in the two traces. A missing or extra entry
   * is in one trace, so both are its position there; a changed one is in
   * both.
   */
  span: { from: Position; to: Position };
}

// ---------------------------------------------------------------------------
// Trace position

/**
 * Where in a trace a record happens, comparable across the two traces of a
 * comparison: `[step, phase, matched, after]`, compared left to right.
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
 * So the first record each trace has in place of the other's is at the
 * same position in both, the record after it is later, and a matched
 * record is later than the unmatched ones just before it.
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

/** Negative when `a` is earlier than `b`, zero at the same position. */
export function comparePositions(a: Position, b: Position): number {
  for (let i = 0; i < 4; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) {
      return d;
    }
  }

  return 0;
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
          inspect: mask(entry.inspect, INSPECT_FIELDS),
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

/** Longest common subsequence of keys: pairs of matched indexes. */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  // Trim the common prefix and suffix: traces mostly agree.
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) {
    start++;
  }
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
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
    const width = cols + 1;
    const table = new Uint32Array((rows + 1) * width);
    for (let i = rows - 1; i >= 0; i--) {
      for (let j = cols - 1; j >= 0; j--) {
        table[i * width + j] =
          a[start + i] === b[start + j]
            ? (table[(i + 1) * width + j + 1] as number) + 1
            : Math.max(
                table[(i + 1) * width + j] as number,
                table[i * width + j + 1] as number,
              );
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
      if (a[start + i] === b[start + j]) {
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
  for (let k = 0; k < n - endA; k++) {
    pairs.push([endA + k, endB + k]);
  }

  return pairs;
}

function diffJson(
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

    return { stream, a, b, pairs: lcs(a.map(keyOf), b.map(keyOf)) };
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
  const one = (k: Keyed) => {
    const p = at.get(k) as Position;

    return { from: p, to: p };
  };
  const out: Difference[] = [];
  for (const { stream, a, b, pairs } of aligned) {
    const matchedA = new Set(pairs.map(([i]) => i));
    const matchedB = new Set(pairs.map(([, j]) => j));
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
      const [pa, pb] = [at.get(ka) as Position, at.get(kb) as Position];
      const span =
        comparePositions(pa, pb) <= 0
          ? { from: pa, to: pb }
          : { from: pb, to: pa };
      for (const f of fields) {
        out.push({
          ...base(ka),
          op: "changed",
          ...f,
          at: { reference: ka.index, candidate: kb.index },
          span,
        });
      }
    }
    a.forEach((k, i) => {
      if (!matchedA.has(i)) {
        out.push({
          ...base(k),
          op: "missing",
          reference: project(k.entry),
          at: { reference: k.index },
          span: one(k),
        });
      }
    });
    b.forEach((k, j) => {
      if (!matchedB.has(j)) {
        out.push({
          ...base(k),
          op: "extra",
          candidate: project(k.entry),
          at: { candidate: k.index },
          span: one(k),
        });
      }
    });
  }

  return out.sort(
    (x, y) =>
      Math.min(x.at.reference ?? 1e9, x.at.candidate ?? 1e9) -
      Math.min(y.at.reference ?? 1e9, y.at.candidate ?? 1e9),
  );
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
