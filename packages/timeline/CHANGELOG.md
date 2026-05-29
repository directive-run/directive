# @directive-run/timeline changelog

## 0.3.0

### Minor Changes

- [`ecc8378`](https://github.com/directive-run/directive/commit/ecc8378cc47876a9526a5827f83f3261890ee5f2) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `directive bisect` – git-bisect for timelines

  Binary-search a recorded timeline for the first frame whose inclusion in the replay prefix flips a user-supplied assertion from passing to failing. The CLI surface mirrors `git bisect run`, but operates over `ObservationEvent` frames instead of git commits.

  Built on `replayTimeline()` and its determinism guarantees: bisect is a tiny binary-search loop over a primitive that already exists.

  **`bisectTimeline()` library API** (`@directive-run/timeline`):

  ```ts
  import { bisectTimeline, deserializeTimeline } from "@directive-run/timeline";

  const bad = deserializeTimeline(JSON.parse(prodErrorReportText));
  const result = await bisectTimeline(
    bad,
    () => {
      const sys = createSystem({ module: counterModule });
      sys.start();
      return sys;
    },
    (sys) => sys.facts.score >= 0
  );
  console.log(`first failing frame: #${result.firstFailingFrameIndex}`);
  ```

  Three failure modes are reported as discrete result fields rather than thrown errors, so the caller can branch deterministically:

  - `noFailureFound: true` – assertion passes after replaying the full timeline; nothing to bisect.
  - `failsOnEmptyReplay: true` – assertion fails on a freshly-started system before any frame replays; bug is in initialization.
  - `nonDeterministic: true` – two full-timeline replays produced different oracle verdicts; bisection refuses (returns early).

  Per-iteration cost is one full replay of `mid` frames. Iteration count is bounded by `2 + 1 + ceil(log2(N))` (determinism gate + empty probe + binary search). For a 10k-frame timeline that's ~14 iterations; for a 1k-frame timeline ~13.

  **`directive bisect` CLI** (`@directive-run/cli`):

  ```sh
  directive bisect bug-1234.json \
    --system test/bisect-system.ts \
    --assert 'facts.count >= 0'
  ```

  The `--system` file must export a _factory_ (a `createSystem` / `systemFactory` / default-export function returning a started Directive system) so bisect can instantiate a fresh hermetic system per midpoint replay. The `--assert` expression evaluates as a JS function body with `facts` and `system` in lexical scope. The CLI is a local-trust tool – don't relay these strings from untrusted callers.

  **11 new library tests** (timeline): happy path, frame-0 trigger, no-failure, fails-on-empty, non-determinism detection, O(log N) iteration bound, factory-freshness invariant, async factories/oracles, determinism-check disable, 1-frame, 0-frame.

  **10 new CLI tests** (cli): missing args, malformed JSON / assertion, factory-missing, full happy path with synthetic 4-frame timeline + JSON output, no-failure-found human output.

- [`189dee2`](https://github.com/directive-run/directive/commit/189dee240b97255f798df1b7a54e368a04460b5d) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `directive timeline diff` – semantic causal-graph diff between two serialized timelines

  Not a textual JSON diff – a causal one. Reports per-category deltas (frame counts, constraint fires, mutation kinds, resolver runs, new errors) so a reviewer can see "Run B fired constraint `loadOnLoading` 3 extra times Run A didn't" without eyeballing a 4000-line diff.

  The diff vocabulary mirrors `@directive-run/timeline/matchers` inverted into reporters: where the matcher surface asserts `toFireConstraint(id, count)` / `toMutate(kind)` / `toResolveWithinMs(resolver)`, the diff surfaces the same buckets as count deltas. Same vocabulary, opposite direction.

  **`diffTimelines()` library API** (`@directive-run/timeline`):

  ```ts
  import { diffTimelines, deserializeTimeline } from "@directive-run/timeline";

  const a = deserializeTimeline(JSON.parse(goodJson));
  const b = deserializeTimeline(JSON.parse(badJson));
  const diff = diffTimelines(a, b);

  if (diff.identical) {
    // semantically same – no further work
  } else {
    for (const c of diff.constraintFires) {
      console.log(`'${c.id}': ${c.aCount} → ${c.bCount} (${c.delta})`);
    }
  }
  ```

  Result categories (only differing entries surface – identical ones are elided):

  - `constraintFires` – per-constraint `constraint.evaluate` count delta, sorted by descending |delta|.
  - `mutations` – per-mutation-kind dispatch count delta. Aligned with `replayTimeline`'s dispatchable filter (`pendingMutation` writes with `status: 'pending'` and a string `kind`).
  - `resolverRuns` – per-resolver `start` / `complete` / `error` axis counts.
  - `newErrors` – `constraint.error` / `resolver.error` / `effect.error` frames that appear on one side but not the other (or differ structurally at the same frame index).
  - `identical` – fast `true` if no category surfaced any difference.

  Defensive `safeStringify` guards the diff against unstringifiable error values (circular refs, BigInts, etc.) – diffing two timelines with hostile error payloads doesn't crash.

  **`directive timeline diff` CLI** (`@directive-run/cli`):

  ```sh
  directive timeline diff baseline.json regression.json
  # Exit 0 = identical, 2 = differences found, 1 = CLI argument error.

  directive timeline diff a.json b.json --json | jq .constraintFires
  ```

  Exit code 2 (not 0/1) so CI can distinguish "diff found differences" from "CLI failed to run." Suitable as a CI gate on PRs that change state-management code.

  Added test coverage for the library diff (identical timelines, constraint deltas, sort order, mutations, resolver runs, errors, lifecycle frames ignored, circular refs, same-shape error elision, two empty timelines) and the CLI (arg parsing, file errors, validation errors, identical exit 0, diverging exit 2, `--json` mode).

  Cascade-edge diff and Mermaid sequence-diagram emission are deferred to v0.2.

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

### Patch Changes

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

- [`40d688e`](https://github.com/directive-run/directive/commit/40d688e0f1e60670f91e229762d25adb0879339e) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Security, architecture, and DX fixes for the timeline tooling.

  No new public APIs; type-narrowing only at consumer surfaces.

  **Security:**

  - `reconstructDispatch()` now strips own `__proto__` / `constructor` / `prototype` keys from hostile timeline JSON before re-spreading into a `MUTATE` dispatch. Defense-in-depth – `JSON.parse` already stores these as benign own properties (no prototype-slot manipulation), but downstream user handlers doing `Object.assign(target, event.payload)` could be misled. Stripping at the boundary is cheaper than auditing every consumer. Regression test added.

  **Architecture:**

  - `diffTimelines` errorKey no longer includes `frameIndex` – the same logical error appearing at shifted positions in two timelines was being double-reported as both `a-only` and `b-only`. Now keyed on `(kind, id, errorJson)` only; `frameIndex` is preserved on the surviving entries for locating. Regression test added.
  - The CLI no longer duplicates timeline types in `replay.ts` / `bisect.ts` / `timeline-diff.ts`. The lazy-import pattern is preserved exactly via `import type` (fully erased at compile time), and types are now single-sourced from `@directive-run/timeline`. Catches drift at compile time the next time timeline adds a field.
  - New `cli/src/lib/timeline-loader.ts` consolidates the three repeated lazy-import blocks into `loadTimelinePackage(verbose)`. The install-prompt error message is now single-sourced.

  **DX:**

  - `loadSystemFactory()` now detects the most common confusion ("user passed a started-instance file expecting bisect to work like replay") and emits a targeted error with a copy-pasteable wrapper. Also reminds users to call `sys.start()` in their factory if they forgot.
  - `directive bisect` `--assert` help text now carries an explicit security note: the expression is evaluated as JavaScript in the CLI process; only pass expressions from sources you trust.
  - `directive bisect --json` now emits `firstFailingFrameIndex: null` (not absent) when no specific frame is the trigger, so jq consumers can distinguish "fails before frame 0" from "frame 0 itself triggers."

  Type narrowing introduced by the `import type` cleanup surfaced three latent unknown-casts in CLI commands (`bisect.ts` factory, `replay.ts` system, `timeline-diff.ts` deserialized). All bridged with explicit casts at the runtime-checked boundary. No behavioral change.

  Planned follow-ups: a subpath split of `timeline/index.ts` into `/bisect` and `/diff` exports, a `BisectResult` discriminated-union refactor, README updates to all three packages, and a `recordReplayable` docstring reframing.

## 0.2.0

### Minor Changes

- [`ec72f5c`](https://github.com/directive-run/directive/commit/ec72f5c0a524ee6b2b0f60146e2fed73614caead) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `@directive-run/timeline/matchers` subpath – causal-graph vitest matchers

  Five matchers for asserting against the recorded `ObservationEvent` stream – not just final state. The same data the formatter renders and `replayTimeline` re-dispatches now powers test assertions.

  ```ts
  // vitest.setup.ts (or any test file)
  import "@directive-run/timeline/matchers";

  // In tests:
  expect(timeline).toReachInMs("status", "ready", 50); // fact reached value within budget
  expect(timeline).toFireConstraint("load", { times: 1 }); // exact fire count
  expect(timeline).toResolveWithinMs("initialLoader", 50); // resolver budget
  expect(timeline).toMutate("submit"); // mutator dispatch
  expect(timeline).not.toCascade(); // ≥2 constraints same reconcile
  ```

  **Surface:**

  - `./matchers` subpath with `import` / `require` / `types` exports.
  - Side-effect-on-import registration via `globalThis.__vitest_expect`; falls through to explicit `registerMatchers(expect)` when the side-effect path doesn't fire.
  - All 5 matchers exported as `matchers.X(timeline, ...)` for non-vitest call sites or custom assertion libraries.
  - TypeScript ambient-module declarations register `Vi.Assertion` / `Vi.AsymmetricMatchersContaining` so `.toReachInMs` etc. are typed inside `expect()` chains.

  **Scope notes:**

  - The pitched fluent API (`.toReachIn(N).ms(...)`) became flat (`.toReachInMs(key, value, ms)`) for cleaner vitest `expect.extend` integration. Functionality identical.
  - `toCascade()` v0.1 uses the heuristic "≥2 active constraints in one reconcile cycle". v0.2 will track caused-by edges from the `requirement.created` / `requirement.met` chain.

  14 new tests covering pass/fail/negation paths plus input validation.

- [`b63f4a9`](https://github.com/directive-run/directive/commit/b63f4a9403621b3da14915dcc612dafcecb8bdd6) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `serializeTimeline` + `deserializeTimeline` + `replayTimeline`

  Recorded timelines are now JSON-roundtrippable and replayable against a fresh system – the substrate for "production error JSON → auto-derived vitest test file."

  **New exports:**

  - `serializeTimeline(timeline) → SerializedTimeline` – JSON-safe wire format with version stamp.
  - `deserializeTimeline(input: unknown) → SerializedTimeline` – validates structure + schema version; throws on mismatch.
  - `replayTimeline(timeline, system, opts?) → Promise<void>` – walks frames in order, re-dispatches recoverable events.
  - `SerializedTimeline` + `ReplayOptions` + `ReplayableSystem` types.

  **v0.1 scope (deliberately narrow):** today reconstructs `MUTATE` dispatches from `@directive-run/mutator`-shaped `pendingMutation` fact.change frames. Other dispatch sources land when core emits first-class `event.dispatch` observation events. The dispatchable-frame filter (`{ dispatchable: true }`, default) skips lifecycle-internal events (`system.start`, `reconcile.*`, `derivation.compute`, ...).

  **v0.2 scope (deferred):** auto-derived vitest source codegen (`directive replay <id>.json` → `<id>.test.ts`); determinism gate; mock-stub generation from recorded resolver pairs.

  5 new tests covering JSON round-trip, deserialize validation, dispatchable replay, non-dispatchable skip, and `dispatchable: false` walk mode.

## 0.1.0 – 2026-04-29

Initial release.

### Added

- `recordTimeline(system, { id })` – subscribe to a Directive system's
  `observe()` stream and capture every lifecycle event as a timestamped
  frame in a named timeline.
- `getTimeline(id)` / `clearTimeline(id)` / `clearAllTimelines()` /
  `setRegistryCap(n)` – registry access + bounded retention.
- `withTimeline(id, system, fn)` – convenience wrapper that
  auto-stops on block resolve / throw.
- `formatTimeline(timeline, opts?)` – render a multi-line, optionally
  ANSI-colored trace. Includes `maxFrames`, `include`, `valuePreviewLen`
  options.
- `TimelineReporter` (from `@directive-run/timeline/reporter`) – Vitest
  reporter that, on test failure, looks up the timeline by the test's
  full name and prints it inline with the failure.
- **Causal-graph matchers** (`./matchers` subpath): five vitest
  matchers – `toReachInMs`, `toFireConstraint`, `toMutate`,
  `toResolveWithinMs`, `toCascade` – that assert against the recorded
  `ObservationEvent` stream. `import '@directive-run/timeline/matchers'`
  registers them globally; `registerMatchers(expect)` is the explicit
  alternative. Each operates on the same frame stream `formatTimeline`
  renders and `replayTimeline` re-dispatches.
- **Serialize and replay:** `serializeTimeline()` + `deserializeTimeline()` +
  `replayTimeline()` – JSON-roundtrip a recorded timeline and replay
  its dispatched events against a fresh system. Today reconstructs
  `MUTATE` dispatches from `@directive-run/mutator`-shaped
  `pendingMutation` fact.change frames; the dispatchable-frame set
  expands as core emits first-class `event.dispatch` observation
  events. v0.2 will add codegen for vitest source files.

### Built on

- `@directive-run/core`'s shipped `system.observe(observer)` API +
  fully-typed `ObservationEvent` stream. No core changes required.

### Known gaps

- Reporter looks up timeline by test name only – no auto-association
  with the system creator. If you create multiple systems in one test,
  record each with a distinct ID and decide which to print.
- Fact-change frames hold references, not snapshots. If a test mutates a
  fact's nested object after the change, the timeline shows the mutated
  state. Use JSON snapshot in handlers if you need at-event values.
- Reporter's `fullTestName` reads only the leaf task name (vitest 1.x
  doesn't expose ancestor pointers). For deeply nested describes, the
  ID convention `expect.getState().currentTestName!` covers the
  hierarchical name reliably.

### Roadmap

- **v0.2** – interactive CLI scrubbing (`n`/`p` step through frames).
- **v0.3** – web UI swim-lane renderer (vitest UI plugin).
- **v0.4** – timeline diff mode (CI vs local divergence detection).
