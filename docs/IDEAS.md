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

**[SHIPPED — see `.changeset/r2b-recordReplayable.md`]**
**[1 day — quick win]** *(original tag, kept for context)*

Wrap `cancellable()` with `recordReplayable()`. Cancellation cause + the original payload that would have completed gets pinned into the timeline's serialized frame stream as a `cancel.reason` annotation. Replay reproduces the cancellation race exactly.

**Substrate dependency:** R1.C's `signal` + `CancelReason` (now `CancelError` post-R2 fix). R1.A's JSON round-trip. R1.B's matchers as the assertion form.

**Compound effect:** Cancellation races become first-class replayable bugs. Combined with R2.A, prod typeahead bugs become 2-line CI repros.

### R2.C — `directive timeline diff <a.json> <b.json>` — semantic causal-graph diff

**[SHIPPED — count-based v0.1, see `.changeset/r2c-timeline-diff.md`]**
**[2 days]** *(original tag, kept for context)*

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

---

## R3 (AE Loop, PII Guardrails) — Game-Changer Ideas

Surfaced during the 5-round AE review loop on `@directive-run/ai` PII
guardrails. The detect/redact split turned PII into a composable fact
stream the constraint engine can react to — every idea below exploits that.

### G1 — `redactionLedger`: reversible, constraint-gated PII vault

**[2 days — viral MAX, compound MAX]**

`redactPII(text, items, { style: 'vault' })` returns redacted text *plus* a
sealed `RedactionLedger` mapping `[VAULT:abc123] → original`. A resolver
re-hydrates the original only when a constraint allows it
(`when: facts.userRole === 'support' && facts.ticketVerified`). The LLM
never sees raw PII; an authorized human downstream does — the runtime
decides who gets the truth.

**Demo:** card hits GPT-4 as `[VAULT:7f3a]`, OpenAI logs stay clean; a
verified support rep sees the real number snap back. Guardrails-AI loses
the data; NeMo blocks the turn. Directive makes redaction a reversible,
permissioned fact.

**Compound:** unlocks PII-safe RAG (vault tokens survive vector storage),
PII-safe eval traces (`redactTimeline()`), audit-trail correlation.

### G2 — `definePIIPolicy`: PII types as facts → constraint-driven routing

**[2 days — viral HIGH, compound MAX]**

`createPIIFactBridge()` feeds `facts.piiSeen = { ssn: 2, credit_card: 1 }`
into a Directive system every turn. Constraints react to data
classification: `when: f.piiSeen.medical_id > 0 → require SWITCH_MODEL to
on-prem`; `when: f.piiSeen.credit_card > 0 && f.region === 'EU' → HALT`.
Data sensitivity drives control flow declaratively — the pile of `if`
statements every regulated-industry team hand-rolls becomes constraints.

**Compound:** wires PII into `createConstraintRouter`; compliance mode
becomes a derivation.

### G3 — `directive pii-diff` + `toLeakNoPII()` CI matcher

**[2 days — viral HIGH, compound HIGH]**

`expect(agentOutput).toLeakNoPII()` and a CLI that scans prompt files /
recorded timelines: "commit a1b2c3 introduced a template that interpolates
`user.ssn` into the system prompt — 14/200 sessions leaked." PII safety
becomes a regression-tested property, not a runtime hope.

### G4 — `streamingPIIGuard`: mid-token-stream redaction

**[3 days — viral MAX, compound HIGH]**

A `StreamingGuardrail` that buffers a sliding token window, runs `detectPII`,
and rewrites tokens in-flight — a leaked SSN becomes `[REDACTED]` before
the last digit renders. Handles PII spanning chunk boundaries (the case
every post-hoc output validator misses).

### G5 — `piiReplay`: redacted, shareable PII-block repro

**[1 day — quick win]**

When a PII guardrail fires, emit a serialized timeline frame with the
offending input vault-redacted (via G1). `directive replay` reproduces the
block decision deterministically — debug a guardrail trip with zero real
PII in the repro. This is the `redactTimeline()` that R2.D's pre-mortem
flagged as a blocker.

### R3 ranked

| Rank | Idea | Days | Viral | Compound | Tag |
|---|---|---|---|---|---|
| 1 | **G1** — reversible constraint-gated vault redaction | 2 | Max | Max | **BUILD CANDIDATE** |
| 2 | **G2** — PII types as facts → constraint routing | 2 | High | Max | makes "constraint-driven AI safety" real |
| 3 | **G3** — `pii-diff` + `toLeakNoPII()` CI matcher | 2 | High | High | rides shipped test substrate |
| 4 | **G4** — mid-stream token-level PII redaction | 3 | Max | High | best demo, edge-case risk |
| 5 | **G5** — redacted PII-block replay | 1 | Med | High | unblocks R2.D flywheel |

**G1 is the asymmetric pick** — 2 days, the demo writes its own headline
("I sent a credit card to GPT-4 and it never saw it — but my verified
support rep still did"), and G4/G5 plus R2.D's `redactTimeline()` all
compound on the vault-ledger primitive. Suggested arc: G1 → G5 → G2.

**Common thread vs LangChain / NeMo / Guardrails-AI:** they treat PII as a
lossy, post-hoc, static *filter*. Directive treats PII as a *fact* —
reversible, permissioned, reactive, replayable, regression-tested.

---

## R4 (AE Loop, RFC-0004 Data-Form Predicates) — Game-Changer Ideas

Surfaced during the 4-round AE review loop on RFC-0004. Each idea exists
*only because* the predicate is now serializable data with `whenSpec` and
`whenExplain` exposed on `inspect()` / `observe()` / `explain()`.

### R4.A — `system.predict()`: the "what's holding this back" oracle

**[3 days — viral MAX, compound MAX, the asymmetric pick]**

`system.predict("transition")` walks a constraint's `whenSpec` against the
current facts and returns the smallest fact diff that would make it fire —
plus which constraints become reachable in the cascade:

```ts
system.predict("transition")
// {
//   willFireWhen: [{ path: "elapsed", op: "$gte", expected: 30, actual: 20, delta: "+10" }],
//   thenUnlocks: ["greenPhase", "yellowPhase"],
//   blockedBy:   ["paused (currently true)"],
// }
```

**Headline:** *"The state library that tells you which fact you need to
change to make your app do the next thing."* No other state library on npm
has this — Redux/Zustand have no constraints; XState guards are functions.
Symbolic execution for free, because the predicate is data.

**Compound:** powers a devtools panel ("hover any idle constraint → see
the literal change required"); seeds R4.B unreachability proofs (predict()
over empty fact set); foundation for R4.D AI repair-loops.

### R4.B — `directive doctor`: contradiction + unreachability static analysis

**[4 days — viral MAX, compound MAX, formal-methods endorsement bait]**

A CLI that walks all registered constraints, runs SMT-lite reasoning over
the predicate trees, and emits warnings:

- *"Constraints `pauseAll` and `transition` have contradictory `when`
  clauses on `paused` — `transition` can never fire while `pauseAll` is
  active."*
- *"`emergencyStop` is unreachable: no fact path leads to
  `priority > 9999`."*
- *"`require: { to: "red" }` is impossible — no resolver handles
  `TRANSITION{to:"red"}`."*

**Headline:** *"The first JS state library that proves your state machine
has no dead branches."* Pitches as "TLA+ lite, free, built-in." Real
formal verification you didn't ask for. HN/TLA+ community endorsement
bait.

**Compound:** becomes a `directive lint` CI rule; lets `predict()` reason
over future fact states; enables "constraint coverage" — what % of clause
combinations were exercised by tests/replays.

### R4.C — `@directive-run/visual-editor`: bidirectional predicate ⇆ React node-graph

**[5 days — viral MAX, compound HIGH]**

```tsx
<PredicateEditor
  whenSpec={system.inspect().constraints[0].whenSpec}
  schema={moduleSchema}
  onChange={(next) => system.constraints.assign("transition", { when: next })}
/>
```

A React component that renders a `FactPredicate` as a drag-and-drop node
graph (à la n8n / Retool's filter builder) and emits a valid
`FactPredicate` back. Round-trip is loss-free because the spec *is* the
data form.

**Headline:** *"The state library where product managers ship constraints."*
A 30-second screencast of a PM editing a feature-flag predicate live, no
code. The no-code primitive Retool/Zapier have been faking for 5 years —
here it's actually typed and actually-the-runtime-form.

**Compound:** SaaS angle (`directive.run/playground`); AI plugin ("rewrite
in plain English" → LLM emits next `FactPredicate` JSON); live editing in
devtools.

### R4.D — `predicateFromIntent()`: LLM writes typed predicates as data

**[3 days — viral MAX, compound MAX]**

```ts
predicateFromIntent({
  intent: "block checkout if cart is empty or user is unverified",
  schema: moduleSchema,
}) // → FactPredicate (typed against the schema)
```

The LLM emits a JSON predicate (not code — *data*). The runtime
type-checks the operator set against the schema (`$gte` on a boolean fact
→ rejected before execution) AND `directive doctor` (R4.B) verifies it
doesn't contradict existing constraints AND `predict()` (R4.A) tells you
which facts must change to make it fire.

**Headline:** *"LLM writes a rule. Type-checker says no. LLM tries again.
Two turns later, the rule is in production — and the runtime never
executed unsafe code."* The first state library where an LLM can safely
modify the running rules, because the output surface is a structurally
validated data form, not arbitrary code. Compare to tool-use-with-eval.

**Compound:** publishes a tool-spec preset for OpenAI / Anthropic
function-calling; closes the loop with R4.B (doctor verifies) and R4.A
(predict previews impact); foundation for self-modifying applications
bounded by the constraint system.

### R4.E — `directive coverage`: per-clause branch coverage for state logic

**[2 days — viral HIGH, compound HIGH, quick-win vitest reporter]**

Run vitest with the timeline recorder on; aggregate every `whenExplain`
payload across all tests; emit a per-clause coverage report:

```
paused $eq true        evaluated 0 times   — no test exercised this branch
elapsed $gte 30        evaluated 47 times  — 12 pass / 35 fail
```

**Headline:** *"Test coverage for state logic, not just lines of code.
lcov is 30 years old and still only knows about JS branches; Directive
knows about business branches."*

**Compound:** CI gate ("PRs must hit ≥N% clause coverage"); pairs with
R2.E fuzzer + R4.B doctor; drives users toward data-form predicates
(function `when` can't be measured this way).

### R4 ranked

| Rank | Idea | Days | Viral | Compound | Note |
|---|---|---|---|---|---|
| 1 | **R4.A** `predict()` | 3 | Max | Max | Asymmetric pick. Substrate already shipped. |
| 2 | **R4.D** LLM emits typed predicates | 3 | Max | Max | Karpathy bait. Rides RFC-0004 directly. |
| 3 | **R4.B** `directive doctor` static analysis | 4 | Max | Max | TLA+/HN endorsement bait. |
| 4 | **R4.E** `directive coverage` reporter | 2 | High | High | Quick win + vitest reporter. |
| 5 | **R4.C** `<PredicateEditor>` bidirectional UI | 5 | Max | High | Best PM-facing demo; SaaS hook. |

**Suggested arc:** R4.A (3d, foundation) → R4.E (2d, instant CI value) →
R4.D (3d, AI angle ships) → R4.B (4d, formal-methods headline) → R4.C
(5d, PM demo). Total: ~17 days for the entire R4 wave, all stacked on
substrate that landed with RFC-0004.

**R4 thesis:** RFC-0004 turned the predicate into a *data structure*.
R4.A treats it as a *solvable equation*. R4.B treats it as a *theorem*.
R4.C treats it as a *UI*. R4.D treats it as an *LLM output format*. R4.E
treats it as a *coverage target*. Five framings of the same JSON object —
none possible while `when` was a function.

---

## R4 Game-Changer Ideas (Round 4 — compound on shipped predicate + clobber + whenExplain)

Surfaced during the R4 innovation pass on RFC-0003 (`owns:` ownership) +
RFC-0004 (`FactPredicate` / `FactTemplate`) **after they shipped together**.
R4.A-E (predict / doctor / PredicateEditor / predicateFromIntent / coverage)
treat the predicate as data. The five below treat the predicate as a
**document, a signal, a target, a witness, a query** — five new framings,
each only possible because predicates are now structurally analyzable AND
clobber events ship the moment ownership drops AND `whenExplain` ships the
moment a clause flips.

### R4.F — `directive rules-diff <git-ref-a> <git-ref-b>`: business-logic PR review for predicate changes

**[2 days — viral MAX, compound MAX — the asymmetric pick of R4 round 2]**

A CLI that walks two git refs, extracts every `whenSpec` from `inspect()`
output (or re-imports each module under a sandboxed `createSystem` for a
snapshot), and renders a **semantic clause-level diff**:

```
constraint: blockCheckout
  - clause REMOVED:  user.verified $eq true
  + clause ADDED:    user.verified $eq true OR user.kycLevel $gte 2
  ~ clause RELAXED:  cart.total $gte 100  →  cart.total $gte 50

constraint: rateLimit
  ! REACHABILITY CHANGED: was reachable in 14 fact configurations,
                          now reachable in 119 (8.5× expansion)
```

Not `git diff` over JSON. A **structural diff** that understands AND/OR
trees, relaxation vs tightening of numeric thresholds, and combinator
flattening. Output: GitHub PR check + Markdown comment + optional Mermaid
sequence diagram of the rule graph.

**Why it's Sherlock:** Every regulated team (finance, healthcare, ad-tech)
hand-rolls a "what changed in our business rules" Notion doc and lies about
keeping it current. Auditors ask "show me the diff between Q2 and Q3
checkout rules" and engineers screenshot if/else statements. This is the
first tool that *actually answers the question* — because Directive's
runtime form of a rule is finally a structured document. Not "lines of code
changed" — "clauses added, clauses removed, thresholds relaxed, reachable
configurations expanded 8×."

**Compound effect:**
- Pairs with R4.E coverage → "this PR added a clause that no test
  exercises"
- Pairs with R4.B doctor → "this PR introduced an unreachable branch"
- Seeds R4.G replay (below) — *given a diff, replay history under both
  versions and show divergent outcomes*
- The structured-diff output IS the changelog. Auto-emit to
  `RULES_CHANGELOG.md` on every release.

**Viral demo (30s):** Open a PR that changes one line in a constraint
file. CI bot replies with: *"⚠ Rule `blockCheckout` now fires in 8.5× more
fact configurations. Test coverage of new clause: 0%. Click to inspect."*
Quote-tweet: *"Your business rules now have a code review tool that knows
what a business rule is."*

**Headline:** *"The first PR-review tool that understands business logic,
not just lines of code."*

### R4.G — `directive replay-under <new-spec> --history <recorded.json>`: counterfactual rule replay

**[✅ SHIPPED 2026-05-21 — `replayUnder()` in @directive-run/core + `directive replay-under` CLI. See docs/concepts/replay-under.md]**

**[3 days — viral MAX, compound MAX, the R2.A-shaped asymmetric pick]**

Given (a) a recorded fact-mutation history from the timeline plugin and
(b) an edited `whenSpec` for an existing constraint, replay the fact
history through the *new* spec and emit a **counterfactual report**:

```
constraint: blockCheckout (proposed change)
  fired 3× in original history
  WOULD HAVE FIRED 47× under proposed spec
  WOULD NOT HAVE FIRED in: 2 sessions (cart abandonment → revenue impact)
  NEW FIRES IN: 44 sessions — sample timestamps + fact snapshots attached
```

The mechanism: history is a frame stream. Every frame restores
`factsBaseline`. For each frame, run `evaluatePredicateExplained` once
under the *original* whenSpec and once under the *proposed* whenSpec. Diff
the pass/fail bit. The product is **before-you-merge causal impact
estimation for any rule change.**

**Why it's Sherlock:** Every product manager who has ever proposed
tightening a fraud rule, relaxing a paywall, or changing an A/B threshold
has had the same question: *"How many users would this have affected last
month?"* The answer today is a JIRA ticket to data science, a 2-week
turnaround, and a SQL query that's wrong because it doesn't model
constraint cascades. R4.G answers the question in **30 seconds**, against
the actual recorded fact history, with cascade modeling built in (because
replay re-runs the engine).

**Compound effect:**
- Pairs with R4.F (above): diff a rule, then click "replay under change"
  for one-click counterfactual
- Pairs with R4.D `predicateFromIntent`: LLM proposes a rule → counterfactual
  replay validates it against real history → ship or iterate
- Pairs with R2.A bisect: bisect across rule versions instead of code
  versions ("which rule change caused the regression in conversion rate?")
- Enables **predicate A/B testing**: ship two `whenSpec`s, route 50/50,
  diff the realized outcome against the replayed counterfactual to detect
  novelty effects

**Viral demo (30s):** PM opens a PR that loosens an eligibility rule.
GitHub bot comments: *"Under last 30 days of recorded sessions: rule fires
4,217× currently, 9,884× under your change. Estimated +$47K MRR @ current
conversion. Click for sample sessions newly eligible."*
Quote-tweet: *"What if you could replay last month's production traffic
against any rule change before you merge it?"*

**Headline:** *"Replay last month's production against your proposed rule
change. Before you merge."* (Sub: "This is what Optimizely never built.")

### R4.H — `predicateToSQL` / `predicateToMongoQuery` / `predicateToPGRest`: same predicate, client AND server

**[3 days — viral HIGH, compound MAX]**

A pure transformation: `FactPredicate<F>` → parameterized SQL `WHERE`
clause (and Mongo query, and PostgREST querystring). Because the predicate
operator set (`$eq`, `$gte`, `$in`, `$matches`, `$between`, `$contains`,
`$all`/`$any`/`$not`) is a **proper subset of SQL/Mongo's query
algebra**, the translation is total and trivial:

```ts
const adultUsers = { age: { $gte: 18 }, status: { $in: ["active", "pending"] } };

// Client (Directive):
const isAdult = (facts: Facts) => evaluatePredicate(adultUsers, facts);

// Server (Postgres):
predicateToSQL(adultUsers, "users");
// → { sql: "SELECT * FROM users WHERE age >= $1 AND status = ANY($2)",
//     params: [18, ["active", "pending"]] }

// Server (MongoDB):
predicateToMongo(adultUsers);
// → { age: { $gte: 18 }, status: { $in: ["active", "pending"] } }
//   (literally identical — Mongo already speaks the dialect)

// Edge (PostgREST):
predicateToPGRest(adultUsers);
// → "users?age=gte.18&status=in.(active,pending)"
```

**Why it's Sherlock:** *Isomorphic predicates* solve the dual-write hell
every full-stack app suffers. Today's reality: write a `WHERE` clause in
SQL for the API. Write the *same* logic as TypeScript `filter()` in the
client. Write it *again* as a Zod refinement for validation. Three sources
of truth, three places to break. Directive's predicate is **the canonical
form** — derived to SQL on the server, evaluated directly on the client,
fed into Zod refinements where useful. **One JSON, three targets, zero
drift.** Drizzle/Prisma never delivered this. tRPC moved validation but
not query semantics.

**Compound effect:**
- Pairs with `@directive-run/query`: server filters use the same predicate
  the client component uses to render filter pills
- Pairs with R4.D LLM-emit-predicate: chatbot generates a predicate, runtime
  type-checks it, server executes it as parameterized SQL with zero string
  concatenation (also closes a whole SQLi attack class for AI-generated
  queries)
- Pairs with RFC-0004 templates: `WHERE name LIKE ${pattern}` from
  `{ $template: "${pattern}" }`
- Pairs with edge-runtime predicates → Cloudflare Workers can evaluate
  predicates server-side with zero cold-start cost

**Viral demo (30s):** Side-by-side editor. Top half: a `FactPredicate`
declaration. Bottom half left: live SQL query. Bottom half right: live
React filter component. User edits one field in the predicate — all three
update. Quote-tweet: *"One predicate. Compiled to SQL on the server,
evaluated directly on the client. The end of dual-write hell."*

**Headline:** *"The state library that doubles as your ORM's query AST."*

### R4.I — `factsBaseline` audit log: GDPR-grade query-the-history

**[2 days — viral HIGH (regulated industries), compound MAX]**

Every constraint fire and every resolver clobber already carries the
`factsBaseline` (per RFC-0003 + RFC-0004). Pipe those into a structured
append-only ledger (SQLite/Parquet/Loki — pluggable):

```ts
const ledger = createAuditLedger(system, { sink: "sqlite:./audit.db" });

// Six months later. GDPR data request:
ledger.query({
  factPath: "user.email",
  changedBetween: ["2026-01-01", "2026-06-01"],
});
// → [
//     { ts, constraint: "emailVerified", whenSpec: {...},
//       priorValue: "old@x.com", newValue: "new@x.com",
//       clauseExplain: [{ path: "verified", op: "$eq", actual: true, pass: true }],
//       causedBy: { trigger: "user-action", eventId: "..." } },
//     ...
//   ]
```

Each entry contains: *the predicate that fired, the clause-level explain
that justified it, the facts before, the facts after, and the chain of
upstream causes*. **A queryable, cryptographically-hashable, append-only
explanation of every state change a regulator could ask about.**

**Why it's Sherlock:** Compliance teams ask three questions: (1) *show me
every write to PII* (R3.G1 vault handles values; R4.I handles
causality); (2) *show me why this user got that decision*; (3) *prove the
decision logic matches our policy document*. **No state library on npm can
answer any of these.** Datadog/Sentry log *events*, not *why*. Directive's
`whenSpec` + `factsBaseline` + `whenExplain` is already the witness — it
just needs a queryable sink. SOC2/HIPAA/PCI/GDPR all collapse from
"build a custom audit pipeline" to "enable the plugin."

**Compound effect:**
- Pairs with R3.G1 vault: PII values are vault-tokens in the audit log,
  ledger query stays compliant
- Pairs with R4.F rules-diff: audit log proves rule R was in effect at time
  T (cryptographic proof of policy adherence)
- Pairs with R4.G replay: regulator asks "would this user have been blocked
  under the prior rule?" — replay the relevant frame
- Foundation for **regulator-facing dashboards** as a SaaS layer (the first
  "compliance as a state library plugin")

**Viral demo (30s):** Production app. User changes their email. Pop open
the audit ledger UI — show the predicate that fired, the clause-level pass
breakdown, the prior/new value, the resolver that wrote it, the chain back
to the user-action event. Quote-tweet: *"Every state change in production
now ships with a court-admissible explanation. Built-in. No custom
pipeline."*

**Headline:** *"The first state library that's GDPR-compliant out of the
box, because it already knows why every fact changed."*

### R4.J — `clobber-loop` detector: real-time ownership-thrash alarms

**[1 day — quick win, viral MED-HIGH, compound HIGH]**

`resolver.write.rejected` events fire the moment ownership drops. Aggregate
them in a small ring buffer (per-fact, time-windowed) and emit a **structured
warning the instant a clobber loop exceeds threshold**:

```
[directive] CLOBBER LOOP DETECTED on fact `cart.discount`
  resolver `applyCoupon` and resolver `applyLoyaltyDiscount` clobbered
  each other 8 times in 412ms.
  Predicates that fire together:
    - applyCoupon.when:  { coupon: { $exists: true } }
    - applyLoyaltyDiscount.when: { user.loyaltyTier: { $gte: 2 } }
  Both fire whenever a logged-in user has a coupon. Add `priority:` or
  combine into a single resolver. View timeline frame 4217.
```

Pure derived signal — no new instrumentation. The clobber event is already
there; the analysis is "did the same pair clobber > N times in M ms with
overlapping whenSpec?" The output is *actionable* because the whenSpec is
data: the loop detector can **prove the two predicates overlap** (set
intersection over clause space) rather than just count events.

**Why it's Sherlock:** Every "why does this fact keep flipping back and
forth?" bug becomes a one-line config from the runtime. Today: stick
`console.log` in five resolvers, scroll devtools for 20 minutes. R4.J:
*"hey, your applyCoupon and applyLoyaltyDiscount are arguing — here's the
overlap proof and the fix."*

**Compound effect:**
- Foundation for R4.B doctor's CI rule ("static-detect overlapping owns:
  predicates before they ship")
- Pairs with R4.A predict: when a clobber loop is detected, predict() tells
  you the minimum priority bump or whenSpec narrowing to break the loop
- Same loop-detection signal feeds R4.I audit log as a higher-severity
  event class

**Viral demo (30s):** Stage a two-resolver clobber loop. App console
suddenly emits: *"⚠ CLOBBER LOOP. Resolver A and Resolver B clobbered
`cart.discount` 8× in 412ms — predicates overlap on
{user.loyaltyTier: { $gte: 2 } AND coupon.$exists}. Fix: add priority or
merge."* Quote-tweet: *"My state library just diagnosed a bug I haven't
written yet."*

**Headline:** *"The state library that notices when two of your rules are
arguing — and tells you why."*

### R4 (Round 2) ranked

| Rank | Idea | Days | Viral | Compound | Note |
|---|---|---|---|---|---|
| 1 | **R4.G** `replay-under` counterfactual rule replay — **✅ SHIPPED 2026-05-21** | 3 | Max | Max | **Asymmetric pick.** Answers the PM question every product team has every week. Rides timeline + whenSpec together. |
| 2 | **R4.F** `directive rules-diff` PR-review tool | 2 | Max | Max | Quickest path to a viral PR-comment screenshot. Every regulated team wants this yesterday. |
| 3 | **R4.H** `predicateToSQL` isomorphic predicates | 3 | High | Max | The "one truth, three targets" article writes itself. Drizzle/Prisma envy. |
| 4 | **R4.I** GDPR-grade audit ledger | 2 | High (regulated) | Max | Niche viral, but compliance teams will literally pay money. |
| 5 | **R4.J** clobber-loop detector | 1 | Med-High | High | One-day quick win. Diagnoses a bug class that has no name yet. |

**Suggested arc:** **R4.J (1d, quick win)** → **R4.F (2d, PR-comment
viral)** → **R4.G (3d, the PM-magnet)** → **R4.H (3d, isomorphic SQL)** →
**R4.I (2d, regulated-industry magnet)**. Total: ~11 days for the entire
second R4 wave. Every one of these is **impossible without** the predicate
being data, `whenSpec` being inspectable, and clobber being observable.

**R4 (Round 2) thesis:** Round 1 (R4.A-E) treated the predicate as **a
solvable equation / theorem / UI / LLM output / coverage target** — five
framings of "the predicate is data, and data can be analyzed." Round 2
treats the predicate as **a document (R4.F diff), a signal (R4.J loop
detector), a witness (R4.I audit log), a target (R4.H multi-platform
codegen), a counterfactual (R4.G replay-under)** — five framings of "the
predicate is data, and data can be *exchanged between systems and across
time*." Together: ten viral framings of one JSON object. The substrate is
not just the predicate. The substrate is *every system the predicate can
travel to and from* — the database, the regulator, the LLM, the audit
trail, the past, the alternate future.

**Why R4.G is the asymmetric pick of Round 2:** every other entry needs a
custom audience (PR reviewers, compliance teams, SQL nerds, devtools
power-users). R4.G needs only **one audience: product managers**. The
demo writes itself, the headline writes itself, and the value is
unambiguous in the first 5 seconds of the screencast. "Replay last month's
production against any rule change before you merge it" is the kind of
sentence that gets retweeted with no commentary.

---

## Backward-compatible additive aliases (v1.6+ candidates)

Naming refinements that cannot land as renames (v1.5 already shipped the
original names) but can land as **parallel aliases** — both names work,
the original is soft-deprecated in docs.

- **`$from` alias for `$ref`** — In v1.6, add `$from` as a parallel name;
  deprecate `$ref` for patches (but keep working). Removes the JSON
  Schema / JSON Pointer collision (`$ref` reads as a document reference;
  Directive's `$ref` is a payload field copy) without breaking v1.5.
