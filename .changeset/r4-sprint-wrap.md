---
"@directive-run/core": minor
"@directive-run/ai": minor
"@directive-run/react": minor
---

feat: predicate-from-intent + audit-ledger + predict + doctor (R4 sprint wrap)

The headline this release earns:

> *"The LLM wrote a rule. The type-checker said no. The doctor said no.
> The predictor said which facts must change. Two turns later, the rule
> was in production — and every state change since then ships with a
> court-admissible, cryptographically-chained explanation. Tamper one
> byte, the chain proves it."*

Six new public APIs across three packages, all compounding on the
rules-as-data substrate shipped earlier this quarter.

### `@directive-run/ai`: `predicateFromIntent`

Let an LLM emit a `FactPredicate` JSON, structurally + semantically
validated against your schema before it reaches the engine. Five layers:
output-size cap (default 64 KiB DoS guard), `JSON.parse`,
`validatePredicate` (closed operator set + depth + JSON-safety),
operator-count cap, `validatePredicateAgainstSchema` (operator-on-kind).
On failure: structured error feeds back to the model in the next
attempt. Throws `PredicateFromIntentError` on retry exhaustion.

```ts
const predicate = await predicateFromIntent({
  intent: "block checkout if cart is empty or user is unverified",
  schema: myModule.schema,
  runner,
});
// → typed FactPredicate, ready to drop into a constraint
```

Tool-spec preset `predicateToolSpec(schema)` for OpenAI / Anthropic
function-calling APIs.

### `@directive-run/core/plugins`: `createAuditLedger`

Append-only, queryable, hash-chained log of every state change.
Captures `constraint.evaluate` (with `whenSpec` + `whenExplain`),
`fact.change` (prior/next), `resolver.write.rejected`,
`resolver.complete/error`, system lifecycle. Query by fact path
(exact match, no LIKE wildcards), constraint id, kind, time range.
Sync djb2 hash chain (`verify()` is sync); optional async SHA-256
strong verify reserved for v2.

Built-in **PII redaction**: fact values for `meta({ tags: ["pii"] })`
keys are replaced with `"[redacted]"` by default. Opt out with
`capturePII: true`.

```ts
const ledger = createAuditLedger();
createSystem({ module, plugins: [ledger.plugin] });

ledger.query({ factPath: "cartTotal", changedBetween: ["2026-01-01", "2026-06-01"] });
ledger.verify(); // tamper detection
```

### `@directive-run/core`: `predict()`

"Would this predicate fire against these facts? If not, what's the
smallest change that would make it fire?" Closes the LLM-emit
iteration loop: model writes rule → `predict()` reports
`missingChanges` with human-readable suggestions → model rewrites.

### `@directive-run/core`: `doctor.checkAgainst()`

Structural contradiction detection between a candidate predicate and
existing constraints. Three types: `direct` (mutually exclusive),
`subset` (candidate is redundant), `overlap` (warning). Pairs with
`predicateFromIntent` for the "doctor says no" gate before LLM-emitted
rules reach production.

### `@directive-run/core`: schema introspection

`getKind(schema)`, `getSchemaFieldKinds(schema)`,
`getOperatorsForKind(kindNode)` — runtime discriminant for the
operator-on-kind matrix that previously only lived in the
`OperatorObject<V>` type. Used by `predicateFromIntent` and
`validatePredicateAgainstSchema`; also useful for prompt builders,
playground UIs, and `predicateToZod` (future).

### `@directive-run/react`: `useAuditLedger`

Subscribe to an audit ledger and get the latest entries matching a
filter, re-rendering as new entries land. The "drop `<AuditLog />`
in your dev sidebar" hook.

```ts
const entries = useAuditLedger(ledger, { kind: "constraint.evaluate", limit: 20 });
```

### What's deferred (tracked in IDEAS.md)

- **SQLite / Parquet / Loki sinks** — sink interface is open; v1 ships
  in-memory `memorySink` only.
- **Audit-ledger devtools panel** — `useAuditLedger` hook ships;
  full panel integration with the floating devtools panel is a
  follow-up.
- **Strong async SHA-256 verify** — v1 ships sync djb2 chain (fast,
  isomorphic, catches accidental + light-adversarial tamper). SHA-256
  for compliance-grade collision resistance lands as v2 dual-chain.
- **Full SMT-lite `doctor`** — z3.wasm-based satisfiability. v1 ships
  structural contradiction detection (direct / subset / overlap).
- **`predicateToZod()`** — schema introspection unlocks this. ~0.5d
  follow-up once demanded.
- **`useAuditLedger` for Vue / Svelte / Solid / Lit** — React only in
  v1; framework parity is mechanical.

Compounds with: `@directive-run/query`, RFC-0004 data predicates, R4.G
`replayUnder`, R4.F `diffRules`, R4.H `predicateToSQL`. The eight-tool
story — see the `eight-tools-from-one-decision` blog post.
