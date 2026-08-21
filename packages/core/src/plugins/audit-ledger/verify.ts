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
 * reported as `valid: false` with a `reason` describing the forgery.
 */

import { hashForEntry, isInternal } from "./hash.js";

/**
 * How many absent seq numbers `verify()` will name individually. The count is
 * always exact; the list is a sample, because the input to a verification is
 * often a file from somewhere else and a number in it should not decide how
 * much memory this allocates.
 */
const MAX_LISTED_MISSING_SEQS = 100;
import type { AuditEntry, AuditLedgerSink, VerifyResult } from "./types.js";

export function verify(
  sink: AuditLedgerSink,
  opts?: { strong?: boolean },
): VerifyResult {
  // v1 ships sync djb2 only. Strong (SHA-256) verify is
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
    return {
      valid: true,
      entryCount: 0,
      marksChecked: false,
    };
  }

  // Sync walk — catches anything the djb2 chain would see.
  // Erased-entry tombstones (kind: "system.entry-erased")
  // legitimately break the chain — the tombstone's payload differs
  // from the original entry it replaced, so the NEXT entry's
  // prevHash no longer matches. When we detect a break whose
  // PREVIOUS entry is a tombstone (or the broken entry itself is
  // one), record the seq and resync the walk from the tombstone's
  // own hash.
  //
  // Only tombstones bearing the internal sentinel are
  // recognised. A forged tombstone — `kind: "system.entry-erased"`
  // written directly via `sink.write()` to mask real tamper —
  // lacks the in-module symbol and is reported as tamper.
  //
  // Use a Set to dedupe — adjacent tombstones can otherwise be
  // recorded twice (once when the tombstone itself is the broken
  // entry, once when the next iteration sees its predecessor was
  // also a tombstone).
  // Whether the mint marks mean anything for this set of entries.
  //
  // The marks are held off the entries, in this process, so they do not
  // survive an export. A ledger reloaded from JSON has none — and calling its
  // tombstones forged on that basis would report every exported ledger as
  // tampered, which is what an export is for.
  //
  // Asked of the entries in hand, not of the ledger that produced them.
  //
  // Asking the ledger looked stronger — it closed a hole where `clear()`
  // empties a sink without making the ledger any less live, so a forgery
  // written afterwards sat among no marks and read as a copy. But a live
  // ledger over a sink that returns copies of what it was handed also has no
  // marks to find, and that is every sink which persists anything. It answered
  // by calling the ledger's own erasures forgeries.
  //
  // Between missing a forgery and manufacturing one, this reports what it can
  // actually see. An unkeyed scheme cannot do better: an attacker can always
  // present a forgery as a copy, and a copy is what most real sinks hand back.
  const marksAreMeaningful = entries.some((e) => isInternal(e));

  // Seqs that are not here and that nothing accounts for.
  //
  // The chain closes over an entry the sink refused, which is what stops one
  // failed write reporting the whole ledger as tampered. But closing over it
  // silently trades a loud wrong answer for a quiet one: the entry is gone and
  // the verdict says nothing. The gap is reported rather than made fatal —
  // it is a lost write, not evidence of tampering.
  const missingSeqs: number[] = [];
  let missingSeqCount = 0;

  const erasedSeqsSet = new Set<number>();
  const unmarkedTombstoneSeqs = new Set<number>();

  // A bounded sink drops its oldest entries once it is full, so the entry the
  // walk starts from is not necessarily the genesis entry — its `prevHash`
  // points at something that is no longer here. Starting the walk at `null`
  // regardless meant the first link always failed on a rotated buffer, and a
  // healthy, untampered ledger reported itself altered for the rest of its
  // life. Worse than useless: an operator who learns that routine rotation
  // reads as tamper learns to ignore the one control that would tell them
  // about real tamper.
  //
  // A first entry whose `seq` is not 0 is a window into a longer chain, so the
  // walk begins from that entry's own recorded `prevHash` and the result says
  // which seq the surviving window starts at. A gap anywhere *after* the head
  // is a different matter and still reports as a break — the entries either
  // side of it are both here, and nothing legitimate removes one from between
  // them without leaving a tombstone.
  const first = entries[0]!;
  const windowStartSeq = first.seq > 0 ? first.seq : undefined;
  let prevHash: string | null =
    windowStartSeq === undefined ? null : first.prevHash;

  // Whether anything explains the missing prefix.
  //
  // Seeding the walk from the surviving window stops routine rotation reading
  // as tamper, but on its own it also accepts a prefix someone simply deleted:
  // the first entry ends up validated against its own recorded `prevHash`,
  // which is exactly the entry an attacker rewrites. The corroboration is
  // already in the buffer — a sink that rotated wrote `system.truncated`
  // markers as it went, and one that was trimmed by hand did not.
  //
  // The marker has to bear the in-module sentinel, for the same reason a
  // tombstone does. A `system.truncated` entry is otherwise an ordinary row
  // anyone holding the sink can append, so an unsentinelled one lets a trimmed
  // prefix present itself as routine rotation — which is exactly the claim
  // this field exists to make.
  //
  // Reported rather than made fatal. A quiet system can outlive its own
  // markers, so their absence is grounds for a question, not a verdict.
  const truncationExplained =
    windowStartSeq === undefined
      ? undefined
      : entries.some((e) => e.kind === "system.truncated" && isInternal(e));
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const previous = i > 0 ? entries[i - 1] : undefined;
    if (previous !== undefined && entry.seq > previous.seq + 1) {
      // Counted in full, listed up to a bound.
      //
      // `verify()` is the forensics path, and its input is routinely a file
      // someone handed you. Enumerating every absent seq meant one row
      // claiming a large one allocated an entry per number: at 2^31 the
      // verifier threw `RangeError` instead of returning a verdict, which
      // hands an attacker a way to stop the check running at all.
      missingSeqCount += entry.seq - previous.seq - 1;
      for (
        let gap = previous.seq + 1;
        gap < entry.seq && missingSeqs.length < MAX_LISTED_MISSING_SEQS;
        gap++
      ) {
        missingSeqs.push(gap);
      }
    }
    if (entry.prevHash !== prevHash) {
      // Legitimate break? Either:
      //   (a) the entry itself is the tombstone, or
      //   (b) the previous entry was the tombstone whose payload
      //       was rewritten by erase().
      const prevEntry = i > 0 ? entries[i - 1]! : null;
      const entryIsTombstone = entry.kind === "system.entry-erased";
      const prevIsTombstone = prevEntry?.kind === "system.entry-erased";

      if (entryIsTombstone || prevIsTombstone) {
        // A tombstone that this runtime did not write is reported, not
        // rejected.
        //
        // This decided the verdict twice, in both directions, and both were
        // wrong in ordinary use. Asking the entries meant a live ledger over a
        // sink that returns copies — every sink that persists anything — had
        // its own erasures called forgeries. Asking whether the ledger had
        // ever written anything meant a ledger resumed from an export accused
        // its own imported tombstones the moment it made a single write of its
        // own, which is every restart.
        //
        // The distinction cannot be drawn reliably: the mark is held in memory
        // against the entry object and does not survive being stored, so
        // "written by the runtime" and "appended by someone" look identical in
        // any record that has been anywhere. An unkeyed chain cannot close
        // that, and a control that manufactures a forgery is worse than one
        // that reports what it could not check — the seqs are named, and an
        // auditor with a reason to care can look.
        const candidates: AuditEntry[] = [];
        if (entryIsTombstone) candidates.push(entry);
        if (prevIsTombstone && prevEntry !== null) {
          candidates.push(prevEntry);
        }
        for (const candidate of candidates) {
          if (marksAreMeaningful && !isInternal(candidate)) {
            unmarkedTombstoneSeqs.add(candidate.seq);
          }
        }
        // Record the tombstone's seq and resync the walk by hashing this
        // entry as our new pointer for the next iteration.
        const tombstoneEntry = entryIsTombstone ? entry : prevEntry!;
        erasedSeqsSet.add(tombstoneEntry.seq);
        try {
          prevHash = hashForEntry(entry);
        } catch (error) {
          // The same guard as the main walk below. Fixing one call site and
          // not its sibling left the forensics entry point throwing for any
          // trail that contains both an erasure and a row this version cannot
          // hash — and an auditor asking whether a record is intact should
          // get an answer either way.
          return {
            valid: false,
            brokenAt: i,
            expectedHash: prevHash ?? "<genesis>",
            actualHash: entry.prevHash ?? "<genesis>",
            entry,
            reason: `cannot verify entry seq ${entry.seq}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }

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
    try {
      prevHash = hashForEntry(entry);
    } catch (error) {
      // An entry written under an algorithm this version does not know. The
      // walk cannot continue past it, and an auditor asking whether the record
      // is intact should get an answer rather than an exception.
      return {
        valid: false,
        brokenAt: i,
        expectedHash: prevHash ?? "<genesis>",
        actualHash: entry.prevHash ?? "<genesis>",
        entry,
        reason: `cannot verify entry seq ${entry.seq}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  const result: {
    valid: true;
    entryCount: number;
    erasedSeqs?: number[];
    windowStartSeq?: number;
    truncationExplained?: boolean;
    marksChecked: boolean;
    missingSeqs?: number[];
    missingSeqCount?: number;
    unmarkedTombstoneSeqs?: number[];
  } = {
    valid: true,
    entryCount: entries.length,
    marksChecked: marksAreMeaningful,
  };
  if (erasedSeqsSet.size > 0) {
    result.erasedSeqs = [...erasedSeqsSet].sort((a, b) => a - b);
  }
  if (unmarkedTombstoneSeqs.size > 0) {
    result.unmarkedTombstoneSeqs = [...unmarkedTombstoneSeqs].sort(
      (a, b) => a - b,
    );
  }
  if (missingSeqCount > 0) {
    result.missingSeqs = missingSeqs;
    result.missingSeqCount = missingSeqCount;
  }

  if (windowStartSeq !== undefined) {
    result.windowStartSeq = windowStartSeq;
    result.truncationExplained = truncationExplained === true;
  }

  return result;
}
