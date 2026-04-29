# Directive — Innovation Backlog

Game-changer ideas surfaced during AE-review-loop rounds. These pass the
"FUCK YES, build that NOW" filter — they would compound on what just
landed and have viral-demo potential. Ranked by `viral × speed × impact`.

Each entry: pitch · viral angle · effort estimate · pre-mortem · what it
unlocks next.

---

## R1.A — `directive replay <prod-error-id>` → auto-derived vitest from a serialized timeline frame stream

**[BUILD CANDIDATE — 2 days]**

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

**[2 days]**

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

**[2 days]**

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
| 1 | **R1.A** — `directive replay` from prod error | 2 | Max | Max | **BUILD CANDIDATE** |
| 2 | **R1.B** — Causal-graph vitest matchers | 2 | High | High | strong follow-on |
| 3 | **R1.C** — `cancellable()` mutator + timer | 2 | High | Med-High | killer for type-ahead |
| 4 | **R1.D** — Live timeline devtools scrubber | 7 | Max | High | Phase 5 pulled forward |
| 5 | **R1.E** — `.invariant()` runtime-checked transitions | 7 | Med-High | High | risky scope creep |

**Recommendation:** R1.A is the asymmetric-payoff pick. Two days, one
screencast, solves a problem every engineer has every week. The
substrate (typed observation events + virtual clock + serializable
mutator dispatch) just landed *together* — that's the moment to build
this.
