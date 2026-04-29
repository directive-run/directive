# `@directive-run/timeline`

> Time-travel test REPL for Directive. When a test fails, it auto-prints
> the full causal chain that got the system into the failing state.

```sh
npm install --save-dev @directive-run/timeline
```

## What it solves

When `expect(sys.facts.status).toBe('ready')` fails, vitest tells you
"expected 'loading' to be 'ready'." That's not a debugging tool — it's
a riddle.

This package leans on Directive's already-shipped
`system.observe(observer)` lifecycle stream and renders the recorded
trace inline with the failure. Now you see:

```
──────── Directive timeline for FAIL ────────
load completes → ready
Timeline 'load completes → ready' — 13 frames over 23ms
  [+0.1ms]    system.start
  [+0.1ms]    reconcile.start
  [+0.2ms]    fact.change status: "idle" → "loading"
  [+0.3ms]    constraint.evaluate load active=true
  [+0.4ms]    requirement.created FETCH_INITIAL (req-1)
  [+0.5ms]    resolver.start initialLoader (req-1)
  [+12.3ms]   resolver.error initialLoader: backend exploded
  [+12.4ms]   reconcile.end (0 completed)
```

Now the failure isn't a riddle. The resolver threw, the status fact
never advanced, the test correctly observed status="loading."

> **Frame-capture note.** `system.init` fires synchronously inside
> `createSystem(...)` — *before* you call `recordTimeline(sys, ...)`,
> so it is missed by any subscriber registered later. To include it,
> call `recordTimeline()` first against a stub-observable, or accept
> that captured frames begin at the next observable event (typically
> `system.start`). This is a Directive engine ordering, not a timeline
> bug.

## Quick start

### 1. Wire the reporter (vitest config)

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { TimelineReporter } from '@directive-run/timeline/reporter';

export default defineConfig({
  test: {
    reporters: ['default', new TimelineReporter()],
  },
});
```

### 2. Record in your test

```ts
import { expect, it } from 'vitest';
import { createSystem } from '@directive-run/core';
import { recordTimeline } from '@directive-run/timeline';

it('completes the load chain', async () => {
  const sys = createSystem({ module: createMyModule(deps) });
  recordTimeline(sys, { id: expect.getState().currentTestName! });

  sys.start();
  sys.events.LOAD();
  await flushAsync();

  expect(sys.facts.status).toBe('ready'); // ← if this fails, timeline prints
  sys.destroy();
});
```

That's it. The reporter looks up the timeline by the test's full name and
renders it on failure.

## Why this works

Every Directive `System` exposes `system.observe(observer)`, a typed
event stream of:

- `fact.change` — every fact write, with prev / next values
- `constraint.evaluate` — every constraint predicate run
- `requirement.created` / `requirement.met` / `requirement.canceled`
- `resolver.start` / `resolver.complete` / `resolver.error` — with
  duration on completion
- `effect.run` / `effect.error`
- `derivation.compute`
- `reconcile.start` / `reconcile.end`
- `system.init` / `start` / `stop` / `destroy`

This package subscribes to that stream and stamps each event with a
monotonic ms offset. The result is a complete causal trace of the
system's entire lifetime during the test.

No other state library has this for free. XState has the inspector but
it's a separate dev-tools surface, not a test-failure adjunct. RTK has
no equivalent. This is Directive's compounding advantage made visible.

## Manual / programmatic use

The recorder works without the reporter — useful if you want to inspect
a timeline mid-test or attach it to a custom error message:

```ts
import { recordTimeline, getTimeline, formatTimeline } from '@directive-run/timeline';

const sys = createSystem({ ... });
recordTimeline(sys, { id: 'load' });
sys.start();
sys.events.LOAD();
await flushAsync();

const out = formatTimeline(getTimeline('load'), { color: false, maxFrames: 30 });
console.log(out);
```

`withTimeline(id, sys, fn)` is a convenience wrapper that auto-stops
recording when the inner block resolves (or throws):

```ts
import { withTimeline } from '@directive-run/timeline';

await withTimeline('my-test', sys, async () => {
  sys.start();
  sys.events.START();
  await flushAsync();
  expect(sys.facts.status).toBe('done');
});
```

## API

### `recordTimeline(system, { id })`
Subscribe to `system.observe()`, push every event into a named timeline.
Returns a `Timeline` with a `stop()` method. Calling with the same `id`
twice replaces the previous recording.

### `getTimeline(id) → Timeline | undefined`
Look up a recorded timeline by ID.

### `clearTimeline(id)`
Drop a single timeline from the registry.

### `clearAllTimelines()`
Drop all recorded timelines. Useful in test global setup.

### `withTimeline(id, system, fn)`
Convenience wrapper — records around an async block; auto-stops on
resolve / throw.

### `formatTimeline(timeline, opts?) → string`
Render a recorded timeline as a multi-line trace. Options:

| Option | Default | Notes |
|---|---|---|
| `color` | TTY auto-detect | ANSI color escapes |
| `maxFrames` | 200 | Truncates long timelines, prints "… N more frames elided" |
| `include` | all | Filter by event kind: `['fact.change', 'resolver.start']` |
| `valuePreviewLen` | 80 | Truncate fact-change value strings |

### `TimelineReporter` (from `@directive-run/timeline/reporter`)
Vitest reporter. On test failure, looks up the timeline by the test's
full name and prints. Constructor accepts the same `FormatOptions` plus
`alwaysPrint: true` to print on pass too (useful when a test "passes" but
you suspect it's not exercising what you expect).

## Performance notes

- **No production cost.** The recorder only fires when you call
  `recordTimeline()`. Don't import this in your app code; only test files
  and devtools.
- **Bounded memory.** Each frame is a small object (timestamp + event).
  500 frames per test ≈ 50 KB. The registry holds completed timelines
  until you call `clearTimeline` / `clearAllTimelines`. For long test
  runs, add `afterEach(() => clearAllTimelines())`.
- **No fact deep-cloning by default.** Fact-change frames hold the
  *references* the engine emits. If your test mutates a fact's nested
  contents after the change, the timeline will show the mutated state,
  not the at-event state. For the strict at-event view, use
  `JSON.parse(JSON.stringify(value))` snapshots in your handlers.

## Roadmap

v0.1 ships the recorder + formatter + vitest reporter. Future versions
explore:

- **v0.2** — interactive scrubbing: pipe failures into a CLI prompt
  with `n`/`p` to step forward/back through frames, showing the facts
  snapshot at each step. (Foundation: facts at frame N can be
  reconstructed by replaying frames 0..N from `system.init`.)
- **v0.3** — web UI: a small static page (served via vitest UI plugin)
  that renders the timeline as a swim-lane diagram. Same data; richer
  rendering.
- **v0.4** — diff mode: compare two timelines (CI failing vs local
  passing) and highlight the divergence point.

These all rest on the v0.1 recorder. If the data model is right, the
frontends compose.

## See also

- [`@directive-run/core` `system.observe()`](https://docs.directive.run/api/system#observe) — the substrate
- [`@directive-run/devtools-plugin`](https://docs.directive.run/plugins/devtools) — runtime inspector (orthogonal: that's for live apps; this is for test failures)
- [Testing chained pipelines](https://docs.directive.run/testing/chained-pipelines)

## License

MIT OR Apache-2.0
