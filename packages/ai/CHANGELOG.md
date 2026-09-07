# @directive-run/ai

## 1.35.0

### Minor Changes

- [`a37f57b`](https://github.com/directive-run/directive/commit/a37f57b008b98d6df929114741edbfcbb07f41e9) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `KvCheckpointStore` — a checkpoint store that survives the process.

  `InMemoryCheckpointStore` is a `Map`, so every checkpoint dies with the
  isolate that made it. That is the right default for a test and useless
  for the case checkpoints exist for: a long multi-agent run that is
  interrupted and resumed later, possibly on a different machine.

  It takes a structural `CheckpointKv` (`get` / `put` / `delete`) rather
  than a platform SDK, so `@directive-run/ai` still has no Cloudflare,
  Deno or Node storage dependency. Cloudflare's `KVNamespace` satisfies
  the interface as-is; anything else adapts in a few lines.

  FIFO eviction, time-based retention and `preserveLabeled` match
  `InMemoryCheckpointStore` exactly, so the two are swappable.

## 1.34.1

## 1.34.0

## 1.33.1

## 1.33.0

## 1.32.0

## 1.31.3

## 1.31.2

## 1.31.1

## 1.31.0

## 1.30.0

### Minor Changes

- [#148](https://github.com/directive-run/directive/pull/148) [`9e9445d`](https://github.com/directive-run/directive/commit/9e9445d343e134b84dd9a6b67af6daa661030905) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **BREAKING:** metadata queries ask per definition, and tell you when the answer moves.

  `system.meta.byTag("pii")` decides what gets redacted before a value reaches a
  model, a log, or a hash-chained audit ledger. Answering it walks every definition
  in the system, so all three consumers cached the answer — and every defect this
  area has had was a cache built once and never rebuilt.

  **New:**

  ```ts
  // O(1) for a fact. `undefined` means "could not answer" — not "no tag".
  system.meta.carriesTag("fact", key, "pii");

  // Replaces the polled revision() counter. Fires for dynamic
  // register/assign/unregister as well as module registration.
  system.meta.subscribe(["pii"], rebuild, { immediate: true });

  // Narrow the walk when you only want one kind.
  system.meta.byTag("pii", { kind: "fact" });
  ```

  **Renamed, with no aliases:**

  | Before                          | After                                                  |
  | ------------------------------- | ------------------------------------------------------ |
  | `MetaMatch.type`                | `kind`, typed `DefinitionKind`                         |
  | `via?: "inherited"`             | `tagOrigin: "authored" \| "inherited"`, always present |
  | `meta: { inheritsTags: false }` | `meta: { tagBoundary: true }`                          |
  | `byCategory(...)`               | removed                                                |
  | `revision()`                    | removed — use `subscribe`                              |

  **Fixed along the way:**

  - Plugins are now told about a write _after_ the graph is invalidated, so a
    plugin asking what a value carries during `onFactSet` is told about the write
    it is being notified of. The batched path already worked this way, so the two
    disagreed with each other.
  - A throwing `system.subscribe` / `system.watch` callback no longer aborts the
    write it was notified of, taking every plugin behind it down.
  - A fact's tags can no longer be taken back. Schema types are frozen,
    `registerKeys` refuses to re-declare an existing key, and `tags` must be a
    plain array of strings — an `Array` subclass could override `includes` and
    answer differently on each call.
  - The audit ledger and the clobber-loop detector refreshed their pii sets from a
    hook `registerModule` does not emit, so a module registered after start put raw
    values into a sink that cannot be edited afterwards. Both now ask per lookup,
    and both resolve a dotted clause path to the fact that carries the tag.
  - The fact-PII guardrail screens `initialFacts` and hydrated state regardless of
    where it sits in the plugin list.

  **New event:** `guardrail.coverage` reports what a guardrail covers rather than
  what it caught, so a screen that has stopped covering anything is no longer
  indistinguishable from one with nothing to report.

  See `docs/rfcs/0011-metadata-queries.md` for the measurements and the two
  rejected designs.

### Patch Changes

- [#150](https://github.com/directive-run/directive/pull/150) [`fedff2a`](https://github.com/directive-run/directive/commit/fedff2aac07e72c2f215a23dd7497a25a4df1580) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Four fixes to the metadata-query change, found by reviewing the implementation
  rather than the plan.

  **A Zod fact stopped working.** Fact tags decide what gets redacted, so the
  schema type holding them was frozen — unconditionally. A Zod schema is a
  supported fact type and mutates itself while validating: v3 caches its shape
  onto the instance on first parse, v4 re-defines properties on it. Either throws
  on a frozen object, so the first validated write to a `z.object()` fact threw
  instead of validating. The freeze now covers only the types this package builds;
  the tag immutability it exists for is unaffected.

  **A fact key containing a dot was redacted against the wrong fact.** The audit
  ledger and the loop detector resolve a clause path like `user.email` to the fact
  that carries the tag, which meant taking the first segment. A key _literally_
  named `user.email` was then looked up as `user` — so a tagged key could be
  answered for by an untagged one, and its value went into the hash chain in the
  clear. Both now try the exact key first and fall back to the root only when the
  exact key is unknown.

  **The coverage signal read maximum when it was blind.** `guardrail.coverage`
  counted a key as covered whenever the guardrail would screen it — and it screens
  when it cannot tell. A guardrail whose tag lookup was completely broken
  therefore reported full coverage. It now counts only keys it has a definite
  answer for, and reports `reason: "unanswerable"` when any key could not be
  answered. That value was declared and never emitted, while two doc comments told
  operators to watch for it.

  **Metadata queries are fenced off the tracking stack.** Walking the tag graph
  forces derivations to compute, and forcing goes through the same accessor a
  derivation body uses. Defensive rather than demonstrated: the mechanism is plain
  in the code and two reviews flagged it, but six attempts to observe the symptom
  measured no dependency growth. The fence is inert if the path is unreachable.

  **A fact could be tagged everywhere except where it counted.** `carriesTag`
  answered `false` for a key present in the schema but absent from the recorded
  tag map, which made "carries nothing" and "not recorded yet" the same answer.
  Three ways to reach it: a module's schema became visible one statement before
  its tags were recorded, and a source registered by that same module attaches
  synchronously in between; a key registered through `facts.$store.registerKeys`
  was never recorded at all; and a validation throw part-way through registration
  left earlier keys live and unrecorded. Every fact key is recorded now, tags are
  recorded immediately after the schema merge, and the store tells the engine
  about keys it registers.

  **A caller-frozen schema type skipped the validation the freeze exists for.**
  `Object.isFrozen` cannot tell "we prepared this" from "the author froze it
  first", so a pre-frozen type bypassed the `tags` check. Tracked in a `WeakSet`
  instead.

  **One bad value could disable the guardrail's startup sweep and its coverage
  channel for the process.** The sweep, the coverage report and the metadata
  subscription were one unguarded block, so a throwing detector or a value with
  hostile property traps ended all three. The sweep now guards per key, and the
  report and subscription are armed before it runs. The subscription is also
  idempotent across `stop()`/`start()`, which previously leaked a listener and
  duplicated every report.

  **Cross-realm arrays are accepted.** `tags` was rejected unless its prototype
  was exactly `Array.prototype`, which fails for an array from a `vm` context, a
  worker or an iframe. The runtime copies `tags` into its own array, and that copy
  — not the prototype check — is what defeats a subclass overriding `includes`.

  **The coverage digest is delimited.** Hashing the bare concatenation gave
  `{"a","bc"}` and `{"ab","c"}` the same digest and the same count, so a coverage
  swap was invisible to the signal meant to catch it.

## 1.29.5

## 1.29.4

## 1.29.3

### Patch Changes

- [#142](https://github.com/directive-run/directive/pull/142) [`7f02618`](https://github.com/directive-run/directive/commit/7f02618a6af0e28f19e7caa3df8460f9a1463f59) Thanks [@jasoncomes](https://github.com/jasoncomes)! - The Gemini runners defaulted to a model that no longer exists.

  `createGeminiRunner` and `createGeminiStreamingRunner` used `gemini-2.0-flash`
  when no model was named. That model was shut down on 2026-06-01, so the default
  had been an unmakeable call for two and a half months. Nothing caught it: the
  default is only reached when a caller names no model, and the failure arrives
  from the provider, so it reads as a network problem rather than a stale
  constant.

  The default is now `gemini-2.5-flash` — the current model closest to what the
  old default was chosen for, the inexpensive general-purpose one. It is exported
  as `DEFAULT_GEMINI_MODEL` so a caller can read it rather than guess, though
  anything with an opinion should name its own model: a default that names a
  specific model ages by construction.

  A test now requires every adapter's default to be a model its own rate table
  prices. The rate table is the one thing in this package that has to be kept
  current, so agreeing with it is a cheap standing check that the default still
  exists.

## 1.29.2

### Patch Changes

- [#140](https://github.com/directive-run/directive/pull/140) [`ce5b582`](https://github.com/directive-run/directive/commit/ce5b58256e8d8cafea19a40d51345ca9060d46bf) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Corrects the published provider rate tables against each provider's own pricing
  page, and adds the current model generations. The `*_PRICING_AS_OF` dates shipped
  in 1.29.0 asserted these tables had been checked; they had not.

  **Rates that were wrong:**

  | Model              | Was           | Published         |
  | ------------------ | ------------- | ----------------- |
  | `claude-sonnet-5`  | $3 / $15      | **$2 / $10**      |
  | `o3`               | $10 / $40     | **$2 / $8**       |
  | `gemini-2.5-flash` | $0.15 / $0.60 | **$0.30 / $2.50** |

  `claude-sonnet-5` carried the figures from a repricing that was cancelled — $2/$10
  was introduced as promotional and is now the standard rate. `o3` over-charged five
  times on input. `gemini-2.5-flash` _under_-charged, which is the worse direction: a
  budget built on it had quietly stopped stopping anything.

  **Models added.** OpenAI's table held nine legacy entries and none of the gpt-5
  family; all fourteen are now present, along with `o1`, `o1-pro` and `o3-pro`.
  Gemini gained the 3.x line and `gemini-2.5-flash-lite`.

  **Models removed.** `gemini-2.0-flash` and `gemini-2.0-flash-lite` were shut down
  on 2026-06-01. A caller naming one now gets an error naming the model rather than
  a price for something that cannot be called.

  **Cached-input rates** are now populated for OpenAI and Gemini, where they were
  absent. Neither provider charges for cache writes — caching is automatic — so
  `cacheWrite` is deliberately unset rather than defaulted to the input rate.

  **The freshness claim now expires.** A table whose checked-on date is more than
  ninety days old fails its test, with a message naming what to do. The date said a
  person compared these numbers to the provider's page; that claim decays, and
  nothing used to notice.

## 1.29.1

### Patch Changes

- [#136](https://github.com/directive-run/directive/pull/136) [`f10770d`](https://github.com/directive-run/directive/commit/f10770d429a0ccdb16daccaa6615c11bfe37efba) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Three fixes for defects in 1.28.0 and 1.29.0, two of them silent data exposure
  and one a duplicate side effect. Upgrade if you use `factPIIGuardrail` or run
  chains longer than fifty reconcile passes.

  **The personal-data screen could latch open permanently.** 1.28.0 taught it to
  rebuild its screened-key list when the system's metadata changed. That rebuild
  emptied the live list and marked itself current _before_ asking which keys to
  screen — so if the lookup failed, or answered with nothing, the screen was left
  holding nothing with the marker already advanced, and every later write took the
  "already current" shortcut. One transient fault, and the screen never looked
  again. It now builds a new list to the side and swaps it in only on success, so
  a failure leaves the previous screen in place and the next write retries.

  **A single unscannable member switched the screen off for the whole value.** The
  walker copies a value before inspecting it, and when that copy was refused — by
  a function property, a class instance carrying methods, a DOM node — it reported
  "nothing found", which a caller cannot tell from "scanned and clean". A payload
  of `{ email, ssn, retry: () => {} }` committed both the address and the number
  in the clear. A member the copier refuses says nothing about its siblings, so
  refused members are now dropped and everything else is scanned.

  **A reconcile chain longer than fifty passes could re-run resolvers that had
  already finished.** 1.28.0 made a long-dormant depth ceiling reachable. It turned
  out to be reachable by ordinary bounded work — a sixty-item queue drain, cursor
  pagination, a backoff counter — and tripping it clears the requirement diff, so
  every live requirement is treated as new and dispatched again, including ones
  that had nothing to do with the long chain. For a resolver that charges a card
  or sends a message, that is a duplicate. The ceiling is dormant again while a
  proper instrument is built: depth cannot see the runaway it was aimed at anyway,
  because a resolver that reschedules without writing a fact resets the counter
  every pass.

## 1.29.0

### Minor Changes

- [#133](https://github.com/directive-run/directive/pull/133) [`8c23916`](https://github.com/directive-run/directive/commit/8c23916b50c45e24f3ad7e6c95ea2b83c4e63ffb) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Every published rate table now carries the date it was last checked, exported
  alongside it: `ANTHROPIC_PRICING_AS_OF`, `OPENAI_PRICING_AS_OF`,
  `GEMINI_PRICING_AS_OF`, `OLLAMA_PRICING_AS_OF`.

  A rate change is the quietest thing that can go wrong with these tables. Nothing
  throws, nothing is missing, no shape changes — every cost the package reports
  drifts by a constant factor, in the same direction, for every caller. The docs
  said the rates "may not reflect the latest," but there was no value a program
  could read, so a consumer could not tell a table checked yesterday from one
  checked eight months ago, and nothing in CI had a constant to compare against.

  The date is that value. Read it to decide whether these numbers are fresh enough
  to bill against:

  ```ts
  import {
    ANTHROPIC_PRICING,
    ANTHROPIC_PRICING_AS_OF,
  } from "@directive-run/ai/anthropic";

  const daysOld =
    (Date.now() - Date.parse(ANTHROPIC_PRICING_AS_OF)) / 86_400_000;

  if (daysOld > 90) {
    // Re-check against the provider before trusting a bill to these.
  }
  ```

  Internally the tables are also pinned by a digest of their own rates, so a rate
  that moves without its date moving fails a test rather than shipping quietly.

## 1.28.1

### Patch Changes

- [#129](https://github.com/directive-run/directive/pull/129) [`5fdee58`](https://github.com/directive-run/directive/commit/5fdee58ebe7ed880d810b319de83e802aca9ac00) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Two fixes found by making the test double honour abort signals, plus the double
  itself.

  **`createMockAgentRunner` now honours `AbortSignal`.** Its configured delay was
  a bare timer nothing could interrupt, and the signal was never read — so a test
  written against it passed whether or not abort worked, because the mock always
  ran to completion and returned a result. Two existing tests said so in their own
  comments while asserting the opposite behaviour, and both were pinning the
  double's blindness as though it were the contract.

  **A cancelled loser in `race` is no longer reported as a failure.** When the
  race cuts off the losing agents, an agent that honours the signal rejects, and
  that rejection was recorded as an agent error. Errored agents are excluded from
  the cancellation set, so `race_cancelled` did not fire — the event announced
  cancellation only when the loser had ignored the signal and finished normally,
  which is exactly when nothing had been cancelled. A deliberate stop also
  surfaced as something going wrong.

  **`dag` node and graph timeouts are verified for the first time.** Both tests
  asserted that timed-out nodes reached `"completed"`, each with a comment
  explaining that the double slept through the abort. They now assert the node is
  cut off.

  **Checkpoint resume is verified for the first time.** Disabling resume across
  all six patterns previously failed one test out of 2,273; the five tests named
  `"resumes from checkpoint"` asserted only that a result came back, which a run
  that ignored the checkpoint and started over also produces. They now check which
  agents ran and what input they were handed. The same change disables resume and
  fails five.

  Also: the root `build` script now builds `./packages/*` only, matching what CI
  already gates on. `build:all` keeps the old behaviour. An example failing used to
  abort the run before the libraries built, leaving a stale `dist` behind a green
  suite.

## 1.28.0

### Patch Changes

- [#128](https://github.com/directive-run/directive/pull/128) [`a7ad568`](https://github.com/directive-run/directive/commit/a7ad568919781912c0586a3027c18dabcfebc77c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Three fixes for changes that took effect but were never announced, plus a new
  `system.meta.revision()` counter that makes the third fixable at all.

  **`derive.assign` could leave `settle()` waiting forever.** Replacing a
  derivation definition records an invalidation, but the reconcile tail only
  scheduled a pass when a _fact_ had changed — and replacing a derivation changes
  no fact key. The invalidation sat undelivered with no pass in which to deliver
  it, and `await system.settle()` never returned. Definition changes now schedule
  a pass when one is owed.

  **The runaway-reconcile guard could never fire.** `MAX_RECONCILE_DEPTH` warns
  when reconcile passes chain without settling, but the counter was reset at the
  end of every pass and re-entry is refused at the top, so it reached one and went
  back to zero, forever. A resolver feeding its own constraint could spin
  indefinitely with nothing printed. The counter now resets when the system
  actually reaches quiet, which is the state that distinguishes a circular chain
  from a busy system — a chain never reaches it, a busy system reaches it between
  changes.

  **`factPIIGuardrail` stopped screening facts that arrived after it started.** It
  built its set of pii-tagged fact keys once, on init. A module registered later
  brought its own tagged facts, and a write to one of them took the same early
  return an untagged key takes: no scan, no redaction, nothing reported. The set
  now rebuilds when the system's metadata changes.

  **New: `system.meta.revision()`.** An integer that moves whenever the set
  `meta.byTag()` and `meta.byCategory()` search can have changed. Both walk every
  definition in the system, so anything consulting them on a hot path caches the
  answer — and had no way to learn the answer had gone stale short of re-walking.
  Compare this number against the one held with your cache and rebuild only when
  it has moved. Only equality is meaningful: a spurious rebuild is correct, a
  skipped one is not.

## 1.27.1

## 1.27.0

## 1.26.0

## 1.25.0

### Minor Changes

- [#109](https://github.com/directive-run/directive/pull/109) [`7ed05b5`](https://github.com/directive-run/directive/commit/7ed05b56f26f7910cc43316abcb3dcc590b819a9) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Real per-delta token streaming from `run`, `runStream` and `runAgentStream`.

  `runStream` previously promised token granularity and delivered a single chunk
  holding the entire response, synthesized once the message completed. It now
  emits one `token` chunk per completed message **by default** — unchanged — and
  one chunk per provider delta when you ask:

  ```ts
  // per-delta chunks, no callback
  const { stream, result } = orchestrator.runStream(agent, prompt, {
    deltas: true,
  });

  // per-delta chunks plus a callback of your own
  const { stream } = orchestrator.runStream(agent, prompt, {
    onToken: (token) => process.stdout.write(token),
  });
  ```

  `onToken` is also accepted by `run()`, so you can have deltas and one awaited
  `RunResult` without switching APIs.

  Streaming is a field on the options object every runner already receives, not a
  separate runner. That is deliberate: a second runner slot would bypass the
  wrappers you had composed, so a `withBudget`-wrapped runner would stop enforcing
  its budget the moment you streamed. As an option it survives `withRetry`,
  `withBudget`, `withFallback`, `withModelSelection` and `withStructuredOutput`
  untouched, and tool-call guardrails keep gating calls while deltas flow.

  **`backpressure: "block"` now works.** It never did before. The SSE parser called
  `onToken` without awaiting it, and `createStreamingRunner`'s own async callback
  had its promise dropped, so against every shipped adapter `"block"` silently
  behaved as `"buffer"` — which is the opposite of what you pick it for. Returning
  a promise from `onToken` now genuinely stops the reader pulling from the
  provider until it settles. If you chose `"block"` because losing output was
  unacceptable, you were getting `"buffer"`; you are now getting what you asked
  for, including the pause in generation that comes with it.

  Behavior changes worth knowing:

  - **`stream_restart` is a new chunk type.** If you exhaustively `switch` over
    the chunk union, add a branch. It fires whenever the runner is re-invoked and
    replays the response from the start — an agent retry, a `withRetry` retry, a
    structured-output schema retry, a `withFallback` move to the next provider, or
    a multi-agent reroute. Discard everything you rendered for the current
    generation; `generation` on the chunk is an opaque marker for the one now
    starting. Emitted only when per-delta streaming was requested.
  - **`RunOptions.onStreamRestart` carries the same boundary to any runner.** The
    wrappers that re-invoke the runner — `withRetry`, `withFallback`,
    `withStructuredOutput` — call it as they do, and every wrapper forwards it the
    way it already forwards `onToken`. Without it a caller streaming through a
    retrying runner rendered the first attempt and the second end to end, as one
    run-on response, and with `withFallback` the stream and the returned
    `RunResult` disagreed outright. `run(agent, input, { onToken, onStreamRestart })`
    gets the boundary too, so the documented shortcut of `run` over `runStream` is
    no longer a downgrade. If you wrote your own wrapper that re-invokes a runner,
    call `options.onStreamRestart` when you do.
  - **`tokenCount` on `token` chunks is deprecated** in favor of `deltaCount`.
    Neither is a token count: a provider delta is not a token (Anthropic sends
    several per delta, Gemini sends sentences). `result.tokenUsage` and
    `result.totalTokens` remain authoritative. `tokenCount` still carries its
    historical value and is not going away in this release.
  - **`done.droppedTokens` reports a real figure.** It was a hardcoded `0`, so a
    truncated stream declared itself complete. Consumers with a drop check that
    had never fired may start seeing non-zero values — that is loss that was
    already happening.
  - **Buffer eviction changed ends.** An overflowing orchestrator stream now drops
    the newest droppable chunk rather than the oldest, so the beginning of a
    message survives and the tail is what is lost. A control chunk —
    `stream_restart`, `approval_required`, `interrupted`, `done`, `error` — is
    never refused: it makes room by evicting the newest droppable chunk, or the
    oldest chunk of any kind when nothing droppable is buffered. The cap applies to
    every type, though: a consumer that stops reading can no longer make the buffer
    grow without limit. `context_updated` counts as droppable, because it only
    names the facts that changed and the values are still readable from the system.
  - **`error` chunks carry `droppedTokens`.** A run that dropped chunks and then
    failed reported nothing about the loss, because only `done` carried the figure.
  - Accumulated partial output is truncated on code-point boundaries, so a lone
    surrogate can no longer break JSON serialization to plugins or devtools.

  A runner that cannot stream ignores the request and returns its ordinary
  buffered result, and the whole-message chunk is still emitted — so nothing
  breaks. If deltas were requested and none arrived alongside non-empty output,
  the orchestrator says so once instead of leaving it silent.

  **Token accounting no longer reads "the provider said nothing" as "the call was
  free."** `RunResult` gains `usageReported`. It is `false` when `tokenUsage` holds
  zeros because the provider sent no usage at all — an OpenAI-compatible endpoint
  that ignores `stream_options.include_usage` (vLLM, LiteLLM, OpenRouter, older
  Azure) is the common case, and it is reported on the buffered path too. On a
  streamed run against such an endpoint the old behavior was `totalTokens: 0` per
  call forever: `withBudget` recorded `$0`, rolling windows never accrued, and
  `maxTokenBudget` never tripped however many calls went out. `withBudget` now
  charges an estimate for a call it cannot price, and
  `runner.getUnpricedCallCount()` says how many of those there have been, so you
  can tell an estimated figure from a measured one.

  This applies everywhere spend is counted, not only in `withBudget`:

  - **`maxTokenBudget` on both orchestrators accrues the estimate too.** It read
    `result.totalTokens` and nothing else, so an orchestrator configured with a
    ceiling ran without one against an endpoint that reports no usage —
    `facts.agent.tokenUsage` sat at zero call after call, and `budgetEstimateTokens`
    did not help, because that reservation is released when the call returns and
    only ever guarded concurrency. `facts.agent.tokenUsage`,
    `orchestrator.totalTokens` and the multi-agent global counter now rise by an
    estimate for such a call, so `onBudgetWarning` and the ceiling both fire.
  - **Both orchestrators accrue when the call ends, not when the run succeeds.**
    The accrual sat after the `pre_output_guardrails` breakpoint and the output
    guardrails, both of which throw, so a prompt that reliably trips an output
    guardrail bought unlimited unrecorded spend — fifty provider calls and half a
    million tokens against a thousand-token cap, with `tokenUsage` still reading
    zero. It now happens against the provider call itself, on either outcome, and
    charges what the call delivered.
  - **A call is charged for what it delivered, on either outcome.** `withBudget`
    recorded only on the success path, so a response the provider generated,
    delivered and billed cost nothing on the ledger if anything downstream threw —
    including the end-of-response marker check, which by design throws _after_ the
    response has been paid for. A call that throws now accrues the text that
    reached the consumer before it failed, which for a marker-stripping gateway is
    the whole response. A call that delivered nothing accrues nothing: a DNS
    failure and a refused connection cost no money and no longer spend a budget
    that outlives the outage.
  - **Requests the wrappers made on the budget's behalf are charged as they
    arrive.** A budget composed _around_ `withRetry` or `withFallback` saw one call
    where six were made. It now charges every response those wrappers received,
    because every one of them was delivered through the same `onToken` the caller
    passed. Nothing is charged on a wrapper's say-so.
  - **`usageReported` tests the numbers, not the container.** A gateway forwarding
    `"usage":{"prompt_tokens":null,"completion_tokens":null}` used to satisfy the
    presence check and record the call as costing exactly zero — no spend, no
    unpriced-call count, no signal of any kind, where the same gateway omitting the
    `usage` key was correctly charged. Every adapter, on both the streamed and the
    buffered path, now requires a count above zero before treating usage as
    reported. One count is enough; nulls are not, and neither is a frame of zeros —
    no call that reached a model consumed zero input tokens. A real zero output
    count still reports, because the input count beside it is not zero.

  **Every charge is measured, and nothing is priced from a declared figure.**
  `estimatedOutputMultiplier` prices output as a multiple of the _input_, which has
  nothing to do with the response: a retrieval prompt answered in a sentence
  over-charges by nearly six times and a one-line prompt answered at length
  under-charges by orders of magnitude. It is now used for one thing only — the
  pre-call check, where there is by definition nothing yet to measure. Every charge
  after the call is made from the text that actually arrived, at the same
  `length / 4` heuristic this package already applies to input.

  `AgentLike.maxTokens`, added in an earlier iteration of this change as a bound
  for that estimate, is removed. It is written by the caller whose spend is being
  limited, so it bounded nothing: `maxTokens: 1` shrank a pre-call estimate until a
  five-cent per-call cap admitted a call that cost eighteen dollars, and the same
  field charged a budget four thousand dollars for a connection that was never
  established. Set `max_tokens` on the adapter, which is what sends it.

  **`withBudget` gains `maxUnpricedCalls`.** Unset by default. Set it and the
  runner refuses further calls with a new `UnpricedCallLimitError` once that many
  recent calls have been charged at estimate rather than at reported usage. A hard
  budget enforced against estimates is still a budget, but an endpoint that has
  quietly stopped reporting usage should not be able to keep it that way
  indefinitely. The count is kept over a rolling window — the widest budget window
  configured, or an hour when there is none — like every other figure the wrapper
  keeps, so an outage that ends stops refusing calls once its failures age out.
  `getUnpricedCallCount()` reads that window. Calls a nested budget refused before
  dispatch are neither charged nor counted, by either error it raises.

  **A stream that ends early is an error, and the marker ends the response.** The
  shipped adapters now require the provider's end-of-response marker — `[DONE]` or
  a `finish_reason` for OpenAI-compatible endpoints, `message_stop` for Anthropic,
  `done: true` for Ollama, a `finishReason` for Gemini. A body truncated
  mid-response arrives as a clean end of stream, so a partial answer used to
  resolve successfully and was indistinguishable from a complete one. A runner you
  built with `createRunner` is unaffected unless you opt in with
  `streaming.requireTerminalEvent` and report the marker from `parseEvent` via
  `terminal: true`.

  The marker also stops the read rather than merely being noted. `[DONE]` ends the
  body: nothing after it is parsed, delivered or accumulated, and the reader stops
  pulling. Text arriving after an end-of-response event is discarded whatever the
  provider — that is what a gateway joining two upstream generations onto one body
  produces, and delivering it hands the consumer both answers as one. Token counts
  are still read past the marker, because OpenAI sends its usage frame after the
  `finish_reason` that ends the response.

  **`onToken` is interruptible, and a throw from it is yours.** The awaited
  callback is now raced against the abort signal, so a callback that never settles
  can no longer park the reader — `abort()` and `destroy()` settle the run and
  cancel the stream instead of leaking the socket, the fetch and a `"running"`
  agent state. A callback that throws is wrapped in a new `StreamConsumerError`
  and treated as consumer-side: `withRetry`, `withFallback` and the orchestrators'
  own retry stop rather than buying the same response again for a consumer that
  just crashed on it. Provider failures retry exactly as before.

  **`runStream` now uses the runner the orchestrator was configured with.** It
  invoked the bare runner, so an orchestrator with an `outputSchema` or a
  `circuitBreaker` silently had neither the moment you streamed — including the
  schema retry the `deltas` documentation said you would see. Streamed runs are now
  validated and gated exactly like buffered ones.

  **Multi-agent paths that accepted streaming options now honor them.**
  `runAgentStream` against a registered task hands the task's output to `onToken`
  as well as to the stream, and `runParallelStream` takes `deltas` and forwards it,
  so a multiplexed stream can carry per-delta chunks tagged by agent.

  **A streamed run now leaves the same record behind as a buffered one.** Stream
  chunks are consumed once and then gone, so anything only ever reported as a
  chunk is unavailable to whoever reconstructs the run afterwards.

  - `orchestrator.runStream` writes `agent_start` and `agent_complete` to the
    debug timeline, with the same fields `orchestrator.run` writes and at the same
    two points. It previously wrote nothing at all, so a streamed run was invisible
    on the timeline — including which agent ran and what it produced. The
    multi-agent orchestrator's streaming path already recorded both. Timelines only
    exist when `debug: true`, so this is additive where it appears at all.
  - The single-agent streaming path caps the `toolCalls` fact at 200 entries, which
    is the cap the buffered path has always applied. It appended without bound
    before, so a long streamed session grew the fact forever and a consumer reading
    it could tell which path had produced it.

  **`destroy()` no longer abandons streams that are still open.** It was
  `system.destroy()` and nothing more: a stream in flight kept its consumers parked
  on an iterator that would never resolve, and the provider request — and the spend
  it was accruing — was left with nothing to cancel it. Both orchestrators now
  abort and close every stream still open, so a consumer mid-`for await` observes
  the stream ending. Streams remove themselves as they terminate, so the bookkeeping
  does not grow across a long-lived orchestrator's lifetime, and `destroy()` with
  nothing streaming does exactly what it did before.

  `destroy()`, `abort()` and `interrupt()` also settle the `result` promise.
  Closing the stream released consumers parked on the iterator, but nothing settled
  `result`, so a runner that does not honor the `AbortSignal` it was handed left a
  graceful shutdown waiting on it forever. Each now rejects with the abort signal's
  own reason — the same value a signal-honoring runner reports — and only while the
  run is still in flight, so a completed run's `result` is untouched. `interrupt()`
  also ends the stream and stops counting toward `getActiveStreamCount()`, which it
  did not; what it still keeps alive, and the only thing that distinguishes it from
  `abort()`, is the `liveContext` subscription. `destroy()` detaches that.

  **Diagnosing a stalled stream from outside the library.** `runStream` and
  `runAgentStream` return a `getStats()` reading the stream's buffered chunk count,
  dropped-chunk count, time to first token, current generation and restart count;
  both orchestrators expose `getActiveStreamCount()`. A consumer that stopped
  pulling and a provider that stopped sending were previously indistinguishable
  from the outside — the first shows a filling buffer, the second shows no first
  token. `restarts` counts re-invocations whether or not deltas were requested;
  `generation` only moves when they were, so deriving one from the other reported a
  structural zero on the buffered path where it meant "not measured".

  **A retry that will not happen no longer announces itself.** `withRetry` emitted
  its restart signal before checking whether the run had been aborted, so an
  aborted retry told the consumer to discard a generation that nothing ever
  replaced.

  **`token` chunks carry `generation`.** The same marker `stream_restart` carries,
  repeated on every token, so a boundary the consumer never received is still
  detectable. Control chunks are also no longer refused when the buffer is
  saturated with other control chunks: a control chunk now always lands, evicting
  the newest droppable chunk or, failing that, the oldest chunk of any kind. A
  dropped `approval_required` left a tool call waiting out the full approval
  timeout for a question nobody was asked, and a dropped `stream_restart` let two
  generations concatenate — the defect that chunk exists to prevent. The cap still
  applies to every type.

- [#109](https://github.com/directive-run/directive/pull/109) [`bf1e8f5`](https://github.com/directive-run/directive/commit/bf1e8f51cdb9d85c946ddf54a0247b38714ca1a4) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **`withBudget` accepts `maxTotalCost`: a hard ceiling on a runner's lifetime spend.**

  Every cap the guard already had gates a _prediction_ — the pre-call estimate is compared against what is left and the call is refused before it runs. That is the right shape for a cap that is the only thing standing between a caller and a bill, and the wrong shape for one that is meant to sit _underneath_ a caller's own stopping rule. A predictive cap fires in place of the caller's rule the moment its prediction is the more pessimistic of the two, and then two ceilings at the same number give two different accounts of the same run.

  `maxTotalCost` gates the ledger instead. Nothing is refused while recorded spend is under it, however large the next call looks; once `getSpent("total")` reaches it, no further call is dispatched.

  ```typescript
  const runner = withBudget(base, {
    pricing,
    // Whatever else stops this run, it does not get to spend past $5.
    maxTotalCost: 5,
  });
  ```

  That makes it composable with a caller that knows things the runner does not — the token cap of the call it is about to make, or that a closing document still has to be paid for. The caller's rule stops the run in the ordinary case; this catches the case where the caller's arithmetic was wrong, and bounds the overshoot to the single call that crossed the line. Nothing enforced after the fact against a provider that bills after the fact can do better without predicting, and `maxCostPerCall` and `budgets` are still there for callers who want the prediction.

  Configuration is checked at construction: a ceiling with no rates to price lifetime spend against is refused rather than left silently inert, and one set against all-zero rates warns.

  `BudgetExceededDetails["window"]` and `BudgetExceededError["window"]` gain `"total"`, exported as the new `BudgetWindowName` type. Additive to a union — a consumer with an exhaustive `switch` over the old three will need a fourth arm.

- [#109](https://github.com/directive-run/directive/pull/109) [`2996a18`](https://github.com/directive-run/directive/commit/2996a182b99c91270b1eacde3179918cb17a020a) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **Cost enforcement: adapter pricing tables now work with every cost surface, and the surfaces no longer fail open.**

  The short version: if you use `withBudget` or `createConstraintRouter`, your recorded spend was probably too low &ndash; sometimes zero &ndash; and your caps may never have tripped. Upgrade, then re-read the action items at the bottom.

  ### Pricing tables and the budget speak the same language

  Each adapter published rates as `{ input, output }`, sized for `estimateCost`; the budget surfaces are typed against `TokenPricing`, which spells the same numbers `{ inputPerMillion, outputPerMillion }`. Handing a table to a budget left both rates `undefined`: every cost was `NaN`, every `estimated > remaining` check was `false`, and the budget never tripped. Every `*_PRICING` entry now carries both field pairs, derived from one source so they cannot drift:

  ```typescript
  import {
    estimateCost,
    requireModelPricing,
    withBudget,
  } from "@directive-run/ai";
  import { ANTHROPIC_PRICING } from "@directive-run/ai/anthropic";

  // The tables are `Record<string, ModelPricing>`, so a bare index gives you
  // `ModelPricing | undefined` under `noUncheckedIndexedAccess` — and an
  // unrecognised model reads as "no rates" much later, where it looks like a
  // missing-rate complaint rather than a typo. `requireModelPricing` throws at
  // the lookup, naming the model and the table's known models.
  const pricing = requireModelPricing(ANTHROPIC_PRICING, "claude-opus-5");

  const cost = estimateCost(inputTokens, pricing.input);
  const guarded = withBudget(runner, {
    pricing,
    budgets: [{ window: "day", maxCost: 10, pricing }],
  });
  ```

  `ANTHROPIC_TOKEN_PRICING`, `OPENAI_TOKEN_PRICING`, `GEMINI_TOKEN_PRICING`, and `OLLAMA_TOKEN_PRICING` remain as aliases for the same tables. `ModelPricing` describes the widened entry; `toTokenPricingTable` is exported so you can widen your own the same way. `TokenPricing`, `ModelPricing`, `BareTokenRates`, and `toTokenPricingTable` moved into the pricing module and are re-exported from `budget.ts`, so existing imports keep working.

  ### One place decides what an unpriceable call costs

  `withBudget` charged the pre-call estimate for a call it could not price; `createConstraintRouter`, given the same helper, charged `0`. A runner that never populates `tokenUsage` therefore held `facts.totalCost` at exactly zero for the router's whole life, and a documented `facts.totalCost > 10` failover never fired &ndash; no cost, no counter, no warning. The pricing module now owns that decision instead of handing each caller a `null` to interpret, and returns a dollar figure together with how it was priced. Six conditions charge from what the call delivered rather than from what the provider billed, count against `getUnpricedCallCount()`, and warn once:

  - No `tokenUsage` at all.
  - A count that is not a non-negative integer. A token is a discrete thing, so a real report is a whole number: one `NaN` in a running total is permanent, and a fractional or subnormal count fails quietly instead &ndash; `5e-324` is finite, positive, and not zero, so it priced out to nothing while also slipping past the all-zero check below. A count supplied as a string is refused rather than read as absent; previously a `cacheReadTokens` of `"10000000"` billed as zero while the same string in `inputTokens` was correctly refused.
  - **New:** a report of zero input, output, _and_ cache tokens. A call that ran had a prompt, and a prompt has tokens &ndash; all-zero is a gateway that dropped the usage block, not a free call. A genuinely free local model is unaffected: its rates are zero, so the estimate is zero.
  - **New:** a runner that threw. A throw is not a refund &ndash; a structured-output parse failure, a blocking guardrail, or post-stream validation all reject a completion the provider already generated and billed. Under `withRetry` every attempt burned money no ledger ever saw.
  - **New:** text delivered for a generation the surviving result does not describe &ndash; a retry, a fallback, or a schema re-ask replayed over. The provider billed for it; the usage on the result that survived describes only itself.
  - Counts that price out to a non-finite cost.

  `createConstraintRouter` gains `getUnpricedCallCount()` and the same once-per-condition warning.

  **Charging for a throw, without pretending it is the same as spend.** A cap that fills with money that was never spent is no better than one that misses money that was &ndash; five refused connections consumed $9 of a $10 hourly cap in testing, indistinguishable from real spend. Three changes:

  - A `BudgetExceededError` or `UnpricedCallLimitError` from a nested `withBudget` is charged **nothing**. That guard raises both from its own pre-call checks, before it invokes the runner it wraps, so the provider was provably never contacted. Chained guards no longer bill each other for calls none of them made.
  - Every other throw is charged **what it delivered**, measured off the deltas that reached the caller's `onToken` before it failed &ndash; which for a gateway that strips the completion marker is the whole response the provider generated and billed. A throw that delivered nothing is charged nothing; there is no observation to price, and a DNS failure should not consume an hour of a budget.
  - What _is_ charged for a throw is reported separately by a new **`getFailedCallSpend(window)`** on `BudgetRunner`, alongside `getSpent`. `getSpent(w) - getFailedCallSpend(w)` is spend attributable to calls that returned; a figure approaching `getSpent` means a cap is being consumed by calls that break part-way through rather than by work.

  `createConstraintRouter` gets the nested-refusal exemption and the separate figure, for the same reason it gets everything else here: a `facts.totalCost` that moves on a call the provider never saw makes a `facts.totalCost > N` failover fire on spend that never happened. It sees no deltas of its own, so it still charges the estimate for a throw that reached it; its accessor is `getFailedCallSpend()` &ndash; no window argument, since the router keeps a lifetime total. A blocked call still counts toward `facts.errorCount`, because the routing constraints should see that it failed.

  ### Untrusted input is read once, at the boundary

  Rates were already snapshotted at construction, so a getter or a post-construction `pricing.inputPerMillion = NaN` no longer reaches the cost math. Token counts now get the same treatment. `withBudget` prices one call against every window ledger and once more for the lifetime total, so it priced the call N+1 times; each of those read `result.tokenUsage` itself, and a usage backed by getters answered each one differently &ndash; one recorded run read `$0` against a one-dollar hourly cap while the lifetime total read `$1800`, every result labelled metered, the unpriced counter at zero, not one warning. `result.tokenUsage` is now read exactly once per call into a value threaded everywhere, and `priceCall` will not accept a raw `tokenUsage`, so a second read site is a type error. Same change in `createConstraintRouter`.

  Every read of a caller-supplied object in the cost path is also gated on `Object.hasOwn` through a single helper. Ungated, a polluted `Object.prototype` reached every object that omits an optional field &ndash; for cache rates and cache counts, most of them. `cacheRead = 0` made cache tokens free through the documented JSON-table path; `cacheWrite = -1` made every table construction throw; `cacheWriteTokens = NaN` downgraded every metered call to the estimate; `cacheReadTokens = 1e15` inflated every bill into a false `BudgetExceeded`; `cost = 1e308` summed into `createAgentMetrics`' cost counter on a call that supplied no cost.

  ### Cached tokens are billed, under one name

  `TokenPricing` gains optional `cacheReadPerMillion` and `cacheWritePerMillion`. On providers that report cache usage, `inputTokens` is the _uncached remainder_ and the cache counts are additive, so pricing only input and output billed a heavily cached call at close to zero.

  **Expect your recorded spend to rise, and by a lot on cached workloads.** The rates did not change and neither did your provider bill; what changed is how much of that bill the ledger sees. A long-context agent turn on Sonnet 4.5 — a 200k prompt served mostly from cache, 2k uncached input, 190k cache reads, 8k cache writes, 500 output — recorded $0.0135 and now records $0.1005, which is 7.4x for that shape. It scales with how much of your prompt is cached, so a short uncached call barely moves and a long cached one moves most.

  If you have a cap sized against the old figures, resize it before upgrading. A budget that sat comfortably under its ceiling can start tripping on the first call, and it will be right to. All four classes are now priced in both surfaces; absent cache rates default to the input rate, which is conservative and never free. The published `cacheWritePerMillion` values assume the **5-minute** cache TTL &ndash; a 1-hour cache writes at 2.0x input rather than 1.25x, so pass your own rate if you use it.

  The count has one canonical name, `cacheWriteTokens`, matching the rate that prices it; `cacheCreationTokens` is a documented alias, and adapters populate that one. Supply either. Both resolve in a single function, `normalizeTokenUsage` in `@directive-run/core`, that every consumer of token usage now routes through. Two metrics consumers were reading counts their own way:

  - `createAgentMetrics().trackRun` read only `cacheWriteTokens` while every shipped adapter emitted the other, so adapter usage passed straight through reported no cache writes and a total of 150 rather than 10,000,150. It now also drops non-finite and negative counts, and reads `cost` and `toolCalls` through the same own-property gate and the same validation &ndash; a counter is cumulative and one bad addend is permanent.
  - The **debug timeline's `agent_complete` event** recorded input and output only, so a run that read ten million tokens from the provider's cache showed as a tiny one &ndash; `inputTokens` is the uncached remainder when a provider reports cache usage. `AgentCompleteEvent` gains optional `cacheReadTokens` and `cacheWriteTokens`, and both orchestrators populate all four classes. A count no ledger would accept is reported as `0` rather than rendering `NaN` into a timeline row.

  ### Budgets, caps, and reporting

  - **Every set of rates on one runner must agree.** Budgets sharing a window share one ledger, so it records at one set of rates while the other budget's cap gates against a total never computed at its rates: `[{hour, $1M cap, $0.001/M}, {hour, $100 cap, $15/$75}]` recorded fifty calls costing $4,500 as ten cents, and neither cap tripped. The top-level `pricing` is held to the same rule, because it prices the same call &ndash; it drives `maxCostPerCall` and `getSpent("total")` while the window rates drive the window ledgers, so `pricing: {0.001/M}` beside `budgets: [{hour, $15/$75}]` reported `getSpent("hour")` of $450 next to a `getSpent("total")` of one cent, with `maxCostPerCall` estimating 15,000x low. Both configurations now throw at construction &ndash; **this may reject a config that previously built.**
  - **A call is recorded once per window, not once per budget.** Two budgets on `"hour"` double-charged: ten $3 calls read as $60, and a pair of $100 hourly caps blocked after $51 of real spend.
  - **`maxCostPerCall` is enforced after the call as well as before.** A call estimated at a cent that billed five dollars passed the gate and was absorbed in silence. The money is already spent, so this reports rather than throws, distinguished by a new `phase: "pre-call" | "post-call"` on `BudgetExceededDetails`.
  - **Window overruns are reported too**, not only per-call ones. A call that estimated under its remaining hour and billed over it landed in the ledger unremarked, and the _next_ call got blocked.
  - **`BudgetExceededDetails.estimated` always holds the pre-call estimate.** The billed figure moved to a new `actual` field, present on `phase: "post-call"`. It previously carried the actual cost in that phase, so a handler logging it printed one thing under a name meaning another.
  - **The `onBudgetExceeded` payload is frozen** before the callback sees it, and the thrown error is built from the untouched original. A callback could previously rewrite the fields of the error about to be thrown; assigning a non-number surfaced a `TypeError` in place of `BudgetExceededError`, which callers read as transient and retried.
  - **`getSpent("total")`** reports lifetime spend, previously unobservable with no windows configured.
  - **`budgets[].window` is validated.** Any string was accepted; `"hourly"` produced a window whose spend always read zero, so the cap could never trip.
  - **Every caller-supplied budget value is read exactly once**, `maxCost` and `window` included.
  - **The pre-call estimate reads the cache rates**, charging input tokens at the highest of input, cache-read, and cache-write &ndash; before the call there is no way to know how the provider will split them, and an estimate under the eventual bill is a cap that does not gate. It still reads only the input string, so it remains a floor, not a prediction.
  - **The inert-cap warning tests what the estimate can produce**, not whether every rate is zero. `{input: 0, output: 0, cacheRead: 5}` is not all-zero, yet its estimate was zero and the cap never blocked anything.
  - **`createConstraintRouter` gets `withBudget`'s protections.** Provider pricing was read live and unvalidated on every call: a negative rate won `preferCheapest` every time and drove the cost fact negative.
  - **Pricing tables are frozen, null-prototype objects &ndash; the table and every entry in it.** A `__proto__` key from parsed JSON cannot reroute the table, an entry cannot be swapped for an all-zero one that leaves a cap inert, and a missing cache rate reads as missing. That last part needs the _entries_, not just the table: `estimateCost(tokens, rates.cacheRead)` is the documented way to price cache tokens and reads the field directly, so on a plain object literal `Object.prototype.cacheRead = 0` answered for every entry that omits the rate &ndash; which is most of them.

  ### Anthropic pricing table

  The table stopped at Sonnet 4.5 and held five keys. Missing pricing throws, so a caller on anything else had no pricing at all and could not use `withBudget` windows. It now carries the current generation &ndash; Fable 5, Opus 5, Opus 4.8/4.7/4.6, Sonnet 5, Sonnet 4.6, Haiku 4.5 &ndash; and the previous one &ndash; Opus 4.5, Opus 4.1, Opus 4, Sonnet 4.5, Sonnet 4 &ndash; with undated aliases alongside the dated keys for models that have both. Sonnet 5 is priced at **list**, not its introductory promotion: a promotion expires, and a spend guard that reads low is a spend guard that does not gate.

  The inclusion rule is now written down beside the rates: every model ID a caller might pass, in every spelling, and rows go in and stay in. A model leaving the API moves its row down rather than deleting it &ndash; reconciling last quarter's invoice needs the rates that quarter was billed at, which is why retired Haiku 3.5 is still listed and why Opus 4.1 is listed despite its retirement date.

  Two malformed keys are corrected. `claude-haiku-4-5-20250514` was never a model ID &ndash; it is `claude-haiku-4-5-20251001` &ndash; and it carried $0.80/$4.00 rather than $1/$5, so every rate derived from it was wrong. `claude-haiku-3-5-20241022` should be `claude-3-5-haiku-20241022`. Either way the caller passing the real ID got nothing back. New `requireModelPricing(TABLE, model)` fails at the lookup naming the model, the table, and its known models, instead of returning `undefined` that surfaces much later as a complaint about a missing rate.

  ### Action items

  1. **Re-read your spend numbers.** Anything recorded before this release may be far too low. `getSpent()` and `facts.totalCost` are now correct; historical figures are not.
  2. **Check `getUnpricedCallCount()`.** Non-zero means that many recent calls were charged from what they delivered rather than from what the provider billed. It is kept over a rolling window &ndash; the widest budget window configured, or an hour when there is none &ndash; so a count tracking your call rate means your runner never reports usable usage and every figure is a measurement.
  3. **Check `getFailedCallSpend()` too.** It is the part of `getSpent()` charged for calls that threw after delivering something. A figure close to `getSpent()` means a cap is filling with calls that break part-way through, not work.
  4. **More than one set of rates on a runner?** Two budgets on one window, or a top-level `pricing` beside window budgets, must price a call identically &ndash; otherwise construction now throws.
  5. **`@directive-run/ai` now requires `@directive-run/core` >= 1.25.0** as a peer, for the shared token-usage normalizer. `normalizeTokenUsage` is a runtime function imported by name from `@directive-run/core/plugins`, and an older core does not export it — so this is not a misprice you would have to go looking for. The module fails to load:

     ```
     SyntaxError: The requested module '@directive-run/core/plugins' does not
     provide an export named 'normalizeTokenUsage'
     ```

     It surfaces the first time anything imports `@directive-run/ai`, before any of your code runs. If your package manager reports a peer conflict here, resolve it rather than override it — there is no degraded mode on the other side of that warning.

- [#109](https://github.com/directive-run/directive/pull/109) [`fef89ed`](https://github.com/directive-run/directive/commit/fef89ed265455290181d736f9d4c5b89f4b1e08d) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **The streaming adapters now parse the event-stream format the way the format is defined, rather than the way one provider happens to write it.**

  Every streamed call in the package went through a parser that matched `"data: "` as a literal prefix, split lines on `\n` alone, and treated each `data:` line as a complete JSON document. All three are narrower than the format allows, and each one turns a perfectly healthy response into a wrong answer:

  - **The space after `data:` is optional.** A server that writes `data:{…}` — TGI, several vLLM builds, Workers AI, and anything using `fmt.Fprintf(w, "data:%s\n\n")` — produced zero parsed events, so the call failed with "ended without a completion marker after 0 characters" and no usage attached. That reads as a truncation, so it was retried, and the failed attempts were billed. These are exactly the endpoints the `baseURL` option exists to reach.
  - **Lines end at CR, LF, or CRLF.** A CR-only body buffered as one ever-growing line whose JSON never parsed, and the resulting `SyntaxError` is swallowed as a malformed event — so a healthy stream reported itself truncated.
  - **An event's `data` lines are one payload, joined with newlines, dispatched on the blank line that closes the event.** A server is free to break a payload at any newline, and one that split Anthropic's opening `message_start` across two `data:` lines lost it silently: the run **succeeded with `inputTokens: 0`**, under-billing with no error anywhere.

  Comments (`: keep-alive`), `event:`, `id:` and `retry:` fields, and `data:` heartbeats with an empty payload are all now recognized for what they are.

  **Two silence clocks instead of one, and neither one measures the wrong thing.**

  The stream deadline was restarted from inside each adapter's event parser, so it only moved for lines that produced a JSON payload. That got both directions wrong at once: the format's own keep-alive mechanism — a `:` comment, which is what nginx and Cloudflare send to hold a connection open — never touched it, while Anthropic's `ping` events always did. Measured, comment keep-alives every 100ms against a 500ms deadline threw `TimeoutError` at 513ms, and pings every 100ms against the same deadline ran past 3000ms and kept going.

  A ping means the connection is up. It does not mean the model is producing. So there are now two clocks:

  ```typescript
  const runner = createAnthropicStreamingRunner({
    apiKey,
    timeoutMs: 120_000, // total silence — nothing at all on the wire
    contentTimeoutMs: 600_000, // alive, but producing nothing. Keep-alives do not restart this.
  });
  ```

  `timeoutMs` keeps its meaning and is now restarted by any sign of life, keep-alives included. `contentTimeoutMs` is new, defaults to ten minutes, and is the ceiling on a connection that keeps saying hello and nothing else. Either running out fails with an error named `"TimeoutError"`, and the message says which. **If you have a model that legitimately thinks for more than ten minutes before emitting anything, raise `contentTimeoutMs`.**

  The clocks also stop while a consumer callback holds a token. `onToken` is awaited — that is what makes backpressure real — and the deadline used to run during it, so a consumer doing 600ms of work per delta under a 400ms deadline tripped a `TimeoutError` that blamed the provider for the consumer's own time. The two shipped features cancelled each other out.

  **The deadline now enforces itself.** `reader.read()` is raced against the abort signal instead of relying on the fetch implementation to error the body. Every adapter accepts an injected `fetch`, and a wrapper that tees the body for logging, replays it from a recording, or hands back a fresh `Response` need not propagate the signal at all — which silently disarmed every stream deadline in the package.

  **And every streaming runner has one.** `createOpenAIStreamingRunner`, `createGeminiStreamingRunner` and `createOllamaStreamingRunner` gain `timeoutMs` and `contentTimeoutMs`, and so does the streaming path of `createRunner` — which is the path the shipped adapters and the harness actually take, and which had no deadline at all. Both default as above, so a stalled call that used to hang indefinitely now fails after two minutes of silence.

  **Truncation is no longer indistinguishable from completion.** `stop_reason: "max_tokens"`, `finish_reason: "length"`, `finishReason: "MAX_TOKENS"` and `done_reason: "length"` all resolved as clean successes, so a response cut off mid-sentence was parsed, validated and acted on as though the model had finished saying it. `RunResult` now carries `stopReason` — `"stop" | "length" | "tool_use" | "content_filter" | "other"` — and `rawStopReason` with the provider's own spelling, on the buffered and streamed paths of all four adapters.

  **Money, in four places:**

  - `createAnthropicStreamingRunner` dropped the prompt-cache token counts its own parser had already read. Against the same body, `createRunner`'s streaming path reported `total=9319` and this one reported `total=19` — a 490x under-report on a fully cached prompt, which any token-window budget reads as a free call. Both paths now call one function, the standalone runner accepts `promptCaching: "automatic"` like the buffered one, and a cache count above zero is never dropped even when caching was not requested.
  - A failed call's usage was lost the moment anything wrapped the error. It travels on the error as an own property, and the reader checked only the outermost one — so `withRetry`, which puts the original on `cause`, was enough to lose it. A budget over a retrying stack recorded **$0.00** for a call the provider billed in full on the prompt; measured through the documented `runner` extension point, that was $0.3836 of real spend against a $0.20 ceiling reported as $0.1384, with no overrun event, because the fraction was computed from a ledger that was wrong. The reader now walks `cause` and `lastError` eight links deep. **A custom runner that wraps its errors must keep the original reachable via `cause`, or the ledger under-bills.**
  - Gemini returned the reasoning summary as the answer. A thinking model sends its summary as an ordinary text part flagged `thought: true` ahead of the real one, and the adapter read `parts[0].text` — so against `gemini-2.5-flash` and `-pro` it returned "Let me think..." and discarded the answer, with a clean terminal marker and no error. Thought parts are now skipped, every remaining part is concatenated, and `thoughtsTokenCount` is added to `outputTokens`, which is how the provider bills it.
  - Anthropic tool use produced an empty success: `input_json_delta` fragments were dropped and `toolCalls` was hard-coded to `[]`, so a tool-calling stream returned `output: ""` with 30 tokens billed. Tool calls are assembled from their fragments and returned. **A streamed Anthropic call that makes a tool call now returns it, where it previously returned none** — code downstream of a streaming runner will start seeing `toolCalls` it never saw before.

  **`Retry-After` reaches the code that waits.** The thrown HTTP error carried only prose, and `withRetry` scanned the message for a header that had never been put in it — so against a 429 that said "come back in 20 seconds" it backed off 500ms, then 1s, then gave up. Streaming HTTP failures now throw a `ProviderHTTPError` carrying `status`, `statusText`, `retryAfter` (seconds), `retryAfterMs`, and the rate-limit and request-id response headers. `withRetry` honours the server's interval wherever one was sent, per RFC 9110 §10.2.3, rather than only on a 429.

  **Smaller things:** SSE requests send `Accept: text/event-stream`, and a 200 that answers with a JSON content type says so instead of failing as a truncated stream; `stream_options: { include_usage: true }` can be turned off with `includeUsage: false`, for Azure deployments below api-version 2024-06-01 that answer 400 to it rather than ignoring it; Ollama's `{"error": …}` at HTTP 200 surfaces as that error rather than as a missing completion marker; Gemini's `promptFeedback.blockReason` surfaces as a refusal rather than as a truncation; and the `AbortSignal` combination helper detaches its listeners on runtimes without `AbortSignal.any`, where it previously left one on the caller's signal for every call made with it.

### Patch Changes

- [#109](https://github.com/directive-run/directive/pull/109) [`90af9a3`](https://github.com/directive-run/directive/commit/90af9a356f96de79592b0ea8408e65ebd0f46671) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **A stalled Anthropic stream is no longer able to hang forever.**

  `createAnthropicStreamingRunner` passed the caller's `signal` to `fetch` and nothing else. A connection that stayed open and stopped sending was therefore bounded by exactly one thing: a caller remembering to cancel it. Nothing in the adapter would ever end that call – not a wall clock, not a token count, not the end of the process's patience. A run that reached that state occupied its slot until something outside the library intervened, and an interrupt written to let the turn in flight finish first had nothing to finish.

  There is now a deadline, and it measures the gap between events rather than the length of the call:

  ```typescript
  const runner = createAnthropicStreamingRunner({
    apiKey,
    // Abandon the call after this long with nothing on the wire.
    timeoutMs: 60_000,
  });
  ```

  The distinction is the whole design. A streamed response runs for as long as the model has something to say, so a wall-clock cap on the call as a whole – which is what `timeoutMs` means on `createAnthropicRunner`, and still does – either truncates a long answer or is set so high that it bounds nothing worth bounding. What goes wrong on a stream is not that it takes a long time, it is that it goes quiet and never ends. So the clock starts when the request goes out and is restarted by every sign of life: the response headers, each delta, and the keep-alive pings Anthropic sends while it works. A stream that talks for an hour is never touched. A stream that goes silent is abandoned a fixed interval later, whatever it had already delivered.

  The default is two minutes of silence, which a healthy stream comes nowhere near – the opening frame follows the request almost immediately and pings arrive throughout – and which still bounds a stall to something a person waiting on the turn will sit through. Pass `Infinity` to run without one. Anything that is not a positive number of milliseconds — zero, a negative, `NaN` — is refused when the runner is built rather than on the first stalled call.

  A stall fails with an error named `"TimeoutError"`, the same name `AbortSignal.timeout` gives the buffered path, so a caller can tell a provider that stopped talking from a run they cancelled themselves. The deadline composes with `callbacks.signal` rather than replacing it: cancellation keeps working, and aborting for either reason ends the call.

- [#109](https://github.com/directive-run/directive/pull/109) [`90af9a3`](https://github.com/directive-run/directive/commit/90af9a356f96de79592b0ea8408e65ebd0f46671) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **`withBudget` now charges a call the provider counted and never finished, instead of recording it as free.**

  A call that threw was charged only from the text it had delivered. That covered a stream cut short part-way through its answer and missed the case that costs the most: a run cancelled during time-to-first-token. Anthropic reports the input token count in its opening `message_start` frame, before a token of the answer exists, and bills for it whether or not the answer ever arrives. On a long transcript the input side is most of the bill. Under a guard that only measured delivered text, such a run went into the ledger at zero – with no delivery to measure, there was nothing to charge – and every window total, every lifetime ceiling, and every consumer reading accumulated spend to decide what a later step may spend was short by exactly the calls that failed most expensively.

  Counts a stream reported before it failed now travel out on the error it throws, and the budget prices the call from them. Nothing is charged twice: the report covers the same call the delivered text does, and the two are reconciled rather than added. Where they disagree the larger figure wins, which matters because the two sides of a report arrive at different moments – Anthropic sends the input count in its first frame and the output count in its last, so a stream cut off in between carries a real input figure beside an output figure of zero, however much text has already arrived. The output side takes whichever is larger, the count or the measurement.

  A failure that left nothing behind – a DNS failure, a refused connection, a throw before dispatch – is still charged nothing, since it cost nothing.

  Every failed call is still counted as one the ledger could not price exactly, including the ones now priced from a report, and `getUnpricedCallCount()` and `maxUnpricedCalls` are unchanged in meaning. A report that arrived before a failure describes the part of the call that had happened by then and says nothing about what the provider billed afterwards, so the charge is a floor under the real figure rather than the figure itself, and the count is what says so.

  `getSpent` and `getFailedCallSpend` will read higher than before for any runner whose calls are being cancelled or cut off. That is the correction: the money was always going out.

- [#109](https://github.com/directive-run/directive/pull/109) [`499d400`](https://github.com/directive-run/directive/commit/499d4007229595d6330919cb279bb2dac0e3c4bb) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **The guardrails whose options are all optional can now be called with no options.** `createPIIGuardrail()`, `createRateLimitGuardrail()`, `createToolGuardrail()` and `createLengthGuardrail()` each took an options object in which every field was optional — and then required you to pass it anyway.

  The natural call threw, and it threw from inside the factory while destructuring, so the message named a field you had never heard of rather than the argument you had left out:

  ```typescript
  createPIIGuardrail();
  // TypeError: Cannot read properties of undefined (reading 'patterns')
  ```

  All four now default to `{}`. `createPIIGuardrail()` gives you the built-in patterns, which is what the signature always implied. Passing options explicitly behaves exactly as before.

  Guardrails with a genuinely required field are unchanged — `createModerationGuardrail` still needs its `checkFn`, and `createContentFilterGuardrail` still needs `blockedPatterns`.

- [#109](https://github.com/directive-run/directive/pull/109) [`9ddaa9e`](https://github.com/directive-run/directive/commit/9ddaa9ebcb4c00e0ffcab5afe6d0b8df1a9db315) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **A retry decision now reads the error that carries the HTTP details, not just the one on top.** `withRetry` wraps its last failure in a `RetryExhaustedError` and puts the original on `cause`; a fallback layer wraps that again. The status and `Retry-After` were read off the outermost error only, and a wrapped error has neither.

  A missing status is treated as retryable, so one wrapper was enough to turn a documented non-retryable status into three attempts, and to discard the interval the server asked to be waited. Both readers now follow `cause` and `lastError` to the same depth the cost ledger already walks.

  `Retry-After: 0` is also honoured. Zero is a legal delta-seconds value meaning retry now, and it is distinct from the server having sent no instruction at all — which is what falls back to exponential backoff.

  **`ProviderHTTPError` is exported.** A streaming HTTP failure throws it and these notes describe it as the contract, but the class was not reachable from any entry point: `instanceof` needs the constructor, and reading `status`, `retryAfter` or the request id off a bare `Error` needed a cast.

- [#109](https://github.com/directive-run/directive/pull/109) [`427af64`](https://github.com/directive-run/directive/commit/427af6485800c69d611bb084c10d4b3c76bc88b2) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **A usage report far under what the call delivered is no longer priced as written.** Reporting _no_ usage was always safe — the ledger falls back to charging what it observed arriving and counts the call as unpriced. Reporting almost none was the hole: the figure was present, so it was trusted, and a call that delivered thousands of tokens was billed for the handful it admitted to.

  That is the shape a gateway produces. Anthropic carries output tokens in `message_delta`, the second-to-last frame on the wire; a proxy that truncates, reorders or nulls the tail loses it while `message_stop` still arrives, so the stream closes cleanly and nothing looks wrong.

  It went quiet everywhere at once, because every cap reads the same number: the graceful stop kept authorizing calls, the hard ceiling never tripped, and no overrun was announced. Measured against a real provider frame: **$1.53 spent against a $1.00 ceiling, reported as $0.81, with no event raised.**

  A report is now checked against what arrived before it is used as a price. Past a wide margin it is treated as unusable rather than quietly corrected — the call is charged from what was observed and counted by `getUnpricedCallCount()`, so the ledger says out loud that it is a floor there.

  The check is deliberately blunt, and it does not adjudicate small differences. Four characters per token is a rough count that under-measures code by a wide margin, so a report modestly below its delivery is ordinary and is left exactly as reported. What it catches is a count that is absent in all but name.

  **A call whose result cannot be read is now charged.** The block that reads the provider's usage runs on caller-supplied data, and a property read can throw — an accessor over a disposed handle, a Proxy, a getter that asserts. That throw used to unwind past the recording entirely: nothing was charged, the unpriced count did not move, and a call that had in fact succeeded surfaced as a failure, which a retry policy then read as transient and bought again. It now charges what was observed, counts the call as unpriced, and returns the result.

## 1.24.1

## 1.24.0

### Minor Changes

- [`f9e93cb`](https://github.com/directive-run/directive/commit/f9e93cb308db03079065750b2fc5ea349f962864) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add opt-in Anthropic prompt caching to `createAnthropicRunner`. Pass `promptCaching: "automatic"` to place a `cache_control` breakpoint on the agent's instructions so Anthropic caches the stable system prefix &ndash; repeat calls that share it read from cache instead of reprocessing it, while the variable message suffix stays uncached. The runner also surfaces the cache-token breakdown on `tokenUsage` via two new optional fields, `cacheReadTokens` and `cacheCreationTokens` (present only when caching is active); `inputTokens` remains the uncached remainder and `totalTokens` now includes the cache tokens.

  Non-breaking and off by default. Cache-field emission is gated on the option, not on the response body (the live API returns `cache_*_input_tokens: 0` on every response): with caching off the runner sends the bare-string system prompt and omits both cache fields, so `tokenUsage` is byte-identical to before; with caching on both fields are always present, so a cache miss correctly reports `cacheReadTokens: 0`. Note that Anthropic silently ignores `cache_control` below a per-model minimum prefix (~1024&ndash;4096 tokens), so short instructions may not cache &ndash; a persistent `cacheReadTokens: 0` is the signal. Currently applies to the non-streaming runner; streaming is a follow-up.

## 1.23.1

### Patch Changes

- [`3a86db7`](https://github.com/directive-run/directive/commit/3a86db7a9ff55cff81150eadc766ae3ca47e5790) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Bump `vitest` to `^3.2.6` across every package that pins it directly, closing GHSA-9crc-q9x8-hgqq (arbitrary file read via Vitest's UI server prior to 3.2.6). Dev-dependency only — no runtime code ships to consumers changes. The full workspace test suite (5,383 tests across 195 files) runs green on 3.2.7.

  Per-package `test` scripts now delegate to the workspace root (`cd ../.. && vitest run packages/<name>/`) to match Vitest 3's cwd-relative `include` resolution.

## 1.23.0

## 1.22.0

## 1.21.0

### Patch Changes

- [`3b4d36b`](https://github.com/directive-run/directive/commit/3b4d36b032289eccd426d65a9e2f0439521fcab8) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Two follow-on defensive fixes.

  ## core: batch-resolver cancellation handles requirements that span multiple in-flight batches

  The reverse index from requirement id → owning batch was a `Map<string, string>` — when two batch resolver definitions ended up processing the same requirement instance concurrently (rare, but legal in the type system), the second registration silently overwrote the first. Cancelling the requirement aborted the most recently registered batch only; the other ran to completion despite the explicit cancel.

  The index is now `Map<string, Set<string>>`. A requirement that participates in N batches at once tracks all N owners; cancelling iterates the snapshot and aborts every batch. The unwind path mirrors the change so the `Set` collapses cleanly per batch and the requirement is removed from the index only when the last owner releases it. All-or-nothing batch semantics are preserved within each batch.

  ## ai: self-healing fallback respects the orchestrator's token budget

  `applySelfHealingFallback` calls the user-supplied `runner` (and any `fallbackRunners`) directly. With `budgetEstimateTokens` configured, the primary path reserved tokens against `maxTokenBudget` via `runAgentWithGuardrails`'s pre-flight check — but every fallback call entered the runner without that reservation. A primary failure CAUSED by budget pressure would then drive the fallback into the same overshoot the pre-flight existed to prevent.

  The new `withFallbackBudgetReservation` wrapper reserves tokens against the running `inFlightReservation`, runs the fallback work, and releases the reservation in `finally`. When `budgetEstimateTokens` is undefined (default) the reservation is 0 and the wrapper is a no-op — strict back-compat for consumers that haven't adopted the new option.

- [`dab3537`](https://github.com/directive-run/directive/commit/dab35376019c715066d5127b4ffce7d10729b9f4) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Two follow-on hardenings.

  ## core: per-source teardown timeout is now configurable per source

  `SourcesManager.cleanupAllAsync` and `evictAll` previously applied a single 5-second cap to every source. Long-tail transports that legitimately need more time to drain (a Supabase channel flushing a backlog before close, an OpenTelemetry batch span exporter draining its queue, a Cloudflare DO storage flush awaiting a D1 commit) hit the cap and reported a hang even when the underlying work was healthy.

  `SourceDef` now accepts an optional `evictTimeoutMs?: number` override. Sources keep the 5s default unless they declare a different ceiling — adjacent sources are unaffected. Pass `Infinity` to disable the cap for that source only (the manager skips the timer wiring entirely so Node doesn't emit a `TimeoutOverflowWarning`).

  ```ts
  sources: {
    supabase: sourceFromSupabaseChannel({
      // Default 5s would clip the backlog drain. Give the channel
      // up to 15s to acknowledge the unsubscribe.
      evictTimeoutMs: 15_000,
      // ...rest of the source config
    }),
  }
  ```

  The package-wide default is exported as `DEFAULT_PER_SOURCE_TIMEOUT_MS` for consumers who want to derive their own ceiling.

  ## ai: `FactPIIErrorMode` joins its sibling in the barrel

  The `errorMode` option on `createFactPIIGuardrail` accepts a `FactPIIErrorMode` union. The type was internal-only — the sister type `FactPIIGuardrailMode` was already exported. Consumers writing the option's type annotation had to deep-import from `@directive-run/ai/guardrails/fact-pii.js`. `FactPIIErrorMode` is now re-exported from both `@directive-run/ai` and `@directive-run/ai/guardrails`.

## 1.20.2

### Patch Changes

- [#76](https://github.com/directive-run/directive/pull/76) [`8577c06`](https://github.com/directive-run/directive/commit/8577c06131385983321d2297cff1751e53baec3b) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Surgical hardening batch — closes review findings on top of the v1.20.x release.

  `@directive-run/core` (patch):

  - **`system.notify.guardrailBlocked` plugin-name validation.** RFC 0010
    initially accepted any `plugin` string. A third-party plugin holding
    a `System` reference could forge `"guardrail.blocked"` events claiming
    `plugin: "fact-pii-guardrail"`, misleading compliance audit consumers.
    The method now drops + warns when called with a plugin name that
    doesn't match a currently-registered plugin.
  - **`system.notify.guardrailBlocked` reentry depth cap.** A plugin's
    `onGuardrailBlocked` hook that re-emits via `notify.guardrailBlocked`
    would recurse through the broadcast fabric until stack overflow.
    Capped at depth 4 (shallow re-emission is fine; pathological
    recursion is dropped).
  - **`system.notify.guardrailBlocked` no-op after destroy.** Late hook
    firings post-`destroyAsync` no longer reach observers.
  - **`system.evict()` try/finally on `state.isEvicting`.** Without it, a
    rejected inner work would latch the flag forever and every
    subsequent `evict()` call would be a silent no-op. Cloudflare DO
    hibernation re-fire would become unrecoverable. The flag is now
    cleared in `finally`; the terminal flag (`isDestroyed`) is set by
    `destroyAsync()` on the happy path.
  - **`system.start()` refuses to start during eviction or after destroy.**
    Previously `start()` only checked `isRunning`, so a race between
    `evict()`'s `sourcesManager.evictAll()` and its `destroyAsync()`
    could re-attach sources the host runtime told us to tear down.
  - **`Plugin.onGuardrailBlocked` JSDoc** clarifies that `Error`-typed
    fact values always surface as `"detect"` regardless of the
    guardrail's configured mode.

  `@directive-run/ai` (patch):

  - **`createFactPIIGuardrail` default `walkDepth` raised from `1` → `2`.**
    Zero-config consumers now scan one level of `Error.cause` chain and
    shallow-nested-object shapes. The `walkDepth` JSDoc enumerates the
    cause-chain depth math (recurses at `depth - 1`, so `walkDepth >= 2`
    needed to scan one cause level). Real-world common shapes ship
    zero-config.
  - **File-level JSDoc** documents the `system.observe()` →
    `"guardrail.blocked"` dual surface (RFC 0010) so consumers reading
    the public docblock learn about the typed-event stream alongside
    the `onBlocked` callback.

  `@directive-run/lit` (patch):

  - **`ModuleController.hostDisconnected`** switched from sync `destroy()`
    to `destroyAsync().catch(...)`. The prior async-teardown migration
    covered `SystemController` + `DirectiveQueryController` but missed the
    zero-config `ModuleController` — Lit users using the simplified
    controller were still dropping source-unsubscribe Promises on the
    floor.

  `@directive-run/react`, `@directive-run/vue`, `@directive-run/svelte`,
  `@directive-run/solid`, `@directive-run/lit` (patch):

  - **Dev-mode `console.warn` on `destroyAsync` rejection.** The previous
    fire-and-forget `.catch(() => {})` silently swallowed every unmount-time
    unsubscribe error. Operators had zero signal when a Supabase channel
    `removeChannel()` rejected. The catch now logs in development
    (`isDevelopment === true`); production behavior is unchanged (the
    manager's `phase: "runtime"` observability sink still receives the
    per-source error).

  Closes six critical and six major findings across security and
  architecture. Larger follow-up items deferred to RFCs: Supabase
  channel-name reuse race, `attachGuardrailsToOtel` helper, timeline
  `guardrail.blocked` renderer, knowledge-bundle docs sync.

## 1.20.1

## 1.20.0

### Patch Changes

- [#73](https://github.com/directive-run/directive/pull/73) [`633e9a2`](https://github.com/directive-run/directive/commit/633e9a2bc19ee4450215b2ddc61d22590fd1d9d8) Thanks [@jasoncomes](https://github.com/jasoncomes)! - RFC 0010 — `guardrail.blocked` ObservationEvent + `system.notify` surface.

  `@directive-run/core` (minor — additive public API):

  - New `ObservationEvent` variant `"guardrail.blocked"` with `plugin`,
    `key`, `kind` (`"redact" | "alert" | "detect"`), `count`, optional
    `category`.
  - New `Plugin.onGuardrailBlocked` hook.
  - New `PluginManager.emitGuardrailBlocked` broadcast.
  - New `System.notify.guardrailBlocked(...)` surface — plugin authoring
    API that fans out to every plugin's `onGuardrailBlocked` hook
    (including the synthetic plugin that backs `system.observe()`).
  - Synthetic observe plugin maps the hook to the typed event.

  `@directive-run/ai` (patch — feature add):

  - `createFactPIIGuardrail` calls `system.notify.guardrailBlocked` on
    every detection, in addition to the existing `onBlocked` callback.
    The `kind` field reports `"redact"` (rewrote via follow-up write),
    `"alert"` (configured mode), or `"detect"` (read-only structured
    type like `Error` — the walker matched but cannot construct a new
    instance with guaranteed `stack` parity).

  Backend wiring (`attachSourcesToOtel`, `@directive-run/timeline`,
  audit-ledger) is consumer-driven via `system.observe()` and is
  deferred to follow-up patches.

  Closes the `guardrail.blocked` ObservationEvent variant work.

## 1.19.7

### Patch Changes

- [#69](https://github.com/directive-run/directive/pull/69) [`9529917`](https://github.com/directive-run/directive/commit/9529917dc23e7a9cd0f363894fca4bdf374f61a0) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Walker hardening — `createFactPIIGuardrail`:

  - **Proxy TOCTOU on pre-clone cap.** The v1.19.6 pre-clone array cap read `value.length` twice (once for the comparison, once during `value.slice`). A hostile `Proxy` whose `length` getter lied on the first read (returning a small number) and on the second read (returning 1e9) could bypass the cap and OOM `structuredClone`. The cap now materializes via a fixed-length `new Array(len)` loop that reads each index exactly once, so the Proxy's traps can't TOCTOU. `structuredClone` then operates on a plain Array of bounded length.
  - **`Error.cause` + `AggregateError.errors` blind spot.** v1.19.6 only scanned `Error.message`. PII inside `error.cause` (string or wrapped Error) or inside an `AggregateError`'s `errors` array was missed. The walker now recurses into both, decrementing `walkDepth` for the recursion so depth bounds still apply.
  - **Idempotency-gate restriction.** The `value === _prev` skip in `onFactSet` / `onFactsBatch` is now restricted to primitives. Object references that survived the engine's own dedup (or arrived via direct `facts.$store.set` writes) are re-inspected on every emission rather than skipped.
  - **Error redact-mode is now alert-only.** The Error path returns the input reference as `redacted` (Error instances are not deep-cloned with new identity). The follow-up `$store.set` is now skipped when `result.redacted === value`, preventing the writes-back-the-same-ref no-op + the gate-skip cascade on the next emit. The redaction action for Error values is therefore detection-only regardless of the configured `mode`; this is the correct semantic for read-only structured types.

  Closes four critical findings. The `guardrail.blocked` `ObservationEvent` variant is deferred to a follow-up RFC since it touches the `@directive-run/core` observation API.

## 1.19.6

### Patch Changes

- [#67](https://github.com/directive-run/directive/pull/67) [`d8d298c`](https://github.com/directive-run/directive/commit/d8d298c42d904bbdb2ddf485b6e4b6ce638d839b) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Walker hardening — `createFactPIIGuardrail`:

  - Top-level array cap (`MAX_ARRAY_SCAN = 10_000`) is now applied BEFORE `structuredClone` rather than after. Previously, a 1M-element array shipped as one realtime row would consume CPU inside `structuredClone` before the walker ever saw it. (Regression of the prior array-cap fix, introduced by the v1.19.3 walker rewrite.)
  - `Error.message` strings are now scanned for PII. `Error` instances preserve through `structuredClone`, but the walker's `Object.entries` path skipped them. The walker now extracts `Error.message` and runs the synchronous regex scanner; matches surface via `onBlocked` for log scrubbing wiring (the `Error` instance itself is read-only, so it cannot be redacted in place).
  - `Date`, `RegExp`, `TypedArray` (`Int8Array`, `Uint8Array`, ...), `DataView`, `ArrayBuffer`, and `Blob` are now short-circuited in the object branch. Previously, the walker would iterate their entries (mostly no-op, but TypedArrays expose numeric byte keys that could in theory trigger false matches). Pass a `customDetector` to inspect these structures.
  - `onFactSet` now skips the inspection step when the incoming `value === _prev`. The redact follow-up store write would otherwise re-enter the hook and trigger a wasted `structuredClone` + scan on the already-redacted token strings (a real CPU hit at 10k publishes/sec).

  Documentation tail: `docs/rfcs/README.md` updated to reflect the walker rewrite shipped in v1.19.3 + hardening as v1.19.6. `packages/knowledge/core/choosing-primitives.md` fixes "six primitives" → "seven primitives" (the `source` primitive count was off-by-one).

## 1.19.5

### Patch Changes

- [#65](https://github.com/directive-run/directive/pull/65) [`e7ccffd`](https://github.com/directive-run/directive/commit/e7ccffdb103aea56c8bce44418177bd2a7c0f19f) Thanks [@jasoncomes](https://github.com/jasoncomes)! - createFactPIIGuardrail walker: sanitization-first via `structuredClone`

  Replaces the manual structural walker with a `structuredClone`-at-entry pattern that strips Proxies, exotic getters, Symbol-iterator overrides, functions, and detects cycles BEFORE the walker runs on the safe clone. Closes the entire class of Proxy-based bypass attacks at once instead of one-by-one.

  ### Why the rewrite

  Three prior rounds patched the walker, each closing one Proxy attack and opening a slightly different one:

  - Round 1: array-shape payloads silently bypass the guard (added array branch).
  - Round 2: deeply nested arrays bypass the depth bound; Proxy whose `get` returns different values per read leaks PII via TOCTOU (added depth decrement + array snapshot).
  - Round 3: Proxy whose `Symbol.iterator` yields a billion items OOMs the worker; Proxy whose iterator returns `undefined` crashes the walker; cycle guard via permanent WeakSet false-skips shared-leaf references (added size cap + try/catch islands + in-progress cycle tracking).

  The escalating-patch pattern is the signal that the walker needs to operate on a value the consumer cannot inject hostile behavior into. `structuredClone` is the canonical primitive: the cloned value has no Proxies (unwrapped to underlying target), no exotic getters, no functions (clone throws on them), no Symbol-iterator overrides, no cycles (clone throws on cyclic input).

  ### Net effect on the walker

  | Before                                                      | After                                                                      |
  | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
  | 2 functions (`inspect` + `inspectStructural`)               | 2 functions (`inspect` + `walkClone`)                                      |
  | `inProgress: WeakSet` threaded through every recursive call | none — clones can't be cyclic                                              |
  | `try/catch` around outer `inspect` body                     | one `try/catch` around `structuredClone` at entry                          |
  | `try/catch` around `[...value]` spread                      | none — clones are plain arrays                                             |
  | `try/catch` around `Object.entries(value)`                  | none — clones are plain objects                                            |
  | Per-trap Proxy defense                                      | One sanitization step strips all Proxies                                   |
  | New Proxy traps open new bypasses                           | New Proxy traps don't open bypasses (Proxy is stripped before walker runs) |

  The walker is shorter, simpler to explain in docs, and future-proof against new Proxy attack vectors.

  ### Behavior changes (consumer-visible)

  - **Non-cloneable inputs** (values containing functions, DOM nodes, WeakMaps, `Promise`, class instances with method refs, cyclic refs) now log a `console.warn` and skip inspection with "no match" — same posture as the previous per-Proxy-trap try/catches, just collapsed to one site. The raw value stays in the store; consumers wire a `customDetector` for these shapes.
  - **Map / Set** continue to be skipped by design. Both survive `structuredClone` but aren't walked (their string elements would need a different traversal shape). Consumers wire a `customDetector`.
  - **`Date` and other structured types** survive `structuredClone` and are correctly skipped by the walker (they aren't redact targets; they're left as-is in the redacted output).
  - **Proxy inputs** are stripped to their target shape — `new Proxy([leak@x.com], { get: ... })` becomes `[leak@x.com]` after clone, and the email correctly redacts. (This is a strict improvement: the prior round treated all Proxy inputs as "no match" out of caution; this round actually redacts them.)
  - **All prior-round regression tests pass unchanged** — the new walker is a strict drop-in.

  ### Compatibility

  `structuredClone` is native in every runtime Directive supports: Node 17+, Bun, Deno, Cloudflare workerd, browsers ≥ 2022.

  ### Tests

  3657 passing across core/ai/sources (+2 new regression tests covering non-cloneable input fallback and Map inside payload). Existing prior-round array / Proxy / cycle / NaN regression tests pass unchanged.

## 1.19.4

## 1.19.3

## 1.19.2

### Patch Changes

- [#59](https://github.com/directive-run/directive/pull/59) [`f387316`](https://github.com/directive-run/directive/commit/f387316e5ab146b8ddd1a5eeee5d0fb8cb2ce57f) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Walker Proxy / cycle / NaN surgical hardening + emitInit cascading registration + MCP recipe enforcement

  Three new Proxy-based attack chains in the walker, introduced by the v1.19.1 array-snapshot fix (each narrow patch opens a slightly different bypass; this release trades narrower fixes for an architectural rewrite that's queued separately). Plus one asymmetric snapshot bug in `emitInit`, one NaN clamp gap, and a documented-only multi-tenant pattern with a prose/code contradiction.

  ### Walker hardening

  **Proxy iterator DoS — array length cap.** A `Proxy` whose target is array-shaped (so `Array.isArray` returns `true`) but whose `Symbol.iterator` yields an arbitrary count blocked the event loop / OOM-ed the worker during `[...value]` spread. The throw from V8's allocation failure was swallowed by `safeCall` at the plugin boundary so the raw PII committed to the store unredacted. Walker now caps any single array snapshot at `MAX_ARRAY_SCAN = 10_000` elements (via `Array.prototype.slice.call`), emits a `console.warn` so consumers see the truncation, and leaves elements past the cap as-is in the redacted output.

  **Proxy throw bypass — try/catch wraps structural walk.** A `Proxy` whose `Symbol.iterator` returned `undefined` (or whose `ownKeys` trap threw) used to crash the walker; the throw was swallowed by `safeCall` and the raw PII committed. The walker now wraps the structural walk in `try/catch` — a hostile shape becomes "no match" rather than a silent commit, with a `console.warn` so the gap is visible.

  **Cycle guard switched from permanent WeakSet to in-progress tracking.** The prior round's cycle guard added every visited object to a permanent WeakSet — a non-cyclic payload that re-used the same object reference at multiple slots (`{ primary: user, secondary: user }`) redacted the first occurrence but skipped every subsequent one. Real-world hits: Supabase `{old: row, new: row}` UPDATE with no changes; MCP resource notifications that include the same contact card under `primary` AND `recipients[]`; webhook batches with deduped IDs. Switched to per-walk in-progress: add on entry, remove on exit (`try / finally`). Catches true ancestor cycles, permits shared leaves.

  **`walkDepth: NaN` clamp.** `Math.floor(NaN)` returned NaN, `Math.max/min` short-circuited to NaN, `NaN <= 0` was `false` — the bound never triggered, and on a deeply-nested non-cyclic shape the walker exhausted the stack with `safeCall` swallowing the throw. Clamp now guards with `Number.isFinite(walkDepth)` and falls back to default `1`.

  **Object branch `Object.entries` try/catch.** Wrapped the `Object.entries(value)` call in `try/catch` so a `Proxy` whose `ownKeys` trap throws is treated as "no match" rather than crashing the walker.

  ### Plugin manager

  **`emitInit` loop-until-quiet.** The prior broadcast snapshot fix patched only sync `broadcast`; async `emitInit` still iterated the live array, so a plugin whose `onInit` called `manager.unregister(otherName)` between awaits could silently skip the next un-init'd plugin — typically `createFactPIIGuardrail` or `audit-ledger`. The previous snapshot-only fix attempt broke the audit-ledger's cascading-registration pattern (`onInit` calls `system.observe(...)` which registers an observer plugin mid-init, whose own `onInit` must fire to bridge engine events to the ledger). Final shape: track init'd plugins via a `WeakSet`, loop the live array until no plugin remains uninit'd, cap at 100 passes to bound an adversarial register-loop. Handles both index-shift and cascading-registration without regressing either.

  ### Documentation

  **`walkDepth` JSDoc rewrite.** Default `walkDepth: 1` did NOT scan the documented dominant Supabase realtime shape (`{ new: [{ email }] }`) because the chain is object → array → object → string (4 levels). JSDoc now lists the canonical real-world shapes with the `walkDepth` they need (flat object: 1, nested object: 2, Supabase row: 4, MCP resource list: 4). Plus documents the hard caps (`MAX_ARRAY_SCAN = 10_000`, cycle guard, finite-only `walkDepth`).

  **MCP factory recipe contradiction fixed.** Previous prose said "if you create the adapter outside the factory, pass it in per call too" while the code example wrapped both adapter AND module construction inside the factory. The "pass it in per call" path re-introduced the multi-tenant cross-contamination the prior round was supposed to close: the adapter's `events.onConnect` is bound at adapter-construction time to whichever factory's `publishRef` was in scope first. Recipe now says explicitly: BOTH adapter and module MUST be constructed inside the same factory; sharing the adapter across factory calls is unsafe.

## 1.19.1

### Patch Changes

- [#57](https://github.com/directive-run/directive/pull/57) [`ec5be62`](https://github.com/directive-run/directive/commit/ec5be62a5744ae7b38972b9a74498173dc7bfe4c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Follow-on fixes — MCP holder factory + plugin broadcast snapshot + createFactPIIGuardrail main barrel

  Three small follow-on fixes not covered by the previous release:

  **MCP holder pattern — multi-tenant safe factory.** The MCP source recipe in `ai-sources.md` declared `let publishRef: SourcePublish | null = null` at module scope. Importing the module twice (one Directive system per tenant DO; SSR with one module instance per worker; Vitest with hot-reload boundaries) made the LAST `attach` overwrite the holder — first tenant's adapter callbacks routed into the second tenant's facts. Recipe now wraps adapter + module construction in a `makeOrchestrator()` factory so each call yields an isolated closure pair. Multi-tenant + SSR + hot-reload safe.

  **`broadcast` snapshots `plugins` before iteration.** A plugin hook callback that called `manager.unregister(...)` (or whose `system.observe()` unsubscribe spliced the array) used to shift indices mid-iteration, silently skipping the NEXT plugin — typically the audit-ledger or `createFactPIIGuardrail`. The broadcaster now iterates a snapshot taken at call time, so reentrant `unregister` no longer corrupts the broadcast.

  **`createFactPIIGuardrail` re-exported from `@directive-run/ai` main barrel.** The required companion to `liveContext` was the only guardrail not on the main barrel. Other guardrails (`createPIIGuardrail`, etc.) ship as `@deprecated` re-exports for back-compat; `createFactPIIGuardrail` now ships the same way. Consumers who follow the "main-barrel" idiom every other guardrail supports will find it.

- [#57](https://github.com/directive-run/directive/pull/57) [`018010e`](https://github.com/directive-run/directive/commit/018010e0ef64a839bd8521ba81696aa33823e68c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Walker DoS / PII bypass + onContextUpdate ordering + mode deprecation restore + docs

  Roughly 30 critical issues were found in the v1.19.0 source-primitive
  surface. This patch closes the four highest-impact clusters; the
  remaining items are tracked for a follow-up minor.

  ### Critical fixes

  **Walker DoS + PII bypass.** The previous array recursion fix passed
  `depth` raw on the array branch and did NOT snapshot the array before
  iterating. Three exploit chains landed simultaneously: (a) a deeply-nested
  `[[[[...]]]]` payload bypassed the documented `walkDepth ≤ 5` bound
  and overflowed the call stack, with the `safeCall` plugin wrapper
  swallowing the throw — leaving the raw PII committed in the fact
  store. (b) Cyclic arrays (`const a = []; a.push(a)`) recursed forever
  into the same overflow. (c) A `Proxy` whose `.get(0)` returned PII on
  the live read but benign content on the `[...value]` spread leaked
  PII into the redacted output at the un-walked indices (TOCTOU).
  Real-world attack surface: any source where the attacker controls
  payload shape — Supabase RPC, MCP resource list, webhook bodies.

  The fix in `packages/ai/src/guardrails/fact-pii.ts`: (1) decrement
  `depth` on the array branch (matches the object branch), (2) snapshot
  the array via `[...value]` BEFORE the loop and iterate the snapshot,
  (3) track visited references via `WeakSet` and bail on revisit.
  Closes the stack-overflow + cycle + Proxy chains with one ~10-line
  fix. Two new regression tests cover the new bound and the cycle
  guard; the existing array tests still pass.

  **`liveContext.onContextUpdate` call order matched to JSDoc.**
  The JSDoc declared `onContextUpdate` "fires AFTER the
  `interruptWhen` predicate runs but BEFORE the chunk emits" — the
  impl called `onContextUpdate` FIRST. The instrumentation hook
  couldn't observe interruption decisions, defeating the documented
  use case. Swap the order, AND wrap both callbacks in try/catch so a
  throw inside `interruptWhen` or `onContextUpdate` no longer
  propagates back through `notifyKey` → `flush` → the source's
  publish handler (which used to kill the publisher entirely and
  skip every downstream listener in the notify cycle).

  **`LiveContextOptions.mode` restored as `@deprecated` for source-compat.**
  v1.18.0 shipped to npm with `mode: "inject-system-message"
| "restart"` on the public `LiveContextOptions` interface. v1.19.0
  removed it. The v1.19.0 changeset asserted "v1.18.0 has not yet
  shipped" — `npm view @directive-run/ai time` says otherwise (1.18.0
  published 2026-06-08 05:42 UTC, 1.19.0 published 2026-06-09 14:21
  UTC — 32hr live with the field). Removing an exported field of an
  exported type is a breaking change requiring a major bump; shipping
  it as minor was a semver violation. This patch restores the field
  as `@deprecated` with a one-shot runtime warning when consumers set
  it (no behavior change — abort-and-emit is still the only path).
  Field will be removed properly in v2.0 with a deprecation cycle.

  ### Documentation fixes

  **Source primitive doc cluster.** The `onEvict` recipe in
  `packages/knowledge/core/sources.md` referenced a `ch` variable
  defined in a sibling closure — a copy-paste consumer would hit
  `ReferenceError`. Rewrote using the holder + closure bridge pattern
  (`let channel = null` shared between `attach` and `onEvict`).
  `packages/knowledge/ai/ai-sources.md` still documented the removed
  `mode: "restart"` field — replaced with the actual shipped behavior
  description. The adapter table referenced a non-existent
  `sourceFromWebSocket()` adapter as the canonical WebSocket bridge —
  clarified that the Cloudflare DO adapter `sourceFromWebSocketMessage()`
  is the shipped path; the generic helper is queued for a follow-up
  RFC. RFC 0005 self-contradicted on `liveContext.guardrails` (drafted
  field vs. shipped `createFactPIIGuardrail`) and listed an "Open
  question" about a removed `mode: "restart"` semantic — both
  rewritten to match the shipped state.

## 1.19.0

### Minor Changes

- [#55](https://github.com/directive-run/directive/pull/55) [`5c7a2d6`](https://github.com/directive-run/directive/commit/5c7a2d60f71f527e9afd85a67afa36f61fc0bdfc) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Five remaining critical fixes to documented surfaces of the source primitive.

  This patch closes the five critical issues affecting documented but
  unreachable or misleading public APIs of v1.18.0. With the earlier batch
  (already merged) plus this one, all ten ship-blocking critical issues are
  resolved.

  ### Critical fixes

  **`System.stopAsync` / `destroyAsync` / `evict` wired through
  `createSystem` wrappers.** Engine implemented these per RFC
  0009 but neither the single-module wrapper at `system.ts:1178+` nor the
  namespaced wrapper at `system.ts:527+` assigned them, and the
  `SingleModuleSystem` / `NamespacedSystem` / system-config types omitted
  the declarations. Calling `createSystem({...}).stopAsync()` failed at
  TypeScript (`Property 'stopAsync' does not exist`) AND at runtime
  (undefined method). The entire RFC 0009 DO-eviction recipe documented
  in `core/sources.md` was unreachable from the public API. All three
  methods now delegate to the engine; both wrappers participate in the
  `tickInterval` cleanup; added a 6-case regression test
  (`system-async-lifecycle.test.ts`) that exercises the public boundary
  including an async source unsubscribe await.

  **Cloudflare DO adapters accept `onEvict`**. `sourceFromDOAlarm`
  and `sourceFromWebSocketMessage` are the literal target runtime for RFC
  0009, yet neither adapter accepted or forwarded an `onEvict` option.
  With this change both adapters expose `onEvict?: () => void | Promise<void>`
  on their options interface. Defaults: `DOAlarm` clears the pending
  alarm via `storage.deleteAlarm()`; `WebSocketMessage` closes the socket
  with code 1001 `"going-away"`. Consumers can override to skip the
  default (e.g. when the runtime hibernates WebSockets natively) or to
  add pre-hibernation work (flush audit log, signal broker). 4 new
  regression tests covering default + custom `onEvict` for both adapters.

  **`createFactPIIGuardrail` walker recurses into arrays**. The
  walker previously short-circuited on `Array.isArray(value)`, so the
  dominant real-world Supabase realtime shape
  (`payload.new = [{ email, ... }]`) and MCP resource-list notifications
  silently bypassed the guard. The walker now inspects array
  elements at the same depth budget, rebuilding the array if any element
  matched. Maps and Sets remain out of scope by design (consumers must
  wire a `customDetector` for those). 2 new regression tests covering
  both "array of PII objects" and "array of PII strings" shapes.

  **RFC 0005 `mode` field removed**. The field
  `liveContext.mode: "inject-system-message" | "restart"` shipped on the
  public API but was never read by the impl. The name
  `"inject-system-message"` falsely implied mid-stream injection; the
  actual behavior is abort-and-emit. Since v1.18.0 has not yet shipped,
  the field is removed cleanly (no deprecation tail to maintain). The
  auto-re-prompt semantics will ship in a follow-up RFC + field together
  once their design is settled. RFC 0005 + `ai-sources.md` updated.

  ### Documentation fixes

  **MCP source recipe rewritten against the real adapter API**.
  The previous recipe in `ai-sources.md` called `adapter.onConnect(cb) →
unsubscribe` — a method that doesn't exist on `MCPAdapter`. The actual
  adapter exposes `MCPAdapterConfig.events` as a single callback bag at
  construction time. The rewritten recipe documents the canonical
  "holder + closure" bridge pattern: a `publishRef` variable that the
  source's `attach` populates, with the adapter's `events.onConnect` /
  `onDisconnect` forwarding through it. This is the general pattern for
  bridging any single-callback-bag third-party SDK into a Directive
  source. Recipe also adds the missing `derivations` schema declaration.

### Patch Changes

- [#55](https://github.com/directive-run/directive/pull/55) [`9ffd758`](https://github.com/directive-run/directive/commit/9ffd7584914b93ca840ae84372fe3e83c75f29e8) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Five critical fixes to documented surfaces of the source primitive.

  A post-merge review of the merged `feat/source-primitive` work found
  five critical issues affecting consumer-facing documented APIs of
  v1.18.0. All five close in this patch.

  ### Critical fixes

  **`createFactPIIGuardrail` not exported from `@directive-run/ai/guardrails`
  subpath**. The mandatory companion to `liveContext` was
  declared in `guardrails/index.ts` but the actual tsup entry for the
  subpath (`src/guardrails-export.ts`) didn't re-export it. Every recipe in
  `packages/knowledge/ai/ai-sources.md` (Sources × Security section) failed
  at import time: `Module '@directive-run/ai/guardrails' has no exported
member 'createFactPIIGuardrail'`. Now exported (function + the four
  public types: `FactPIIGuardrailMode`, `FactPIIGuardrailOptions`,
  `FactPIICategory`, `FactPIIMatch`). The internal JSDoc example in
  `fact-pii.ts` also referenced the wrong import path (`@directive-run/ai`
  instead of `@directive-run/ai/guardrails`) — corrected.

  **`@directive-run/sources` rejected by `@directive-run/sandbox`
  validator**. The sandbox validator's `ALLOWED_DIRECTIVE_PACKAGES`
  set didn't include `sources`, so every playground snippet, MCP
  `run_in_sandbox` call, and docs live runner that imported the umbrella
  package or either subpath (`@directive-run/sources`,
  `@directive-run/sources/supabase`, `@directive-run/sources/cloudflare`)
  hard-failed with `is not allowed in the sandbox` despite the umbrella
  shipping as part of v1.18.0. Added `sources` to the allowlist and added
  two-segment-subpath coverage to the validator test grid.

  **`sourceFromSupabaseChannel` unsubscribe fires-and-forgets
  `removeChannel`**. The original issue RFC 0009 was
  designed to close: the adapter returned a sync unsubscribe that did
  `void client.removeChannel(chan)`, so `system.stopAsync()` resolved
  before the Supabase broker dropped the subscription. A subsequent
  `start → stopAsync → start` cycle double-subscribed because the broker
  still held the old channel when the new attach raced in. Per RFC 0009's
  `SourceUnsubscribe = () => void | Promise<void>` widening, the adapter
  now returns `async () => { await client.removeChannel(chan); }`. Engines
  using legacy sync `cleanupAll` still ignore the returned promise — same
  fire-and-forget behavior as before — but the broker drop is now
  observable to consumers using `stopAsync`.

  ### Documentation fixes

  **Broken cross-ref anchor**: `packages/knowledge/core/sources.md`
  linked to `ai-security.md#sources-pii--closing-the-fact-injection-bypass`
  with a single hyphen between "sources" and "pii". The actual GFM anchor
  generated from the heading `## Sources × PII — closing the fact-injection
bypass` has a double hyphen (`×` strips to a kept space). The
  highest-traffic cross-ref in the source primitive doc was landing on a
  404 anchor. Corrected to `#sources--pii--closing-the-fact-injection-bypass`.

  **RFCs 0005–0009 status flipped from Draft → Accepted**: all
  five RFCs still carried `Status: Draft (2026-06-07)` even though
  `sources.md` and `ai-sources.md` already cite them as shipped. Readers
  following the link saw Draft headers and concluded the feature was
  design-only. Status now reads: `Accepted — shipped 2026-06-07 in
feat/source-primitive (PR #52, merge ab97b028); pending v1.18.0 release`.

## 1.18.0

### Minor Changes

- [#52](https://github.com/directive-run/directive/pull/52) [`dbbeb4b`](https://github.com/directive-run/directive/commit/dbbeb4b1e0cad1d209c1fc511c1754e6c5a243e5) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `createFactPIIGuardrail` — fact-store boundary PII guardrail

  Closes the source → fact → agent-prompt PII bypass: `createPIIGuardrail` and
  `createEnhancedPIIGuardrail` only inspect the `data.input` argument
  passed to `runStream(agent, input, ...)`. When a source publishes PII
  into a fact and the agent's prompt template embeds that fact
  (`"Hello ${facts.email}..."`), the PII reaches the LLM call without
  hitting the input guardrail chain.

  `createFactPIIGuardrail` is a Directive plugin (wired at
  `createSystem({ plugins: [...] })`) that scans every write to a
  `pii`-tagged fact, auto-discovered via `meta.byTag("pii")` at `onInit`.
  Two modes:

  - `"redact"` (default, safe shipping posture): rewrites the fact value
    via a follow-up store write so the next read returns the redacted
    form. The raw value briefly exists for one microtask while the
    redaction lands; downstream subscribers that snapshot at that instant
    see it; the LLM call after the next settle does not.
  - `"alert"`: fires the `onBlocked` callback but does NOT mutate the
    fact. Use for monitoring-only deployments where the source's
    transport is already trusted and you want to page on every match
    without modifying state.

  The built-in regex covers SSN, credit-card, and email. Pass a
  synchronous `customDetector` for domain-specific patterns (internal
  account numbers, partner IDs). The full async detector at
  `@directive-run/ai/guardrails/pii-enhanced` is unsuitable for this hook
  because `onFactSet` is synchronous and a deferred detection would let
  the raw PII reach observers + breakpoints + audit-ledger before the
  redaction completed.

  Wires as the mandatory prerequisite for the upcoming
  `runStream({ liveContext })` recipe, which would otherwise expand the
  fact-injection bypass surface into the mid-stream context updates the
  agent reads while generating.

  Hard rejection at the write boundary requires a pre-commit transform
  hook on the source primitive itself (Directive plugin hooks are
  wrapped by the plugin manager's `safeCall` and a thrown error is
  swallowed). Tracked as a future RFC. Today's `"redact"` mode is the
  safe-shipping posture.

  Docs:

  - New `packages/knowledge/ai/ai-sources.md` — AI × Sources patterns,
    three-tier lifetime ladder, `runStream({ liveContext })` recipe
    (RFC 0005 cross-ref), MCP lifecycle as a source, sources × security,
    anti-patterns (no token streaming via source, no polling from a
    constraint), `@directive-run/sources/*` adapter subpath inventory.
  - `packages/knowledge/ai/ai-security.md` — new "Sources × PII" section
    with the threat chain + the redact recipe, and a row in the quick
    reference table.
  - `packages/knowledge/core/sources.md` — "Related" links to the new
    `ai-sources.md` + `ai-security.md` anchor.

  Eight regression tests cover redact mode (string + object payloads),
  alert mode, `includeKeys` / `excludeKeys` escape hatches, and the
  custom detector composition path.

- [#52](https://github.com/directive-run/directive/pull/52) [`e0ecd16`](https://github.com/directive-run/directive/commit/e0ecd160c9c947e6c9976dfc08fdac959eb46431) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `attachSourcesToOtel` — pipe core source.\* observation events into the
  same OTel tracer the AI plugin uses

  An observability review found `@directive-run/ai/otel.ts`
  subscribes only to the AI `DebugTimeline` event stream, so the four
  `ObservationEvent.source.*` variants (`source.attach`,
  `source.publish`, `source.detach`, `source.error`) shipped by the
  source primitive never reached the OTel exporter. SREs running with
  `createOtelPlugin` saw agent spans but could not answer "which source
  is publishing?" or "did source `mcp` error attach?" from their
  tracing backend.

  `attachSourcesToOtel(system, { tracer, serviceName })` closes the gap
  as a focused helper (not a second OTel plugin) so a single
  `OtelTracer` carries both AI and core source spans. Wire it once at
  `createSystem` time:

  ```ts
  import { trace } from "@opentelemetry/api";
  import { createOtelPlugin, attachSourcesToOtel } from "@directive-run/ai";

  const tracer = trace.getTracer("directive-app");
  const otel = createOtelPlugin({ serviceName: "my-app", tracer });

  const system = createSystem({ module });
  otel.attach(orchestrator.timeline);
  const unsub = attachSourcesToOtel(system, { tracer, serviceName: "my-app" });
  ```

  Spans emitted:

  - `directive.source.attached` — long-lived span per (sourceId,
    moduleId). Opened at attach; closed at detach with status `OK`.
  - `publish` span events on the active span (NOT new spans per
    publish — cardinality budget). At 10 sources × 100 publishes/sec
    the exporter sees 1000 events/sec on 10 long-lived spans, well
    within typical OTel collector budgets.
  - `directive.source.error` — short-duration error-status span with
    `directive.phase`, `error.message` (truncated by the manager).

  Optional `publishSampleRate` (default 1.0) sub-samples publish events
  for very high-throughput sources.

  Tests: 4 regression tests covering attach → detach span lifecycle,
  publish-as-event-on-active-span, error span shape, and unsubscribe
  behavior.

  The complementary `@directive-run/ai/devtools-server.ts` integration
  (extend `DevToolsServerMessage` with source.\* variants) is deferred
  to a follow-up PR.

- [#52](https://github.com/directive-run/directive/pull/52) [`901836e`](https://github.com/directive-run/directive/commit/901836ec59fdb7444b24695ff385b327376382e5) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `runStream({ liveContext })` — Reactive Agents (RFC 0005)

  Additive `liveContext` option on `orchestrator.runStream()` that turns
  sources into a feedback loop for the in-flight LLM run. The agent's
  view of the world stays in sync with reality: a source publishes a
  fact update, the orchestrator emits a `context_updated` chunk, and
  when `interruptWhen` returns `true` the LLM run is aborted and an
  `interrupted` chunk lands on the stream.

  The implementation is **231 LOC** in `agent-orchestrator.ts` —
  comfortably under the RFC 0005 300-LOC scope guard. The bridge re-uses
  the same `system.facts.$store.subscribe(keys, cb)` mechanism the
  breakpoint + approval waiters already wire (no new primitives needed
  on the core side).

  ### Additive surfaces

  **`OrchestratorStreamChunk` union** — two new variants:

  - `{ type: "context_updated"; changedKeys: readonly string[] }` —
    emitted on watched-fact changes. Always emitted when `notifyOn:
"all-changes"`; emitted only for changes that trigger an interrupt
    when `notifyOn: "interrupt-only"` (default).
  - `{ type: "interrupted"; reason: string; partialOutput: string; changedKeys: readonly string[] }` —
    emitted when `interruptWhen` returns `true` OR when the consumer
    calls `result.interrupt(reason?)`. Carries the partial LLM output
    accumulated up to the abort point so a consumer can stitch a
    retry prompt.

  **`OrchestratorStreamResult`** — new `interrupt(reason?: string): void`
  method. Distinct from `abort()`: `abort` tears down the AsyncIterable
  AND detaches `liveContext`; `interrupt` cancels the LLM run but leaves
  fact subscriptions alive so the next caller-driven prompt continues
  against fresh facts.

  **`runStream` options** — accepts `liveContext: LiveContextOptions<F>`:

  ```ts
  const result = orchestrator.runStream(agent, input, {
    liveContext: {
      system: marketSystem,
      keys: ["lastPrice", "lastVolume"],
      interruptWhen: (facts, changedKeys) =>
        Math.abs(facts.lastPrice - facts.openPrice) > 5,
      mode: "restart", // reserved for follow-up minor; today's
      // landing ships "inject-system-message"
      // behavior (consumer re-prompts)
      notifyOn: "interrupt-only", // default; "all-changes" is the noisier variant
      onContextUpdate: (keys) =>
        Sentry.addBreadcrumb(`liveContext: ${keys.join(",")}`),
    },
  });

  for await (const chunk of result.stream) {
    if (chunk.type === "token") process.stdout.write(chunk.data);
    if (chunk.type === "interrupted") {
      console.log(
        `Agent interrupted: ${chunk.reason}; partial: ${chunk.partialOutput}`
      );
      // Optionally call orchestrator.runStream again with fresh context.
    }
  }
  ```

  ### Security companion

  `createFactPIIGuardrail` (shipped in the prior phase) is the
  **mandatory** companion when `liveContext` watches facts that may
  carry PII. Without it, `liveContext` expands the source → fact →
  prompt PII bypass surface into mid-stream context updates the agent
  reads while generating. The new `ai-sources.md` recipe documents this
  gating.

  ### Multi-agent orchestrator

  `OrchestratorStreamResult` shapes constructed inside
  `multi-agent-orchestrator.ts` gain `interrupt()` stubs that map to
  `abort()` — multi-agent delegate / task streams don't carry
  `liveContext` bindings of their own, so the distinction collapses
  there.

  ### Tests

  5 new regression tests covering the chunk variant shapes (type
  narrowing + payload fields), the `interruptWhen` default
  (`() => true` — any watched-key change interrupts), the false-path
  ("interrupt only when threshold crossed") behavior, and end-to-end
  AsyncIterable drainage of `context_updated` → `interrupted` →
  `done`. AI suite: 1506 → 1511 passing.

  ### Status

  Ships the additive surface + the `liveContext` event loop. The
  `mode: "restart"` variant ships the chunk-emission contract today
  (consumer re-prompts via a fresh `runStream` call — matches the
  documented `"inject-system-message"` mode); automatic re-invocation
  on `"restart"` is reserved for a follow-up minor once the
  multi-step prompt-merging strategy is locked in.

### Patch Changes

- [#52](https://github.com/directive-run/directive/pull/52) [`08d84df`](https://github.com/directive-run/directive/commit/08d84dfe4ac558d2dd9013407e6b12a60ec6cfac) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Source primitive RFCs — review close-out: public alias exports + interrupt() semantic + evict(deadline) detached-work + liveContext setup hoist + self-loop guard + docs drift

  A review of the five RFC implementations (0005-0009) surfaced one
  critical and several major issues. All shipped without prior review
  in the original implementation pass; this patch closes them.

  ### Critical fixes

  **Public alias exports** (RFC 0006): the 22+ `*Definition` aliases
  landed in `packages/core/src/core/types/index.ts` but the curated
  public barrel at `packages/core/src/index.ts` didn't re-export them.
  `import type { ModuleDefinition } from "@directive-run/core"` — the
  exact form anti-patterns.md #21 instructs consumers to write —
  failed at the package boundary. Every alias is now re-exported from
  the public barrel.

  **`interrupt()` semantic** (RFC 0005): the headline feature of
  liveContext — `interrupt()` cancels the LLM run but keeps the
  subscription alive — was broken. `abortController.abort()` triggered
  the IIFE catch path → reject → `resultPromise.finally(() =>
tearDownLiveContext())` ran → subscription died. The distinction
  between `abort` and `interrupt` collapsed.

  Fix: a private `interruptInitiated` flag is set BEFORE
  `abortController.abort()` in `interrupt()`. The `finally` callback
  checks the flag and skips `tearDownLiveContext` when the abort came
  from `interrupt`. The caller is now correctly responsible for either
  re-prompting via a fresh `runStream` against the live subscription, or
  calling `abort()` to fully tear down.

  ### Major fixes

  **`evict(deadline≤0)` detached work** (RFC 0009): when `evict` is
  called with a synchronous deadline, the eviction IIFE used to be
  constructed, then the function returned early — leaving the IIFE
  running detached with no error path (unhandled-rejection risk if late
  teardown threw). The two paths now both attach a swallow-catch:
  synchronous-deadline kicks off detached work with a `.catch(() =>
{})`; deadline-raced path attaches the same swallow before
  `Promise.race`. Per-source errors still route through the manager's
  `phase: "runtime"` sink, so the catch doesn't lose signal.

  **liveContext setup hoist** (RFC 0005): the liveContext subscription
  used to wire up AFTER the resultPromise IIFE was constructed (and had
  already started running synchronously up to its first `await`). The
  race is theoretical today (the IIFE's sync prefix doesn't mutate
  facts), but a future IIFE prefix change could synchronously trigger
  fact mutations before the subscription wires up. The block now runs
  BEFORE the IIFE construction. The subscription callback closes over
  `closed`, `pushChunk`, `accumulatedOutput`, `abortController` — all
  declared above and reactive to mutations from inside the IIFE.

  **Self-loop dev-mode guard** (RFC 0005): nothing prevented a consumer
  from passing `liveContext.system === orchestrator.system` AND
  watching bridge-state keys (`agent`, `conversation`, `approvalState`).
  The orchestrator's own `setAgentState` / `setConversation` writes
  would trigger `interruptWhen`, self-looping the run. The
  orchestrator's `runStream` now warns in `debug: true` mode when the
  overlap is detected.

  **`mode: "restart"` dead code** (RFC 0005): the `mode` field was
  declared on `LiveContextOptions` but the implementation never read
  `liveCfg.mode` — both values produced identical behavior. The type
  union order is now `"inject-system-message" | "restart"` (the
  shipping default first), the JSDoc is honest that `"restart"` is
  forward-compat-only, and the `@example` block uses
  `"inject-system-message"`.

  **`SourceReportError` export** (RFC 0008): the callback type that
  authors need to type their reportError helpers wasn't re-exported.
  Now exported from `@directive-run/core/types/index.ts` and from the
  public barrel at `@directive-run/core`.

  **`reportError` parameter optional** (RFC 0008): the type signature
  of `SourceDef.attach` declared `reportError` as required, but the
  JSDoc said it was optional. Made the parameter optional in the type
  to match.

  **Coalesce strategy uniformity** (RFC 0007): the JSDoc on
  `SourceDef.coalesce` documented per-event-name coalescing but didn't
  call out that the STRATEGY (lastWriteWins vs none) is uniform per
  source. Added a "Limitation" subsection naming the constraint.

  ### Documentation drift fixes

  `packages/knowledge/ai/ai-sources.md` had multiple factual errors
  against the shipped types:

  - Documented a `liveContext.guardrails` field that doesn't exist
    (removed — security companion is `createFactPIIGuardrail` wired at
    `createSystem` time, documented in the Status section).
  - Listed `mode` default as `"restart"` (flipped to
    `"inject-system-message"`).
  - Missing `changedKeys` field on `interrupted` chunk shape (added).
  - Missing required `keys` field in the signature example (added).
  - Never mentioned `result.interrupt(reason?)` method (added with
    contrast vs `abort()`).
  - "Status" section still in RFC-design-speak after ship (flipped to
    "shipped").

  `packages/knowledge/core/sources.md` gained three new sections per
  RFC 0007/0008/0009 acceptance criteria:

  - "Error handling — runtime errors via reportError" (RFC 0008).
  - "Backpressure — coalesce: lastWriteWins" (RFC 0007).
  - "Async-aware teardown — system.stopAsync() + DO onEvict" (RFC 0009).

  Stale line references in `docs/rfcs/0005-live-context-agent.md`
  (`agent-orchestrator.ts:1309, 1474`) replaced with symbolic
  references.

  Gates: core typecheck + 2117 tests passing; ai typecheck + 1511 tests
  passing; sources typecheck clean; core dist 14,678 B gz (under
  18,000 B budget).

- [#52](https://github.com/directive-run/directive/pull/52) [`dc30477`](https://github.com/directive-run/directive/commit/dc30477379def350bcf8998b9ce3883641e71bbd) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `createFactPIIGuardrail` Luhn validation + `attachSourcesToOtel` span-leak fix + `walkDepth` option

  Three targeted fixes against the phases shipped immediately
  before this patch.

  **`createFactPIIGuardrail` — credit-card false positives.** A
  self-review found the inlined `\b(?:\d[ -]?){13,19}\b` regex would
  sweep up phone numbers, tracking IDs, and any 13-19 digit sequence
  formatted with separators as credit cards. The shipping path now
  mirrors `pii-enhanced.ts`'s detection: a broader 4-4-4-4 / 13-19
  unseparated regex paired with a synchronous Luhn checksum validator.
  Phone numbers, sequence IDs, and other long digit runs that don't pass
  Luhn are NOT redacted. The canonical Visa test number
  (`4111 1111 1111 1111`) continues to redact correctly.

  **`createFactPIIGuardrail` — `walkDepth` option for nested objects.**
  The previous one-level object walk silently passed deeper PII (e.g.
  `{ profile: { email } }`) through unredacted. Review flagged this as
  a security limitation that wasn't documented. The plugin now
  accepts an optional `walkDepth: 1 | 2 | 3 | 4 | 5` (default `1`,
  clamped to `[1, 5]` to prevent pathological recursion on cyclic
  structures). Arrays, Maps, and Sets remain out of scope at any depth —
  consumers with those shapes should pass a `customDetector` that walks
  the consumer-specific structure.

  **`attachSourcesToOtel` — active spans no longer leak on unsubscribe.**
  Review found the helper's returned unsubscribe just detached the
  `system.observe()` subscriber, leaving every active `directive.source.attached`
  span open forever in the collector. The helper now ends each active
  span with status `OK` and a `directive.detached: true` attribute when
  the consumer detaches the wiring. Collectors that retain unfinished
  spans no longer accumulate them across `attachSourcesToOtel` /
  unsubscribe cycles.

  Tests: +3 regression tests (Luhn rejection on non-card 16-digit
  sequences, `walkDepth: 1` default leaves nested PII alone, `walkDepth: 3`
  walks deeper). Fact-PII test file 8 → 11; `otel-sources.test.ts` test 4
  rewritten to assert the new no-leak contract; AI suite 1503 → 1506.

## 1.17.2

## 1.17.1

## 1.17.0

## 1.16.0

## 1.15.0

## 1.14.0

### Minor Changes

- [`8c59331`](https://github.com/directive-run/directive/commit/8c5933191502009871449c7610d78836a4863602) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Security hardening, a smaller AI bundle, and broader test coverage.

  ### Security fixes

  - **`@directive-run/vite-plugin-api-proxy`** – 10 MB body cap, a 30 s
    slowloris timeout, and a response-header allowlist. `set-cookie`,
    `authorization`, `x-api-key`, and `x-internal-*` are now explicitly
    dropped from upstream responses; only `content-type`, `cache-control`,
    `etag`, `last-modified`, `vary`, `content-encoding`, `content-language`,
    `expires`, and `pragma` are forwarded. Closes an upstream-header info
    leak and a body-flood denial-of-service.
  - **`@directive-run/core` worker adapter** – `request<T>()` accepts
    `timeoutMs?: number` (default 30 s; `0`/`Infinity` opts out). On timeout
    or `worker.onerror`, all pending entries reject and clear, closing an
    unbounded `pendingRequests` Map leak.
  - **`@directive-run/ai` structured output** – `extractJsonFromOutput` now
    runs `isPrototypeSafe` on every `JSON.parse` return point. LLM output
    with `__proto__`/`constructor`/`prototype` keys throws
    `[Directive] structured-output: extracted JSON contains unsafe
prototype keys` instead of silently passing through.

  ### Smaller AI bundle

  - **`@directive-run/ai` bundle split** – the main bundle drops from 120 KB
    to **44 KB** (-63%). New subpath exports (additive – the main barrel
    keeps re-exports with `@deprecated` JSDoc for one cycle):
    - `@directive-run/ai/multi-agent` – orchestrator, patterns, agent
      communication, checkpoints, breakpoints
    - `@directive-run/ai/predicate` – `predicateFromIntent*`,
      `predicateToolSpec*`, `PredicateFromIntentError`
    - `@directive-run/ai/guardrails` – PII, moderation, prompt-injection,
      semantic cache
    - `@directive-run/ai/devtools` – debug timeline, devtools WebSocket
      server, health monitor
    - `@directive-run/ai/evals` – eval harness
    - (`@directive-run/ai/mcp`, `/openai`, `/anthropic`, `/ollama`, `/gemini`
      unchanged)
  - **`@directive-run/core` audit-ledger refactor** – the audit ledger moved
    to `packages/core/src/plugins/audit-ledger/`. Public API unchanged; the
    tombstone-forgery defense is intact.

  ### Test coverage

  Added coverage for the `useAuditLedger` hooks across React, Vue, Svelte,
  and Solid (initial-value sync, reactive update, filter exclusion,
  `pollMs<50` clamp with dev warning, large-ledger warning, and cleanup on
  unmount), plus new tests for the vite-plugin-api-proxy body cap / header
  allowlist / timeout, the worker-adapter timeout and `onerror` paths, and
  the structured-output prototype-safety guard.

  ### Other fixes

  - Root README – added the 8 missing packages to the table (`el`, `query`,
    `cli`, `mutator`, `optimistic`, `timeline`, `vite-plugin-api-proxy`,
    `knowledge`) and fixed an adapter-count mismatch.
  - `@directive-run/vite-plugin-api-proxy` – new README documenting the CORS
    rationale, header allowlist, body cap, and production warning.
  - `AuditLedgerSink.erase` parameter renamed `tombstoneFactory` →
    `markerEntryFactory` (parameter-name rename only, no behavior change –
    positional args mean no consumer breakage).
  - Added 6 plugin concept docs (`logging`, `devtools`, `persistence`,
    `observability`, `circuit-breaker`, `performance`) under
    `docs/concepts/`.

## 1.13.0

### Minor Changes

- [`195480a`](https://github.com/directive-run/directive/commit/195480a1fe92234e023fa70db3a021b60f5efb91) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Security hardening, more honest audit-ledger claims, and two new public APIs.

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

  - **Tombstone forgery defense** – `verify()` recognizes only `ledger.erase()`-stamped tombstones via an unforgeable internal sentinel symbol. Direct `sink.write({kind:"system.entry-erased",...})` is detected as tamper.
  - **PII redaction now walks predicate operands** – `{ email: { $eq: "alice@x.com" } }` no longer leaks the literal into `whenSpec`.
  - **Function-form `whenSource` → `sourceHash` only** – function source NEVER lands in audit entries; secrets in closures stay private.
  - **AuditEntry payloads are frozen** at write time. In-process mutation throws.
  - **`AbortSignal.any()` properly composes** runner timeouts with caller signals (previously caller signal silently disabled timeout).
  - **PII default-redaction** for `meta({ tags: ["pii"] })` fact values in the audit ledger. `capturePII: true` opts out.
  - **predicateFromIntent** ships `signal?: AbortSignal`, `redactIntent?: boolean`, `intentHash` provenance field, and `dangerousRegex` ReDoS detection.

  ### v1 boundaries (honest)

  The audit-ledger is **tamper-evident**, NOT cryptographic-grade:

  - djb2 32-bit hash chain – detects accidental + light-adversarial tamper. SHA-256 reserved for v2.
  - `verify({ strong: true })` throws "reserved for v2" (was a no-op silently returning valid in v1.12.0).
  - In-memory ring buffer drops oldest past `capacity` (default 10k). SQLite / Parquet sinks reserved for v2.
  - `ledger.erase()` provides per-subject GDPR Art.17 erasure in-sink only; persisted exports must be erased separately. Erased entries break the chain at the erasure point; `verify()` reports them in `erasedSeqs: number[]`.
  - No actor / operator / session attribution on entries (v2).
  - No read-tracking (constraint evaluations + writes only).
  - No trusted timestamps (RFC 3161 TSA) – `Date.now()` is operator-controlled.
  - No signing keys with rotation (v2).

  ### Migration (from v1.12.0)

  | Was                                                                                             | Now                                                                                                                                   |
  | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
  | `predicateToolSpec(schema)`                                                                     | `predicateToolSpecAnthropic(schema)` (deprecated alias retained)                                                                      |
  | (none)                                                                                          | `predicateToolSpecOpenAI(schema)` (new – OpenAI Chat Completions shape)                                                               |
  | `predicateFromIntentWithProvenance().rawOutputHash`                                             | `.predicateHash` (now canonicalized via `stableStringify` before hashing – semantically-identical responses produce identical hashes) |
  | `VerifyResult.erasedAt: number[]`                                                               | `VerifyResult.erasedSeqs: number[]` (avoids units collision with per-tombstone `erasedAt` timestamp)                                  |
  | `ledger.erase().tombstone`                                                                      | `.markerEntry` (renamed; plural mismatch resolved)                                                                                    |
  | `ledger.erase()` always emitted marker                                                          | Now `{ erased: 0, markerEntry: null }` for zero-match calls (no chain pollution)                                                      |
  | `PredictResult.predicate`                                                                       | removed (input reference; caller already has it)                                                                                      |
  | `predict({ cartTotal: { $changed: true } }, facts)`                                             | now synthesizes a warning in `missingChanges` when `prev` is omitted (previously silent)                                              |
  | `doctor.checkAgainst({ a: 100 }, [{ id: x, whenSpec: { a: 50 } }])` `subset` → `contradictions` | now → `warnings` (subset means "redundant", not "impossible")                                                                         |
  | `doctor.checkOwns()` returned `{ findings }`                                                    | now `{ warnings }` with `severity` discriminator                                                                                      |
  | `AuditEntry` (constraint.evaluate).whenSource.preview                                           | `.sourceHash` (secret-leak defense)                                                                                                   |
  | `Vue useAuditLedger` initial value sync                                                         | initial query fires immediately + microtask refresh (no empty-state flash)                                                            |
  | `Svelte` only `createAuditLedgerStore`                                                          | `useAuditLedger` alias added for cross-framework muscle memory                                                                        |
  | `dangerousRegex` exported from main barrel                                                      | moved to `@directive-run/core/internals` (the `@internal` tag was contradictory)                                                      |

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

  - The 14-variant `AuditEntry` discriminated union – every consumer's switch keeps working; new kinds were strictly additive (the compliance-audit demo gained an exhaustiveness `never` check to catch future drift at compile time).
  - All v1.12.0 APIs (`createAuditLedger`, `predicateFromIntent`, `predict`, `doctor`, `predicateToSQL/Mongo/Postgrest`, `whenExplain` panel) – same call signatures, hardened internals.
  - The newly added APIs (`describePredicate`, `predicateHash`) are net-new exports; no removed surface.

  ### Compliance demo updates

  `examples/compliance-audit` gained an ERASE button alongside TAMPER + VERIFY, demoing the full GDPR Art.17 → tombstone → verify-with-`erasedSeqs` flow. Bundle 146 kB / 46 kB gz.

  ### Not in this release

  Planned follow-ups include `ledger.replayUnder()`,
  `predicateToZod/JSONSchema/TypeScript`, an ensemble-jury `tuneFromIntent`,
  a `directive ledger render` English forensic timeline, a predict ×
  checkOwns preemptive collision check, and `RULES.md` codegen via
  `describePredicate`.

## 1.12.0

## 1.11.0

### Minor Changes

- [`280928d`](https://github.com/directive-run/directive/commit/280928dec0776fda998055fc9b47955abdf58c04) Thanks [@jasoncomes](https://github.com/jasoncomes)! - feat: predicate-from-intent + audit-ledger + predict + doctor

  The headline this release earns:

  > _"The LLM wrote a rule. The type-checker said no. The doctor said no.
  > The predictor said which facts must change. Two turns later, the rule
  > was in production – and every state change since then ships with a
  > tamper-evident, hash-chained (djb2 32-bit; SHA-256 reserved for v2)
  > explanation. Tamper one byte, the chain proves it."_

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

  ledger.query({
    factPath: "cartTotal",
    changedBetween: ["2026-01-01", "2026-06-01"],
  });
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
  `getOperatorsForKind(kindNode)` – runtime discriminant for the
  operator-on-kind matrix that previously only lived in the
  `OperatorObject<V>` type. Used by `predicateFromIntent` and
  `validatePredicateAgainstSchema`; also useful for prompt builders,
  playground UIs, and `predicateToZod` (future).

  ### `@directive-run/react`: `useAuditLedger`

  Subscribe to an audit ledger and get the latest entries matching a
  filter, re-rendering as new entries land. The "drop `<AuditLog />`
  in your dev sidebar" hook.

  ```ts
  const entries = useAuditLedger(ledger, {
    kind: "constraint.evaluate",
    limit: 20,
  });
  ```

  ### What's deferred

  - **SQLite / Parquet / Loki sinks** – sink interface is open; v1 ships
    in-memory `memorySink` only.
  - **Audit-ledger devtools panel** – `useAuditLedger` hook ships;
    full panel integration with the floating devtools panel is a
    follow-up.
  - **Strong async SHA-256 verify** – v1 ships sync djb2 32-bit chain
    (fast, isomorphic, catches accidental + light-adversarial tamper).
    SHA-256 dual-chain reserved for v2.
  - **Full SMT-lite `doctor`** – z3.wasm-based satisfiability. v1 ships
    structural contradiction detection (direct / subset / overlap).
  - **`predicateToZod()`** – schema introspection unlocks this. ~0.5d
    follow-up once demanded.
  - **`useAuditLedger` for Vue / Svelte / Solid / Lit** – React only in
    v1; framework parity is mechanical.

  Pairs with `@directive-run/query`, data predicates, `replayUnder`,
  `diffRules`, and `predicateToSQL`. See the `eight-tools-from-one-decision`
  blog post.

  > Correction (later release): the original v1.11.0 language overpromised. The shipped substrate is tamper-evident with hash-chained (djb2 32-bit) entries; "court-admissible" and "GDPR-grade" were marketing claims that exceeded what the code delivers. See docs/concepts/audit-ledger.md for the accurate threat model.

## 1.10.0

## 1.9.0

## 1.8.0

## 1.7.0

## 1.6.1

## 1.6.0

## 1.5.0

### Minor Changes

- [`e3b4cc6`](https://github.com/directive-run/directive/commit/e3b4cc661679e267039e2a64ee85d32f2fc00ddd) Thanks [@jasoncomes](https://github.com/jasoncomes)! - PII guardrails: split detection from redaction

  `detectPII` is now **detection-only**. The `redact` and `redactionStyle`
  options have been removed – `detectPII(text, options)` returns a
  `PIIDetectionResult` whose `redactedText` is always `undefined`. A new
  `detectAndRedactPII` helper covers the previous one-shot detect-and-redact
  shape.

  This is a small shape change on a utility export that hadn't reached a
  stable 1.x API contract; the migration is a one-line drop-in. Treating it
  as a `minor` reflects the practical migration cost rather than a wholesale
  v2 commitment.

  ### Migration

  Calls that relied on `detectPII(text, { redact: true, redactionStyle })`
  no longer compile. Pick the form that matches your usage:

  ```ts
  // Before
  const result = await detectPII(text, {
    redact: true,
    redactionStyle: "typed",
  });
  // result.redactedText -> the redacted string

  // After (one-shot, equivalent shape)
  import { detectAndRedactPII } from "@directive-run/ai";
  const result = await detectAndRedactPII(text, { style: "typed" });
  // result.redactedText -> the redacted string

  // After (separated – detect once, redact later)
  import { detectPII, redactPII } from "@directive-run/ai";
  const result = await detectPII(text);
  const redacted = result.detected
    ? redactPII(text, result.items, "typed")
    : text;
  ```

  `detectAndRedactPII` accepts every `detectPII` option plus an optional
  `style?: RedactionStyle`, and populates `redactedText` only when PII is
  actually detected (`undefined` otherwise).

  ### Also in this release

  - **`national_id` is now detectable** as a first-class `PIIType`.
  - **`redactPII` overlap handling fixed** – overlapping or adjacent matches
    no longer corrupt the redacted output.
  - **New PII type exports** for consumers building custom detectors and
    redaction flows (`PIIDetectionResult`, `DetectedPII`, `PIIType`,
    `PIIDetector`, `RedactionStyle`).

## 1.4.0

## 1.3.0

## 1.1.2

## 1.1.1

## 1.1.0

## 1.0.1

## 1.0.0

### Minor Changes

- [`a6a23b2`](https://github.com/directive-run/directive/commit/a6a23b2e52377a07bbbde52a89dcffcc3db2f826) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add DefinitionMeta – optional metadata for all 7 definition types

  **Core (`@directive-run/core`):**

  - `DefinitionMeta` type: label, description, category, color, tags, extensible index signature
  - `meta?` on modules, facts (via `t.number().meta()`), events (`{ handler, meta }`), constraints, resolvers, effects, derivations (`{ compute, meta }`)
  - `system.meta` O(1) accessor: module, fact, event, constraint, resolver, effect, derivation
  - `system.meta.byCategory()` and `system.meta.byTag()` bulk queries with `MetaMatch` return type
  - `system.inspect()` surfaces meta on all 7 definition types + modules array
  - `system.explain()` uses meta.label and meta.description in causal chains
  - Trace entries enriched with inline meta on all sub-arrays (factChanges, constraintsHit, resolversStarted, resolversCompleted, resolversErrored, effectsRun, derivationsRecomputed)
  - All meta frozen at registration via Object.create(null) + Object.freeze (prototype pollution defense)
  - Devtools graph renders meta.label for node labels, meta.color for node colors, meta.description as SVG tooltips

  **AI (`@directive-run/ai`):**

  - `formatSystemMeta(inspection)` – formats SystemInspection into LLM-readable markdown context
  - `toAIContext(system)` – convenience wrapper
  - `metaContext: true` option on both single-agent and multi-agent orchestrators
  - Token-efficient: only includes annotated definitions, omits empty sections

### Patch Changes

- Updated dependencies [[`a6a23b2`](https://github.com/directive-run/directive/commit/a6a23b2e52377a07bbbde52a89dcffcc3db2f826)]:
  - @directive-run/core@1.0.0

## 0.8.9

## 0.8.8

## 0.8.7

### Patch Changes

- [`627b7a7`](https://github.com/directive-run/directive/commit/627b7a7349fe2be0f3aca5bc54127aafba4863e0) Thanks [@jasoncomes](https://github.com/jasoncomes)! - SSR hydration for all adapters, query cache persistence, audit fixes

  - core: Add `mergeHydrationFacts` shared utility, cache `wrapWithNestedWarning` proxies, wire resolver key to engine, ship observability from .lab, add `getInflightCount()`, consolidate `safeStringify`
  - react: `useHydratedSystem` uses shared `mergeHydrationFacts`
  - vue: Add `DirectiveHydrator` component + `useHydratedSystem` composable
  - svelte: Add `setHydrationSnapshot` + `useHydratedSystem`
  - solid: Add `DirectiveHydrator` + `useHydratedSystem`
  - lit: Add `HydrationController` with lifecycle management
  - ai: Split the orchestrator into smaller modules, rename `dispose()` to `destroy()`, enable bundle splitting (246KB -> 109KB), remove legacy shims
  - query: Add `persistQueryCache` plugin for offline cache persistence

## 0.8.6

## 0.8.5

## 0.8.4

## 0.8.3

## 0.8.2

## 0.8.1

## 0.8.0

## 0.7.0

## 0.6.0

### Minor Changes

- ### Breaking Changes

  - **Rename `debug.runHistory` → `trace`**: `createSystem({ debug: { runHistory: true } })` is now `createSystem({ trace: true })`. The `DebugConfig` type is removed; use `TraceOption` instead. `system.runHistory` is now `system.trace`. `RunChangelogEntry` is now `TraceEntry`.
  - **Rename `debug.timeTravel` → `history`**: `createSystem({ debug: { timeTravel: true } })` is now `createSystem({ history: true })`. `system.timeTravel` is now `system.history`. `snapshotEvents` moves from top-level module config to `history: { snapshotEvents: [...] }`.
  - **HistoryState API aligned with HistoryAPI**: `canUndo`/`canRedo`/`undo()`/`redo()` removed from `HistoryState` (returned by `useHistory` hooks). Use `canGoBack`/`canGoForward`/`goBack()`/`goForward()` instead.
  - **Observability plugin moved to lab**: `createObservability` and `createAgentMetrics` are no longer exported from `@directive-run/core/plugins` or `@directive-run/ai`. The implementation is preserved in `observability.lab.ts` for re-evaluation. Types are still exported.

  ### Features

  - Document full `getDistributableSnapshot` API including `includeFacts`, `excludeDerivations`, `metadata`, and `includeVersion` options.
  - Add `.lab.ts`/`.lab.md` feature lifecycle convention for managing lab → prod → deprecated phases.

  ### Fixes

  - Add global `cursor: pointer` to all buttons.
  - Narrow home page hero code block width.

## 0.5.0

### Minor Changes

- [`7229881`](https://github.com/directive-run/directive/commit/72298811032bbaf988bf8c200cc8ba481f0132f7) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add dynamic runtime definitions, harden security, and refactor internals.

  **Features**

  - Add `register()`, `assign()`, `getOriginal()`, `restoreOriginal()` for constraints, resolvers, derivations, and effects at runtime
  - Add `DerivationsControl` type for dynamic definition methods on `system.derive`
  - Add `read()` overload for fact keys on `SingleModuleSystem`

  **Fixes**

  - Fix command injection vulnerability in CLI `graph` command (`exec` → `execFile`)
  - Reject schema keys starting with `$` to prevent internal collision
  - Prefix all testing assertion errors with `[Directive]`
  - Harden all 11 proxies with `defineProperty`, `getPrototypeOf`, `setPrototypeOf` traps

  **Improvements**

  - Extract shared adapter utilities (SSE parsing, hooks, error handling) in AI package
  - Split orchestrator into pattern-composition, pattern-factories, pattern-serialization
  - Split `facts.ts` into `schema-builders.ts` + facts store
  - Consolidate `BLOCKED_PROPS` to single export in `tracking.ts`
  - Remove 7 internal builder types from public exports

  **BREAKING:** `constraintFactory` renamed to `createConstraintFactory`, `resolverFactory` renamed to `createResolverFactory`

## 0.4.2

## 0.4.1

### Patch Changes

- [`73a604e`](https://github.com/directive-run/directive/commit/73a604e68f86f785f413fbfb9314f9fac90fef2a) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Enforce stricter lint rules and add CLI + knowledge packages.

  **Features**

  - Add `@directive-run/cli` with `ai-rules init` command for installing AI coding rules across editors (Claude, Cursor, Copilot, Cline, Windsurf)
  - Add `@directive-run/knowledge` for extracting structured knowledge from Directive packages

  **Improvements**

  - Promote 8 Biome lint rules from warn to error: `noUnusedTemplateLiteral`, `useLiteralKeys`, `useExponentiationOperator`, `useConst`, `noUselessElse`, `noConfusingVoidType`, `noCommaOperator`, `noDelete`
  - Auto-fix all lint violations across source files (no API changes)

## 0.4.0

### Minor Changes

- [`ed2475d`](https://github.com/directive-run/directive/commit/ed2475d4b01e87e198fe87d1f846abe19e8ce3ff) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add tasks system, supervisor resilience, and enriched debug timeline to the AI orchestrator. Consolidate error handling and harden resolvers in core. Simplify DevTools with rewritten session panel and removed dead views. Fix memory message deduplication in multi-agent orchestrator.

## 0.3.0

### Minor Changes

- [`b418d25`](https://github.com/directive-run/directive/commit/b418d259eb663bd79c769b89a5069e4a10ed160c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add run history, constraint disable API, and DevTools overhaul with graph visualization, panel UI, and AI bridge. Rewrite AI package with modular orchestrator architecture, multi-agent orchestrator, evals framework, OTEL tracing, breakpoints, checkpoints, health monitoring, reflection patterns, and Gemini adapter. Add full DevTools React UI with timeline, DAG, flamechart, compare, replay, and anomaly detection views.

## 0.2.0

### Minor Changes

- [`7e3e3ed`](https://github.com/directive-run/directive/commit/7e3e3ed20754c1b605596d1f7a2969590af73f7c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `snapshotEvents` option to `createModule` for controlling which events create time-travel snapshots. Add optional equality function parameter to `useSelector` across all framework adapters. Remove deprecated `bus`, `obs`, `multi`, and `costRatePerMillion` aliases from `createAgentStack`.
