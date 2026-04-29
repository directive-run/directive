# @directive-run/timeline changelog

## 0.1.0 — 2026-04-29

Initial release. The Sherlock pick from MIGRATION_FEEDBACK item #1+#3+#7.

### Added
- `recordTimeline(system, { id })` — subscribe to a Directive system's
  `observe()` stream and capture every lifecycle event as a timestamped
  frame in a named timeline.
- `getTimeline(id)` / `clearTimeline(id)` / `clearAllTimelines()` —
  registry access.
- `withTimeline(id, system, fn)` — convenience wrapper that
  auto-stops on block resolve / throw.
- `formatTimeline(timeline, opts?)` — render a multi-line, optionally
  ANSI-colored trace. Includes `maxFrames`, `include`, `valuePreviewLen`
  options.
- `TimelineReporter` (from `@directive-run/timeline/reporter`) — Vitest
  reporter that, on test failure, looks up the timeline by the test's
  full name and prints it inline with the failure.

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
