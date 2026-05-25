# `predicateFromIntent` — LLMs write rules, runtime validates

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

1. **Output-size cap** (default 64 KiB) — rejects the 10 MB-payload DoS before `JSON.parse`.
2. **`JSON.parse`** — wrapped in `extractJsonFromOutput` so surrounding prose is tolerated.
3. **`validatePredicate`** — closed operator set (`$eq`, `$gte`, `$any`, …), depth limit, prototype-safe, JSON-safe operands.
4. **Operator-count cap** (default 256) — kills `{ $any: [{x:1}, …100k] }`.
5. **`validatePredicateAgainstSchema`** — cross-checks operator-on-kind: `$gte` on a boolean fact, unknown fact path, etc.

On any failure: the structured error feeds back to the LLM in the next attempt's prompt, including the original intent, the schema kinds, and the operator allowlist for the offending fact. Default 3 retries.

On retry exhaustion: throws `PredicateFromIntentError` with `.attempts`, `.errors`, `.lastRawOutput`. Never returns a partial / unvalidated predicate. Use `predicateFromIntentRaw` if you want diagnostics without the throw.

## Tool-spec preset for function-calling APIs

OpenAI and Anthropic use different tool-spec shapes — pick the matching helper.

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
  active: boolean — allowed: $eq, $ne, $in, $nin, $exists
  …and 199 more fact(s) available — ask if you need the full list.
```

This keeps retry prompts short for large schemas (200+ facts) — critical for token budgets and context-window pressure. Non-structural errors (e.g. JSON parse failures) fall back to the full schema, since the offending paths aren't known.

## Concurrency + cancellation (M7)

`predicateFromIntent` does **NOT** limit in-flight calls. Wrap it with a concurrency limiter (e.g. `p-limit`, `Bottleneck`) before exposing it to user-driven traffic:

```ts
import pLimit from "p-limit";

const limit = pLimit(5); // at most 5 concurrent LLM calls
const predicate = await limit(() => predicateFromIntent({ ... }));
```

Pass an `AbortSignal` via `opts.signal` for cooperative cancellation — checked between retry attempts. Aborted calls throw `Error("aborted")`:

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

## Provenance — auditable rule emission (M24)

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
  model: provenance.model,           // "gpt-4o-mini"
  intent: provenance.intent,         // sanitized (post-redact) user intent
  emittedAt: provenance.emittedAt,   // ISO timestamp
  attempts: provenance.attemptCount, // retry count
  rawOutputHash: provenance.rawOutputHash, // SHA-256 hex (or djb2 fallback)
});
```

The `rawOutputHash` is SHA-256 when `crypto.subtle` is available (browsers, Node 19+, workers); otherwise a sync djb2 hex hash — sufficient as a tamper-evident pointer.

## Security model

The `intent` string is **untrusted user input**. The security boundary is the structural validation pipeline — operators are restricted to a closed set, so a prompt-injected `$where: "..."` is rejected at layer 3 before it ever reaches a query compiler.

For sensitive use (admin tools, public APIs):
- Pass `redact?: (intent) => string` to sanitize the intent before it lands in the system prompt.
- Pair with [`doctor.checkAgainst`](./doctor.md) to reject predicates that contradict existing rules.
- Pair with [`predicate codegen`](./predicate-codegen.md) to compile the validated predicate to safe parameterized SQL.

## What this does NOT do

- **Doesn't invoke the model** — you bring your own `runner` (an `AgentRunner` from `@directive-run/ai`'s adapters).
- **Doesn't memoize** — every call hits the LLM. Cache at the call site.
- **Doesn't sanitize the LLM's training-data biases** — if the model emits a discriminatory rule, the validator says "structurally fine"; you still need policy review.
- **Doesn't perform multi-turn reasoning** — one retry loop, errors fed back inline. For complex reasoning, wrap with your own state machine.

> **Demo runners are not LLMs.** The `mockPredicateRunner` shipped in
> `examples/compliance-audit/` is a regex-based dispatcher: it always
> returns *something* and is gated to dev/preview builds. For test
> doubles in your own code, prefer
> [`createMockAgentRunner`](../api/testing.md) from
> `@directive-run/ai/testing`, which records calls and supports per-agent
> response configuration. **Do not ship a mock runner to production.**

## Reference

- API: `predicateFromIntent`, `predicateFromIntentRaw`, `predicateFromIntentWithProvenance`, `predicateToolSpecOpenAI`, `predicateToolSpecAnthropic`, `predicateToolSpec` (deprecated alias), `PredicateFromIntentError`, `PredicateFromIntentProvenance`
- Validation helpers: [`validatePredicateAgainstSchema`](../api/types.md), [`getSchemaFieldKinds`](../api/types.md), [`getOperatorsForKind`](../api/types.md), `dangerousRegex`
- Pairs with: [`doctor`](./doctor.md), [`predict`](./predict.md), [predicate codegen](./predicate-codegen.md)
