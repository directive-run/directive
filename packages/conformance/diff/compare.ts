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

/** The part of an entry that is a contract. */
export function contract(entry: TraceEntry): Json {
  switch (entry.k) {
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
  const out: Difference[] = [];
  for (const stream of STREAMS) {
    const a = left.filter((k) => k.stream === stream);
    const b = right.filter((k) => k.stream === stream);
    const pairs = lcs(a.map(keyOf), b.map(keyOf));
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
      for (const f of fields) {
        out.push({
          ...base(ka),
          op: "changed",
          ...f,
          at: { reference: ka.index, candidate: kb.index },
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
  return compareWith(reference, candidate, engine, contract);
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
