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
  /** A derivation id, own or namespaced: `d0`, `a::d0`. */
  derivation: (v) => typeof v === "string" && /^([a-z]::)?d\d+$/.test(v),
  /** A requirement type: `A0`. */
  requirementType: (v) => typeof v === "string" && /^[A-Z]\d+$/.test(v),
  /** A requirement id: `A0:{}`. */
  requirementId: (v) => typeof v === "string" && /^[A-Z]\d+:\{\}$/.test(v),
  /**
   * A keyed resolver's requirement id (L11): the key's answer for a fuzz
   * requirement, its bare type, plain or JSON-quoted (`A0`, `"A0"`), quotes
   * paired. Quirk b's keyed twins name it for `id` and `requirementId`, where
   * the originals name `requirementId`; any other id shape (`A0:{}`, `a0`,
   * `"A0`) is outside it. Added on the owner's instruction (2026-11-18:
   * "Approve; you sign them (Recommended)") under quirk b's approval.
   * Hand-named: `generalize` never picks it.
   */
  keyedRequirementId: (v) =>
    typeof v === "string" && /^("?)[A-Z]\d+\1$/.test(v),
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
  /**
   * The error a fuzz derivation throws, derivations only: `a.d2 throws at
   * 4` (row (bx)'s knock-on entries, L12 gate run 3). Hand-named.
   */
  derivationThrownMessage: (v) =>
    typeof v === "string" && /^[a-z]\.d\d+ throws at \d+$/.test(v),
  /**
   * A fuzz derivation's value: a boolean (a threshold), a number (a sum) or
   * a string (an L11 `$template`). Hand-named.
   */
  derivedValue: (v) =>
    typeof v === "boolean" ||
    typeof v === "string" ||
    (typeof v === "number" && Number.isFinite(v)),
  /**
   * A derivation's dependency keys as `onDerivationCompute` passes them:
   * fuzz fact or derivation keys, own or namespaced (`f0`, `a::d1`, the
   * Date fact `when`, the L11 string fact `tx`), and a derivation read by
   * another as 1.35 and 2.0 name it, `derive.<id>` (`derive.d0`,
   * `derive.a::d0`; L12 gate run 4, PR seed 2), and the `module` step's
   * module's facts `z::g0`, `z::g1` (PR seed 19). Hand-named.
   */
  dependencyKeys: (v) =>
    Array.isArray(v) &&
    v.every(
      (x) =>
        typeof x === "string" &&
        (/^([a-z]::)?([fd]\d+|when|tx)$/.test(x) ||
          /^derive\.([a-z]::)?d\d+$/.test(x) ||
          /^z::g[01]$/.test(x)),
    ),
  /**
   * A derivation a distributable snapshot can hold (row (bx)'s knock-on,
   * L12 gate run 4): a fuzz derivation (`derivation`), or `z::h0`, the one
   * derivation of the module a `module` step registers (diff/fuzz/model.ts
   * `extraModule`; PR seed 19). Hand-named.
   */
  snapshotDerivation: (v) =>
    typeof v === "string" && /^(([a-z]::)?d\d+|z::h0)$/.test(v),
  /**
   * A distributable snapshot as a watch passes it (L12): `createdAt` and
   * `data`, a plain object, with `version` (a string) and `expiresAt` (an
   * integer) when the options ask for them. Row (bx)'s fuzz entry names it.
   * Hand-named.
   */
  distributableSnapshot: (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return false;
    }
    const o = v as Record<string, Json | undefined>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined);
    const allowed = new Set(["createdAt", "data", "version", "expiresAt"]);

    return (
      keys.every((k) => allowed.has(k)) &&
      Number.isInteger(o.createdAt) &&
      o.data !== null &&
      typeof o.data === "object" &&
      !Array.isArray(o.data) &&
      (o.version === undefined || typeof o.version === "string") &&
      (o.expiresAt === undefined || Number.isInteger(o.expiresAt))
    );
  },
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
  /** A batch call's items: one or more batch items (`0.1`), repeats allowed. */
  batchItems: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => typeof x === "string" && /^\d+\.\d+$/.test(x)),
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
   * exactly `facts`, `id`, `ordered` and `trigger`. `facts` holds fuzz
   * facts only (`f0`, `a::f1`, the Date fact `when`, `b::when`), with any
   * values; `id` is a positive integer; `ordered` is true: the recorder
   * replaces the snapshot's `timestamp` (`Date.now` on the fake clock, which
   * the two engines' clocks can end at different times) with whether it is
   * at or after the engine's previous snapshot (diff/record.ts, rule 4);
   * `trigger` is 1.35's pass label,
   * `facts-changed:` and up to five keys, then `+<n>more` past five
   * (utils/history.ts). Fact keys include `tx`, the L11 fuzz's string fact
   * (diff/fuzz/model.ts), on the owner's instruction (2026-11-18: "Approve;
   * you sign them (Recommended)") under row (ay)'s approval. The facts are what a seed wrote, so an entry for a
   * snapshot that moved or went missing (rows (as), (ay), (bb)) names this
   * class, never a seed's values. Hand-named: `generalize` never picks it.
   */
  snapshot: (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return false;
    }
    const key = /^([a-z]::)?(f\d+|when|tx)$/;
    const keys = Object.keys(v).sort();
    const { facts, id, ordered, trigger } = v as Record<string, Json>;

    return (
      keys.join() === "facts,id,ordered,trigger" &&
      facts !== null &&
      typeof facts === "object" &&
      !Array.isArray(facts) &&
      Object.keys(facts).every((k) => key.test(k)) &&
      typeof id === "number" &&
      Number.isInteger(id) &&
      id > 0 &&
      ordered === true &&
      typeof trigger === "string" &&
      /^facts-changed:([a-z]::)?(f\d+|when|tx)(,([a-z]::)?(f\d+|when|tx)){0,4}(\+\d+more)?$/.test(
        trigger,
      )
    );
  },
  /**
   * One history snapshot of an L10 case: `snapshot`'s shape, with the fact
   * keys the L10 fuzz adds besides the seed's facts (diff/fuzz/model.ts):
   * `zf` and `zw`, which a dynamic case gives module a, and `g0` and `g1`,
   * the facts of the module a `module` step registers (`extraModule`), each
   * bare or under one namespace (`a::zf`, `z::g0`). At least one of the four
   * must be there, so a snapshot `snapshot` already names is outside it.
   * Only the L10 (ay) entry names it: an L8 entry keeps `snapshot`, so a
   * snapshot that carries a registered module's facts (the RFC's H1) is
   * never covered by an entry written before modules were drawn. Hand-named,
   * as `snapshot` is.
   */
  snapshotDynamic: (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return false;
    }
    const name = "(f\\d+|when|tx|zf|zw|g0|g1)";
    const key = new RegExp(`^([a-z]::)?${name}$`);
    const added = /^([a-z]::)?(zf|zw|g0|g1)$/;
    const keys = Object.keys(v).sort();
    const { facts, id, ordered, trigger } = v as Record<string, Json>;
    if (
      facts === null ||
      typeof facts !== "object" ||
      Array.isArray(facts) ||
      typeof trigger !== "string"
    ) {
      return false;
    }
    const factKeys = Object.keys(facts);
    const changed = `([a-z]::)?${name}`;

    return (
      keys.join() === "facts,id,ordered,trigger" &&
      factKeys.every((k) => key.test(k)) &&
      factKeys.some((k) => added.test(k)) &&
      typeof id === "number" &&
      Number.isInteger(id) &&
      id > 0 &&
      ordered === true &&
      new RegExp(
        `^facts-changed:${changed}(,${changed}){0,4}(\\+\\d+more)?$`,
      ).test(trigger)
    );
  },
  /**
   * One history snapshot of an L10 case taken for a write that is not module
   * z's: `snapshotDynamic` whose label names neither `g0` nor `g1`. The
   * facts may hold module z's (a module registered before the write), but
   * registerModule's own snapshot (`facts-changed:z::g0,z::g1`, its init)
   * and a write of module z are outside. Only the L10 unannounced (ay) twin
   * names it, so a missing registerModule snapshot (the RFC's H1) still needs
   * the paused record `snapshotDynamic`'s entry requires. Hand-named.
   */
  snapshotDynamicWrite: (v) =>
    LIKE.snapshotDynamic?.(v) === true &&
    !/(^facts-changed:|,)([a-z]::)?g[01](,|\+|$)/.test(
      (v as { trigger: string }).trigger,
    ),
  /**
   * A derivation id that can compute an `assign`ed object form (row (bl)):
   * a static one (`d0`, `a::d1`), the define pool's dynamic `z0` and `z1`
   * (`dynamicId`), or module a's reader `zin`, which reads `z0`. Hand-named:
   * only the (bl) entry names it.
   */
  dynamicDerivation: (v) =>
    typeof v === "string" && /^([a-z]::)?(d\d+|z[01]|zin)$/.test(v),
  /**
   * A fact key a history restore writes in a fuzz case: a seed's fact
   * (`f0`, `b::f2`), the Date fact `when`, an L10 dynamic case's `zf` and
   * `zw`, or module z's `g0` and `g1`, bare or under one namespace. Row (be):
   * a `back` of more than one step after a closed changeset lands on another
   * snapshot, so the restore's batch names another key first. Hand-named:
   * only the (be) entry names it.
   */
  historyFactKey: (v) =>
    typeof v === "string" && /^([a-z]::)?(f\d+|when|z[fw]|g\d+)$/.test(v),
  /**
   * A settled trace run that started a resolver: what row (bi) makes 2.0
   * report when 1.35 pushed the run out of its ring while that resolver ran
   * (L9). Hand-named, as `snapshot` is, because a run has 15 keys and lists
   * of any length: exactly a trace run's keys (`anomalies` only when it has
   * one, as 1.35 writes it), `status` "settled", a non-empty
   * `resolversStarted` whose rows name a resolver and a requirement, and the
   * other lists as lists. A run that started no resolver settles at once
   * and reports on both engines, so it is outside the class.
   */
  traceRunWithResolvers: (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return false;
    }
    const run = v as Record<string, Json>;
    const keys = Object.keys(run)
      .filter((k) => k !== "anomalies")
      .sort()
      .join();
    const lists = [
      "constraintsHit",
      "derivationsRecomputed",
      "effectErrors",
      "effectsRun",
      "factChanges",
      "requirementsAdded",
      "requirementsRemoved",
      "resolversCompleted",
      "resolversErrored",
    ];
    const started = run.resolversStarted;

    return (
      keys ===
        "causalChain,constraintsHit,derivationsRecomputed,duration,effectErrors,effectsRun,factChanges,id,requirementsAdded,requirementsRemoved,resolversCompleted,resolversErrored,resolversStarted,status,timestamp" &&
      (run.anomalies === undefined ||
        (Array.isArray(run.anomalies) && run.anomalies.length > 0)) &&
      run.status === "settled" &&
      typeof run.causalChain === "string" &&
      lists.every((k) => Array.isArray(run[k])) &&
      Array.isArray(started) &&
      started.length > 0 &&
      started.every(
        (row) =>
          row !== null &&
          typeof row === "object" &&
          !Array.isArray(row) &&
          typeof (row as Record<string, Json>).resolver === "string" &&
          typeof (row as Record<string, Json>).requirementId === "string",
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
  /**
   * The error object that follows `historyImportFailed` when 2.0 rejects an
   * import by row (bc) (core-next api/history.ts), as the recorder keeps it
   * (`{ $error: { name, message } }`), its message word for word: "[Directive]
   * Invalid history data: currentIndex must be the index of a snapshot". The
   * contract masks the whole object (`{ "$incidental": "object" }`); this
   * class reads the record before the mask, so the (bc) console entry excuses
   * only (bc)'s own failure, and any other import failure (a bad snapshot
   * list, a non-number index) stays unexplained.
   */
  /**
   * Row (bx)'s knock-on (L12 gate run 3): the development warning 2.0's
   * extra distributable-snapshot read prints when a fuzz derivation throws
   * (core-next api/distributable.ts), word for word:
   * `[Directive] getDistributableSnapshot: Skipping derivation "a::d2" due
   * to error:`. Only a derivation id, plain or namespaced. Hand-named.
   */
  distributableSkipped: (v) =>
    typeof v === "string" &&
    /^\[Directive\] getDistributableSnapshot: Skipping derivation "([a-z]::)?d\d+" due to error:$/.test(
      v,
    ),
  /**
   * The error that warning carries: a fuzz derivation's own thrown error,
   * exactly `{ $error: { name: "Error", message: "a.d2 throws at 4" } }`
   * (an effect's, `a.x0 throws at 4`, is outside it). Hand-named.
   */
  derivationThrown: (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return false;
    }
    const e = (v as Record<string, Json>).$error;
    if (e === null || typeof e !== "object" || Array.isArray(e)) {
      return false;
    }
    const o = e as Record<string, Json>;

    return (
      Object.keys(v).length === 1 &&
      Object.keys(o).length === 2 &&
      o.name === "Error" &&
      typeof o.message === "string" &&
      /^[a-z]\.d\d+ throws at \d+$/.test(o.message)
    );
  },
  historyIndexNotASnapshot: (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return false;
    }
    const e = (v as Record<string, Json>).$error;
    if (e === null || typeof e !== "object" || Array.isArray(e)) {
      return false;
    }
    const o = e as Record<string, Json>;

    return (
      Object.keys(v).length === 1 &&
      Object.keys(o).length === 2 &&
      o.name === "Error" &&
      o.message ===
        "[Directive] Invalid history data: currentIndex must be the index of a snapshot"
    );
  },
};

/**
 * The masked form of a string or an object the contract hides
 * (diff/compare.ts `tag`): where a `$text` pattern may stand.
 */
function isMaskedString(v: Json | undefined): boolean {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length === 1 &&
    (v.$incidental === "string" || v.$incidental === "object")
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

/** One ledger entry as the fuzz's `ledger` step records it (`query({})`). */
type LedgerEntry = Record<string, Json>;

const LEDGER_LABEL = JSON.stringify({ op: "ledger" });

const NAVIGATE_KEYS = "from,hashAlgo,kind,prevHash,schemaVersion,seq,to,ts";

/** `a` and `b` are the same entry but for `seq` and `prevHash`. */
function sameButChain(a: Json | undefined, b: Json | undefined): boolean {
  if (!isEntry(a) || !isEntry(b)) {
    return false;
  }
  const rest = (e: LedgerEntry) =>
    canonicalJson(
      Object.fromEntries(
        Object.entries(e).filter(([k]) => k !== "seq" && k !== "prevHash"),
      ),
    );

  return rest(a) === rest(b);
}

function isEntry(v: Json | undefined): v is LedgerEntry {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Whether 2.0's ledger entries (`b`, newest first, as `query({})` lists
 * them) are 1.35's (`a`) with at least one `system.history.navigate`
 * entry inserted (row (az)). Read oldest first, each 2.0 entry either is
 * 1.35's next entry, equal but for its `seq` (1.35's plus the navigate
 * entries inserted before it) and its `prevHash` (1.35's until the first
 * insertion, a djb2 hex after it, since the chain now covers the inserted
 * entry), or is an inserted navigate entry: that kind, an integer `from`,
 * `to`, `seq` and `ts`, 1.35's `hashAlgo` and `schemaVersion`, and no
 * other field. Every 1.35 entry is used, in order.
 */
function navigateInserted(a: Json[], b: Json[]): boolean {
  const ref = [...a].reverse();
  const cand = [...b].reverse();
  let i = 0;
  let inserted = 0;
  for (const e of cand) {
    if (!isEntry(e)) {
      return false;
    }
    const next = ref[i];
    if (sameButChain(next, e) && isEntry(next)) {
      const seqOk =
        typeof next.seq === "number" &&
        typeof e.seq === "number" &&
        e.seq === next.seq + inserted;
      const hashOk =
        inserted === 0
          ? e.prevHash === next.prevHash
          : typeof e.prevHash === "string" &&
            /^[0-9a-f]{1,8}$/.test(e.prevHash);
      if (!seqOk || !hashOk) {
        return false;
      }
      i += 1;
      continue;
    }
    const shape = Object.keys(e).sort().join();
    const like = ref[0] as LedgerEntry | undefined;
    if (
      shape !== NAVIGATE_KEYS ||
      e.kind !== "system.history.navigate" ||
      ![e.from, e.to, e.seq, e.ts].every(
        (v) => typeof v === "number" && Number.isInteger(v),
      ) ||
      typeof e.prevHash !== "string" ||
      !/^[0-9a-f]{1,8}$/.test(e.prevHash) ||
      like === undefined ||
      e.hashAlgo !== like.hashAlgo ||
      e.schemaVersion !== like.schemaVersion
    ) {
      return false;
    }
    inserted += 1;
  }

  return i === ref.length && inserted > 0;
}

/**
 * Classes of a changed pattern's `pair` (`{ path, pair }`): each judges
 * 1.35's whole record and the engine under test's whole record together
 * (`Difference.record`, `candidateRecord`), so a field-by-field change is
 * excused only when the two records stand in the named relation. Each is
 * hand-named for one approved row; `generalize` never picks one.
 */
export const PAIR: Record<
  string,
  (reference: Json | undefined, candidate: Json | undefined) => boolean
> = {
  /**
   * Row (az) in the audit ledger (L12c): 2.0's `replay()` and `import()`
   * call `onHistoryNavigate`, which the ledger records as a
   * `system.history.navigate` entry; 1.35 does not. So a fuzz `ledger`
   * step's two records differ only so: `verify()` reports a higher
   * `entryCount` with every other field equal, and the entries are 1.35's
   * with navigate entries inserted (`navigateInserted`). Added on the
   * owner's instruction, under row (az)'s approval ("Approve all as
   * recommended (Recommended)", 2026-11-10).
   */
  ledgerNavigateInserted: (referenceRecord, candidateRecord) => {
    const dataOf = (r: Json | undefined) =>
      isEntry(r) && r.k === "external" && Object.keys(r).length === 2
        ? r.data
        : undefined;
    const reference = dataOf(referenceRecord);
    const candidate = dataOf(candidateRecord);
    if (
      !Array.isArray(reference) ||
      !Array.isArray(candidate) ||
      reference[0] !== LEDGER_LABEL ||
      candidate[0] !== LEDGER_LABEL ||
      reference.length !== candidate.length
    ) {
      return false;
    }
    if (reference.length === 2) {
      const [, r] = reference;
      const [, c] = candidate;
      if (!isEntry(r) || !isEntry(c)) {
        return false;
      }
      const rest = (e: LedgerEntry) =>
        canonicalJson(
          Object.fromEntries(
            Object.entries(e).filter(([k]) => k !== "entryCount"),
          ),
        );

      return (
        typeof r.entryCount === "number" &&
        typeof c.entryCount === "number" &&
        c.entryCount > r.entryCount &&
        r.valid === true &&
        rest(r) === rest(c)
      );
    }
    if (reference.length === 3) {
      const [, rTag, r] = reference;
      const [, cTag, c] = candidate;

      return (
        rTag === "entries" &&
        cTag === "entries" &&
        Array.isArray(r) &&
        Array.isArray(c) &&
        navigateInserted(r, c)
      );
    }

    return false;
  },
};

/**
 * Whether `path` is `prefix` or inside it (a `pair` pattern's path: the two
 * records are judged whole, so any field under the prefix may differ).
 */
export function pathWithin(prefix: string, path: string): boolean {
  return (
    path === prefix ||
    path.startsWith(`${prefix}.`) ||
    path.startsWith(`${prefix}[`)
  );
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
        (keys === "from,path,record,to" && fits(q.record as Json, d.record)) ||
        (keys === "pair,path" &&
          typeof q.pair === "string" &&
          PAIR[q.pair]?.(d.record, d.candidateRecord) === true &&
          pathWithin(path, d.path ?? ""))) &&
      (keys === "pair,path" ||
        (pathFits(path, d.path ?? "") &&
          fits(q.from as Json, d.reference) &&
          (isLower(q.to)
            ? typeof d.reference === "number" &&
              typeof d.candidate === "number" &&
              d.candidate < d.reference
            : fits(q.to as Json, d.candidate))))
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
