/**
 * What a signed divergence excuses, by payload (P3-F1; diff/scenario.ts
 * `Divergence`, README "Divergences"): a hand scenario's entry names its
 * records (`Excuse`, with a count `explain` enforces), a fuzz entry bounds
 * them (`Bound`). Free of vitest, so the census (lib/census.ts) and the
 * migration (scripts/fingerprint-divergences.ts) read the same rules.
 */

import type { Difference } from "./compare.js";
import type { Json } from "./normalize.js";

/**
 * One record a hand-scenario entry excuses, `count` times in one run of its
 * scenario. A missing or extra difference names its whole `record` as
 * compared (the 1.35 record for missing, the 2.0 record for extra: the
 * contract projection, diff/compare.ts). A changed difference names the
 * field's full `path` and both values: `from` on 1.35, `to` on the engine
 * under test, each left out when that side has no value there.
 */
export interface Excuse {
  count: number;
  record?: Json;
  path?: string;
  from?: Json;
  to?: Json;
}

/**
 * A fuzz entry's bound on the payloads it excuses: a difference is admitted
 * only when its payload fits one of the patterns in `match` (`fits`). The
 * payload is the record for a missing or extra difference, and
 * `{ path, from, to }` for a changed one (as in `Excuse`, a side with no
 * value is `{ "$like": "absent" }`).
 *
 * A pattern is JSON that must match exactly (the same keys, no more and no
 * fewer; arrays of the same length; equal scalars), except:
 *
 * - `{ "$like": name }` matches any value of the named class (`LIKE`): an
 *   identifier of the fuzz model's naming grammar (a resolver, constraint,
 *   requirement or effect of any module), an integer, or absent;
 * - in a changed pattern's `path`, `[*]` matches any array index;
 * - a changed pattern's `to` may be `{ "$lt": "from" }` (`LOWER`): the
 *   engine under test's value is a number below 1.35's, for a quirk whose
 *   approval says which way a count moves (quirk z: 2.0 holds fewer timers);
 * - a changed pattern may add `record`, a pattern 1.35's whole record must
 *   fit (`Difference.record`), for a change excused only inside a record of
 *   a given shape (row (av): an item changed only in a batch call whose
 *   items repeat on 1.35, `batchItemsRepeated`).
 *
 * Why this bound is honest (P3-F1): a fuzz entry covers a quirk wherever a
 * seed puts it, so the resolver, requirement or attempt it shows up on
 * differs from seed to seed; those are the only parts a pattern leaves
 * open. The record's stream, kind, field names, tags, structure, array
 * lengths and every other value stay literal, so the entry no longer
 * excuses an unrelated record kind, a different field or key, an extra
 * field, or a value outside that grammar. Patterns are generalized
 * (`generalize`) from the records the entry's class showed on the current
 * engines (scripts/fingerprint-divergences.ts).
 */
export interface Bound {
  match: Json[];
}

/** The `$like` classes of a `Bound` pattern. */
export const LIKE: Record<string, (v: Json | undefined) => boolean> = {
  absent: (v) => v === undefined,
  integer: (v) => typeof v === "number" && Number.isInteger(v),
  /** A resolver id, own or namespaced: `r0`, `a::r0`. */
  resolver: (v) => typeof v === "string" && /^([a-z]::)?r\d+$/.test(v),
  /** A constraint id: `c0`, `a::c0`. */
  constraint: (v) => typeof v === "string" && /^([a-z]::)?c\d+$/.test(v),
  /** A requirement type: `A0`. */
  requirementType: (v) => typeof v === "string" && /^[A-Z]\d+$/.test(v),
  /** A requirement id: `A0:{}`. */
  requirementId: (v) => typeof v === "string" && /^[A-Z]\d+:\{\}$/.test(v),
  /** A resolver's record tag: `a.r0`. */
  resolverTag: (v) => typeof v === "string" && /^[a-z]\.r\d+$/.test(v),
  /** An effect's record tag: `a.x0`. */
  effectTag: (v) => typeof v === "string" && /^[a-z]\.x\d+$/.test(v),
  /**
   * 1.35's settle() rejection when its maxWait runs out (its details list
   * what was still in flight): `[Directive] settle() timed out after 5000ms. …`.
   */
  settleTimeout: (v) =>
    typeof v === "string" &&
    /^\[Directive\] settle\(\) timed out after \d+ms\./.test(v),
  /**
   * The error a fuzz resolver's attempt ended with: its own thrown message
   * (`a.r0 attempt 1`) or the engine's timeout of it
   * (`Resolver "a::r0" timed out after 3ms`). One class, not two: the
   * entries that hold an attempt's error (quirk b's) excuse whichever way the
   * attempt failed (their `when`, `resolverRejects`, names both), so a bound
   * that kept the two apart would describe which one a seed happened to show.
   */
  attemptError: (v) =>
    typeof v === "string" &&
    (/^[a-z]\.r\d+ attempt \d+$/.test(v) ||
      /^Resolver "([a-z]::)?r\d+" timed out after \d+ms$/.test(v)),
  /**
   * The error a fuzz derivation or effect throws: `a.d0 throws at 4`,
   * `b.x1 throws at 6`. Quirk b's changed entries read it on the 2.0 side
   * only: 1.35's extra attempt error pairs with 2.0's next error of the
   * stream, which may be a derivation's or an effect's (a pairing shift).
   */
  thrownError: (v) =>
    typeof v === "string" && /^[a-z]\.[dx]\d+ throws at \d+$/.test(v),
  /** A derivation or effect id, own or namespaced: `d0`, `b::x1`. */
  thrower: (v) => typeof v === "string" && /^([a-z]::)?[dx]\d+$/.test(v),
  /** A fuzz fact's key, own or namespaced: `f0`, `a::f1`. */
  fact: (v) => typeof v === "string" && /^([a-z]::)?f\d+$/.test(v),
  /** The batched resolver's id (L7), own or namespaced: `rb`, `a::rb`. */
  batchResolver: (v) => typeof v === "string" && /^([a-z]::)?rb$/.test(v),
  /** A constraint that feeds the batched resolver: `b0`, `a::b1`. */
  batchConstraint: (v) => typeof v === "string" && /^([a-z]::)?b\d+$/.test(v),
  /** A batch requirement's type: `AB`. */
  batchRequirementType: (v) => typeof v === "string" && /^[A-Z]B$/.test(v),
  /** A batch requirement's id: `AB:{"item":"0.1"}`. */
  batchRequirementId: (v) =>
    typeof v === "string" && /^[A-Z]B:\{"item":"\d+\.\d+"\}$/.test(v),
  /** A batch requirement's item, `<source>.<index>`: `0.1`. */
  batchItem: (v) => typeof v === "string" && /^\d+\.\d+$/.test(v),
  /** The batched resolver's record tag: `a.rb`. */
  batchTag: (v) => typeof v === "string" && /^[a-z]\.rb$/.test(v),
  /**
   * A batch call's items (`batchItem`s) where some item repeats: a queue
   * that held one requirement twice, row (av)'s shape on 1.35 (`0.0, 0.0`).
   * Never a class `generalize` picks: an entry names it by hand, so a
   * call of distinct items stays outside it.
   */
  batchItemsRepeated: (v) =>
    Array.isArray(v) &&
    v.every((x) => typeof x === "string" && /^\d+\.\d+$/.test(x)) &&
    new Set(v).size < v.length,
  /**
   * The error a batched call or item ended with: a thrown batch's or
   * fallback run's own message (`a.rb attempt 1`), a with-results item's
   * (`a.rb 0.1 attempt 1`), or the engine's timeout of the batch
   * (`Batch resolver "rb" timed out after 3ms`). One class, as
   * `attemptError` is for a single run.
   */
  batchAttemptError: (v) =>
    typeof v === "string" &&
    (/^[a-z]\.rb( \d+\.\d+)? attempt \d+$/.test(v) ||
      /^Batch resolver "([a-z]::)?rb" timed out after \d+ms$/.test(v)),
  /**
   * One history snapshot as `onSnapshot` passes it (L8; the RFC's T1, T3):
   * exactly `facts`, `id`, `timestamp` and `trigger`. `facts` holds fuzz
   * facts only (`f0`, `a::f1`, the Date fact `when`, `b::when`), with any
   * values; `id` is a positive integer; `timestamp` a number at or above 0
   * (`Date.now` on the fake clock); `trigger` is 1.35's pass label,
   * `facts-changed:` and up to five keys, then `+<n>more` past five
   * (utils/history.ts). The facts are what a seed wrote, so an entry for a
   * snapshot that moved or went missing (rows (as), (ay), (bb)) names this
   * class, never a seed's values. Hand-named: `generalize` never picks it.
   */
  snapshot: (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return false;
    }
    const key = /^([a-z]::)?(f\d+|when)$/;
    const keys = Object.keys(v).sort();
    const { facts, id, timestamp, trigger } = v as Record<string, Json>;

    return (
      keys.join() === "facts,id,timestamp,trigger" &&
      facts !== null &&
      typeof facts === "object" &&
      !Array.isArray(facts) &&
      Object.keys(facts).every((k) => key.test(k)) &&
      typeof id === "number" &&
      Number.isInteger(id) &&
      id > 0 &&
      typeof timestamp === "number" &&
      timestamp >= 0 &&
      typeof trigger === "string" &&
      /^facts-changed:([a-z]::)?(f\d+|when)(,([a-z]::)?(f\d+|when)){0,4}(\+\d+more)?$/.test(
        trigger,
      )
    );
  },
  /**
   * A history record's snapshot ids where some id repeats: row (ba)'s shape
   * on 1.35, whose next id is not moved by an import (E3, H7: `[1, 2, 3, 4,
   * 2]`). Hand-named, as `batchItemsRepeated` is: a list of distinct ids
   * stays outside it.
   */
  snapshotIdsRepeated: (v) =>
    Array.isArray(v) &&
    v.every((x) => typeof x === "number" && Number.isInteger(x)) &&
    new Set(v).size < v.length,
  /**
   * A history record (the fuzz model's `historyRecord`) whose `index` is
   * outside its list: below 0 or at or past `length`. Row (bc)'s shape on
   * 1.35, which imports any `currentIndex` (E2, H15); in the fuzz, the
   * import of an empty history (index -1, length 0, trigger
   * `importedEmpty`). Hand-named.
   */
  historyIndexOutside: (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return false;
    }
    const { index, length } = v as Record<string, Json>;

    return (
      typeof index === "number" &&
      typeof length === "number" &&
      Number.isInteger(index) &&
      (index < 0 || index >= length)
    );
  },
};

/**
 * The `$text` classes of a `Bound` pattern: the wording of a console
 * argument, which the contract masks (`{ "$incidental": "string" }`,
 * diff/compare.ts). `{ "$text": name }` stands where that mask is, in a
 * missing or extra console entry's pattern, and matches only an argument the
 * engine printed in the named wording (`Difference.raw`), so an entry can
 * name the one development warning its approval is for. Every other console
 * comparison still sees the mask only.
 */
export const TEXT: Record<string, (v: Json | undefined) => boolean> = {
  /**
   * The development warning a fuzz resolver's error prints when no error
   * strategy handles it, once per source (packages/core errors.ts, and
   * core-next's api/core.ts, word for word): `[Directive] resolver "a::r0"
   * threw: a.r0 attempt 1. Requirement "A0" stays unmet. The default error
   * strategy skips it silently. …`. The error is a fuzz attempt's own
   * (`attemptError`: its thrown message or its timeout, the full stop the
   * warning adds in place of the message's own), and the sentence on the
   * requirement is there unless the requirement was already met. Quirk b's
   * console entry names it: 1.35 spends it on the extra error after a cancel.
   */
  resolverThrew: (v) =>
    typeof v === "string" &&
    /^\[Directive\] resolver "([a-z]::)?r\d+" threw: ([a-z]\.r\d+ attempt \d+|Resolver "([a-z]::)?r\d+" timed out after \d+ms)\.( Requirement "[A-Z]\d+" stays unmet\.)? The default error strategy skips it silently\. Configure errorBoundary\.onResolverError \(or errorBoundary\.onError\) to handle it; this warning shows once per source and only in development\.$/.test(
      v,
    ),
  /**
   * The development warning for a Date written to a fuzz module's Date
   * fact `when`, by the fact's internal key (`a::when`, `b::when`), word
   * for word as both engines print it (packages/core tracking.ts
   * `warnNonJsonFactAssignment`, core-next api/facts.ts `warnNonJson`):
   * `[Directive] Fact "a::when" assigned a Date instance.\nFacts must be
   * JSON-roundtrippable …`. Row o's fuzz entry names it: 1.35 prints the
   * warning by the module-qualified name (`a.when`) and again by this key,
   * 2.0 by the module-qualified name only.
   */
  dateWriteByKey: (v) =>
    typeof v === "string" &&
    /^\[Directive\] Fact "[a-z]::when" assigned a Date instance\.\nFacts must be JSON-roundtrippable for reactivity to work correctly\.\nDate mutations are not tracked\.\nUse \.getTime\(\) for timestamps instead\.\nSee: https:\/\/directive\.run\/docs\/facts#json-rule$/.test(
      v,
    ),
  /**
   * The error 1.35 logs when `history.import()` rejects its data (E2,
   * utils/history.ts: `console.error("[Directive] Failed to import history
   * data:", error)`), its first argument word for word. Row (bc)'s entry
   * names it: 2.0 with (bc) rejects an index outside the list, which 1.35
   * imports, so 2.0 logs this where 1.35 logs nothing (`importedEmpty`).
   */
  historyImportFailed: (v) =>
    typeof v === "string" && v === "[Directive] Failed to import history data:",
};

/** The masked form of a string the contract hides (diff/compare.ts `tag`). */
function isMaskedString(v: Json | undefined): boolean {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length === 1 &&
    v.$incidental === "string"
  );
}

/** A changed pattern's `to` that requires a number below the `from` value. */
export const LOWER = { $lt: "from" } as const;

/** Whether `p` is `LOWER`. */
export function isLower(p: Json | undefined): boolean {
  return (
    p !== null &&
    typeof p === "object" &&
    !Array.isArray(p) &&
    Object.keys(p).length === 1 &&
    p.$lt === "from"
  );
}

/**
 * Whether `value` fits `pattern` (`Bound`). `raw` is the same place in the
 * record before the contract masked it (`Difference.raw`), walked alongside
 * `value` and read only by a `$text` pattern; without it a `$text` pattern
 * matches nothing.
 */
export function fits(
  pattern: Json,
  value: Json | undefined,
  raw?: Json,
): boolean {
  if (
    pattern !== null &&
    typeof pattern === "object" &&
    !Array.isArray(pattern)
  ) {
    const keys = Object.keys(pattern);
    if (keys.length === 1 && keys[0] === "$like") {
      const test = LIKE[pattern.$like as string];

      return test?.(value) === true;
    }
    if (keys.length === 1 && keys[0] === "$text") {
      const test = TEXT[pattern.$text as string];

      return isMaskedString(value) && test?.(raw) === true;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const o = value as Record<string, Json | undefined>;
    const have = Object.keys(o).filter((k) => o[k] !== undefined);
    const r =
      raw !== null && typeof raw === "object" && !Array.isArray(raw)
        ? raw
        : undefined;

    return (
      have.length === keys.length &&
      keys.every((k) => k in o && fits(pattern[k] as Json, o[k], r?.[k]))
    );
  }
  if (Array.isArray(pattern)) {
    const r = Array.isArray(raw) ? raw : undefined;

    return (
      Array.isArray(value) &&
      value.length === pattern.length &&
      pattern.every((p, i) => fits(p, value[i], r?.[i]))
    );
  }

  return pattern === value;
}

/**
 * The record a missing, extra or moved difference names: 1.35's for missing
 * and moved (a moved record's other fields are `changed` differences of
 * their own), the engine's for extra.
 */
export function recordOf(d: Difference): Json | undefined {
  return d.op === "extra" ? d.candidate : d.reference;
}

/** A difference's payload, as a `Bound` pattern reads it. */
function payloadOf(d: Difference): Json | undefined {
  if (d.op !== "changed") {
    return recordOf(d);
  }

  return { path: d.path ?? "", from: d.reference, to: d.candidate } as Json;
}

/** Whether `path` fits a pattern's path, where `[*]` is any index. */
export function pathFits(pattern: string, path: string): boolean {
  const literal = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(
    `^${pattern.split("[*]").map(literal).join("\\[\\d+\\]")}$`,
  ).test(path);
}

/** Whether bound `b` admits difference `d` (`Bound`). */
export function admits(b: Bound, d: Difference): boolean {
  const payload = payloadOf(d);

  return b.match.some((p) => {
    if (d.op !== "changed") {
      return fits(p, payload, d.raw);
    }
    const q = p as Record<string, Json>;
    const path = q.path;

    const keys = Object.keys(q).sort().join();

    return (
      typeof path === "string" &&
      (keys === "from,path,to" ||
        (keys === "from,path,record,to" && fits(q.record as Json, d.record))) &&
      pathFits(path, d.path ?? "") &&
      fits(q.from as Json, d.reference) &&
      (isLower(q.to)
        ? typeof d.reference === "number" &&
          typeof d.candidate === "number" &&
          d.candidate < d.reference
        : fits(q.to as Json, d.candidate))
    );
  });
}

/** The `LIKE` classes `generalize` reads a value as, first match wins. */
const ORDER = [
  "integer",
  "requirementId",
  "requirementType",
  "resolver",
  "constraint",
  "resolverTag",
  "effectTag",
  "attemptError",
  "batchResolver",
  "batchConstraint",
  "batchRequirementType",
  "batchRequirementId",
  "batchItem",
  "batchTag",
  "batchAttemptError",
];

/**
 * `v` with every string of a `LIKE` identifier class and every integer
 * replaced by that class, and an absent value by `absent`. A class already
 * in place (`{ "$like": name }`, a pattern being re-generalized with the
 * current classes) stays as it is.
 */
export function generalizeValue(v: Json | undefined): Json {
  if (v === undefined) {
    return { $like: "absent" };
  }
  const like = ORDER.find((name) => LIKE[name]?.(v));
  if (like) {
    return { $like: like };
  }
  if (Array.isArray(v)) {
    return v.map(generalizeValue);
  }
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    if (keys.length === 1 && keys[0] === "$like") {
      return v;
    }

    return Object.fromEntries(keys.map((k) => [k, generalizeValue(v[k])]));
  }

  return v;
}

/**
 * The pattern a fuzz difference generalizes to: every string of a `LIKE`
 * identifier class and every integer becomes that class, every absent side
 * `absent` (`generalizeValue`); and in a changed difference's path, the
 * indices after `prefix` (the entry's own `path`) become `[*]`. Everything
 * else stays literal.
 */
export function generalize(d: Difference, prefix?: string): Json {
  if (d.op !== "changed") {
    return generalizeValue(payloadOf(d));
  }
  const path = d.path ?? "";
  const head = prefix && path.startsWith(prefix) ? prefix : "";

  return {
    path: head + path.slice(head.length).replace(/\[\d+\]/g, "[*]"),
    from: generalizeValue(d.reference),
    to: generalizeValue(d.candidate),
  };
}

/** Key-order-independent JSON; a key whose value is undefined is left out. */
export function canonicalJson(value: Json | undefined): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, Json | undefined>;

    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }

  return value === undefined ? "undefined" : JSON.stringify(value);
}

/** One side of a changed excuse: its value, or absent when it has none. */
function sameSide(
  x: Excuse,
  side: "from" | "to",
  value: Json | undefined,
): boolean {
  return side in x
    ? value !== undefined && canonicalJson(x[side]) === canonicalJson(value)
    : value === undefined;
}

/** Whether excuse `x` names difference `d`'s record (`Excuse`). */
export function names(x: Excuse, d: Difference): boolean {
  if (d.op === "changed") {
    return (
      !("record" in x) &&
      x.path === d.path &&
      sameSide(x, "from", d.reference) &&
      sameSide(x, "to", d.candidate)
    );
  }
  const record = recordOf(d);

  return (
    !("path" in x) &&
    !("from" in x) &&
    !("to" in x) &&
    record !== undefined &&
    canonicalJson(x.record) === canonicalJson(record)
  );
}

/** The fingerprint of difference `d`: the `Excuse` that names it, count 1. */
export function excuseFor(d: Difference): Excuse {
  if (d.op !== "changed") {
    return {
      count: 1,
      record: recordOf(d) as Json,
    };
  }

  return {
    count: 1,
    path: d.path as string,
    ...(d.reference === undefined ? {} : { from: d.reference }),
    ...(d.candidate === undefined ? {} : { to: d.candidate }),
  };
}
