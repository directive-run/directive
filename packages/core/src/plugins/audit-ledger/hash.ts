/**
 * Hash chain primitives — canonicalization, djb2 dispatch, depth-2
 * freeze, and the in-module tombstone sentinel.
 *
 * `LEDGER_INTERNAL_TOKEN` is the heart of the tombstone-forgery defense.
 * It MUST live in this single file and MUST NOT be re-exported
 * from the folder's public surface (`./index.ts`). The only external
 * surface that touches it is `verify()` and the tombstone factory in
 * `index.ts`, both of which import it directly from this module.
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
 * Private sentinel stamped onto tombstone entries by {@link createAuditLedger.erase}.
 * Never exported from the folder's barrel, never serialized — `verify()`
 * checks for it before accepting a `system.entry-erased` entry as a
 * legitimate chain break.
 *
 * Without this, a caller holding a raw `AuditLedgerSink` reference
 * could write `{ kind: "system.entry-erased", … }` directly into the
 * sink to mask real tampering as legitimate erasure. The sentinel
 * raises the bar so only the in-process ledger plugin (which lives in
 * this folder's closure) can mint a valid tombstone.
 *
 * @internal — DO NOT re-export from `./index.ts` or `./types.ts`.
 */
export const LEDGER_INTERNAL_TOKEN: unique symbol = Symbol(
  "directive.audit-ledger.internal",
);

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
