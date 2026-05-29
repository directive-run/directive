/**
 * `memorySink()` — bounded ring-buffer implementation of
 * `AuditLedgerSink`. Drops the oldest entry past `capacity`
 * (default 10,000), exposes a truncation hook so the ledger plugin
 * can emit a `system.truncated` marker before the shift, and
 * supports in-place tombstone erasure for GDPR Art. 17.
 *
 * Pure storage layer — no hash chain awareness, no PII redaction.
 * The plugin in `./index.ts` owns those concerns and routes them
 * through this sink via `write()` / `erase()`.
 */

import type { AuditEntry, AuditLedgerSink, QueryFilter } from "./types.js";

const DEFAULT_MEMORY_CAPACITY = 10_000;
const DEFAULT_QUERY_LIMIT = 1000;

function parseRangeBound(v: string | number | Date): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new Error(
        "[Directive] audit-ledger: changedBetween bound must be a finite number, ISO string, or Date.",
      );
    }

    return v;
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isFinite(t)) {
      throw new Error(
        `[Directive] audit-ledger: changedBetween bound "${v}" is not a parseable ISO date string.`,
      );
    }

    return t;
  }
  throw new Error(
    "[Directive] audit-ledger: changedBetween bound must be a number, ISO string, or Date.",
  );
}

export function matchesFilter(entry: AuditEntry, filter: QueryFilter): boolean {
  if (filter.kind) {
    const kinds = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
    if (!kinds.includes(entry.kind)) return false;
  }
  if (filter.factPath !== undefined) {
    // Exact match — no LIKE wildcards. (SEC M2)
    if (entry.kind === "fact.change") {
      if (entry.key !== filter.factPath) return false;
    } else if (entry.kind === "resolver.write.rejected") {
      if (entry.fact !== filter.factPath) return false;
    } else {
      return false;
    }
  }
  if (filter.constraintId !== undefined) {
    if (entry.kind !== "constraint.evaluate") return false;
    if (entry.constraintId !== filter.constraintId) return false;
  }
  if (filter.changedBetween) {
    const [a, b] = filter.changedBetween;
    const start = parseRangeBound(a);
    const end = parseRangeBound(b);
    if (entry.ts < start || entry.ts > end) return false;
  }

  return true;
}

/**
 * In-memory bounded ring-buffer sink. Drops oldest entries past
 * `capacity` (default 10,000). Use this as the default sink for dev,
 * tests, and StackBlitz demos.
 */
export function memorySink(opts: { capacity?: number } = {}): AuditLedgerSink {
  const capacity = opts.capacity ?? DEFAULT_MEMORY_CAPACITY;
  let entries: AuditEntry[] = [];
  let truncateHandler:
    | ((droppedSeq: number, droppedCount: number) => void)
    | null = null;

  const sink: AuditLedgerSink = {
    write(entry) {
      if (entries.length >= capacity) {
        // (M23) About to overflow — notify the owner BEFORE the shift
        // so the dropped seq is still known. The handler may push an
        // entry of its own (a truncation marker), which will itself
        // push us over capacity; we shift one for one until we're back
        // at capacity (handlers must be O(1) writers — typically one).
        const dropped = entries[0]!;
        truncateHandler?.(dropped.seq, 1);
        entries.shift();
      }
      entries.push(entry);
      // If the handler wrote a marker (entries.length now > capacity),
      // drop one more from the head to keep us at capacity exactly.
      while (entries.length > capacity) {
        entries.shift();
      }
    },
    query(filter) {
      const limit = filter.limit ?? DEFAULT_QUERY_LIMIT;
      const out: AuditEntry[] = [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]!;
        if (matchesFilter(e, filter)) {
          out.push(e);
          if (out.length >= limit) break;
        }
      }

      return out;
    },
    recent(n) {
      const start = Math.max(0, entries.length - n);

      return entries.slice(start);
    },
    forFact(path, opts2 = {}) {
      return this.query({ factPath: path, limit: opts2.limit });
    },
    forConstraint(id, opts2 = {}) {
      return this.query({ constraintId: id, limit: opts2.limit });
    },
    toJSON() {
      return { entries: entries.slice(), capturedAt: Date.now() };
    },
    clear() {
      entries = [];
    },
    destroy() {
      entries = [];
      truncateHandler = null;
    },
    erase(filter, tombstoneFactory) {
      let count = 0;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!;
        if (matchesFilter(e, filter)) {
          entries[i] = tombstoneFactory(e);
          count++;
        }
      }

      return count;
    },
    onTruncate(handler) {
      truncateHandler = handler;
    },
  };

  return sink;
}
