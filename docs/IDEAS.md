# Directive — Innovation Backlog

Game-changer ideas surfaced during AE-review-loop rounds. These pass the
"FUCK YES, build that NOW" filter — they would compound on what just
landed and have viral-demo potential. Ranked by `viral × speed × impact`.

Each entry: pitch · viral angle · effort estimate · pre-mortem · what it
unlocks next.

---

## R1.A — `directive replay <prod-error-id>` → auto-derived vitest from a serialized timeline frame stream

**[v0.1 SCAFFOLD SHIPPED 2026-04-29 — `@directive-run/timeline@0.2.0`]**

**Status:** v0.1 scaffold shipped in commit `b63f4a94`. `serializeTimeline()` + `deserializeTimeline()` + `replayTimeline()` round-trip a recorded timeline through JSON and re-dispatch its `MUTATE`-shaped frames against a fresh system. v0.2 (auto-derived vitest source codegen + determinism gate + mock-stub generation from recorded resolver pairs) deferred — the value-layer is the foundation.

**Pitch:** Ship a `serializeTimeline()` + `replayTimeline()` pair plus a
`directive replay` CLI command. A user's prod error handler dumps the
last 30 seconds of timeline frames as JSON. CLI takes that JSON and
generates a *passing failing vitest file* that reproduces the bug
deterministically — events fire in original order, virtual clock
advances to original `ts` deltas, mutator dispatches replay
byte-for-byte.

**Karpathy angle:** "I clicked a button in production, hit an error,
pasted the error ID into my CLI, and got a failing test in my IDE 4
seconds later. I didn't write a repro. The library wrote it from the
causal graph." This is the time-travel debugger that React/Redux/XState
never delivered, with the kicker that the output is a real test file
that lives in the repo forever.

**The substrate is already complete:**
- Timeline frames are typed `ObservationEvent`s — already JSON-serializable
- Mutator events have a stable discriminator (`kind`) — replay knows what to dispatch
- RFC 0001's `virtualClock` advances deterministically
- Missing: `frames → vitest source string` codegen + `--from-prod-json` adapter

**Pre-mortem:**
- Frames containing non-serializable values (functions, DOM nodes, file
  handles) silently diverge → lean on optimistic's existing JSON-roundtrip
  contract. Document loudly.
- Resolvers that touch external services (deps closures) need mocking →
  codegen emits `vi.mock(...)` stubs derived from the recorded
  `resolver.start` / `resolver.complete` pair (input → output is
  observable in the timeline).

**Compound effect:**
- "Replay-as-bug-report" — Sentry/PostHog integration; every error ships
  with a replay file
- "Replay-as-fixture" — record once, persist, run as regression test
  forever (unlocks property-test-style fuzz over recorded scenarios)
- "Time-travel REPL in devtools" — same serialization pipeline drives
  the in-browser scrubber Phase 5 wants
- "Diff two timelines" — golden-master testing for state machines

**Why it tops the rank:** viral × speed × impact all max. Two days, one
screencast, hits every JS engineer's "I wish I could just replay the bug"
pain.

---

## R1.B — `expect(timeline).toReachIn(N).ms('status', 'ready')` causal-graph vitest matchers

**[v0.1 SHIPPED 2026-05-01 — `@directive-run/timeline/matchers` subpath]**

Five matchers landed: `toReachInMs`, `toFireConstraint`, `toMutate`,
`toResolveWithinMs`, `toCascade`. Surface name shifted from the
fluent `.toReachIn(N).ms(...)` builder to flat
`.toReachInMs(key, value, ms)` for cleaner vitest `expect.extend`
ergonomics. v0.2 (richer caused-by edge tracking for `toCascade`,
`thenReach` chaining) deferred — the v0.1 surface covers the
high-value assertions from the AE-review-loop pitch.

**Pitch:** A `@directive-run/timeline/matchers` vitest extension. Instead
of `expect(sys.facts.x).toBe(y)` (state at a point), assert *causal*
facts:

```ts
expect(timeline).toReachIn(50).ms('status', 'ready');
expect(timeline).toFireConstraint('pendingMutation').exactly(1).times();
expect(timeline).toMutate('submit').thenReach('values', expectedValues);
expect(timeline).notToCascade(); // no constraint fires another mutation
```

**Karpathy angle:** XState's `model.testFromEvents` was *the*
differentiator. This is one better — assertions over the causal graph
the engine already records. No state library on npm has this.

**Pre-mortem:** Matcher API surface is large — easy to ship 30 verbs
nobody uses. Mitigation: ship 5 (`toReachIn`, `toFireConstraint`,
`toMutate`, `toCascade`, `toResolve`); document each with a real
Minglingo bug it would have caught.

**Compound effect:** Foundation for property-based testing over the
causal graph (fast-check generators that emit event sequences and assert
invariants like "no constraint ever fires forever"). Same matchers run
on prod replays from R1.A.

---

## R1.C — `defineMutator.cancellable()` virtual-clock-aware automatic mutation cancellation when superseded

**[v0.1 SHIPPED 2026-05-01 — `@directive-run/mutator@0.2.0`]**

`cancellable(opts, handler)` HOC ships in mutator. Handler receives
`signal: AbortSignal`; two cancellation triggers
(`supersedeOn: 'self'|'never'` and `timeoutMs`). The signal's reason
carries a typed `CancelReason` enum. Pass `virtualClock.setTimeout`
for deterministic test timing — timeouts fire under
`clock.advanceBy()` with no real-time waits. 9 new tests cover basic
invocation, supersession (both modes), timeout (with virtualClock),
supersession+timeout composition, and HOC independence.

**Pitch:** Today's mutator overwrites `pendingMutation` if a new MUTATE
arrives mid-flight, but the in-flight handler still runs to completion
(and its `await deps.submit(...)` still hits the network). Add
`cancellable()`: every mutation handler receives a `signal: AbortSignal`
that fires when a new MUTATE supersedes it OR when an explicit `t.timer`
countdown expires:

```ts
const mut = defineMutator<MyMutations, MyFacts>({
  search: cancellable(
    { supersedeOn: 'self', timeoutMs: 3_000 },
    async ({ payload, signal, facts }) => {
      facts.results = await fetch(`/q?${payload.q}`, { signal })
        .then(r => r.json());
    },
  ),
});
```

**Karpathy angle:** This is what *every* type-ahead search has been
hand-rolling badly for a decade. With timer + mutator + timeline, you
get **provably-correct cancel-on-supersede with a 3-line declaration,
deterministic under virtual clock in tests, visible on the timeline**.

**Pre-mortem:** AbortSignal contract is sneaky — handlers need to
actually pass `signal` to fetch/etc., otherwise cancellation is a lie.
Mitigation: dev-mode warning when a handler ignores `signal` for >100ms.

**Compound effect:** Same primitive handles debounce, throttle, request
deduplication. RFC 0001 explicitly punted on these as "compose from
primitives" — this is the composition.

---

## R1.D — `directive.devtools/timeline-stream` live timeline streamed over WebSocket to a browser scrubber

**[1 week]**

**Pitch:** A 200-line server-side adapter pipes `system.observe()` to a
WebSocket; a 500-line React app renders the live timeline as a scrubber
with frame-by-frame fact diffs, virtual-clock controls, and
"jump to frame N → snapshot facts" preview. Distributed as
`@directive-run/devtools-timeline`.

**Karpathy angle:** Redux DevTools but with **causality** instead of just
action history — you see *why* a fact changed (which constraint fired,
which resolver ran, which derivation invalidated). Plus the virtual-clock
scrubber. Two months early on Phase 5.

**Pre-mortem:** UI work eats time. Ship terminal-only first
(`formatTimeline` + `blessed`), then port to web.

**Compound effect:** Becomes the canonical Directive marketing surface
(HN front-page screenshot). R1.A's prod-replay JSON becomes the import
format for the scrubber.

---

## R1.E — `defineMutator.invariant(...)` runtime-enforced "during mutation X, fact Y can only transition through this set"

**[1 week — risky scope]**

**Pitch:** Add a fluent invariant API to mutator:

```ts
defineMutator<...>({
  submit: withOptimistic<F>(['values'])(...),
}).invariant('submit', {
  facts: ['status'],
  allowedTransitions: ['idle→submitting', 'submitting→success', 'submitting→error'],
  maxDurationMs: 5_000, // virtual clock
});
```

…compiles into a constraint that watches the timeline during the
mutation's lifetime and *throws synchronously* in dev if the transition
is illegal. Prod logs but doesn't throw.

**Karpathy angle:** "I declared a partial state machine *inside my
mutation*. The library tells me at dev time when a refactor introduces
an illegal transition I never specified. It's like TLA+ but as a
JSDoc-friendly fluent API."

**Pre-mortem:** Risk of becoming a worse XState by accident — if
invariants compose to a full FSM users will demand visualization,
hierarchical states, etc. Mitigation: scope-cap aggressively. One
invariant per mutation. No nesting.

**Compound effect:** Generates Mermaid state diagrams from invariants
automatically (timeline already has the data). Becomes the documentation
primitive.

---

## Ranked

| Rank | Idea | Days | Viral | Compound | Tag |
|---|---|---|---|---|---|
| 1 | **R1.A** — `directive replay` from prod error | 2 | Max | Max | **v0.1 SCAFFOLD SHIPPED** (timeline@0.2.0) |
| 2 | **R1.B** — Causal-graph vitest matchers | 2 | High | High | **v0.1 SHIPPED** (timeline/matchers) |
| 3 | **R1.C** — `cancellable()` mutator + timer | 2 | High | Med-High | **v0.1 SHIPPED** (mutator@0.2.0) |
| 4 | **R1.D** — Live timeline devtools scrubber | 7 | Max | High | Phase 5 pulled forward |
| 5 | **R1.E** — `.invariant()` runtime-checked transitions | 7 | Med-High | High | risky scope creep |

---

## R2.A-E — Second-order ideas surfaced after R1.A+B+C shipped

The substrate compounds. Five new candidates emerged from the post-ship innovation review — each only became cheap to build *because* the three R1 surfaces shipped together.

### R2.A — `directive bisect <good.json> <bad.json>` — git-bisect for timelines

**[SHIPPED — single-timeline v0.1, see `.changeset/r2a-bisect.md`]**
**[BUILD CANDIDATE — 2 days]** *(original tag, kept for context)*

Two serialized timelines, one passing, one failing. CLI binary-searches the frame delta, replays each midpoint, runs your matchers, prints "frame #47 (`MUTATE submit`) is the first divergence."

**Substrate dependency:** R1.A's `replayTimeline` (deterministic re-run of any prefix) + R1.B's matchers (pass/fail oracle). Without both, the midpoint-replay-and-assert loop is impossible.

**Pre-mortem:** non-determinism breaks bisection — every midpoint must produce the same outcome. Mitigate by refusing to bisect unless `replayTimeline(input)` twice matches byte-for-byte.

**Compound effect:** Seeds R2.C diff (same midpoint primitive). Foundation for "CI bisect bot."

### R2.B — `recordReplayable()` HOC: prod cancellable mutations auto-emit supersession-aware replay frames

**[1 day — quick win]**

Wrap `cancellable()` with `recordReplayable()`. Cancellation cause + the original payload that would have completed gets pinned into the timeline's serialized frame stream as a `cancel.reason` annotation. Replay reproduces the cancellation race exactly.

**Substrate dependency:** R1.C's `signal` + `CancelReason` (now `CancelError` post-R2 fix). R1.A's JSON round-trip. R1.B's matchers as the assertion form.

**Compound effect:** Cancellation races become first-class replayable bugs. Combined with R2.A, prod typeahead bugs become 2-line CI repros.

### R2.C — `directive timeline diff <a.json> <b.json>` — semantic causal-graph diff

**[2 days]**

Not a textual JSON diff — a causal one. "Run B fired constraint `pendingMutation` 3 extra times Run A didn't. Run B has a new cascade edge." Output is structured + a Mermaid sequence diagram.

**Substrate dependency:** Both inputs are R1.A serialized timelines. The diff vocabulary IS R1.B's matchers inverted into reporters.

**Compound effect:** Killer review surface for PRs that touch state. Foundation for R1.D scrubber rendering two timelines side-by-side.

### R2.D — Sentry/PostHog adapter → CI auto-PR with matcher-based test

**[1 week — flywheel]**

Drop-in `@directive-run/sentry` attaches `serializeTimeline()` to every Sentry breadcrumb. GitHub Action consumes new Sentry issues, runs `directive replay --as-test`, opens a PR with a failing vitest using R1.B matchers. Engineer reviews, fixes, merges.

**Karpathy angle:** "Production errors arrive as failing PRs. I never write repro steps."

**Substrate dependency:** R1.A serialize + the v0.2 codegen IDEAS deferred. Critically, the *generated test body* uses R1.B matchers (not brittle `toBe` assertions) — without matchers, auto-generated tests are fragile point-state checks.

**Pre-mortem:** auto-PR noise hell at high-cardinality. Mitigate by deduping on causal-graph hash (shape, not values). PII story needed: ship `redactTimeline()` alongside.

**Compound effect:** This is the *flywheel*. Every prod error ships a deterministic test. Drives the matcher library toward real-world idioms (drives R1.B v0.2). Replay archive becomes a corpus for property-testing fuzzers (R2.E territory).

### R2.E — Property-test generator: `forAllTimelines((events) => expect(timeline).notToCascade())`

**[1 week]**

A `@directive-run/test-utils/fast-check` adapter. Define legal event arbitraries; the runner generates 1000 sequences, replays each, asserts matcher invariants. Counter-example emits a serialized timeline JSON identical to R1.A's prod-replay format — same shrinker, same playback.

**Substrate dependency:** Replay (R1.A) is the engine. Matchers (R1.B) are the invariants. Cancellable's deterministic AbortSignal under virtualClock (R1.C) is what makes 1000 trial replays not flake on async races.

**Compound effect:** Closes the loop — replay JSON is the exchange format for prod errors (R2.D), bisect inputs (R2.A), diff inputs (R2.C), AND fuzzer outputs (R2.E). One serialization spec, four entry points.

### R2 ranked

| Rank | Idea | Days | Viral | Compound | Tag |
|---|---|---|---|---|---|
| 1 | **R2.A** — `directive bisect` over timelines | 2 | Max | Max | **BUILD CANDIDATE** |
| 2 | **R2.D** — Sentry → auto-PR with matcher-based test | 7 | Max | Max | flywheel |
| 3 | **R2.B** — `recordReplayable()` cancel-aware replay HOC | 1 | High | High | quick win |
| 4 | **R2.C** — Causal-graph timeline diff CLI | 2 | High | High | review surface |
| 5 | **R2.E** — fast-check property tests over timelines | 7 | Med-High | Max | exchange-format payoff |

**R2.A is the asymmetric pick** — same structure as R1.A, R1.B, R1.C: 2 days, runs entirely on already-shipped surface, demo writes itself ("upload two JSONs, get the divergence frame"). Seeds R2.C and validates the determinism guarantees R2.D and R2.E both lean on.

**Recommendation:** R1.A is the asymmetric-payoff pick. Two days, one
screencast, solves a problem every engineer has every week. The
substrate (typed observation events + virtual clock + serializable
mutator dispatch) just landed *together* — that's the moment to build
this.
