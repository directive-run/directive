# `predicateFromIntent` – LLMs write rules, runtime validates

> Let an LLM emit a `FactPredicate` as JSON, structurally + semantically
> validated against your schema *before* it ever reaches the runtime.
> No string concatenation. No `eval`. No prompt-injected `$where`.

## The pipeline

```ts
import { createOpenAIRunner } from "@directive-run/ai/openai";
import { predicateFromIntent } from "@directive-run/ai";

const runner = createOpenAIRunner({ apiKey, model: "gpt-4o-mini" });

const predicate = await predicateFromIntent({
  intent: "unblock checkout when the cart total is at least 50",
  schema: checkoutModule.schema,
  runner,
});
// → { cartTotal: { $gte: 50 } }
```

Five layers of validation per call:

1. **Output-size cap** (default 64 KiB) – rejects the 10 MB-payload DoS before `JSON.parse`.
2. **`JSON.parse`** – wrapped in `extractJsonFromOutput` so surrounding prose is tolerated.
3. **`validatePredicate`** – closed operator set (`$eq`, `$gte`, `$any`, …), depth limit, prototype-safe, JSON-safe operands.
4. **Operator-count cap** (default 256) – kills `{ $any: [{x:1}, …100k] }`.
5. **`validatePredicateAgainstSchema`** – cross-checks operator-on-kind: `$gte` on a boolean fact, unknown fact path, etc.

On any failure: the structured error feeds back to the LLM in the next attempt's prompt, including the original intent, the schema kinds, and the operator allowlist for the offending fact. Default 3 retries.

On retry exhaustion: throws `PredicateFromIntentError` with `.attempts`, `.errors`, `.lastRawOutput`. Never returns a partial / unvalidated predicate. Use `predicateFromIntentRaw` if you want diagnostics without the throw.

## Tool-spec preset for function-calling APIs

OpenAI and Anthropic use different tool-spec shapes – pick the matching helper.

**OpenAI (Chat Completions / Responses):**

```ts
import { predicateToolSpecOpenAI } from "@directive-run/ai";

const tool = predicateToolSpecOpenAI(checkoutModule.schema, {
  name: "set_checkout_rule",
});

await openai.chat.completions.create({
  model: "gpt-4o-mini",
  tools: [tool], // → { type: "function", function: { name, description, parameters } }
  messages: [...],
});
```

**Anthropic (Messages API):**

```ts
import { predicateToolSpecAnthropic } from "@directive-run/ai";

const tool = predicateToolSpecAnthropic(checkoutModule.schema, {
  name: "set_checkout_rule",
});

await anthropic.messages.create({
  model: "claude-3-5-sonnet-latest",
  tools: [tool], // → { name, description, input_schema }
  messages: [...],
});
```

> **`predicateToolSpec` (no suffix) is deprecated.** It returns the Anthropic shape for back-compat with v1.12.x callers. Prefer the explicit helper that matches your provider.

## Retry feedback is provider-friendly (M16)

When a validation error fires a retry, the next prompt only reminds the LLM about the **fact paths that failed**, not the entire schema:

```
Validation errors (fix every one):
  - path "active", op "$gte": Operator "$gte" is not allowed on fact "active" of kind "boolean". Allowed: $eq, $ne, $in, $nin, $exists.
    → allowed operators for this fact: $eq, $ne, $in, $nin, $exists

Schema reminder:
  active: boolean – allowed: $eq, $ne, $in, $nin, $exists
  …and 199 more fact(s) available – ask if you need the full list.
```

This keeps retry prompts short for large schemas (200+ facts) – critical for token budgets and context-window pressure. Non-structural errors (e.g. JSON parse failures) fall back to the full schema, since the offending paths aren't known.

## Concurrency + cancellation (M7, N6)

`predicateFromIntent` does **NOT** limit in-flight calls. Wrap it with a concurrency limiter (e.g. `p-limit`, `Bottleneck`) before exposing it to user-driven traffic:

```ts
import pLimit from "p-limit";

const limit = pLimit(5); // at most 5 concurrent LLM calls
const predicate = await limit(() => predicateFromIntent({ ... }));
```

Pass an `AbortSignal` via `opts.signal` for cooperative cancellation. The signal is checked between retry attempts AND forwarded into the runner call (`runner(agent, input, { signal })`):

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000); // 5s deadline

const predicate = await predicateFromIntent({
  intent: "...",
  schema: ...,
  runner,
  signal: controller.signal,
});
```

**Runner must honor the signal for true mid-call cancellation (N6).** Fetch-based adapters (the bundled OpenAI / Anthropic / Ollama runners) thread the signal through to `fetch`, so the network call aborts mid-stream. A custom runner that ignores the third arg of the `AgentRunner` signature still delivers cancellation – but only at the next retry boundary, since the in-flight request will run to completion before the loop checks `signal.aborted` again.

When the runner honors the signal and throws an abort-shaped error (`DOMException("Aborted", "AbortError")` from fetch, or any throw while `signal.aborted` is true), `predicateFromIntent` rethrows as `Error("aborted")` without burning a retry attempt.

## Provenance – auditable rule emission (M24, N3, M6)

Production deployments **MUST** persist a provenance record alongside any LLM-emitted predicate. Without it, auditing "where did this rule come from?" later is guesswork.

`predicateFromIntentWithProvenance` wraps `predicateFromIntent` and returns both:

```ts
import { predicateFromIntentWithProvenance } from "@directive-run/ai";

const { predicate, provenance } = await predicateFromIntentWithProvenance({
  intent: "block checkout when cart > 10k",
  schema: checkoutModule.schema,
  runner,
  agent: { name: "predicate-emitter", model: "gpt-4o-mini" },
});

await db.predicates.insert({
  predicate,
  model: provenance.model,            // "gpt-4o-mini" (or "unknown" – see below)
  intent: provenance.intent,          // sanitized intent – omitted when redactIntent: true
  intentHash: provenance.intentHash,  // SHA-256 hex of the sanitized intent (always present)
  emittedAt: provenance.emittedAt,    // ISO timestamp
  attempts: provenance.attemptCount,  // retry count
  predicateHash: provenance.predicateHash, // canonicalized hash of the validated predicate
});
```

### Hash semantics (N3)

- **`predicateHash`** hashes the VALIDATED predicate object, canonicalized via stable stringification. Two LLM responses that differ only in whitespace or key order produce the **same** hash. This is the right primitive for "did the model emit the same logical rule?" queries.
- **`intentHash`** hashes the sanitized intent STRING (SHA-256 when `crypto.subtle` is available, djb2 fallback). Use it to dedupe identical intents or to satisfy "we never stored the raw intent" claims.

The legacy `rawOutputHash` field is gone – it hashed the raw LLM output string, which made two semantically-identical responses with different whitespace hash differently. If you have stored `rawOutputHash` values from v1.12.x, re-derive `predicateHash` from the persisted predicate via `predicateHash(predicate)` from `@directive-run/core` (public API – semver-stable, no `/internals` import needed).

### PII guidance – `redact` vs `redactIntent` (M6)

> ⚠ **`redactIntent` defaults to `false` for back-compat.** For
> PII-sensitive deployments, ALWAYS pass `redactIntent: true` – the
> raw intent often contains user-supplied content (names, emails,
> medical / financial details, customer messages) that becomes a
> permanent record in `provenance.intent` once persisted. The default
> is opt-in only because flipping it now would silently strip
> diagnostic data from existing callers; **v2 may flip this default**.

The two PII knobs run at different stages of the pipeline. Use both for full coverage:

| Option | When it runs | What it does | Default |
| --- | --- | --- | --- |
| `redact` | **Before the LLM call** | Sanitize the `intent` STRING before it lands in the system prompt sent to the model. Common uses: strip SSN / email / phone patterns, scrub prompt-injection markers. | `undefined` (no-op) |
| `redactIntent` | **After the LLM call** (in the provenance record) | Omit the raw `intent` field from `PredicateFromIntentProvenance`. `intentHash` is still computed and persisted – only the raw text drops out. | `false` |

The two are independent – `redact` shapes what the MODEL sees, `redactIntent` shapes what the PROVENANCE RECORD persists. For a PII-sensitive deployment you probably want both: a `redact` sanitizer (so the third-party LLM provider never sees raw PII) plus `redactIntent: true` (so the audit record persists only the hash).

```ts
const { provenance } = await predicateFromIntentWithProvenance({
  intent: "patient with SSN 123-45-6789 over the limit",
  schema,
  runner,
  redact: (s) => s.replace(/\d{3}-\d{2}-\d{4}/g, "[SSN]"), // ← LLM sees scrubbed
  redactIntent: true,                                        // ← record drops raw text
});

provenance.intent;     // undefined
provenance.intentHash; // "a1b2c3…" – still present
```

You can still dedupe / correlate via `intentHash`, but the raw text never lands in the provenance payload.

### Model field caveat

`provenance.model` is populated from `opts.agent?.model`. If you call `predicateFromIntentWithProvenance` with no `agent`, the default `predicate-emitter` agent has no model field, and `provenance.model` resolves to `"unknown"`. v1 does **NOT** read provider-detected model strings from `RunResult` – that requires the `AgentRunner` contract to expose it, which is a v2 change. Pass `agent: { name: "...", model: "..." }` explicitly if you need provider attribution today.

## Security model

The `intent` string is **untrusted user input**. The security boundary is the structural validation pipeline – operators are restricted to a closed set, so a prompt-injected `$where: "..."` is rejected at layer 3 before it ever reaches a query compiler.

For sensitive use (admin tools, public APIs):
- Pass `redact?: (intent) => string` to sanitize the intent before it lands in the system prompt.
- Pair with [`doctor.checkAgainst`](./doctor.md) to reject predicates that contradict existing rules.
- Pair with [`predicate codegen`](./predicate-codegen.md) to compile the validated predicate to safe parameterized SQL.

## What this does NOT do

- **Doesn't invoke the model** – you bring your own `runner` (an `AgentRunner` from `@directive-run/ai`'s adapters).
- **Doesn't memoize** – every call hits the LLM. Cache at the call site.
- **Doesn't sanitize the LLM's training-data biases** – if the model emits a discriminatory rule, the validator says "structurally fine"; you still need policy review.
- **Doesn't perform multi-turn reasoning** – one retry loop, errors fed back inline. For complex reasoning, wrap with your own state machine.

> **Demo runners are not LLMs.** The `mockPredicateRunner` shipped in
> `examples/compliance-audit/` is a regex-based dispatcher: it always
> returns *something* and is gated to dev/preview builds. For test
> doubles in your own code, prefer
> [`createMockAgentRunner`](../api/testing.md) from
> `@directive-run/ai/testing`, which records calls and supports per-agent
> response configuration. **Do not ship a mock runner to production.**

## Reference

- API: `predicateFromIntent`, `predicateFromIntentRaw`, `predicateFromIntentWithProvenance`, `predicateToolSpecOpenAI`, `predicateToolSpecAnthropic`, `predicateToolSpec` (deprecated alias), `PredicateFromIntentError`, `PredicateFromIntentProvenance`
- Validation helpers: [`validatePredicateAgainstSchema`](../api/types.md), [`getSchemaFieldKinds`](../api/types.md), [`getOperatorsForKind`](../api/types.md), `dangerousRegex` (subpath `@directive-run/core/internals` – no semver guarantee)
- Pairs with: [`doctor`](./doctor.md), [`predict`](./predict.md), [predicate codegen](./predicate-codegen.md)
