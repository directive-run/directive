# `@directive-run/timeline` – time-travel test REPL for Directive

> When a test fails, vitest tells you "expected 'loading' to be 'ready'."
> That's a riddle, not a debugging tool. This package records the full
> causal chain – every fact change, constraint evaluation, requirement,
> resolver run – and prints it inline with the failure.

## What it solves

Directive systems already expose `system.observe(observer)` – a typed
stream of every lifecycle event the runtime emits. Timeline subscribes
to that stream, stamps each event with a monotonic ms offset, and stores
the result in a named registry. On test failure, the vitest reporter
looks up the timeline by the test's full name and renders it:

```
Timeline 'load completes → ready' – 8 frames over 23ms
  [+0.1ms]    system.start
  [+0.1ms]    reconcile.start
  [+0.2ms]    fact.change status: "idle" → "loading"
  [+0.3ms]    constraint.evaluate load active=true
  [+0.4ms]    requirement.created FETCH_INITIAL (req-1)
  [+0.5ms]    resolver.start initialLoader (req-1)
  [+12.3ms]  resolver.error initialLoader: backend exploded
  [+12.4ms]  reconcile.end (0 completed)
```

The failure isn't a riddle anymore. The resolver threw, the status fact
never advanced, the test correctly observed `status: "loading"`.

## Setup

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { TimelineReporter } from "@directive-run/timeline/reporter";

export default defineConfig({
  test: {
    reporters: ["default", new TimelineReporter()],
  },
});
```

```ts
// in a test file
import { expect, it } from "vitest";
import { createSystem } from "@directive-run/core";
import { recordTimeline } from "@directive-run/timeline";

it("completes the load chain", async () => {
  const sys = createSystem({ module: createMyModule(deps) });
  recordTimeline(sys, { id: expect.getState().currentTestName! });

  sys.start();
  sys.events.LOAD();
  await flushAsync();

  expect(sys.facts.status).toBe("ready");
  // → if this fails, the reporter prints the full causal trace above
  sys.destroy();
});
```

That's it. The reporter looks up the timeline by the test's full name
and renders on failure.

> **Frame-capture note.** `system.init` fires synchronously inside
> `createSystem(...)` – *before* you call `recordTimeline(sys, …)`, so
> it is missed by any subscriber registered later. Captured frames begin
> at the next observable event (typically `system.start`). This is a
> Directive engine ordering, not a timeline bug.

## API

| Symbol | What |
| --- | --- |
| `recordTimeline(system, { id })` | Subscribe to `system.observe()`; returns a `Timeline` with `stop()`. Calling with the same `id` twice replaces the prior recording. |
| `getTimeline(id)` | Look up by ID. Returns `Timeline \| undefined`. |
| `clearTimeline(id)` | Drop one entry. |
| `clearAllTimelines()` | Drop everything. Useful in `afterEach`. |
| `withTimeline(id, system, fn)` | Convenience wrapper; auto-stops on resolve / throw. |
| `formatTimeline(timeline, opts?)` | Render as multi-line text. |
| `serializeTimeline(timeline)` | JSON-safe export – post to a bug tracker, attach to a Sentry event. |
| `deserializeTimeline(input)` | Parse + structurally validate; throws on malformed input. |
| `replayTimeline(timeline, system, opts?)` | Re-dispatch recorded frames against a fresh system. |
| `bisectTimeline(timeline, factory, assertion, opts?)` | Binary-search a timeline for the first frame that flips an assertion. |
| `diffTimelines(a, b)` | Semantic causal-graph diff – count deltas, not JSON text diff. |
| `setRegistryCap(n)` | Adjust the LRU eviction cap (default 500). |

## Examples

### Vitest matchers – assert against the causal chain

Subpath import wires five matchers that read the recorded
`ObservationEvent` stream:

```ts
// vitest.setup.ts
import "@directive-run/timeline/matchers";
```

```ts
import { recordTimeline } from "@directive-run/timeline";

it("completes in under 50ms with no cascade", async () => {
  const t = recordTimeline(sys, { id: "fast" });
  sys.start();
  sys.events.LOAD();
  await flushAsync();

  expect(t).toReachInMs("status", "ready", 50);     // fact reached value
  expect(t).toFireConstraint("load");               // fired ≥ 1 time
  expect(t).toFireConstraint("load", { times: 1 }); // exactly N
  expect(t).toResolveWithinMs("initialLoader", 50); // resolver budget
  expect(t).toMutate("submit");                      // mutator dispatch
  expect(t).not.toCascade();                         // ≥ 2 constraints same cycle
});
```

### Serialize for prod – replay in dev

Recorded timelines are JSON-roundtrippable:

```ts
import {
  serializeTimeline,
  deserializeTimeline,
  replayTimeline,
} from "@directive-run/timeline";

// Production: dump the last N frames alongside the error.
const json = JSON.stringify(serializeTimeline(timeline));
await fetch("/bug-reports", { method: "POST", body: json });

// Local repro: build a fresh system with the SAME module shape, replay.
const incoming = deserializeTimeline(JSON.parse(prodErrorJson));
const sys = createSystem({ module: createSameModuleAsProd() });
sys.start();
const result = await replayTimeline(incoming, sys);
// → { dispatched: 4, skipped: 12, truncated: 0 }
```

`replayTimeline` walks frames in order. Today, "dispatchable" means
`@directive-run/mutator`-shaped `pendingMutation` fact-change frames –
core will land first-class `event.dispatch` recording in a later cycle.
Non-dispatchable frames (`system.start`, `reconcile.start`,
`derivation.compute`, …) are skipped by default; opt out with
`{ dispatchableOnly: false }` for diagnostic walks.

**Only frames your program authored are re-dispatched.** Every
`fact.change` frame carries an `origin` – `authored`, `restore` or
`hydrate` – and replay skips anything that is not `authored`. A restored
frame is the *result* of an action rather than the action, so dispatching
it would apply the mutation a second time: a timeline containing an undo
would replay as two mutations where the user made one. `toMutate` counts
authored frames for the same reason. A timeline recorded before `origin`
existed replays unchanged, because replayed writes could not be recorded
then.

In rendered output a non-authored frame is marked:

```
[+12.0ms]   cartTotal: 120 → 75 (restored)
[+0.1ms]    session: null → {…} (hydrated)
```

### Bisect for non-determinism – git-bisect over frames

```ts
import { bisectTimeline, deserializeTimeline } from "@directive-run/timeline";

const bad = deserializeTimeline(JSON.parse(prodCrashJson));
const result = await bisectTimeline(
  bad,
  () => {
    const sys = createSystem({ module: counterModule });
    sys.start();
    return sys;
  },
  (sys) => (sys as { facts: { score: number } }).facts.score >= 0,
);

switch (result.kind) {
  case "found":
    console.log(`first failing frame: #${result.firstFailingFrameIndex}`);
    break;
  case "no-failure":
    console.log("assertion never fails – wrong oracle?");
    break;
  case "fails-on-empty":
    console.log("bug is in initialization – bisect cannot narrow further");
    break;
  case "non-deterministic":
    console.log("two full replays disagreed – fix determinism first");
    break;
}
// → "first failing frame: #47"
```

The default `determinismCheck: true` runs the full-timeline replay twice
before searching and refuses to bisect if the two runs disagree. Without
that gate the midpoint search picks an arbitrary direction at each step
and lies confidently. Cost is `O(log N)` replays, each up to `N` frames –
a 10k-frame timeline takes ~14 replays of ~5k frames each. Keep the
factory cheap (no real I/O in module factories).

### Diff – semantic causal-graph compare

```ts
import { diffTimelines, deserializeTimeline } from "@directive-run/timeline";

const a = deserializeTimeline(JSON.parse(goodJson));
const b = deserializeTimeline(JSON.parse(badJson));
const diff = diffTimelines(a, b);

if (diff.identical) {
  console.log("semantically identical");
  // → "semantically identical"
} else {
  for (const c of diff.constraintFires) {
    console.log(`'${c.id}': ${c.aCount} → ${c.bCount} (${c.delta})`);
  }
  for (const r of diff.resolverRuns) {
    console.log(`resolver '${r.resolver}': errors ${r.aErrors}→${r.bErrors}`);
  }
}
// → "'canCheckout': 1 → 3 (+2)"
// → "resolver 'submit': errors 0→1"
```

The diff vocabulary mirrors the matchers inverted into reporters:
`toFireConstraint(id, count)` ↔ `diff.constraintFires`,
`toMutate(kind)` ↔ `diff.mutations`,
`toResolveWithinMs(resolver)` ↔ `diff.resolverRuns`. Same buckets,
opposite direction.

### Edge case: long timelines truncate cleanly

```ts
const out = formatTimeline(getTimeline("load"), { maxFrames: 30 });
// Timeline 'load' – 30 frames over 1.2s
//   [+0.1ms]   system.start
//   ...
//   … (170 more frames elided; raise maxFrames to see all)
```

`replayTimeline` also caps at `DEFAULT_MAX_REPLAY_FRAMES` (100,000) by
default – a malicious prod-error JSON dump can't run an unbounded
synchronous loop in a worker. Adjust via `{ maxFrames: N }`.

## What it does NOT do

- ✅ Records every `ObservationEvent` the system emits after subscription.
- ✅ Survives `JSON.stringify` round-trip via `serializeTimeline`.
- ✅ Replays mutator-shaped dispatches against a fresh system.
- ✅ Bisects with a determinism gate.
- ❌ Not a production telemetry sink – import only in test files / devtools.
- ❌ Not a live inspector – pair with `@directive-run/devtools-plugin` for that.
- ❌ Does not capture `system.init` (fires before `recordTimeline` can subscribe).
- ❌ Does not deep-clone fact values – frames hold the references the engine emits. For an at-event snapshot, `JSON.parse(JSON.stringify(value))` in your handler.
- ❌ Does not auto-dispatch every event type today – only mutator-shaped `pendingMutation` writes (more arrive when core lands `event.dispatch`).

## Performance notes

- **Bounded memory.** Each frame is a small object (timestamp + event).
  500 frames ≈ 50 KB. The registry holds completed timelines until you
  call `clearTimeline` / `clearAllTimelines`. For long test runs add
  `afterEach(() => clearAllTimelines())`.
- **Registry cap.** Default 500 timelines; oldest evicted by insertion
  order. Tune via `setRegistryCap(n)`.
- **No production cost.** The recorder only fires when you call
  `recordTimeline()`. Don't import in app code.

## See also

- [Package README on GitHub](https://github.com/directive-run/directive/tree/main/packages/timeline)
- [`@directive-run/devtools-plugin`](https://docs.directive.run/plugins/devtools) – live inspector (orthogonal: that's for live apps; timeline is for test failures)
- [`createAuditLedger`](./audit-ledger.md) – the production-side equivalent for "why did this happen"
- [`@directive-run/mutator` `recordReplayable`](./mutator.md) – pins cancel events into facts so timeline replay can reason about them
