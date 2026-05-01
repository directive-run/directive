# @directive-run/timeline changelog

## 0.2.0

### Minor Changes

- [`ec72f5c`](https://github.com/directive-run/directive/commit/ec72f5c0a524ee6b2b0f60146e2fed73614caead) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `@directive-run/timeline/matchers` subpath — causal-graph vitest matchers (R1.B v0.1)

  Five matchers for asserting against the recorded `ObservationEvent` stream — not just final state. The same data the formatter renders and `replayTimeline` re-dispatches now powers test assertions.

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

- [`b63f4a9`](https://github.com/directive-run/directive/commit/b63f4a9403621b3da14915dcc612dafcecb8bdd6) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `serializeTimeline` + `deserializeTimeline` + `replayTimeline` (R1.A scaffold)

  Recorded timelines are now JSON-roundtrippable and replayable against a fresh system. This is the BUILD CANDIDATE from the AE-review-loop's innovation pass — the substrate for "production error JSON → auto-derived vitest test file."

  **New exports:**

  - `serializeTimeline(timeline) → SerializedTimeline` — JSON-safe wire format with version stamp.
  - `deserializeTimeline(input: unknown) → SerializedTimeline` — validates structure + schema version; throws on mismatch.
  - `replayTimeline(timeline, system, opts?) → Promise<void>` — walks frames in order, re-dispatches recoverable events.
  - `SerializedTimeline` + `ReplayOptions` + `ReplayableSystem` types.

  **v0.1 scope (deliberately narrow):** today reconstructs `MUTATE` dispatches from `@directive-run/mutator`-shaped `pendingMutation` fact.change frames. Other dispatch sources land when core emits first-class `event.dispatch` observation events. The dispatchable-frame filter (`{ dispatchable: true }`, default) skips lifecycle-internal events (`system.start`, `reconcile.*`, `derivation.compute`, ...).

  **v0.2 scope (deferred):** auto-derived vitest source codegen (`directive replay <id>.json` → `<id>.test.ts`); determinism gate; mock-stub generation from recorded resolver pairs.

  5 new tests covering JSON round-trip, deserialize validation, dispatchable replay, non-dispatchable skip, and `dispatchable: false` walk mode.

## 0.1.0 — 2026-04-29

Initial release. The Sherlock pick from MIGRATION_FEEDBACK item #1+#3+#7.

### Added

- `recordTimeline(system, { id })` — subscribe to a Directive system's
  `observe()` stream and capture every lifecycle event as a timestamped
  frame in a named timeline.
- `getTimeline(id)` / `clearTimeline(id)` / `clearAllTimelines()` /
  `setRegistryCap(n)` — registry access + bounded retention.
- `withTimeline(id, system, fn)` — convenience wrapper that
  auto-stops on block resolve / throw.
- `formatTimeline(timeline, opts?)` — render a multi-line, optionally
  ANSI-colored trace. Includes `maxFrames`, `include`, `valuePreviewLen`
  options.
- `TimelineReporter` (from `@directive-run/timeline/reporter`) — Vitest
  reporter that, on test failure, looks up the timeline by the test's
  full name and prints it inline with the failure.
- **R1.B causal-graph matchers** (`./matchers` subpath): five vitest
  matchers — `toReachInMs`, `toFireConstraint`, `toMutate`,
  `toResolveWithinMs`, `toCascade` — that assert against the recorded
  `ObservationEvent` stream. `import '@directive-run/timeline/matchers'`
  registers them globally; `registerMatchers(expect)` is the explicit
  alternative. Each operates on the same frame stream `formatTimeline`
  renders and `replayTimeline` re-dispatches. 14 new tests.
- **R1.A scaffold:** `serializeTimeline()` + `deserializeTimeline()` +
  `replayTimeline()` — JSON-roundtrip a recorded timeline and replay
  its dispatched events against a fresh system. Today reconstructs
  `MUTATE` dispatches from `@directive-run/mutator`-shaped
  `pendingMutation` fact.change frames; the dispatchable-frame set
  expands as core emits first-class `event.dispatch` observation
  events. v0.2 will add codegen for vitest source files.

### Built on

- `@directive-run/core`'s shipped `system.observe(observer)` API +
  fully-typed `ObservationEvent` stream. No core changes required.

### Known gaps

- Reporter looks up timeline by test name only — no auto-association
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

- **v0.2** — interactive CLI scrubbing (`n`/`p` step through frames).
- **v0.3** — web UI swim-lane renderer (vitest UI plugin).
- **v0.4** — timeline diff mode (CI vs local divergence detection).
