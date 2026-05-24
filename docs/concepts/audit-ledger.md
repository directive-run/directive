# `createAuditLedger` — court-admissible audit, built-in

> An append-only, queryable, cryptographically-chained log of every
> state change a Directive system makes. The auditor's "why did this
> user get that decision?" question now has a one-line answer.

## Setup

```ts
import { createSystem } from "@directive-run/core";
import { createAuditLedger } from "@directive-run/core/plugins";

const ledger = createAuditLedger();

const system = createSystem({
  module: checkoutModule,
  plugins: [ledger.plugin], // that's it
});

system.start();
```

The ledger subscribes to every observation event the system emits — constraint evaluations, fact changes, resolver writes — and records them, in order, with the rule that was in effect at the time and the per-clause `whenExplain` payload.

## Query

```ts
// What changed cart-total between Jan and June?
ledger.query({
  factPath: "cartTotal",
  changedBetween: ["2026-01-01", "2026-06-01"],
});

// Why did the checkout constraint fire?
ledger.forConstraint("canCheckout");

// All entries touching the user's email
ledger.forFact("user.email");

// Most recent 50 entries
ledger.recent(50);
```

Filter shape:

| Field | Type | Note |
| --- | --- | --- |
| `factPath` | `string` | **Exact match** (no LIKE wildcards). |
| `constraintId` | `string` | Filter by `constraint.evaluate` entries. |
| `kind` | `AuditEntryKind \| AuditEntryKind[]` | Discriminator. |
| `changedBetween` | `[start, end]` | ISO-8601 strings, epoch numbers, or `Date`. |
| `limit` | `number` | Default 1000. |

## Captured events

| Kind | Payload includes |
| --- | --- |
| `constraint.evaluate` | `constraintId`, `active`, `whenSpec`, `whenExplain` |
| `fact.change` | `key`, `prior`, `next` |
| `resolver.write.rejected` | `resolverId`, `fact`, `expected`, `actual` (rejection) or `dropped` (summary) |
| `resolver.complete` | `resolverId`, `requirementId`, `duration` |
| `resolver.error` | `resolverId`, `requirementId`, `error` |
| `system.init/start/stop/destroy` | (lifecycle markers) |

## Hash chain — tamper detection

Every entry stores `prevHash`, the djb2 hash (`hashObject`) of the previous entry's canonical JSON. To detect tampering:

```ts
const result = ledger.verify();
if (!result.valid) {
  console.error(
    `Tampered entry at index ${result.brokenAt}`,
    `expected prevHash: ${result.expectedHash}`,
    `actual prevHash:   ${result.actualHash}`,
  );
}
```

Sync by default. Pass `{ strong: true }` for an async SHA-256 walk — collision-resistant against an adversary; v1 sync walk uses a 32-bit djb2 hash (fast, fits in StackBlitz / browser, catches accidental + light-adversarial tamper).

**Threat model:** detects tampering; does **NOT** prevent it. Pair with file ACLs / append-only filesystem / WORM storage for full guarantee.

## PII redaction (default ON)

Fact values flow into the ledger via `whenExplain.actual` and `fact.change.{prior,next}`. By default, the ledger reads `system.meta.byTag("pii")` at start and *redacts* values for those facts to `"[redacted]"`:

```ts
const checkoutModule = createModule("checkout", {
  schema: {
    facts: {
      email: t.string().meta({ tags: ["pii"] }),
      cartTotal: t.number(),
    },
    // ...
  },
});

// In the ledger:
// fact.change { key: "email", prior: "[redacted]", next: "[redacted]" }
// fact.change { key: "cartTotal", prior: 30, next: 75 }
```

Opt out with `capturePII: true`. Custom sanitization: pass `redact?: (entry) => entry`.

## Sinks

```ts
import { memorySink } from "@directive-run/core/plugins";

const sink = memorySink({ capacity: 100_000 });
const ledger = createAuditLedger({ sink });
```

v1 ships the in-memory ring buffer (`memorySink`). It drops oldest past `capacity` (default 10k). For durable / queryable-after-restart sinks (SQLite, Parquet, Loki), implement `AuditLedgerSink` — the interface is open.

## Export

```ts
const dump = ledger.toJSON();
// → { entries: AuditEntry[], capturedAt: number }
```

Save to disk, ship to S3, feed into a reporting pipeline. The entries are plain JSON — no BSON, no Buffer.

## What this does NOT do

- **Not a durable store on its own** — `memorySink` is bounded; spill to your own sink for production.
- **Not a real-time alerting pipeline** — pair with `system.observe()` for that. The ledger is the *record*, not the *alarm*.
- **Doesn't capture every observation event** — `derivation.compute`, `requirement.created/met/canceled`, `effect.run`, `reconcile.start/end` are skipped in v1. They're available via `system.observe()` directly if needed.

## Reference

- API: `createAuditLedger`, `memorySink`, `AuditLedger`, `AuditEntry`, `AuditLedgerSink`, `QueryFilter`
- Pairs with: [`whenExplain` panel](./when-explain-panel.md), [`predicate codegen`](./predicate-codegen.md), [`replayUnder`](./replay-under.md)
