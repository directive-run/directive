---
"@directive-run/core": minor
"@directive-run/ai": minor
"@directive-run/react": minor
"@directive-run/vue": minor
"@directive-run/svelte": minor
"@directive-run/solid": minor
"@directive-run/lit": minor
---

R4 sprint AE review loop — security hardening, honest claims, +2 new public APIs

Four-round AE review loop on the v1.12.0 R4 sprint wrap. Started with
8 CRITICAL / 26 MAJOR; converged in 4 rounds to 0 / 0. Trajectory:
R1 8→R2 4→R3 1→R4 0 CRITICAL. Tests 3551 → 3972 (+421). Two
game-changers shipped as byproducts: `describePredicate` (R6.B) and
`predicateHash` (R6.D).

### New public APIs

```ts
import {
  // Plain-English renderer for FactPredicate
  describePredicate,
  // Content-addressed predicate fingerprint (djb2 32-bit; SHA-256 reserved for v2)
  predicateHash,
} from "@directive-run/core";

describePredicate({ cartTotal: { $gte: 50 }, region: { $in: ["US", "EU"] } });
// → "cart total is at least 50 AND region is one of [US, EU]"

predicateHash({ cartTotal: { $gte: 50 } });
// → "a1b2c3d4" (stable across runs and runtimes)
```

### Security guarantees hardened

- **Tombstone forgery defense** — `verify()` recognizes only `ledger.erase()`-stamped tombstones via an unforgeable internal sentinel symbol. Direct `sink.write({kind:"system.entry-erased",...})` is detected as tamper.
- **PII redaction now walks predicate operands** — `{ email: { $eq: "alice@x.com" } }` no longer leaks the literal into `whenSpec`.
- **Function-form `whenSource` → `sourceHash` only** — function source NEVER lands in audit entries; secrets in closures stay private.
- **AuditEntry payloads are frozen** at write time. In-process mutation throws.
- **`AbortSignal.any()` properly composes** runner timeouts with caller signals (previously caller signal silently disabled timeout).
- **PII default-redaction** for `meta({ tags: ["pii"] })` fact values in the audit ledger. `capturePII: true` opts out.
- **predicateFromIntent** ships `signal?: AbortSignal`, `redactIntent?: boolean`, `intentHash` provenance field, and `dangerousRegex` ReDoS detection.

### v1 boundaries (honest)

The audit-ledger is **tamper-evident**, NOT cryptographic-grade:

- djb2 32-bit hash chain — detects accidental + light-adversarial tamper. SHA-256 reserved for v2.
- `verify({ strong: true })` throws "reserved for v2" (was a no-op silently returning valid in v1.12.0).
- In-memory ring buffer drops oldest past `capacity` (default 10k). SQLite / Parquet sinks reserved for v2.
- `ledger.erase()` provides per-subject GDPR Art.17 erasure in-sink only; persisted exports must be erased separately. Erased entries break the chain at the erasure point; `verify()` reports them in `erasedSeqs: number[]`.
- No actor / operator / session attribution on entries (v2).
- No read-tracking (constraint evaluations + writes only).
- No trusted timestamps (RFC 3161 TSA) — `Date.now()` is operator-controlled.
- No signing keys with rotation (v2).

### Migration (from v1.12.0)

| Was | Now |
| --- | --- |
| `predicateToolSpec(schema)` | `predicateToolSpecAnthropic(schema)` (deprecated alias retained) |
| — | `predicateToolSpecOpenAI(schema)` (new — OpenAI Chat Completions shape) |
| `predicateFromIntentWithProvenance().rawOutputHash` | `.predicateHash` (now canonicalized via `stableStringify` before hashing — semantically-identical responses produce identical hashes) |
| `VerifyResult.erasedAt: number[]` | `VerifyResult.erasedSeqs: number[]` (avoids units collision with per-tombstone `erasedAt` timestamp) |
| `ledger.erase().tombstone` | `.markerEntry` (renamed; plural mismatch resolved) |
| `ledger.erase()` always emitted marker | Now `{ erased: 0, markerEntry: null }` for zero-match calls (no chain pollution) |
| `PredictResult.predicate` | removed (input reference; caller already has it) |
| `predict({ cartTotal: { $changed: true } }, facts)` | now synthesizes a warning in `missingChanges` when `prev` is omitted (previously silent) |
| `doctor.checkAgainst({ a: 100 }, [{ id: x, whenSpec: { a: 50 } }])` `subset` → `contradictions` | now → `warnings` (subset means "redundant", not "impossible") |
| `doctor.checkOwns()` returned `{ findings }` | now `{ warnings }` with `severity` discriminator |
| `AuditEntry` (constraint.evaluate).whenSource.preview | `.sourceHash` (secret-leak defense) |
| `Vue useAuditLedger` initial value sync | initial query fires immediately + microtask refresh (no empty-state flash) |
| `Svelte` only `createAuditLedgerStore` | `useAuditLedger` alias added for cross-framework muscle memory |
| `dangerousRegex` exported from main barrel | moved to `@directive-run/core/internals` (the `@internal` tag was contradictory) |

### Audit-ledger AuditEntry kinds (14)

`constraint.evaluate`, `resolver.write.rejected`, `fact.change`,
`resolver.complete`, `resolver.error`, `system.init/start/stop/destroy`,
`system.snapshot`, `system.history.navigate`, `system.truncated`,
`system.entry-erased`, `system.subject-erased`. All entries carry
`schemaVersion: 1` + `hashAlgo: "djb2-1"` for future v2 dual-format
verify.

### useAuditLedger framework parity

React / Vue / Svelte / Solid all expose `useAuditLedger(ledger, filter, { pollMs? })` returning a reactive array of matching entries. Lit ships `AuditLedgerController` as a `ReactiveController`. All five poll (default 250 ms; minimum clamp at 50 ms in dev mode). Pub/sub subscription API reserved for v2.

### What didn't change (back-compat)

- The 14-variant `AuditEntry` discriminated union — every consumer's switch keeps working; new kinds were strictly additive (the compliance-audit demo gained an exhaustiveness `never` check to catch future drift at compile time).
- All R4 sprint v1.12.0 APIs (`createAuditLedger`, `predicateFromIntent`, `predict`, `doctor`, `predicateToSQL/Mongo/Postgrest`, `whenExplain` panel) — same call signatures, hardened internals.
- All R6.B / R6.D APIs added are net-new exports; no removed surface.

### Compliance demo updates

`examples/compliance-audit` gained an ERASE button alongside TAMPER + VERIFY, demoing the full GDPR Art.17 → tombstone → verify-with-`erasedSeqs` flow. Bundle 146 kB / 46 kB gz.

### Out of scope (queued for next sprint, see IDEAS.md)

R6.A `ledger.replayUnder()`, R6.C `predicateToZod/JSONSchema/TypeScript`,
R7.A ensemble-jury `tuneFromIntent`, R7.B `directive ledger render`
(English forensic timeline), R7.C predict×checkOwns preemptive
collision, R7.E `RULES.md` codegen via `describePredicate`. All
buildable in <3 days each on the hardened v1.13.0 substrate.
