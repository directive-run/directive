# @directive-run/mutator changelog

## 0.4.0

### Minor Changes

- [`aa2e7c3`](https://github.com/directive-run/directive/commit/aa2e7c345dbf9d0808d4337ae740b4e95eaee9ae) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `MutatorFragments.facts.pendingMutation` now preserves the `PendingMutation<M>` generic when spread into a module schema.

  The fragment type previously surfaced as `ReturnType<typeof t.object>` — a fully-erased object schema with no narrowing. Spreading `...mut.facts` into `schema.facts` collapsed the typed `{kind, payload, status, error}` shape to `unknown`, killing autocomplete on the very fact the package exists to type.

  The interface is now `pendingMutation: SchemaType<PendingMutation<M> | null>`. Consumers reading `facts.pendingMutation` after the spread get the typed discriminated union narrowed by `kind` — exactly the shape `defineMutator<M, F>` was designed to produce. Pure type-layer change; runtime behaviour is unchanged.

## 0.3.1

### Patch Changes

- [`93cd8b8`](https://github.com/directive-run/directive/commit/93cd8b804c79ae3f08a52d9848312faf135f2cf5) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Docs UX reconciliation: AI tooling becomes a first-class install path
  and Directive's coding knowledge ships from one source-of-truth to
  every assistant.

  A new `/docs/ide-integration` page at directive.run is the canonical
  decision tree across Claude Code, Cursor, GitHub Copilot, Windsurf,
  Cline, OpenAI Codex, and the programmatic `@directive-run/knowledge`
  API. The docs sidebar gets an "AI Tooling" section as item #2 between
  Getting Started and Core API, surfacing the integration path
  alongside the core learning journey. The `/llms.txt` route gains an
  "Install paths for your AI assistant" block so LLM agents crawling
  the docs at runtime learn how a downstream developer would install
  the same knowledge they're consuming.

  The Claude Code install path becomes real: a `.claude-plugin/
marketplace.json` is now committed to the directive monorepo root —
  previously gitignored, which is why `/plugin marketplace add
directive-run/directive` returned 404 from GitHub. Users can now run
  the two-step install the claude-plugin README has been documenting:

  ```
  /plugin marketplace add directive-run/directive
  /plugin install directive@directive-plugins
  ```

  Every published adapter README (query, mutator, optimistic, timeline,
  el, cli, vite-plugin-api-proxy) gains two new sections: a "Composes
  with" footer linking the sibling packages it commonly composes with
  (fixes the nav-orphan gap from R7 — query had no links to mutator /
  optimistic / timeline despite being designed to compose), and a "Use
  this package with your AI assistant" hook tied to that package's
  value prop. Each knowledge `.md` file in `@directive-run/knowledge`
  gains a one-line top-of-file breadcrumb naming the package(s) it
  documents, so a developer or LLM reading any file in isolation knows
  immediately which import to use.

  The top-level monorepo README gains an "AI tooling" section between
  the existing AI Guardrails and React sections. The
  `@directive-run/knowledge` README is restructured so consumer
  pathways (plugin / CLI / programmatic / llms.txt) lead, instead of
  the programmatic API which previously dominated above the fold.

  Strategic FYIs for the v1.15 release notes — these are NOT shipping
  in v1.15 but are explicitly tracked:

  - `@directive-run/claude-plugin` npm publication is under evaluation;
    the plugin stays Claude Code marketplace-only for v1.15.
  - See-also cross-link footers across the 25 knowledge files are on
    the v1.16 roadmap.
  - MCP SSE server (`mcp.directive.run`) for live agent retrieval is on
    the v1.16 roadmap.

  No code changes; no API changes; this is the docs UX reconciliation
  that makes v1.15's AI tooling story discoverable.

## 0.3.0

### Minor Changes

- [`02d80c4`](https://github.com/directive-run/directive/commit/02d80c427c3c6b989765dcd99aa51d1aa3770b8b) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Security, correctness, and DX hardening for timeline replay, matchers, and the cancellable mutator HOC.

  ### Timeline (surface-compatible fixes)

  - **Spread-order RCE in `reconstructDispatch`.** `{ type: "MUTATE", ...next }` let an attacker-controlled `frames[i].event.next.type` field override the dispatch type. Untrusted production-error JSON could re-route every replayed event to an arbitrary handler. Fix: spread-then-set (`{ ...next, type: "MUTATE" }`).
  - **Frame-shape validation in `deserializeTimeline`.** Per-frame validation of `ts`/`event`/`event.type`. Untrusted JSON with malformed frames now produces precise `TypeError` rejections instead of crashing the replay loop with bare exceptions.
  - **Matcher iteration robustness.** All five matchers now filter `frames()` through `isWellFormedFrame` before iterating. Hostile input produces clean assertion failures instead of TypeErrors.
  - **Structural equality in `toReachInMs`.** Replaced `JSON.stringify` equality with `structuredEqual` – NaN/undefined/Infinity no longer produce false-positive matches.
  - **`maxFrames` cap on `replayTimeline`.** Default 100,000 frames; prevents unbounded synchronous loops on hostile JSON dumps.
  - **`replayTimeline` returns `ReplayResult`** (`{ dispatched, skipped, truncated }`) instead of `void`. Lets callers verify the replay actually re-dispatched events instead of silently no-op'ing on non-mutator systems. Breaking change vs v0.2 only in type signature; existing call sites that ignored the return value continue to work.
  - **`dispatchableOnly?: boolean`** is the new option name; `dispatchable?` is kept as a deprecated alias for v0.x compatibility. The original name read backwards ("dispatchable: true" sounded like "this thing IS dispatchable" not "filter to dispatchable").

  ### Mutator (additive Error subclasses)

  - **`CancelError` Error subclass for `signal.reason`.** New runtime carriers `CancelError`, `TimeoutCancelError`, `SupersededCancelError` ensure `signal.reason instanceof Error` checks succeed downstream. Plain-object reasons silently failed `fetch(url, {signal})` re-throw paths and `.catch(err => err instanceof Error)` filters in logging frameworks. The `CancelReason` type still works (Error subclasses expose the same `kind` field), so existing `signal.reason?.kind === 'superseded'` checks remain valid.
  - **Exported `cancelReason` factory** – `cancelReason.superseded()` and `cancelReason.timeout(afterMs)` produce typed Error subclasses. Single source of truth for both producers (cancellable internals) and consumers (handler abort observers).
  - **`cancelTimeout` cleanup error-shadowing fix.** A throwing `setTimeout`-cancel-handle (e.g. a hostile virtual clock) no longer replaces the original handler's exception. The cleanup is wrapped in try/catch.
  - **Peer dep tightened to `@directive-run/core@^1.3.0`.** `cancellable()`'s ergonomic test path imports `virtualClock` from core 1.3.0; consumers on 1.2.x would have hit a runtime error copying the README example.

- [`f70bd70`](https://github.com/directive-run/directive/commit/f70bd70071d2bc2fab5af6b6866f8e7c6ce559b1) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `recordReplayable()` HOC – structured cancellation events for replay-aware mutations

  Wraps a mutator handler with the same supersession + timeout semantics as `cancellable()`, plus a synchronous `onCancel` callback that fires the moment the AbortController calls `abort()`. The callback receives a `CancelEvent<F, P>` carrying:

  - `kind: 'superseded' | 'timeout'`
  - `afterMs?: number` (timeout only)
  - `payload: P` – the dispatch that did NOT complete
  - `dispatchSeq: number` – per-handler monotonic counter
  - `facts: F` – live facts reference

  Use `onCancel` to pin cancellations into a place that survives in the timeline (typically a facts array). Without that, a replay re-dispatches the same MUTATE events but has no record of which were superseded vs which completed – so timeline diff/bisect tools cannot reason about cancellations without parsing free-form error strings.

  ```ts
  import { defineMutator, recordReplayable } from "@directive-run/mutator";

  const search = recordReplayable<MyFacts, { q: string }>(
    {
      supersedeOn: "self",
      timeoutMs: 3_000,
      onCancel: ({ facts, kind, payload, dispatchSeq }) => {
        facts.cancellations.push({
          kind,
          queryAtCancel: payload.q,
          seq: dispatchSeq,
        });
      },
    },
    async ({ payload, facts, signal }) => {
      const res = await fetch(`/q?${payload.q}`, { signal });
      facts.results = await res.json();
    }
  );
  ```

  Implementation note: `recordReplayable()` is `cancellable(opts, innerHandler)` where `innerHandler` adds a `signal.addEventListener('abort')` around the user's handler. Timeout / supersession semantics are EXACTLY those of `cancellable()` – the HOC is purely additive. The abort listener fires synchronously, BEFORE the handler's pending await rejects with AbortError, so the callback sees the freshest possible state.

  `onCancel` errors are caught and swallowed – the abort path stays clean.

  9 new tests covering: clean run no-op, supersession callback delivery, dispatchSeq monotonic per HOC, two HOCs maintain independent counters, timeout callback delivery with afterMs preserved, onCancel-throw robustness, non-CancelError abort filter, CancelError class hierarchy.

### Patch Changes

- [`0d8cae5`](https://github.com/directive-run/directive/commit/0d8cae57e7e9b28ecb64e98588458a264dbd06c1) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Production-readiness pass: better docs, cleaner types, and consistent semantics.

  No new commands; existing surfaces gain better docs, cleaner types, and consistent semantics.

  **Documentation:**

  - `@directive-run/timeline` README – replaces the outdated "v0.4 – diff mode (deferred)" roadmap with shipped reality. New "Serialize, replay, bisect, diff" section walks all four operational entry points end-to-end with library and CLI examples for each.
  - `@directive-run/cli` README – adds full sections for `directive replay`, `directive bisect` (with a security note for `--assert`), and `directive timeline diff` (with exit-code documentation).
  - `@directive-run/mutator` README – new "Recording cancellations for replay" section covers `recordReplayable()` end-to-end.

  **Type ergonomics:**

  - `BisectResult` now carries a `kind: 'found' | 'no-failure' | 'fails-on-empty' | 'non-deterministic'` discriminator. Consumers can `switch (result.kind)` for clean type-narrowed access instead of juggling three booleans plus an optional index. Legacy boolean fields stay populated for back-compat (marked `@deprecated`).

  **Exit-code consistency:**

  - `directive bisect` now exits `2` on a "standard hit" (located the first failing frame). Aligns with `directive timeline diff` (exit 2 = differences found), so CI gates can branch uniformly: `0 = clean, 1 = CLI error, 2 = problem found / refused`. Documented in the CLI README.

  **Docstring corrections:**

  - `recordReplayable()` JSDoc reframed: the function is a generic "call me when abort fires" hook. Pinning into facts is one use case; Sentry breadcrumbs, Redux logs, OpenTelemetry, and metrics are equally valid. Removes the misleading "pairs with timeline" framing that overstated the coupling.

## 0.2.0

### Minor Changes

- [`dc4ac7b`](https://github.com/directive-run/directive/commit/dc4ac7b93007104ce4973d86fb3d6f6a5d1fcded) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `cancellable()` HOC – auto-cancel-on-supersede for mutator handlers

  Wrap a mutator handler with `cancellable()` to get auto-cancellation: a fresh dispatch of the same wrapped handler aborts the prior in-flight invocation, or an optional timeout fires the abort after N ms.

  ```ts
  import { defineMutator, cancellable } from "@directive-run/mutator";

  const formMutator = defineMutator<MyMutations, MyFacts>({
    search: cancellable(
      { supersedeOn: "self", timeoutMs: 3_000 },
      async ({ payload, facts, signal }) => {
        const res = await fetch(`/q?${payload.q}`, { signal });
        facts.results = await res.json();
      }
    ),
    submit: async ({ payload, facts }) => {
      facts.values = await deps.submit(payload.values);
    },
  });
  ```

  **Two cancellation triggers, both opt-in:**

  - `supersedeOn: 'self'` (default) – new dispatch supersedes prior
  - `supersedeOn: 'never'` – only timeout fires; parallel runs are fine
  - `timeoutMs: number` – abort after N ms from invocation start

  **Test ergonomics.** Pass `virtualClock.setTimeout` from `@directive-run/core` via the `setTimeout` option to make timeouts fire synchronously under `clock.advanceBy(ms)` – no real-time waits.

  The signal's `.reason` carries a typed `CancelReason`:

  ```ts
  type CancelReason =
    | { kind: "superseded" }
    | { kind: "timeout"; afterMs: number };
  ```

  **Composition.** Drops in directly to `defineMutator`'s handler map slot. Two separate `cancellable()` HOCs around different handlers do NOT cancel each other – the supersession registry is closure-scoped per call.

  **v0.1 scope:** `cancellable()` is a value-layer HOC; engine-side never sees a difference between a wrapped handler and a plain async one. v0.2 will explore the timeline integration so `expect(timeline).toCancel('search')` matchers can assert against the abort stream.

  9 new tests covering basic invocation, supersession (both modes), timeout (using virtualClock for determinism), supersession+timeout composition, HOC independence.

## 0.1.0 – 2026-04-29

Initial release.

### Added – v0.2 (cancellable)

- `cancellable(opts, handler)` – HOC that wraps a mutator handler with
  auto-cancellation. Receives a `signal: AbortSignal` in the handler
  context. Two cancellation triggers: `supersedeOn: 'self' | 'never'`
  (default `'self'`) and `timeoutMs?: number`. The signal's `reason`
  carries a typed `CancelReason` distinguishing `{kind:'superseded'}`
  from `{kind:'timeout', afterMs}`. Pass `setTimeout` from
  `virtualClock` for deterministic test timing.
- `CancellableOptions`, `CancellableHandlerContext<F, P>`,
  `CancelReason` type exports.

### Added – v0.1

- `defineMutator(handlers)` – typed builder that returns six fragments
  (facts / events / requirements / eventHandlers / constraints /
  resolvers) wiring a discriminated `pendingMutation` lifecycle into a
  Directive module.
- `mutate(kind, payload?)` – typed payload constructor for `MUTATE`
  dispatches.
- Single-flight concurrency model: new mutations overwrite in-flight ones
  via the `pendingMutation` fact.
- Error capture: thrown handlers surface on `pendingMutation.error`
  with `status: 'failed'` (a distinct status from `'running'` so the
  UI can disambiguate; the constraint stops firing).
- Built on `@directive-run/core@^1.2.0` (requires `ctx.requeue` for
  handler-cascade chains).

### Known gaps

- Parallel-of-same-shape mutations not supported – last-write-wins.
- No runtime payload validation – TypeScript only at dispatch site.
- Optimistic / snapshot-rollback support belongs to upcoming
  `@directive-run/optimistic`; do manual rollback inside handlers for
  now.

### Why the 0.x version

This package collapses a real-world boilerplate pattern but the API
shape (six-spread vs builder vs HOC) is still being validated against
production use. v1.0 ships once at least three external consumers have
worn the API end-to-end.
