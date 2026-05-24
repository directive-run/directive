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

```ts
import { predicateToolSpec } from "@directive-run/ai";

const tool = predicateToolSpec(checkoutModule.schema, {
  name: "set_checkout_rule",
});

await openai.messages.create({
  model: "gpt-4o-mini",
  tools: [tool], // drop-in tool spec
  messages: [...],
});
```

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

## Reference

- API: `predicateFromIntent`, `predicateFromIntentRaw`, `predicateToolSpec`, `PredicateFromIntentError`
- Validation helpers: [`validatePredicateAgainstSchema`](../api/types.md), [`getSchemaFieldKinds`](../api/types.md), [`getOperatorsForKind`](../api/types.md)
- Pairs with: [`doctor`](./doctor.md), [`predict`](./predict.md), [predicate codegen](./predicate-codegen.md)
