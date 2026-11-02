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
 *   approval says which way a count moves (quirk z: 2.0 holds fewer timers).
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
};

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

/** Whether `value` fits `pattern` (`Bound`). */
export function fits(pattern: Json, value: Json | undefined): boolean {
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
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const o = value as Record<string, Json | undefined>;
    const have = Object.keys(o).filter((k) => o[k] !== undefined);

    return (
      have.length === keys.length &&
      keys.every((k) => k in o && fits(pattern[k] as Json, o[k]))
    );
  }
  if (Array.isArray(pattern)) {
    return (
      Array.isArray(value) &&
      value.length === pattern.length &&
      pattern.every((p, i) => fits(p, value[i]))
    );
  }

  return pattern === value;
}

/** A difference's payload, as a `Bound` pattern reads it. */
function payloadOf(d: Difference): Json | undefined {
  if (d.op !== "changed") {
    return d.op === "missing" ? d.reference : d.candidate;
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
      return fits(p, payload);
    }
    const q = p as Record<string, Json>;
    const path = q.path;

    return (
      typeof path === "string" &&
      Object.keys(q).length === 3 &&
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
  const record = d.op === "missing" ? d.reference : d.candidate;

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
      record: (d.op === "missing" ? d.reference : d.candidate) as Json,
    };
  }

  return {
    count: 1,
    path: d.path as string,
    ...(d.reference === undefined ? {} : { from: d.reference }),
    ...(d.candidate === undefined ? {} : { to: d.candidate }),
  };
}
