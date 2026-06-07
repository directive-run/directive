/**
 * createAuditLedger — append-only, queryable, hash-chained
 * (djb2; SHA-256 reserved for v2) audit of every state change. For
 * forensics and "show me why this user got that decision."
 *
 * Captures (per observation event):
 *
 *   - `constraint.evaluate` → { whenSpec, whenExplain, active, whenSource? }
 *   - `resolver.write.rejected` (rejection + summary kinds)
 *   - `fact.change` → { key, prior, next }
 *   - `resolver.complete` → { resolverId, requirementId, duration }
 *   - `system.init` / `system.start` / `system.stop` / `system.destroy`
 *   - `system.snapshot` / `system.history.navigate` (lifecycle markers)
 *   - `system.truncated` (ring-buffer overflow marker)
 *   - `system.entry-erased` / `system.subject-erased` (GDPR Art.17 stub)
 *
 * PII redaction: by default, fact keys whose meta carries the `pii`
 * tag (via `system.meta.byTag("pii")`) have their values replaced with
 * `"[redacted]"` in `whenExplain.actual`, `fact.change.prior`,
 * `fact.change.next`, and the cached `whenSpec` operands. Opt out with
 * `capturePII: true`.
 *
 * Folder layout:
 *   types.ts            — public type surface + version stamps
 *   hash.ts             — djb2 dispatch + freeze helper + INTERNAL TOKEN
 *   sink.ts             — memorySink() ring buffer
 *   predicate-redact.ts — PII-aware redactWhenSpec
 *   verify.ts           — tombstone-aware chain walk
 *   index.ts (this)     — createAuditLedger factory + plugin wiring
 */

import type {
  ModuleSchema,
  ObservationEvent,
  Plugin,
  System,
} from "../../core/types.js";
import type {
  ClauseResult,
  FactPredicate,
} from "../../core/types/predicate.js";
import { hashObject } from "../../utils/utils.js";
import { LEDGER_INTERNAL_TOKEN, freezeEntry, hashForEntry } from "./hash.js";
import { redactWhenSpec } from "./predicate-redact.js";
import { memorySink } from "./sink.js";
import type {
  AuditEntry,
  AuditLedger,
  AuditLedgerOptions,
  VerifyResult,
} from "./types.js";
import { HASH_ALGO, SCHEMA_VERSION } from "./types.js";
import { verify as verifyChain } from "./verify.js";

// Re-export the public surface. `LEDGER_INTERNAL_TOKEN` is intentionally
// NOT included — the tombstone-forgery defense depends on its
// unguessability from outside this folder. (N7)
export { memorySink } from "./sink.js";
export type {
  AuditEntry,
  AuditEntryKind,
  AuditLedger,
  AuditLedgerOptions,
  AuditLedgerSink,
  QueryFilter,
  VerifyResult,
} from "./types.js";

/**
 * Create an audit ledger that subscribes to the given system's
 * observation stream. Returns a `Plugin` to install + a query/verify
 * API for the ledger.
 *
 * @example
 * ```ts
 * import { createAuditLedger } from "@directive-run/core/plugins";
 *
 * const ledger = createAuditLedger();
 * const system = createSystem({ module, plugins: [ledger.plugin] });
 * system.start();
 *
 * // Six months later — auditor asks "what changed cart-total in March?"
 * ledger.query({
 *   factPath: "cartTotal",
 *   changedBetween: ["2026-03-01", "2026-04-01"],
 * });
 *
 * // Verify nobody tampered with the ledger
 * const verdict = await ledger.verify();
 * if (!verdict.valid) {
 *   console.error("Tamper at entry", verdict.brokenAt);
 * }
 * ```
 */
export function createAuditLedger(opts: AuditLedgerOptions = {}): AuditLedger {
  const sink = opts.sink ?? memorySink();
  const capturePII = opts.capturePII ?? false;
  const userRedact = opts.redact;

  let seq = 0;
  let lastHashCache: string | null = null; // Cache hash of last-written entry payload

  let system: System<ModuleSchema> | null = null;
  let unobserve: (() => void) | null = null;

  /**
   * Cache of constraint.id → whenSpec (snapshotted at start, refreshed
   * on register/assign/unregister). Spec is already PII-redacted at
   * cache time, so the operand pointer that flows into every
   * `constraint.evaluate` entry can never leak. (C2)
   */
  const whenSpecCache = new Map<string, FactPredicate<unknown>>();

  /**
   * Cache of constraint.id → sourceHash for function-form constraints.
   * (N5, M22)
   *
   * We hash the stringified function rather than store any preview of
   * its source. Closures frequently reference secrets in scope
   * (`apiKey`, `dbPassword`, customer PII pulled from outer state) and
   * a preview would land those in the audit trail in plaintext. The
   * hash is a tamper-evident identity — auditors can verify "this
   * constraint's source has not changed across these entries" without
   * ever seeing the source itself.
   */
  const whenSourceCache = new Map<string, string>();

  /** Cache of PII-tagged fact paths. */
  const piiTaggedFacts = new Set<string>();

  function refreshWhenSpecCache(): void {
    whenSpecCache.clear();
    whenSourceCache.clear();
    if (!system) return;
    try {
      const inspect = (
        system as {
          inspect?: () => {
            constraints?: Array<{
              id: string;
              whenSpec?: unknown;
              when?: unknown;
            }>;
          };
        }
      ).inspect;
      if (typeof inspect !== "function") return;
      const inspection = inspect();
      const constraints = inspection?.constraints ?? [];
      // Best-effort access to merged constraint defs for function-form
      // source capture. Not exposed via the public type; we feature-detect.
      const mergedDefs = (
        system as {
          $internal?: {
            mergedConstraints?: Record<string, { when?: unknown }>;
          };
        }
      ).$internal?.mergedConstraints;
      for (const c of constraints) {
        if (c.whenSpec !== undefined) {
          // Redact PII operands at cache time so the cached pointer
          // flowing into evaluate entries is already safe. (C2)
          whenSpecCache.set(
            c.id,
            redactWhenSpec(
              c.whenSpec,
              capturePII,
              piiTaggedFacts,
            ) as FactPredicate<unknown>,
          );
        } else {
          // No whenSpec means function-form `when:` (or no when at
          // all). Capture a HASH of the function source rather than
          // the source itself — closures may reference secrets in
          // scope, and any preview would leak them into the audit
          // trail. (N5, M22)
          const def = mergedDefs?.[c.id];
          const whenFn =
            def && typeof def.when === "function" ? def.when : undefined;
          if (whenFn) {
            whenSourceCache.set(c.id, hashObject(String(whenFn)));
          } else if (c.when !== undefined && typeof c.when === "function") {
            whenSourceCache.set(c.id, hashObject(String(c.when)));
          } else {
            // Function-form constraint we couldn't reach the source
            // of. Mark it so audit entries still surface the form.
            // We hash the marker string for consistency with the
            // sourceHash field shape.
            whenSourceCache.set(c.id, hashObject("[function]"));
          }
        }
      }
    } catch {
      // System not yet ready — skip silently.
    }
  }

  function refreshPIITags(): void {
    piiTaggedFacts.clear();
    if (capturePII || !system) return;
    try {
      const meta = (
        system as { meta?: { byTag?: (tag: string) => Array<{ id: string }> } }
      ).meta;
      if (!meta || typeof meta.byTag !== "function") return;
      const tagged = meta.byTag("pii") ?? [];
      for (const m of tagged) {
        piiTaggedFacts.add(m.id);
      }
    } catch {
      // No meta accessor — skip.
    }
  }

  function redactValue(factPath: string, value: unknown): unknown {
    if (capturePII) return value;
    if (piiTaggedFacts.has(factPath)) return "[redacted]";

    return value;
  }

  function redactClauses(
    clauses: ClauseResult[] | undefined,
  ): ClauseResult[] | undefined {
    if (!clauses) return clauses;
    if (capturePII || piiTaggedFacts.size === 0) return clauses;
    let mutated = false;
    const out: ClauseResult[] = clauses.map((c) => {
      if (piiTaggedFacts.has(c.path)) {
        mutated = true;
        return { ...c, actual: "[redacted]" };
      }
      // Recurse into combinator children.
      if (c.children) {
        const inner = redactClauses(c.children);
        if (inner !== c.children) {
          mutated = true;
          return { ...c, children: inner };
        }
      }

      return c;
    });

    return mutated ? out : clauses;
  }

  /**
   * `partial` is the entry-specific payload (no seq/ts/prevHash). It's
   * typed as `Record<string, unknown>` because TS's distributed Omit
   * over the AuditEntry discriminated union doesn't compose cleanly;
   * runtime construction is safe because each call site passes a
   * known-shape literal.
   *
   * Entries are deeply-frozen at write time (depth 2 — top-level
   * values + whenExplain clauses) so that downstream consumers cannot
   * mutate payloads in place and forge the chain. (C3)
   */
  function emit(partial: Record<string, unknown>): AuditEntry {
    const entry = {
      ...partial,
      seq: seq++,
      ts: Date.now(),
      prevHash: lastHashCache,
      hashAlgo: HASH_ALGO,
      schemaVersion: SCHEMA_VERSION,
    } as AuditEntry;

    const finalEntry = userRedact ? userRedact(entry) : entry;
    freezeEntry(finalEntry);
    sink.write(finalEntry);

    // Sync hash of this entry — stashed as the next entry's prevHash.
    // Whole entry is hashed (including its own prevHash field) so
    // verify() can rebuild the chain deterministically.
    lastHashCache = hashForEntry(finalEntry);

    return finalEntry;
  }

  function onEvent(event: ObservationEvent): void {
    switch (event.type) {
      case "constraint.evaluate": {
        const whenSpec = whenSpecCache.get(event.id);
        const whenSourceHash = whenSourceCache.get(event.id);
        const partial: Record<string, unknown> = {
          kind: "constraint.evaluate",
          constraintId: event.id,
          active: event.active,
          whenExplain: redactClauses(event.whenExplain),
        };
        if (whenSpec !== undefined) {
          partial.whenSpec = whenSpec;
        } else if (whenSourceHash !== undefined) {
          // Function-form constraint — sourceHash is informational and
          // NOT replayable. We deliberately do NOT include any source
          // preview because closures may reference secrets in scope. (N5, M22)
          partial.whenSource = {
            kind: "function",
            sourceHash: whenSourceHash,
          };
        }
        emit(partial);
        break;
      }
      case "fact.change":
        emit({
          kind: "fact.change",
          key: event.key,
          prior: redactValue(event.key, event.prev),
          next: redactValue(event.key, event.next),
        });
        break;
      case "resolver.write.rejected":
        if (event.kind === "summary") {
          emit({
            kind: "resolver.write.rejected",
            rejection: "summary",
            resolverId: event.resolver,
            requirementId: event.requirementId,
            reason: event.reason,
            dropped: event.dropped,
          });
        } else {
          emit({
            kind: "resolver.write.rejected",
            rejection: "rejection",
            resolverId: event.resolver,
            requirementId: event.requirementId,
            reason: event.reason,
            fact: event.fact,
            expected: redactValue(event.fact, event.expected),
            actual: redactValue(event.fact, event.actual),
          });
        }
        break;
      case "resolver.complete":
        emit({
          kind: "resolver.complete",
          resolverId: event.resolver,
          requirementId: event.requirementId,
          duration: event.duration,
        });
        break;
      case "resolver.error":
        emit({
          kind: "resolver.error",
          resolverId: event.resolver,
          requirementId: event.requirementId,
          error: String(event.error),
        });
        break;
      case "system.init":
      case "system.start":
      case "system.stop":
      case "system.destroy":
        emit({ kind: event.type });
        break;
      case "source.attach":
      case "source.detach":
        // Source attach/detach captures the privilege-change posture:
        // a runtime-registered source is a new ingestion endpoint, an
        // attach/detach pair bounds the period during which fact mutations
        // could have originated from this source. `source.publish` is
        // DELIBERATELY NOT captured — high-volume sources would blow up
        // the ledger; the resulting fact.change entries already encode the
        // outcome and remain queryable.
        emit({
          kind: event.type,
          sourceId: event.id,
          moduleId: event.moduleId,
        });
        break;
      case "source.error":
        emit({
          kind: "source.error",
          sourceId: event.id,
          moduleId: event.moduleId,
          phase: event.phase,
          error: event.error instanceof Error ? event.error.message : String(event.error),
        });
        break;
      default:
        // Other observation events ignored in v1 (derivation.compute,
        // requirement.created/met/canceled, effect.run/error,
        // reconcile.start/end, source.publish). They're available via
        // .observe() directly if a consumer wants them.
        break;
    }
  }

  /**
   * Re-entrance guard for the truncation handler. The marker entry is
   * itself a write that may trigger another shift; without this we'd
   * recurse and overflow. (M23)
   */
  let emittingTruncate = false;

  function attach(sys: System<ModuleSchema>): void {
    system = sys;
    refreshPIITags();
    refreshWhenSpecCache();
    unobserve = sys.observe(onEvent);
    // Wire up the truncation marker — fires BEFORE the sink drops the
    // oldest entry, so the dropped seq is still known. The guard
    // prevents the marker's own write from recursing back through the
    // capacity overflow path. (M23)
    sink.onTruncate?.((droppedSeq, droppedCount) => {
      if (emittingTruncate) return;
      emittingTruncate = true;
      try {
        emit({
          kind: "system.truncated",
          droppedSeq,
          droppedCount,
        });
      } finally {
        emittingTruncate = false;
      }
    });
  }

  function detach(): void {
    if (unobserve) {
      unobserve();
      unobserve = null;
    }
    system = null;
    whenSpecCache.clear();
    whenSourceCache.clear();
    piiTaggedFacts.clear();
  }

  const plugin: Plugin<ModuleSchema> = {
    name: "audit-ledger",
    onInit(sys) {
      attach(sys as System<ModuleSchema>);
    },
    onStop() {
      // Keep the sink populated so query() works after stop, but
      // drop the subscription to avoid leaks.
      if (unobserve) {
        unobserve();
        unobserve = null;
      }
    },
    onDestroy() {
      detach();
    },
    onDefinitionRegister(type, id) {
      if (type === "constraint") refreshWhenSpecCache();
      if (type === "constraint" || type === "resolver" || type === "effect") {
        // Re-pull PII tags too — a dynamically-registered fact (rare)
        // could have brought new meta.
        refreshPIITags();
      }
      void id;
    },
    onDefinitionAssign(type, id) {
      // (C4) Constraint assigned a new spec — refresh the cache so the
      // NEXT evaluate emits the new whenSpec, not the stale one.
      if (type === "constraint") refreshWhenSpecCache();
      void id;
    },
    onDefinitionUnregister(type, id) {
      if (type === "constraint") refreshWhenSpecCache();
      void id;
    },
    onSnapshot(snapshot) {
      // (M9) Capture history snapshot as a lifecycle marker. Snapshot
      // contents (facts) are NOT included to keep the entry small and
      // avoid duplicating PII through a different channel.
      emit({
        kind: "system.snapshot",
        snapshotId: snapshot.id,
        trigger: snapshot.trigger,
      });
    },
    onHistoryNavigate(from, to) {
      // (M9) Capture time-travel navigation as a lifecycle marker.
      emit({
        kind: "system.history.navigate",
        from,
        to,
      });
    },
  };

  /**
   * Strip the internal sentinel from an entry before it reaches a
   * public read path. Returns a shallow clone with `__internal`
   * removed — keeps the (frozen) live entry intact for verify() while
   * making sure consumers never see the symbol. (N7)
   */
  function stripInternal(entry: AuditEntry): AuditEntry {
    if (
      (entry as AuditEntry & { __internal?: unknown }).__internal === undefined
    ) {
      return entry;
    }
    const clone = { ...entry } as AuditEntry & { __internal?: unknown };
    delete clone.__internal;

    return clone as AuditEntry;
  }

  function stripInternalAll(
    entries: readonly AuditEntry[],
  ): readonly AuditEntry[] {
    // Avoid allocating a new array unless at least one entry carries
    // the sentinel — the common case (no tombstones) is a no-op.
    let needsClone = false;
    for (const e of entries) {
      if (
        (e as AuditEntry & { __internal?: unknown }).__internal !== undefined
      ) {
        needsClone = true;
        break;
      }
    }
    if (!needsClone) {
      return entries;
    }

    return entries.map(stripInternal);
  }

  return {
    plugin,
    query: (filter = {}) => stripInternalAll(sink.query(filter)),
    recent: (n) => stripInternalAll(sink.recent(n)),
    forFact: (path, opts2) => stripInternalAll(sink.forFact(path, opts2)),
    forConstraint: (id, opts2) =>
      stripInternalAll(sink.forConstraint(id, opts2)),
    toJSON: () => {
      const snap = sink.toJSON();

      return {
        entries: stripInternalAll(snap.entries),
        capturedAt: snap.capturedAt,
      };
    },
    verify(opts?: { strong?: boolean }): VerifyResult {
      return verifyChain(sink, opts);
    },
    erase(filter) {
      // (C8) Replace matching entries with tombstones IN PLACE, keeping
      // seq + prevHash + hashAlgo so verify() can resync the chain.
      const erasedAt = Date.now();
      let count = 0;
      if (typeof sink.erase === "function") {
        count = sink.erase(filter, (e) => {
          // Build a tombstone preserving the immutable chain fields.
          // Carry SCHEMA_VERSION from the original so a fresh tombstone
          // doesn't claim to be at a newer schema than the entry it
          // replaced. (F-5)
          //
          // (N7) Stamp the in-module sentinel so `verify()` can tell
          // this tombstone apart from a forgery written via
          // `sink.write({ kind: "system.entry-erased", … })`. The
          // sentinel is stripped from every public read path.
          const tombstone = {
            seq: e.seq,
            ts: e.ts,
            kind: "system.entry-erased" as const,
            prevHash: e.prevHash,
            hashAlgo: e.hashAlgo,
            schemaVersion:
              (e as AuditEntry & { schemaVersion?: typeof SCHEMA_VERSION })
                .schemaVersion ?? SCHEMA_VERSION,
            originalKind: e.kind,
            erasedAt,
            __internal: LEDGER_INTERNAL_TOKEN,
          } as AuditEntry;
          // CAUTION: replacing the payload changes the entry's hash —
          // which means the NEXT entry's prevHash will no longer match.
          // verify() recognises `system.entry-erased` as a legitimate
          // chain break and reports it in `erasedSeqs` rather than as
          // tamper. (N1 + M1)
          freezeEntry(tombstone);

          return tombstone;
        });
      }
      // (MAJOR-3) Skip the `system.subject-erased` marker when nothing
      // matched the filter — emitting an "erased: 0" marker pollutes
      // the chain with noise and confuses auditors looking for real
      // erasures.
      if (count === 0) {
        return { erased: 0, markerEntry: null };
      }
      // (N2) Don't store the raw filter — PII can land in the values
      // (e.g. `factPath: "alice@x.com"`). Capture a hash + a shape
      // descriptor so an auditor sees WHICH fields were used without
      // exposing the values.
      const filterShape = {
        factPath: filter.factPath !== undefined,
        constraintId: filter.constraintId !== undefined,
        kind: filter.kind,
        changedBetween:
          filter.changedBetween !== undefined
            ? ("[range]" as const)
            : undefined,
      };
      // Emit a single chained `system.subject-erased` marker — recorded
      // AFTER the erasure so auditors see what was removed and why.
      const markerEntry = emit({
        kind: "system.subject-erased",
        filterHash: hashObject(filter),
        filterShape,
        erased: count,
      });

      return { erased: count, markerEntry };
    },
    clear() {
      sink.clear();
      seq = 0;
      lastHashCache = null;
    },
    destroy() {
      detach();
      sink.destroy();
    },
  };
}
