# `createAuditLedger` – tamper-evident audit, built-in

> An append-only, queryable, hash-chained (djb2 32-bit; SHA-256 reserved for v2)
> log of every state change a Directive system makes. The auditor's
> "why did this user get that decision?" question now has a one-line
> answer.

## Threat model

The v1 ledger is a **detection-only**, in-process **tamper-evident**
record. Read this before deploying it as evidence:

- **What it catches.** Any in-place mutation of an entry after write –
  changing `kind`, swapping `prior`/`next`, removing an entry, replacing
  one – breaks the `prevHash` link of the next entry and surfaces in
  `verify()` with the broken index, expected hash, and actual hash.
- **What it does NOT catch.** A determined attacker with write access to
  the sink can recompute the entire chain after their edit (djb2 is
  unkeyed and 32-bit). The detection guarantee is against accidental
  mutation, library bugs, and casual probing – not against a
  capable adversary. **Pair with append-only filesystem, WORM storage,
  signed off-site copies, or an external trusted timestamping
  authority for evidentiary use.**
- **Hash function is 32-bit djb2 (not SHA-256).** Collision-prone at
  scale. SHA-256 is reserved for v2 (`verify({ strong: true })`
  THROWS today – there is no silent fallback).
- **No per-subject erasure in v1 export reach.** `ledger.erase(filter)`
  replaces matching entries with tombstones in the in-memory sink only.
  Any persisted external copy (`toJSON()` dumps, downstream sinks)
  must be erased by the application. Sink-level erase is a v2 promise.
- **No signing keys in v1.** No HMAC, no Ed25519, no key rotation.
  Anyone with write access to the sink can rewrite history. Keyed
  signing is a v2 promise.
- **Sink-level tombstone forgery.** An attacker holding a
  `sink.write()` reference can ATTEMPT to forge `system.entry-erased`
  tombstones to hide tampering – without the sentinel defense, a
  swapped payload could be hand-replaced with a `kind:
  "system.entry-erased"` entry and `verify()` would treat the chain
  break as legitimate erasure. `verify()` defends via an internal
  sentinel that ONLY `ledger.erase()` can stamp. Forged tombstones
  (written directly via `sink.write({ kind: "system.entry-erased",
  … })`) are detected as tamper with `reason: "tombstone forgery
  detected – missing internal sentinel."`. The sentinel is stripped
  from every public read path (`query`, `recent`, `toJSON`, `forFact`,
  `forConstraint`) so consumers cannot see or copy it. Use
  `ledger.erase()` for legitimate erasure; sink-level WORM storage or
  write ACLs remain the primary defense; the sentinel is
  defense-in-depth.
- **Hash chain canonicalization.** `syncHash(entry)` calls
  `hashObject(entry)` which calls `stableStringify(entry)` – the entry
  shape (`seq`, `ts`, `kind`, `prevHash`, `hashAlgo`, `schemaVersion`,
  …payload) is canonicalized via key-sorted JSON, then djb2-hashed to
  a 32-bit hex string. Each entry carries `hashAlgo: "djb2-1"` and
  `schemaVersion: 2` – any change to the canonicalization, hash
  function, or entry shape bumps the matching tag, so existing exports
  remain verifiable against the algorithm and schema they were written
  under. Version 2 is where `fact.change` gained its `origin` field;
  entries written under 1 still verify, because the version is part of
  what each entry is hashed over.

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

The ledger records the events listed under [Captured events](#captured-events) – constraint evaluations, fact changes, resolver outcomes and lifecycle markers – in order, with the rule that was in effect at the time and the per-clause `whenExplain` payload. It does not record everything `system.observe()` emits: derivation computes, requirement lifecycle, effect runs, reconcile boundaries and source publishes are deliberately left out, because they describe how the runtime reached a decision rather than what it decided. Subscribe with `system.observe()` directly if you need those.

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
| `constraint.evaluate` | `constraintId`, `active`, `whenSpec` (PII operands redacted) or `whenSource` (function-form `sourceHash`), `whenExplain` |
| `fact.change` | `key`, `prior`, `next`, `origin` (see [below](#where-a-write-came-from--origin)). `prior` is **omitted** on the first write of a key, and `next` is omitted when a key is deleted – a value that was never there is not redacted into existence, and keys with no value are dropped before the entry is hashed, so an export carries the same bytes the live entry was hashed over |
| `resolver.write.rejected` | `resolverId`, `fact`, `expected`, `actual` (rejection) or `dropped` (summary) |
| `resolver.complete` | `resolverId`, `requirementId`, `duration` |
| `resolver.error` | `resolverId`, `requirementId`, `error` |
| `system.init/start/stop/destroy` | (lifecycle markers) |
| `system.snapshot` | `snapshotId`, `trigger` (history snapshot marker) |
| `system.history.navigate` | `from`, `to` (time-travel navigation marker) |
| `system.truncated` | `droppedSeq` (oldest entry dropped since the last marker), `droppedCount` (how many). Written after the entry whose arrival caused the overflow, so the marker follows its own cause |
| `system.entry-erased` | `originalKind`, `erasedAt` (per-entry tombstone, replaces an erased entry in place) |
| `system.subject-erased` | `filterHash`, `filterShape`, `erased` (chained marker; raw filter values never land in the ledger – see [Erasure](#erasure-gdpr-art-17-stub)) |

### Batched writes

A write made inside `system.batch()` is recorded. It previously was not, and that covers more than an explicit `batch()` call: event handlers, effects, resolvers before their first `await`, `initialFacts`, `hydrate` and every history navigation write through a batch, so most of the writes a running system makes arrive this way.

Consecutive writes to a key from the same origin fold into **one entry**, carrying the value the key held before that run and the value it holds after – not one entry per write. A change of [origin](#where-a-write-came-from--origin) cuts the run, so a batch that writes a fact and then rewinds history produces two entries for that key, in the order the writes happened. Two consequences, and the second is the one that matters for an audit:

- A body that writes the same key in a loop produces one entry, not one per iteration. A hundred thousand writes to a single key in one batch coalesce to a single entry.
- **A value a fact held only inside a batch is not recorded.** Write a value and overwrite it before the batch closes and the entry reads as the transition from the first value to the last, with nothing about what sat in between. If you need every intermediate value, do not batch the writes.

A key written and then written back keeps its entry, with `prior` and `next` equal. It reads as noise, but a batch that leaves no trace at all is worse.

**This is more entries than before.** On a workload of a hundred event dispatches touching three facts each, the ledger goes from 99 entries to 399. A system's opening state now appears too, because `init` writes through a batch. If you are on the default in-memory sink it holds 10,000 entries and will rotate roughly four times sooner than it used to – see [Sinks](#sinks) and size it for your write rate. Note that **truncation markers share that capacity**: once a sink is overflowing steadily it writes one `system.truncated` marker per real entry, so a buffer sized N holds roughly N/2 of your own entries. Ask for twice what you intend to keep. Anything counting ledger rows in a test or a dashboard should expect different numbers.

### Where a write came from – `origin`

Every `fact.change` entry carries an `origin`:

| `origin` | Means |
| --- | --- |
| `authored` | Your program made this write. |
| `restore` | A history navigation replayed it – `restore`, `goBack`, `goForward`, `goTo`, `replay`, `import`. |
| `hydrate` | Stored state was loaded in – `hydrate`, `initialFacts`, or a snapshot applied through `system.restore`. |

Select on it in the query rather than filtering the result, because `query()` walks newest-first and stops at `limit`:

```ts
ledger.query({ kind: "fact.change", factPath: "cartTotal", origin: "authored" });
```

`origin` is stamped against each write as it is made, never read from a flag when the batch is reported. A batch can hold writes of more than one origin – a program that writes a fact and then rewinds history in the same batch makes both – and a single label taken at the end would describe neither.

**`origin` is not an authenticity signal.** `authored` means the write did not arrive through a replay or a hydration door. It says nothing about who or what made it, and any code holding a system handle can make an authored write. Do not use it to decide whether a change is legitimate.

Replays are **filed, never dropped**. A ledger that dropped them would put a label in charge of whether an entry exists, and a label worth that much is worth forging. Filing them puts it in charge of nothing more than which rows an auditor reads together.

A history navigation also emits a `system.history.navigate` marker carrying the snapshot indexes it moved between. Neither replaces the other: the marker has no keys or values, the `fact.change` rows have no indexes.

### Function-form constraints – `whenSource` is informational only

For **predicate-form** constraints (`when: { cartTotal: { $gte: 50 } }`), the ledger captures the full `whenSpec` – replayable, queryable, and (with PII redaction) safe to persist.

For **function-form** constraints (`when: (facts) => facts.cartTotal >= 50`), the ledger captures only:

```ts
whenSource: { kind: "function"; sourceHash: "a1b2c3d4" }
```

`sourceHash` is a djb2 hash of the stringified function. **The raw source is never captured**, because closures routinely reference secrets in their lexical scope:

```ts
const apiKey = process.env.STRIPE_KEY;
constraints: {
  enabled: {
    when: (facts) => apiKey === "sk-live-..." && facts.x > 0, // ← would leak
    require: { type: "GO" },
  },
}
```

A pre-v1.13 ledger captured a `preview: String(fn).slice(0, 200)` field, which surfaced any inline literal – including credentials – in every `constraint.evaluate` entry. **The current `sourceHash` field reveals nothing about the source**; auditors can use it to detect *when* a function-form constraint changes between deploys (different deploys → different hash) without ever seeing what changed. Function-form constraints are therefore **informational only** in the ledger – they are not replayable from the audit trail. If you need full audit replayability, prefer the predicate form (`when: { … }`) wherever feasible.

## Hash chain – tamper detection

Every entry stores `prevHash`, the djb2 32-bit hash (`hashObject`) of the previous entry's canonical JSON, plus a `hashAlgo: "djb2-1"` tag identifying the algorithm. To detect tampering:

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

v1 ships sync djb2 32-bit only. `verify({ strong: true })` is reserved for v2 (SHA-256 chain) and **THROWS** today – there is no silent fallback. Call `verify()` (no args) for tamper detection.

**A rotated buffer is not a broken chain.** Once a bounded sink is full it drops its oldest entries, so the entries you hold are a window into a longer chain and the first one's `prevHash` points at something no longer present. `verify()` starts the walk from that entry and reports `windowStartSeq` – the seq the window begins at – on the valid arm:

```ts
const result = ledger.verify();
if (result.valid && result.windowStartSeq !== undefined) {
  console.log(`intact from seq ${result.windowStartSeq}; older entries rotated out`);
}
```

A verified window is a narrower claim than a verified chain: the entries present are intact and in order, and nothing is claimed about the ones that rotated out. Use the `system.truncated` markers to see what went.

A gap *after* the window start is reported rather than treated as a break – `missingSeqs` names up to a hundred of the absent seq numbers and `missingSeqCount` gives the exact total. The usual cause is a sink that refused an entry; the chain deliberately closes over one so a single failure does not condemn the whole record. Check `missingSeqCount` as well as `valid`, and set `onWriteError` if a lost entry is something you need to know about as it happens.

`marksChecked` says whether the provenance of erasure tombstones and truncation markers could be checked at all. The runtime records which entries it wrote in memory, so a ledger reloaded from an export – and any sink that does not hand back the same object it was given – reports `false`. The chain is still checked; what is not is whether those two kinds were written by the runtime or appended by someone.

**Erased entries appear as legitimate chain breaks.** When you call `ledger.erase()`, matching entries are replaced with `system.entry-erased` tombstones whose payloads differ from the original – the next entry's `prevHash` no longer matches. `verify()` recognises this pattern and reports the erased seqs on the valid arm:

```ts
const result = ledger.verify();
if (result.valid) {
  console.log(`${result.entryCount} entries; ${result.erasedSeqs?.length ?? 0} erased`);
}
```

The per-entry `system.entry-erased` tombstone payload carries an `erasedAt` (ms epoch) timestamp; the `VerifyResult` summary surfaces the matching seq numbers in `erasedSeqs` so callers can correlate without re-walking the chain.

Real tamper still surfaces as `valid: false` even when tombstones are present.

**Algorithm discriminator.** Every entry carries `hashAlgo: "djb2-1"`. `verify()` dispatches on this tag – v1 has a single arm; v2 will add `"sha256-1"` without breaking pre-v2 exports. Entries with an unknown `hashAlgo` cause `verify()` to throw with a clear error.

See [Threat model](#threat-model) above for what this catches and what it doesn't.

## PII redaction (default ON)

Fact values flow into the ledger via `whenExplain.actual` and `fact.change.{prior,next}`. By default, the ledger asks `system.meta` per lookup whether a fact carries the tag, and *redacts* values for those facts to `"[redacted]"`:

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

## Erasure (GDPR Art. 17 stub)

```ts
const { erased, markerEntry } = ledger.erase({ factPath: "user.email" });
if (markerEntry) {
  console.log(`erased ${erased} entries; marker seq=${markerEntry.seq}`);
} else {
  console.log("filter matched nothing – no marker emitted");
}
```

`erase(filter)` does two things:

1. Replaces matching entries in the sink with `system.entry-erased`
   tombstones that preserve `seq`, `prevHash`, `hashAlgo`, and
   `schemaVersion` so `verify()` can resync the chain across the gap.
   `verify()` reports these seqs in `erasedSeqs: number[]` rather
   than as tamper – see [Hash chain](#hash-chain--tamper-detection).
   Each tombstone also carries an in-module sentinel so `verify()`
   distinguishes legitimate erasures from `sink.write()` forgeries
   (N7 – see [Threat model](#threat-model)).
2. When at least one entry matched, appends a chained
   `system.subject-erased` summary entry – the `markerEntry`
   returned – carrying `erased: number` plus a PII-safe description
   of the filter that ran. **When zero entries match, `markerEntry`
   is `null` and no marker is emitted** – keeps the audit trail
   free of empty `"erased: 0"` records.

The returned name is `markerEntry` – the singular chained
summary – to distinguish it from the N per-entry tombstones that
land in the sink.

### Filter PII safety

The summary marker does **not** record the raw filter – `filterSummary`
is gone. It carries:

| Field | What |
| --- | --- |
| `filterHash` | `hashObject(filter)` – tamper-evident identity, no values. |
| `filterShape` | Stripped shape, e.g. `{ factPath: true, constraintId: false, kind: undefined, changedBetween: "[range]" }`. |

This is intentional: a filter like `{ factPath: "alice@x.com" }` would
land plaintext PII in the audit trail under the old `filterSummary`
field. Two erasures that ran with the *same* filter still share the
same `filterHash` for cross-correlation.

> ⚠ **v1 erases only from THIS sink.** External copies – `toJSON()`
> exports, downstream sinks (SQLite/Loki/Parquet), persisted backups,
> log shippers – must be erased separately. Sink-level erasure
> contracts are a v2 promise.

*Note: actor / operator attribution is not recorded on erase markers – see [What v1 does NOT capture (v2 promises)](#what-v1-does-not-capture-v2-promises) for the complete v2 roadmap.*

## Sinks

```ts
import { memorySink } from "@directive-run/core/plugins";

const sink = memorySink({ capacity: 100_000 });
const ledger = createAuditLedger({ sink });
```

v1 ships the in-memory ring buffer (`memorySink`). It drops oldest past `capacity` (default 10k). For durable / queryable-after-restart sinks (SQLite, Parquet, Loki), implement `AuditLedgerSink` – the interface is open.

## Export

```ts
const dump = ledger.toJSON();
// → { entries: AuditEntry[], capturedAt: number }
```

Save to disk, ship to S3, feed into a reporting pipeline. The entries are plain JSON – no BSON, no Buffer.

> ⚠ **GDPR Chapter V – cross-border transfer warning.** `ledger.toJSON()`
> returns the full ledger payload **including fact values** (even when
> PII redaction is on, non-tagged facts pass through verbatim). When that
> data leaves the EEA – uploaded to a US S3 bucket, shipped to a
> non-adequate cloud region, or relayed through a third-country
> processor – that is a personal-data transfer event under
> [GDPR Articles 44–50](https://gdpr-info.eu/chapter-5/). Pair the export
> with an appropriate transfer mechanism: an adequacy decision (Art. 45),
> Standard Contractual Clauses (Art. 46), or another approved safeguard.
> Directive does not perform the transfer assessment for you.

## What this does NOT do

- **Not a durable store on its own** – `memorySink` is bounded; spill to your own sink for production.
- **Not a real-time alerting pipeline** – pair with `system.observe()` for that. The ledger is the *record*, not the *alarm*.
- **Doesn't capture every observation event** – `derivation.compute`, `requirement.created/met/canceled`, `effect.run`, `reconcile.start/end` are skipped in v1. They're available via `system.observe()` directly if needed.

## What v1 does NOT capture (v2 promises)

The v1 ledger is honest about what it isn't. These are the known gaps,
each tracked as a v2 commitment so deployments don't quietly ship into
an audit gap and find out at the compliance review:

- **Actor / operator / session / request-id / node-id on entries** – v1
  records *what* changed, not *who* changed it. There is no `actor`,
  `operatorId`, `sessionId`, `requestId`, or `nodeId` field on
  `AuditEntry`. For most regulated workflows (SOX §404, HIPAA
  §164.312(b), PCI DSS 10.2) the *who* is non-optional. **v2 promise:**
  pluggable attribution context threaded through every entry, with a
  documented "no attribution" mode for offline / single-tenant use.
- **Per-subject erasure for GDPR Art. 17 (Right to Erasure)** – `erase()`
  in v1 operates on the in-memory sink only. Any persisted export
  (`toJSON()` → S3, file dumps, downstream Loki/Parquet sinks) must be
  erased separately by your application. Directive cannot reach into
  storage it doesn't own. **v2 promise:** sink-level `erase(subject)`
  hook with a documented contract and a reference implementation for
  the durable sinks Directive ships.
- **Read-access logging (writes-only ledger)** – see the dedicated
  section below.
- **Trusted timestamps (RFC 3161 TSA)** – v1 `ts` is `Date.now()` at the
  moment the entry is appended. There is no signed timestamp from an
  external Time-Stamping Authority. For evidentiary use (court-ordinable
  audit trails, regulatory submissions where wall-clock manipulation is
  in scope), a v1 ledger is *contemporary log evidence*, not *certified
  time evidence*. **v2 promise:** optional `tsaProvider` config that
  attaches an RFC 3161 token to each entry (or to chain checkpoints) at
  acceptable cost/latency.
- **Signing keys with rotation** – v1 uses an unkeyed djb2 32-bit chain. Anyone
  with write access to the sink can replay the chain after tampering;
  the chain only catches *uncoordinated* mutation. **v2 promise:** HMAC
  (or Ed25519) signed entries with a rotation protocol that doesn't
  break verification of pre-rotation entries.
- **Cross-border data transfer protection** – `ledger.toJSON()` is a
  personal-data transfer event under GDPR Chapter V (Arts. 44–50) the
  moment the bytes leave the EEA. v1 does not enforce, classify, or warn
  on transfer destinations. **v2 promise:** an opt-in transfer-policy
  hook that runs before export, plus a documented integration pattern
  for SCCs and adequacy-decision gating.

### Read-tracking gap

The v1 ledger is **writes-only**. `constraint.evaluate` entries count
as "a rule was evaluated against the current state" – they are not
"the data was *read* by an actor". A constraint evaluation can fire
because a fact changed, not because a user requested anything.

Applications subject to:

- **HIPAA §164.308(a)(1)(ii)(D)** – Information System Activity
  Review (regular review of access reports, audit logs, and security
  incident tracking), and
- **PCI DSS 10.2.1** – log all individual user accesses to cardholder
  data,

…must layer their own read-access logging on top of Directive. The
ledger captures the system's view of "what changed and why"; it does
**not** capture "who looked at what". **v2 promise:** a `read.observe`
hook so consumers can opt into per-fact read tracking with the same
PII-redaction and tamper-chain guarantees the write side gets today.

## Reference

- API: `createAuditLedger`, `memorySink`, `AuditLedger`, `AuditEntry`, `AuditLedgerSink`, `QueryFilter`
- Pairs with: [`whenExplain` panel](./when-explain-panel.md), [`predicate codegen`](./predicate-codegen.md), [`replayUnder`](./replay-under.md)
