# Eight Tools From One Decision: The Update

*Posted 2026-05-24 · ~6 min read · postscript to [Rules-as-Data](./rules-as-data.md)*

Two weeks ago we said six tools fell out of one decision: rules-as-data. We were behind. The total is eight.

This post is the update. Tool seven is LLMs writing rules safely. Tool eight is every state change shipping with an auditable, hash-chained tamper-detection record. Both shipped this week. Both fall out of the same JSON predicate. Both were an afternoon of code.

---

## Tool 7 — LLMs write rules; the runtime says yes or no

```ts
import { predicateFromIntent } from "@directive-run/ai";

const predicate = await predicateFromIntent({
  intent: "unblock checkout when the cart total is at least 50 and the user is in the US or EU",
  schema: checkoutModule.schema,
  runner,
});
// → { cartTotal: { $gte: 50 }, region: { $in: ["US", "EU"] } }
```

The runtime never sees a string the LLM authored. It sees a JSON object the LLM authored. The difference is the entire security model.

Five layers of validation per call:

1. **Output-size cap** — 64 KiB by default. Reject before `JSON.parse`. Kills 10 MB-payload DoS.
2. **`JSON.parse`** — wrapped in our prose-tolerant extractor.
3. **`validatePredicate`** — closed operator set (`$eq`, `$gte`, `$any`, …), depth limit, prototype-safe, JSON-safe operands. A prompt-injected `$where: "function(){return true}"` fails here.
4. **Operator-count cap** — 256 by default. Kills `{$any: [...100k clauses]}` exhaustion.
5. **`validatePredicateAgainstSchema`** — cross-checks operator on kind. `$gte` on a boolean fact? Rejected before the predicate sees a runtime.

On failure: structured errors feed back to the model in the next attempt. Three retries. On exhaustion: throws — never returns a partial predicate.

Pair this with [`doctor.checkAgainst`](/docs/doctor) and [`predict`](/docs/predict) and you get the loop the positioning post promised:

> *The LLM wrote a rule. The type-checker said no. The doctor said no. The predictor said which facts must change. Two turns later, the rule was in production — and the runtime never executed unsafe code.*

That's not a future state. That's two weeks of code, on top of the predicate type we already had.

---

## Tool 8 — Every state change is an auditable entry with hash-chained tamper-detection

```ts
import { createAuditLedger } from "@directive-run/core/plugins";

const ledger = createAuditLedger();
createSystem({ module, plugins: [ledger.plugin] });

// Six months later:
ledger.query({
  factPath: "user.email",
  changedBetween: ["2026-01-01", "2026-06-01"],
});
// → [
//   { ts, kind: "constraint.evaluate", constraintId: "emailVerified",
//     whenSpec: {...}, whenExplain: [...] },
//   { ts, kind: "fact.change", key: "user.email", prior: "[redacted]", next: "[redacted]" },
//   { ts, kind: "resolver.complete", resolverId: "submitEmail", duration: 42 },
//   ...
// ]
```

Three things to notice:

**The auditor's question is one line.** *"Show me every change to user.email between Jan and June."* `ledger.query({ factPath, changedBetween })`. Done. The thing that used to be a SQL query against a custom audit pipeline is a method call.

**The rule that was in effect is in the entry.** Not the constraint ID. The actual `whenSpec` JSON, the per-clause `whenExplain` payload. The auditor doesn't read your source code to find out which version of the rule fired; the rule fired, the rule was logged, the rule is right there in the entry.

**PII-tagged fact values redact by default.** Any fact tagged `meta({ tags: ["pii"] })` ships `"[redacted]"` to the ledger instead of the raw value — in `fact.change` payloads, in `whenExplain.actual`, AND in the cached `whenSpec` operands that flow into every `constraint.evaluate` entry. Opt out with `capturePII: true`. The default-on redaction is one defensive layer, not the whole compliance story — see the [Threat model](/docs/audit-ledger#threat-model) for what v1 is and isn't.

The ledger is hash-chained (djb2; SHA-256 reserved for v2). Every entry's `prevHash` is the djb2 hash of the previous entry, plus a `hashAlgo: "djb2-1"` tag so future algorithm changes don't silently break old exports. `ledger.verify()` walks the chain and reports the first broken link with `expectedHash` and `actualHash` so a UI can highlight which entry was tampered with. The threat model is *detection*, not *prevention* — pair with append-only storage, signed off-site copies, or an RFC 3161 trusted timestamping authority for evidentiary use.

**What v1 is NOT.** Detection-only, not prevention. 32-bit djb2 hash, not SHA-256 (collision-prone against a determined attacker — that's a v2 promise). No per-subject erasure across external storage (`ledger.erase()` reaches only the in-memory sink). No signing keys, no key rotation, no trusted timestamps. The runtime catches accidental + casual-probe mutation cleanly; for adversary-resistant evidence, layer the v1 chain underneath append-only WORM storage and an external TSA.

Eleven hundred LOC for the data layer + plugin + React hook. Two days. Same predicate, third consumer.

---

## What this proves

It proves nothing new. The positioning post said: predicates are data, every consumer of the data participates, future tools are an afternoon of code. This release is two more afternoons.

The first follow-up was the audit ledger. We had RFC-0003's `factsBaseline`, RFC-0004's data predicates, and R4.E's `whenExplain` — all the ingredients. The ledger is the tree-walker that captures them, plus a query API, plus a hash chain. The hard work was done before this sprint started; the ledger is what falls out when you ask "what's the smallest plugin that captures this data?"

The second was `predicateFromIntent`. We had the operator-set as a closed Zod-style enum, `validatePredicate` (structural), and the type-level `OperatorObject<V>` matrix encoding "which operators are valid on which kinds." The new piece is the *runtime* version of that matrix (`getOperatorsForKind`), plus a prompt builder, plus retry-with-feedback. Two days. Same predicate, fourth consumer.

And four bonus tools shipped quietly:

- **`predict()`** — "would this fire, and if not, what facts must change?" Closes the LLM-emit iteration loop with a single tree walk. One day.
- **`doctor.checkAgainst()`** — structural contradiction detection between a candidate predicate and existing constraints. Direct, subset, overlap. The "doctor says no" gate before LLM rules reach production. One day.
- **Schema introspection** — `getKind`, `getSchemaFieldKinds`, `getOperatorsForKind`. The runtime kind discriminant that unlocks `predicateFromIntent`. Half a day.
- **`useAuditLedger` React hook** — drop `<AuditLog />` in your dev sidebar. Live, filtered, re-renders on new entries.

Ten new public APIs. Same JSON tree. Same architectural decision we made eighteen months ago.

---

## What's deferred

We kept the changeset honest about what didn't ship:

- **SQLite / Parquet / Loki sinks** — `memorySink` is the v1 reference. The sink interface is open; anyone with a `better-sqlite3` dependency can ship a Postgres-backed audit log this afternoon.
- **Full SMT-lite `doctor`** — z3.wasm-based satisfiability is the real-deal. The structural v1 catches the obvious contradictions; the SMT version catches the subtle ones.
- **Strong async SHA-256 verify** — `verify({ strong: true })` THROWS today (no silent fallback). The v1 djb2 chain is fast, sync, isomorphic, and catches accidental + casual-probe tamper. SHA-256 is the v2 promise — it lands when someone actually needs it.
- **Audit-ledger devtools panel** — the `useAuditLedger` hook ships; the in-floating-panel render is a follow-up.

None of these are blockers for the headline. All of them are an afternoon of code each, *because the substrate already exists*. That's the dividend.

---

## Try it

```bash
npm install @directive-run/core@latest @directive-run/ai@latest @directive-run/react@latest
```

- [predicate from intent](/docs/predicate-from-intent)
- [audit ledger](/docs/audit-ledger)
- [predict](/docs/predict)
- [doctor](/docs/doctor)
- The original [Rules-as-Data](/blog/rules-as-data) post that started this thread

If you're holding three implementations of the same rule across your stack — and an LLM that's about to write a fourth — this is the library that's going to feel like it was built for you.

It was.

Eight tools deep, two weeks later. We're calling it.
