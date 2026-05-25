/**
 * `verify()` — walk the hash chain genesis → tip, surfacing the first
 * broken link (or accepting it as a legitimate erasure tombstone).
 *
 * Erased entries appear as legitimate breaks — their payload changed
 * so the NEXT entry's `prevHash` no longer matches. `verify()`
 * recognises a `system.entry-erased` entry bearing the in-module
 * sentinel and resyncs the walk from the tombstone's own hash.
 *
 * Forged tombstones — `kind: "system.entry-erased"` written directly
 * via `sink.write()` to mask real tamper — lack the sentinel and are
 * reported as `valid: false` with a `reason` describing the forgery. (N7)
 */

import { LEDGER_INTERNAL_TOKEN, hashForEntry } from "./hash.js";
import type { AuditEntry, AuditLedgerSink, VerifyResult } from "./types.js";

export function verify(
  sink: AuditLedgerSink,
  opts?: { strong?: boolean },
): VerifyResult {
  // (C1) v1 ships sync djb2 only. Strong (SHA-256) verify is
  // reserved for v2 and must NOT silently no-op — the previous
  // implementation returned `{ valid: true }` regardless of the
  // chain's actual state, which lied to callers.
  if (opts?.strong === true) {
    throw new Error(
      "[Directive] verify({ strong: true }) is reserved for v2 — v1 ships sync djb2 chain only. Use verify() (sync) for tamper detection.",
    );
  }

  const { entries } = sink.toJSON();
  if (entries.length === 0) {
    return { valid: true, entryCount: 0 };
  }

  // Sync walk — catches anything the djb2 chain would see.
  // (N1 + M1) Erased-entry tombstones (kind: "system.entry-erased")
  // legitimately break the chain — the tombstone's payload differs
  // from the original entry it replaced, so the NEXT entry's
  // prevHash no longer matches. When we detect a break whose
  // PREVIOUS entry is a tombstone (or the broken entry itself is
  // one), record the seq and resync the walk from the tombstone's
  // own hash.
  //
  // (N7) Only tombstones bearing the internal sentinel are
  // recognised. A forged tombstone — `kind: "system.entry-erased"`
  // written directly via `sink.write()` to mask real tamper —
  // lacks the in-module symbol and is reported as tamper.
  //
  // Use a Set to dedupe — adjacent tombstones can otherwise be
  // recorded twice (once when the tombstone itself is the broken
  // entry, once when the next iteration sees its predecessor was
  // also a tombstone).
  const erasedSeqsSet = new Set<number>();
  let prevHash: string | null = null;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.prevHash !== prevHash) {
      // Legitimate break? Either:
      //   (a) the entry itself is the tombstone, or
      //   (b) the previous entry was the tombstone whose payload
      //       was rewritten by erase().
      const prevEntry = i > 0 ? entries[i - 1]! : null;
      const entryIsTombstone = entry.kind === "system.entry-erased";
      const prevIsTombstone = prevEntry?.kind === "system.entry-erased";

      if (entryIsTombstone || prevIsTombstone) {
        // (N7) Verify the SENTINEL on whichever entry(ies) claim
        // tombstone status. Missing sentinel ⇒ forgery ⇒ tamper.
        const candidates: AuditEntry[] = [];
        if (entryIsTombstone) candidates.push(entry);
        if (prevIsTombstone && prevEntry !== null) {
          candidates.push(prevEntry);
        }
        const forged = candidates.find(
          (e) =>
            (e as AuditEntry & { __internal?: unknown }).__internal !==
            LEDGER_INTERNAL_TOKEN,
        );
        if (forged) {
          return {
            valid: false,
            brokenAt: i,
            expectedHash: prevHash ?? "<genesis>",
            actualHash: entry.prevHash ?? "<genesis>",
            entry: forged,
            reason:
              "tombstone forgery detected — missing internal sentinel. A 'system.entry-erased' entry was written via sink.write() rather than ledger.erase(); rejected as tamper.",
          };
        }
        // Legitimate erasure — record the tombstone's seq and
        // resync the walk by hashing this entry as our new pointer
        // for the next iteration.
        const tombstoneEntry = entryIsTombstone ? entry : prevEntry!;
        erasedSeqsSet.add(tombstoneEntry.seq);
        prevHash = hashForEntry(entry);

        continue;
      }

      return {
        valid: false,
        brokenAt: i,
        expectedHash: prevHash ?? "<genesis>",
        actualHash: entry.prevHash ?? "<genesis>",
        entry,
      };
    }
    prevHash = hashForEntry(entry);
  }

  const result: {
    valid: true;
    entryCount: number;
    erasedSeqs?: number[];
  } = {
    valid: true,
    entryCount: entries.length,
  };
  if (erasedSeqsSet.size > 0) {
    result.erasedSeqs = [...erasedSeqsSet].sort((a, b) => a - b);
  }

  return result;
}
