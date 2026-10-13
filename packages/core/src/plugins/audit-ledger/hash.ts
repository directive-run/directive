/**
 * Hash chain primitives — canonicalization, djb2 dispatch, depth-2
 * freeze, and the in-module tombstone sentinel.
 *
 * The minted-here set is the heart of the tombstone-forgery defense. It MUST
 * live in this single file and MUST NOT be re-exported from the folder's
 * public surface (`./index.ts`). The only surfaces that touch it are
 * `verify()` and the tombstone and truncation-marker factories in `index.ts`,
 * all of which import from this module directly.
 *
 * Hash chain: each entry stores `prevHash` — the djb2 (`hashObject`)
 * hash of the previous entry's stable-stringified payload. Tampering
 * with any entry's payload breaks the next entry's `prevHash` link —
 * visible in `verify()`. v1 ships sync djb2 only; `verify({ strong: true })`
 * is reserved for v2 (SHA-256) and throws today.
 */

import { hashObject } from "../../utils/utils.js";
import type { AuditEntry } from "./types.js";

/**
 * The entries this ledger minted, held off the entries themselves.
 *
 * `verify()` treats two kinds as legitimate chain breaks — an erasure
 * tombstone, and a truncation marker accounting for a rotated prefix. Both are
 * therefore worth forging: a caller holding a raw sink reference who can write
 * one can present tampering as erasure, or a hand-trimmed prefix as routine
 * rotation. Membership here is what separates the ones this module made.
 *
 * Kept in a module-private `WeakSet` rather than as a field on the entry,
 * because every version of "a field on the entry" fails somewhere:
 *
 *  - a string key holding a symbol value is rendered by the canonical
 *    stringifier and dropped by `JSON.stringify`, so it entered the hash but
 *    not the export, and every exported ledger carrying one failed
 *    verification — the same defect this subsystem shipped once before, in a
 *    different field;
 *  - a symbol key is skipped by both, but `Object.getOwnPropertySymbols` on
 *    any genuine entry hands the symbol to a consumer, who can then stamp it
 *    on a forged one.
 *
 * Nothing on the entry means nothing to hash, nothing to serialise, and
 * nothing to steal. The cost is that the mark does not survive export — see
 * `verify()`, which reports that rather than calling an imported ledger's
 * tombstones forged.
 */
const mintedHere = new WeakSet<object>();

/** Record that this module minted `entry`. */
export function markInternal(entry: AuditEntry): void {
  mintedHere.add(entry);
}

/** Whether this module minted `entry`, in this process. */
export function isInternal(entry: AuditEntry): boolean {
  return mintedHere.has(entry);
}

/**
 * Take the entry's own copy of anything it holds a reference to, then freeze
 * that copy.
 *
 * The freeze exists so a consumer cannot mutate a payload in place and forge
 * the chain. It used to freeze whatever it was handed — and what it was handed
 * was the application's own fact value. Recording a change therefore froze
 * application state: reading a nested property afterwards threw a proxy
 * invariant error, so installing the audit plugin broke the system it was
 * auditing.
 *
 * Copying gives the same guarantee and a stronger one. A value mutated after
 * it was recorded no longer changes what the record says, because the record
 * is not holding the caller's object at all.
 *
 * A value that cannot be copied — one carrying a function, or a shape the
 * structured clone algorithm refuses — is kept as-is and left unfrozen. Better
 * a payload that could in principle be mutated than an audit control that
 * mutates the system. The chain still covers it; only the in-process
 * immutability is weaker, and only for values that were never serialisable.
 */
function ownCopy(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

export function freezeEntry(entry: AuditEntry): AuditEntry {
  const record = entry as unknown as Record<string, unknown>;
  for (const key of Object.keys(entry)) {
    const v = record[key];
    if (v !== null && typeof v === "object") {
      const copy = ownCopy(v);
      record[key] = copy;
      if (copy !== v) {
        // Only freeze what this entry owns. An object we failed to copy is
        // still the caller's.
        if (Array.isArray(copy) && key === "whenExplain") {
          for (const clause of copy) {
            if (clause !== null && typeof clause === "object") {
              Object.freeze(clause);
            }
          }
        }
        Object.freeze(copy);
      }
    }
  }
  Object.freeze(entry);

  return entry;
}

// ============================================================================
// Hash chain — canonicalization
// ============================================================================
//
// `syncHash(entry)` calls `hashObject(entry)` which calls
// `stableStringify(entry)` — every entry shape (seq, ts, kind, prevHash,
// hashAlgo, ...payload) is canonicalized via key-sorted JSON, then
// djb2-hashed to a 32-bit hex string.
//
//   - Fast, sync, isomorphic Node/Bun/Deno/browser.
//   - Tamper-DETECTION against accidental + light adversarial probing.
//   - Collision-prone against a determined attacker, by design (32 bits).
//
// Any future change to the canonicalization or hash function breaks
// existing exports, so each entry carries `hashAlgo: "djb2-1"`. Verifiers
// must check that tag matches what they expect.
//
// `verify({ strong: true })` is reserved for v2 (SHA-256 chain via Web
// Crypto). It throws today — there is no silent fallback. v1 ships sync
// djb2 only.

/**
 * The value as an export can carry it.
 *
 * The record's whole point is that it can be handed to someone else and still
 * check out. So an entry holds what JSON can hold, decided once when the entry
 * is written rather than papered over at hashing time. Live and round-tripped
 * hashes then agree because they are hashes of the same data.
 *
 * This was learned the hard way, four times. The canonical stringifier renders
 * a present-but-undefined key and JSON drops it, so an entry holding one
 * hashed differently after an export and anyone checking an exported trail was
 * told it had been altered — by the tool whose only job is answering that
 * question. It happened to a fact's missing prior value, to a marker's
 * provenance stamp, and to the nested shape recorded for an erasure filter.
 * Each fix removed one field rather than the disagreement.
 *
 * An earlier attempt normalised at hashing time instead, and rebuilt every
 * object through `Object.entries` on the way. That erased the stringifier's
 * typed-value handling: a `Date`, a `Map`, a `Set` and a `{}` all hashed
 * alike, so a recorded value could be edited in place and still verify.
 * Projecting at write time keeps the content — a `Date` becomes its timestamp
 * string, a `Map` becomes its entries — so nothing is silently lost and
 * nothing collapses together.
 *
 * What changes shape, and why: a `Date` and a `RegExp` become strings; a `Map`
 * and a `Set` become arrays, which is more than JSON would keep of them on its
 * own; `NaN` and the infinities become `null`, as `JSON.stringify` writes
 * them; a hole or an `undefined` in an array becomes `null`; a key whose value
 * is `undefined`, a function, or a symbol is dropped.
 */
/**
 * Kept below the depth the canonical stringifier walks.
 *
 * The stringifier stops at fifty and writes a marker in place of whatever is
 * below, so anything an entry held down there was in the record and outside
 * the hash — writable in place, and identical to any other payload differing
 * only past that line. Projecting no deeper than the hash reaches means
 * nothing is recorded that is not covered, and content past it is dropped
 * visibly, at the moment of writing.
 */
const MAX_PROJECT_DEPTH = 45;

/**
 * How many values one entry's payload may contribute to the record.
 *
 * Not a size limit for its own sake — it is what keeps the cost of hashing an
 * entry proportional to the entry. Past it the rest is dropped as
 * `"[too-large]"`, visibly, at the moment of writing.
 */
const MAX_PROJECTED_NODES = 10_000;

/**
 * A value in a position JSON writes `null` for rather than omitting.
 *
 * Dropping a key whose value is `undefined` is what an object does; inside an
 * array — and inside the pair arrays a map projects to — there is no key to
 * drop, so the slot has to hold something, and `null` is what an export puts
 * there.
 */
function orNull(value: unknown): unknown {
  return value === undefined ? null : value;
}

/**
 * Record a key as this object's own, whatever the key is called.
 *
 * Plain assignment goes through any setter the prototype chain offers, and
 * `__proto__` has one. So a payload carrying that key — which is anything
 * parsed from external JSON — had the value silently swallowed rather than
 * recorded.
 */
function defineOwn(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export function asRecorded(
  value: unknown,
  depth = 0,
  path?: Set<object>,
  memo?: { left: number },
): unknown {
  if (depth > MAX_PROJECT_DEPTH) return "[max-depth]";
  // Charged for every value produced, not only for the objects walked into.
  // Counting objects alone left the leaves free, so a single object with a few
  // thousand string keys, reached down a shared graph, produced ninety-three
  // megabytes from about two thousand inputs — a bound on the traversal, not
  // on the output, which is the thing that has to be bounded.
  const budget = memo ?? { left: MAX_PROJECTED_NODES };
  if (budget.left <= 0) return "[too-large]";
  budget.left--;
  if (value === null) return null;
  const type = typeof value;
  if (type === "number") {
    return Number.isFinite(value as number) ? value : null;
  }
  if (type === "bigint") return (value as bigint).toString();
  if (type === "string" || type === "boolean") return value;
  if (type !== "object") return undefined;

  const object = value as object;
  // Two structures, doing different jobs.
  //
  // The path set answers "am I inside this object right now?", which is what a
  // cycle is. Tracking it across the whole walk instead — which an earlier
  // version did — treats the second sighting of a shared but perfectly acyclic
  // object as a cycle and returns it unprojected.
  //
  // The budget bounds the whole projection. A graph whose nodes are each
  // referenced twice is a tree of two-to-the-depth when walked, and it is
  // walked twice — once here and once by the canonical stringifier, which does
  // its own path-scoped traversal and cannot be told about sharing. Reusing a
  // projected sub-result makes this pass cheap and leaves the stringifier
  // exponential, so the only thing that bounds both is a limit on how much is
  // produced. Measured before it: twenty-two shared nodes took 4.3 seconds and
  // produced a 37MB entry, and a little deeper took the process with it. One
  // fact value must not be able to do that, least of all through the plugin
  // that is meant to be watching.
  const seen = path ?? new Set<object>();
  if (seen.has(object)) return "[circular]";
  seen.add(object);
  try {
    if (object instanceof Date) {
      return Number.isFinite(object.getTime()) ? object.toISOString() : null;
    }
    if (object instanceof RegExp) return String(object);
    // Every collection stops iterating once the budget is out, rather than
    // producing a marker per remaining slot.
    //
    // The budget bounded the recursion and not the breadth, so a large flat
    // collection still materialised every position: a million-element array is
    // free without this plugin and cost 246ms and a 13.9MB entry with it. The
    // point of the bound is that a fact value cannot decide how much the
    // record does.
    if (object instanceof Map) {
      // Two levels, because that is what this produces: an array of pairs.
      // Charging one let content sit at twice the depth the budget thought it
      // was allowing, which put it back below the line the canonical
      // stringifier walks to — recorded, outside the hash, and editable in
      // place. The depth cap has to count what comes out, not what goes in.
      const pairs: unknown[] = [];
      for (const [k, v] of object) {
        if (budget.left <= 0) {
          pairs.push("[too-large]");
          break;
        }
        pairs.push([
          orNull(asRecorded(k, depth + 2, seen, budget)),
          orNull(asRecorded(v, depth + 2, seen, budget)),
        ]);
      }

      return pairs;
    }
    if (object instanceof Set) {
      const items: unknown[] = [];
      for (const item of object) {
        if (budget.left <= 0) {
          items.push("[too-large]");
          break;
        }
        items.push(orNull(asRecorded(item, depth + 1, seen, budget)));
      }

      return items;
    }
    if (Array.isArray(object)) {
      // Indexed rather than mapped. `map` preserves holes, so a sparse array
      // stayed sparse: the canonical stringifier writes nothing for a hole and
      // JSON writes `null`, which is the same live-versus-export disagreement
      // this file keeps having, reached by a shape nobody thinks to type.
      const items: unknown[] = [];
      for (let index = 0; index < object.length; index++) {
        if (budget.left <= 0) {
          items.push("[too-large]");
          break;
        }
        items.push(orNull(asRecorded(object[index], depth + 1, seen, budget)));
      }

      return items;
    }

    const out: Record<string, unknown> = {};
    // Keys taken one at a time rather than materialised up front.
    //
    // `Object.entries` built the whole list of key-and-value pairs before the
    // budget was consulted, so a payload with a million keys cost 846ms and
    // 47MB of transient heap inside a fact write — bounded in what it recorded
    // and not in what it did to get there. Taking the keys alone brings that to
    // 167ms. The remaining cost is the key list itself, which the language
    // gives no way to walk lazily without also walking the prototype chain.
    for (const key of Object.keys(object)) {
      const item = (object as Record<string, unknown>)[key];
      if (budget.left <= 0) {
        defineOwn(out, "[too-large]", true);
        break;
      }
      const projected = asRecorded(item, depth + 1, seen, budget);
      if (projected === undefined) continue;
      // Defined, not assigned. A key of `__proto__` reaches a setter on the
      // object prototype, so assigning it set this object's prototype instead
      // of recording anything — the content vanished from the entry, and two
      // materially different writes produced byte-identical records that
      // verified clean. `JSON.parse` of anything external can carry that key.
      defineOwn(out, key, projected);
    }

    return out;
  } finally {
    seen.delete(object);
  }
}

function syncHash(entry: AuditEntry): string {
  // stableStringify guarantees same hash across runtimes regardless of
  // key insertion order (architecture review #11, security review C1).
  return hashObject(entry);
}

/**
 * Dispatch to the right hash function based on the entry's `hashAlgo`
 * discriminator. v1 has a single arm (`djb2-1`); the switch is in
 * place so v2 can add `"sha256-1"` without touching call sites.
 *
 * v2 promise: when SHA-256 lands, this becomes `case "sha256-1": return
 * await asyncSha256(entry);` — verify() will become async accordingly.
 */
export function hashForEntry(entry: AuditEntry): string {
  switch (entry.hashAlgo) {
    case "djb2-1":
      return syncHash(entry);
    default:
      throw new Error(
        `[Directive] audit-ledger: unknown hashAlgo "${String((entry as { hashAlgo: unknown }).hashAlgo)}" on entry seq=${entry.seq}. Cannot verify chain integrity. Known algorithms: "djb2-1".`,
      );
  }
}
