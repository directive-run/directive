# `@directive-run/timeline`

> Time-travel test REPL for Directive. When a test fails, it auto-prints
> the full causal chain that got the system into the failing state.

```sh
npm install --save-dev @directive-run/timeline
```

## What it solves

When `expect(sys.facts.status).toBe('ready')` fails, vitest tells you
"expected 'loading' to be 'ready'." That's not a debugging tool – it's
a riddle.

This package leans on Directive's already-shipped
`system.observe(observer)` lifecycle stream and renders the recorded
trace inline with the failure. Now you see:

```
──────── Directive timeline for FAIL ────────
load completes → ready
Timeline 'load completes → ready' – 8 frames over 23ms
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
> `createSystem(...)` – *before* you call `recordTimeline(sys, ...)`,
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

- `fact.change` – every fact write, with prev / next values
- `constraint.evaluate` – every constraint predicate run
- `requirement.created` / `requirement.met` / `requirement.canceled`
- `resolver.start` / `resolver.complete` / `resolver.error` – with
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

The recorder works without the reporter – useful if you want to inspect
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
Convenience wrapper – records around an async block; auto-stops on
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

## Causal-graph vitest matchers (R1.B)

Five matchers for asserting against the *causal chain* a Directive
system produced – not just final state. Subpath import:

```ts
// vitest.setup.ts
import '@directive-run/timeline/matchers';
```

Or explicit registration:

```ts
import { expect } from 'vitest';
import { registerMatchers } from '@directive-run/timeline/matchers';
registerMatchers(expect);
```

Then in tests:

```ts
import { recordTimeline } from '@directive-run/timeline';

it('completes in under 50ms with no cascade', async () => {
  const t = recordTimeline(sys, { id: 'fast' });
  sys.start();
  sys.events.LOAD();
  await flushAsync();

  expect(t).toReachInMs('status', 'ready', 50);     // fact reached value
  expect(t).toFireConstraint('load');                // fired ≥1 time
  expect(t).toFireConstraint('load', { times: 1 }); // exactly N
  expect(t).toResolveWithinMs('initialLoader', 50); // resolver budget
  expect(t).toMutate('submit');                      // mutator dispatch
  expect(t).not.toCascade();                         // ≥2 constraints same cycle
});
```

Each matcher operates on the recorded `ObservationEvent` stream – the
same data the formatter renders and `replayTimeline` re-dispatches. No
other state library has assertion-against-causal-graph for free.

## Serialize, replay, bisect, diff

Recorded timelines are **JSON-serializable**. The package ships four
operational entry points that all consume that same JSON:

### `serializeTimeline()` + `replayTimeline()` – re-dispatch a recorded run

```ts
import {
  serializeTimeline,
  deserializeTimeline,
  replayTimeline,
} from '@directive-run/timeline';

// Production: dump the last N seconds of timeline alongside the error.
const json = JSON.stringify(serializeTimeline(timeline));
await fetch('/bug-reports', { method: 'POST', body: json });

// Local repro: parse the JSON, build a fresh system with the SAME
// module shape, replay the recorded events.
const incoming = deserializeTimeline(JSON.parse(prodErrorJson));
const sys = createSystem({ module: createSameModuleAsProd() });
sys.start();
const result = await replayTimeline(incoming, sys);
// result is { dispatched, skipped, truncated } – verify the replay
// actually re-fired what you expected.
```

CLI equivalent: `directive replay bug.json --system test/system.ts`.

Replay walks frames in order and re-dispatches anything that maps to a
known dispatchable surface (today: `@directive-run/mutator`-shaped
`pendingMutation` fact.change frames). Non-dispatchable frames
(`system.start`, `reconcile.start`, `derivation.compute`, ...) are
skipped by default – opt out with `{ dispatchableOnly: false }` for
diagnostic walks.

### `bisectTimeline()` – git-bisect for timelines (R2.A)

Binary-search a recorded timeline for the first frame whose inclusion
flips a user-supplied assertion from passing to failing.

```ts
import { bisectTimeline, deserializeTimeline } from '@directive-run/timeline';

const bad = deserializeTimeline(JSON.parse(prodCrashJson));
const result = await bisectTimeline(
  bad,
  // Factory: bisect calls this once per midpoint to get a fresh system.
  () => {
    const sys = createSystem({ module: counterModule });
    sys.start();
    return sys;
  },
  // Oracle: true = good prefix, false = bad prefix.
  (sys) => sys.facts.score >= 0,
);

if (result.firstFailingFrameIndex !== undefined) {
  console.log(`first failing frame: #${result.firstFailingFrameIndex}`);
} else if (result.noFailureFound) {
  console.log('assertion never fails – wrong oracle?');
} else if (result.failsOnEmptyReplay) {
  console.log('bug is in initialization – bisect cannot narrow further');
} else if (result.nonDeterministic) {
  console.log('two full replays disagreed – fix determinism first');
}
```

CLI equivalent: `directive bisect bug.json --system factory.ts --assert 'facts.score >= 0'`.

**Cost:** O(log N) replays of up to N frames each, plus two
full-timeline replays for the determinism gate. The dominant cost in
practice is the **factory** – your `createSystem + start + initial reconcile`
runs ~log₂(N) times. Keep the factory cheap (lazy DB/network init,
no real I/O in module factories) or expect bisect of large timelines
to take seconds.

### `diffTimelines()` – semantic causal-graph diff (R2.C)

Compare two serialized timelines as a structured causal-graph report.
Not a textual JSON diff – a per-category delta.

```ts
import { diffTimelines, deserializeTimeline } from '@directive-run/timeline';

const a = deserializeTimeline(JSON.parse(goodJson));
const b = deserializeTimeline(JSON.parse(badJson));
const diff = diffTimelines(a, b);

if (diff.identical) {
  console.log('semantically identical');
} else {
  for (const c of diff.constraintFires) {
    console.log(`'${c.id}': ${c.aCount} → ${c.bCount} (${c.delta > 0 ? '+' : ''}${c.delta})`);
  }
  for (const m of diff.mutations) {
    console.log(`mutation '${m.id}': ${m.aCount} → ${m.bCount}`);
  }
  for (const r of diff.resolverRuns) {
    console.log(`resolver '${r.resolver}': errors ${r.aErrors}→${r.bErrors}`);
  }
}
```

CLI equivalent: `directive timeline diff a.json b.json` (exit 0 = identical, 2 = differences, 1 = error).

The diff vocabulary mirrors the matcher vocabulary inverted into
reporters: `toFireConstraint(id, count)` ↔ `diff.constraintFires`,
`toMutate(kind)` ↔ `diff.mutations`, `toResolveWithinMs(resolver)` ↔
`diff.resolverRuns`. Same buckets, opposite direction.

## Roadmap

v0.2 ships the recorder + formatter + vitest reporter + serialize +
replay + bisect + diff + matchers. Shipped surfaces compose: one JSON
spec, four operational entry points.

Future versions explore:

- **v0.3** – interactive scrubbing: pipe failures into a CLI prompt
  with `n`/`p` to step forward/back through frames, showing the facts
  snapshot at each step.
- **v0.4** – web UI: a small static page that renders the timeline as
  a swim-lane diagram. Same data; richer rendering.
- **v0.5** – Mermaid sequence-diagram emitter for `diffTimelines`
  (PR-comment-friendly causal diff visualization).
- **v0.5** – first-class `event.dispatch` ObservationEvent support
  (today replay/diff coupling is mutator-shape-based; core will land
  the canonical wire format).

These all rest on the recorder + JSON. If the data model is right,
the frontends compose.

## Composes with

- [`@directive-run/mutator`](../mutator) — every mutation cycle records into the timeline; replay a failed test's exact mutation sequence
- [`@directive-run/optimistic`](../optimistic) — captures optimistic writes AND rollbacks, so flaky tests reproduce byte-for-byte
- [`@directive-run/query`](../query) — recorded refetches and tag invalidations turn data-fetching tests into deterministic replays
- [`@directive-run/core` `system.observe()`](https://docs.directive.run/api/system#observe) — the substrate
- [`@directive-run/devtools-plugin`](https://docs.directive.run/plugins/devtools) — runtime inspector (orthogonal: that's for live apps; this is for test failures)

## Use this package with your AI assistant

Recorded timelines make AI debugging reproducible byte-for-byte — when an AI assistant proposes a fix to a flaky test, the timeline tells you whether the fix actually changes the failing event sequence. Pair with [Directive's IDE Integration](https://directive.run/docs/ide-integration).

```
# Claude Code
/plugin marketplace add directive-run/directive
/plugin install directive@directive-plugins

# Cursor / Copilot / Windsurf / Cline / Codex
npx directive ai-rules init
```

## See also

- [Testing chained pipelines](https://docs.directive.run/testing/chained-pipelines)

## License

MIT OR Apache-2.0
