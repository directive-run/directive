# @directive-run/conformance (private)

The 2.0 oracle. Core's black-box tests, copied unchanged and run against more
than one engine:

| Project | Engine |
| --- | --- |
| `conformance:v1`, `conformance:v1:prod` | the published release pinned by the `directive-v1` npm alias (now `@directive-run/core@1.35.0`), development and production builds. The reference. |
| `conformance:local`, `conformance:local:prod` | the workspace's `packages/core` source |
| `conformance:v2`, `conformance:v2:prod` | core-next's source, up to `current` in `layers.rules.json` |
| `conformance:v2:dist`, `conformance:v2:dist:prod` | core-next's built `dist/` (what ships: mangled `_` members, the dev check folded at each use; `:prod` sets `NODE_ENV=production`), same gate |
| `conformance:diff` | differential scenarios: both engines in one process, traces compared (`diff/`) |
| `conformance:checks` | the tamper tests for `check-expects` |

```bash
pnpm --filter @directive-run/core build          # two tests use the built package
pnpm conformance                                 # check-expects, census, oracle guard
pnpm --filter @directive-run/conformance ratchet [--update]  # v2 never-regress list
pnpm --filter @directive-run/conformance typecheck
pnpm --filter @directive-run/conformance port    # re-copy after core's tests change
pnpm --filter @directive-run/conformance oracle:update  # after changing the harness
pnpm --filter @directive-run/conformance pin:v1         # after moving the directive-v1 alias
```

## What each piece does

- `lib/classify.ts` decides which core tests are portable and produces each
  copy in memory; `scripts/port.ts` writes it. Only core import specifiers
  change, plus the declared rewrites in `lib/rewrites.ts`.
- `scripts/check-expects.ts` (`lib/check.ts`) re-runs the classification and
  fails unless every committed file equals a fresh port: the same imports
  from allowed specifiers only, the same body, every original assertion
  verbatim, no stray files. `scripts/__tests__/check.test.ts` tampers with a
  copy of the repo in each of those ways and proves the check fails.
- `self/engine-identity.test.ts` runs in every engine project and proves the
  project loads the engine it claims, for every entry point: each export is
  the unmocked module at the expected file (no setup-file mock or wrapper),
  the built entry and declarations are where they should be, and on v1 the
  installed package is byte for byte the npm tarball the lockfile names.
- `scripts/census.ts` (`lib/census.ts`) runs every project with a JSON
  reporter and proves the run was complete: the vitest config is exactly the
  expected one (projects, includes, setup file, aliases, nothing extra);
  every port ran in every engine project; nothing was skipped except the
  `aheadOfV1.json` tests on v1; nothing is todo; every named test ran; v1
  and local ran the same tests; the self and tamper tests ran in full. It
  also verifies `harness.lock.json`.
- `harness.lock.json` pins the sha256 of every harness file (config, helpers, diff/,
  self tests, lib, scripts, tsconfig, package.json, `aheadOfV1.json`,
  `oracle-baseline.json`). Any harness edit needs `oracle:update`, and a PR
  that changes the lock needs the `oracle-change` label.
- `scripts/oracle-guard.ts` (`lib/guard.ts`) enforces the rules for changing
  the oracle, below.
- `tsconfig.json` typechecks the ports against workspace source, so ported
  `expectTypeOf` and `@ts-expect-error` lines are enforced. `noUnusedLocals`
  is off: a declared rewrite can leave an original's helper unused.

## Differential scenarios (`diff/`)

The ported tests check what their authors thought to assert. The
differential harness checks everything else: it runs the same definitions
and steps on the reference engine and every engine under test and requires
the traces to agree.

- `diff/record.ts` records, in order: every plugin hook with its arguments
  (the list in `diff/hooks.ts` is type-checked against each engine's
  `Plugin`, so a new hook cannot go unrecorded), every `observe()` event,
  every store notification per fact and derivation with the value a
  subscriber reads at that moment, every console message (load-time ones
  included), unhandled rejections, each step and anything it threw,
  pending fake timers after destroy, outside effects the scenario reports
  (`external`), and at each `settle`/`checkpoint` all facts, every
  derivation's value and the whole `inspect()`.
- `diff/normalize.ts` makes values comparable. Errors keep their name,
  message and every own property but `stack` (a DirectiveError's `source`,
  `sourceId`, `context`, `recoverable`; `cause`, recursively). Nothing
  nondeterministic is stripped; the runner makes it deterministic instead:
  fake timers at time 0 (`Date`, `performance`, every timer) and console
  capture installed before the engine loads, `Math.random` seeded per
  scenario, step values copied per run, and a fresh engine instance per run
  (1.35 dedupes some dev warnings per process, so a reused instance would
  make a run depend on the runs before it — `diff/self/tamper.test.ts`
  shows it).
- `diff/compare.ts` compares stream by stream (hook, observe, notify,
  console, error, external, state, timers), aligning each stream with a
  longest common subsequence keyed by kind (hook name, event type, …), step
  and phase (`sync`: inside the step's call; `async`: after it returned).
  One inserted hook is one difference, not a cascade. The console stream
  breaks ties by text: of the longest alignments it takes the one that
  pairs the most records of identical wording, so as many records pair as
  by keys alone and a missing or extra warning is the one the other engine
  did not print (1.35 printing [X, Y] and 2.0 [Y] leaves X missing, not Y),
  provided the records both engines print appear in the same order. If
  they swap order, a printed record can be left unpaired, so a `$text`
  class should name a wording the other engine never prints.
- `diff/scenario.ts`: `scenario(name, build, steps)` runs the reference
  twice (the runs must match exactly, incidental parts included, or the
  scenario/recorder is not deterministic — never approvable) and each
  engine under test once, and prints each difference with context.
- `diff/engines.ts`: the reference (`v1`, the published 1.35.0), `local`
  (workspace source) and `v2` (`packages/core-next/src/index.ts`, once it
  exists — until then the census prints why it is not compared). v2 runs a
  scenario only at or below `current` in `layers.rules.json`; each scenario
  has its own layer there under `scenarios`, and each fuzz case is placed by
  the features it uses (`diff/fuzz/model.ts` `specLayer`).
- `diff/scenarios/l<N>-*.test.ts` are hand-written scenarios by layer (one
  per rung of the ladder, L0–L13). `diff/fuzz/` generates one- and
  two-module systems (crossModuleDeps, retries, timeouts, cancels, throwing
  derivations and effects, cleanups, every boundary strategy, sources,
  history, trace) and step sequences (writes, batches, Dates, publishes,
  stop/start/destroy mid-run, snapshot/restore, back/forward, a second
  system in the same engine instance). A resolver's start, write and abort
  are external records under their own kinds, `["start" | "wrote" |
  "aborted" | "timeout", "<module>.r<index>", attempt]`, so the comparison
  pairs a start only with a start, and an entry's kind does not depend on
  the resolver's id. An abort whose `signal.reason` is the resolver's
  timeout error (`Resolver "<id>" timed out after <ms>ms`) is a `timeout`,
  any other an `aborted`: 1.35 never aborts a signal on a timeout, so a
  `timeout` record is 2.0's alone (row n), and it never pairs with a later
  cancel-time `aborted`. An effect's run and its cleanup are kinded the
  same way, `["effect" | "cleanup", "<module>.x<index>", values read]`, so
  an entry for an extra effect run does not depend on the effect's id.
  The batched resolver (L7: at most one per case, in the first module, fed
  by one or two constraints, with `resolveBatch`, `resolveBatchWithResults`
  or the resolve() fallback) records the same kinds under `<module>.rb`,
  with the call's items last; a batch timeout's message counts as a
  timeout too.
  PR CI runs the fixed seed for 205
  cases across every layer (`FUZZ_DEFAULT_RUNS`); the census fails fewer than
  200 compared (`lib/fuzz.ts` `FUZZ_FLOOR`) or more than max(1% of cases, 2)
  runaways — and `.github/workflows/diff-fuzz-nightly.yml` runs 5,000 from a
  random seed it prints; failures shrink and print the seed and spec. A system
  that uses every layer sits above `current`, so v2 would sit out of nearly all
  of them. Each run therefore adds 40% more cases (`FUZZ_V2_PERCENT`: 82 on top
  of 205, 2,000 on top of 5,000; an exact count, not a probability), generated
  with a ceiling at `current` (`specArbitrary({ ceiling })`, from
  `FEATURE_LAYERS`), so v2 takes part in them, and the census fails fewer than
  60 cases compared on v2 (`FUZZ_V2_FLOOR`, counted from what each run
  compared) while `current` is not null. The cases across every layer all still
  run, as before.
  **Batches at a settle step: one shared wait.** Jason, 2026-11-07: "One
  shared wait (Recommended)". It replaced the two separate drains: 1.35's
  (Jason, 2026-11-06: "Wait out 1.35's batches (Recommended)"), which
  advanced only 1.35's clock until its batches finished, and v2's (Jason,
  2026-11-07: "Wait out 2.0's detached batches too (Recommended)"), which
  advanced only v2's until its detached runs finished. The two ended at
  different fake times (seed 4: 12 ms against 250 ms), so the engines'
  clocks drifted apart for every later step. 1.35's `settle()` resolves
  while a batch still runs, and 2.0's waits for it (row (as)), but not for a
  detached run (a bound run whose requirement is retracted leaves flight
  unaborted, RFC-0003). So in the fuzz only, after `settle()` resolves, both
  engines' fake clocks advance together, by the same amount, to the first
  time at which neither has a batch still running, and the `settle`
  checkpoint is recorded there, on both at the same fake time. Running is
  read from 1.35's own schedule (`batchDrain` in diff/fuzz/model.ts): a call
  of the batched handler still live (not returned, and not past its
  timeout, the timer due at it included), a retry backoff of a failed call
  still running (its end included), or the system not settled; on 1.35 that
  is any batch, on 2.0 a detached run, since its
  attached ones are what its `settle()` waited for. A call whose signal a
  clobber or a retraction aborted still counts while its timeout timer is
  pending: 1.35's `withTimeout` clears that timer only when the call settles
  or the timer fires, never on abort, so its timeout still fires (and its
  run's end still asks a pass); with no timeout, an aborted call is an
  orphan, as a canceled single run is. That is the coordinator's reading of
  the rule's "until neither has a batch still running" (2026-11-08, seed
  19), not a separate owner decision. The engines run one
  after the other, so the common time is found in rounds
  (`nextTargets`, diff/scenario.ts): where the reference and v2 ended a
  settle step's wait at different times, the later becomes that step's
  target and both run again. A v2 whose `settle()` resolved with attached
  work left takes no part, so it still differs
  (diff/self/settle-drain.test.ts). Attached work is read at the instant
  `settle()` resolves, not after the harness has driven it: a timer due in
  that same millisecond may run first, and work it starts was not left by
  `settle()` (deep seed 24301, where both engines' `settle()` resolve
  settled at 1 ms and a canceled run's write then raises a new attempt on
  both). A run goes to its target one timer at a
  time, as its own wait does. Each wait is capped at 5 s of fake time after
  its `settle()` resolved (`DRAIN_BOUND_MS`), 2.0's own `settle()` limit;
  when one engine is still running at its cap, the other is advanced to that
  same time and judged there:
  - both engines still running at the cap: the case is discarded under the
    never-settles rule below;
  - only 1.35 still running while 2.0 finished: discarded the same way;
  - only 2.0 still running while 1.35 finished in the same time: the case
    fails, as a 2.0 bug ("2.0-only live"), naming what kept 2.0 live,
    unless an approved `ends` entry had already stopped the case's
    comparison on 2.0 before 2.0 outworked the reference. **Discard after
    the stop.** Jason, 2026-11-08: "Use 'Discard after the stop'
    (Recommended)". The cut is the time the reference's batches finished at
    that step (`SettleWait.quietAt`): the stop counts as first when its
    record comes before the point 2.0's clock reached that time
    (`SettleWait.cutAt`), by the same `stopsBefore` test as the timer-budget
    runaway after a stop (Jason, 2026-11-02: "Discard after the stop").
    Then the comparison had already ended, so judging liveness there would
    judge work it had abandoned: the case is discarded after the stop,
    counted toward the runaway limit, max(1% of cases, 2), on the census's
    "discarded after a stop" sub-line, which names the stopping entries
    (seeds 8 and 2: quirk a's re-dispatch under "retry" lets 2.0 into a
    chase of two writes that 1.35 runs too once given the same first
    write). Its differences before the stop are still checked. With no
    `ends` stop on 2.0, or a stop after the reference had finished, it
    still fails (diff/self/settle-drain.test.ts). This replaces the
    write-after-cancel verdict of the same day (Jason, 2026-11-08: "Refine:
    write-after-cancel = discard (Recommended)"): a write a handler makes
    while its signal is aborted (`writeAfterAbort`, counted in the fuzz
    handlers, diff/fuzz/model.ts) is now only reported, since seed 2's chase
    has none (its one abort is the writer's own, `abortOn` firing on its
    write) and the count read a hand-instrumented handler rather than the
    comparison.
  A batch still live at the cap on the workspace engine, or on the
  reference's second run, fails the case too. Hand scenarios never wait, and
  their signed (as) entries still pin 1.35's early `settle()`. The fuzz line
  counts the cases where each engine's clock advanced, and those that took
  more than one round.
  **A reference that never settles.** Jason, 2026-11-07: "Discard, own count
  (Recommended)". When the reference's own batches are still live at the
  shared wait's cap on its first run, the case never settles on 1.35: it
  records a batch's errors after its run ends, so a "retry" boundary
  re-dispatches the batch forever; a fallback batch has nothing that
  cancels it; or two writes chase each other on both engines (seed 10). 2.0
  is bounded there by approved rows (quirk a, (at)). Such a case is
  discarded like a reference runaway (`ScenarioResult.neverSettles`), but
  counted on its own census line (with how many had v2 live too), never
  toward the runaway limit, and more than the seed's cap fail the run, in
  the fuzz test and in the census (diff/self/settle-drain.test.ts). The cap:
  Jason, 2026-11-07: "Cap at 1% of cases, min 3 (Recommended)", so max(1% of
  the seed's cases, 3) (`maxNeverSettles`, lib/fuzz.ts); measured, about
  0.5% of cases.
  **Fuzz: deep runs report batched cases.** Jason, 2026-11-09: "Gate on
  short seeds; deep runs report (Recommended)". The L7 gate passed on the
  PR seeds (1 to 20 and 24301 at the PR count, all blocking). The nightly
  sets `DIFF_FUZZ_BATCH_REPORT=1` (lib/fuzz.ts `FUZZ_BATCH_REPORT_ENV`; only
  the exact value "1" turns it on): there, a failing case with a batched
  resolver (trigger `batched`) is reported, not failed. It is listed in the
  job summary (`summary.md`), and its spec, report and traces
  (`case-<n>.json`, in `DIFF_FUZZ_REPORT_DIR`) are uploaded as the run's
  artifact. Each is triaged in a follow-up slice, and a case triaged as a
  real 2.0 bug blocks at once. A failing case with no batched resolver
  still fails the job, as do the runaway, never-settles and v2 limits, and
  so does a case the shared wait judges a 2.0 bug ("2.0-only live"),
  batched or not: that verdict is already the 2.0-bug finding (lib/fuzz.ts
  `onFailingCase`).
  Nothing else sets the flag, so PR CI and the census stay fully blocking
  (diff/self/batch-report.test.ts). A reported case is not shrunk: the
  file holds the case as generated.
- `diff/self/` proves the harness. `tamper.test.ts` injects faults through
  wrappers (a reordered, dropped, extra or moved event; a changed fact; a
  leaked timer; a load-time warning; a stale read) and checks the
  contract/advisory split. `faults.test.ts` runs faulted copies of core's
  own source (`faults.ts`, from the slice-0.2 reviews: extra computes,
  doubled hooks and resolver runs, notifications moved to a microtask,
  reversed effects, stale reads during notification, off-by-one backoff
  and timeout, skipped cleanups, wrong error fields, dropped inspect
  fields, no warning dedupe) and requires a scenario or fuzz case to catch
  each, after a control copy passes everything.
- `diff/unfired-hooks.json` lists hooks no scenario can fire, with the
  reason and layer; the census fails a hook that neither fires nor is
  listed, and a listed hook that fires. Today: `onFactDelete`, which 1.35
  never emits.
- `pnpm --filter @directive-run/conformance diff:coverage [scenarios|fuzz|all]`
  reports function coverage of `packages/core/src` and the hooks fired.

`record()` and `createRecorder()` are the reusable part (the public
`record()` of the 2.0 testing story, B3, can start from them).
`scenario()`, `runOn()` and `runScenario()` are internal: vitest-bound,
and they patch process globals (timers, `Math.random`, console,
`unhandledRejection`).

Writing a scenario: `build({ core, plugins, external, handles })` returns
`createSystem` options built with `core` and `plugins` (the engine being
run and its `/plugins` entry), so the same code builds on every engine;
report outside effects with `external`; stash handles (a source's
`publish`) in `handles` for `run` steps. Steps: `start`, `stop`,
`destroy`, `dispatch`, `set` (`ns.key` for a namespaced fact), `batch`,
`advance` (fake ms), `tick` (microtasks only), `settle`, `checkpoint`,
`snapshot`/`restore`, `back`/`forward`, and `run` (a labelled function).
Pass `{ observeDerivations: false }` for a scenario about what a reader
sees of a derivation nobody subscribes to (the recorder's own
subscriptions would otherwise keep it fresh). Give every scenario a
unique literal title (the census counts them) and a layer in
`layers.rules.json` `scenarios`.

### What the trace freezes

| Part | Status | How it is compared |
| --- | --- | --- |
| Hook names, order within the hook stream, arguments | contract | exact |
| `observe()` events: type, order within the stream, payload | contract | exact |
| Store notifications: which id, order, the value read at that moment | contract | exact |
| Sync vs async: whether an entry happens inside the step's call | contract | part of the alignment key |
| Facts, derivation values and `inspect()` shape at each checkpoint | contract | exact, except the fields below |
| `inspect()` `pendingInvalidations`, `observedDerivations`, `hitCount`, `lastActiveAt` | incidental | presence and type strict; value advisory |
| Console messages: level and count | contract | exact |
| Console wording | incidental | advisory |
| Error name, message, own fields, cause | contract | exact (never the stack) |
| Class names (`$class`) | incidental | presence strict; name advisory |
| Pending timers after destroy | contract | exact |
| Interleaving across streams (a hook vs an observe event) | incidental | advisory, printed when the streams agree |
| How many microtask rounds a `tick` flushes | incidental | do not checkpoint mid-chain |
| A retry's jitter draw: the wait a scenario reports as `[resolverId, attempt, { $draw, min, max }]` (an `external` entry), and the `duration` of that resolver's completion (`onResolverComplete` argument 2, `resolver.complete`) | incidental | the `$draw` and `duration` values are advisory; `min`, `max` and the rest strict; the draw must lie in `[min, max]` and each duration in the sum of its resolver's bounds, in both streams, on every engine, the reference too |

A jitter draw is incidental because two valid engines draw different
numbers from the same seeded `Math.random` (1.35 draws twice before its first
jitter, 2.0 does not), not because the delay is unchecked: the scenario states
the bounds (`base` is the backoff delay, clamped to `maxDelay`, before jitter;
`full`: 0 to `base`; `equal`: `base / 2` to `base`; `{ maxMs }`: `base` to
`base + maxMs`) and `runScenario` fails a draw outside them, and a completion
`duration` outside the sum of its resolver's bounds, whether the hook or the
observe event reports it. The masked set and the checked set are the same
set: a `$draw` is masked only as the third element of a three-element
`external` array whose marker has exactly the keys `$draw`, `min` and `max`
(which is the one thing `runScenario` bounds-checks), and a `$draw` anywhere
else is a scenario error, never masked. Such a scenario starts each jittered
resolver at a fixed time, so no later start time or order of events depends
on a draw; the bounds of chains that run at once must keep their attempts
apart for the same reason. A drawn resolver completes once per scenario.

Advisories are printed with the scenario and never fail it. Changing this
table, or `diff/compare.ts`, changes the contract: it is an oracle change
(label) and Jason's call (CODEOWNERS).

**Divergences.** An intended difference between the engines goes in
`diff/divergences.json`, keyed by what differs, never by trace index:
`{ id, scenario, stream, kind, reason, approvedBy, date }`, optionally
narrowed by `engine`, `step`, `op` (`missing` / `extra` / `changed` /
`moved`) and `path` (inside the entry; a prefix covers everything under
it), and named
exactly by `excuses` or `bound` (below). **Jason
approves every entry; an agent never adds one, and never fills in
`approvedBy`.** The census fails an entry that is incomplete or unsigned,
or that covered no difference in the run (stale). The file is part of the
harness, so adding one needs `oracle:update` and the `oracle-change`
label, and CODEOWNERS puts it under Jason's review. It is the one harness
file an engine PR may change (see "Engine and oracle land separately").

**A moved record** (`op: "moved"`, diff/scenario.ts `fileMoves`). A
record missing on the engine under test in step N that it has, of the same
stream and kind, as an extra record in step N + 1 is filed as one
difference, a move, at the reference's step and phase with the reference's
record as its payload, but only where a signed entry with op `moved`
covers that move; every other such pair stays a `missing` and an `extra`,
so no other entry sees its differences change shape. Only the step moved:
every field that differs between the two records is a `changed` difference
of its own, compared as a matched pair's would be. So an entry for a move
covers that one record arriving a step later and never its absence: a 2.0
that never makes the record still shows it `missing`. Row
(av)'s early flush on 1.35 (seed 1 at DIFF_FUZZ_RUNS=5000: 1.35's queue
holds the re-raised item twice, which fills `maxSize` 2 and flushes a step
before 2.0's window timer) is one: its entry
`l7-fuzz-av-external-start-moved` bounds the moved record to 1.35's call
with an item repeated (`$like` `batchItemsRepeated`), with `when`
`batchMaxSize`, and the repeated item itself stays a `changed` difference
for the (av) changed-items entry. The census accepts `moved` as an op and
rejects a `path` on it.

**An entry names what it excuses** (P3-F1, `diff/fingerprint.ts`). The
fields above only name a class of differences; on their own they would
excuse any number of same-kind records in the entry's step, and any value
under a changed entry's path. So every entry also carries one of:

- `excuses` (a hand scenario's entry): the records it excuses, each with a
  `count`. A missing or extra excuse is `{ count, record }`, the whole
  record as compared (1.35's for missing, 2.0's for extra); a changed one is
  `{ count, path, from, to }`, the field's full path with its 1.35 and 2.0
  values (a side with no value is left out). A record no excuse names is
  unexplained, and so is a copy past an excuse's count. The census also
  fails an excuse that excused fewer records than its count (stale).
- `bound` (a fuzz entry, whose records differ from seed to seed): `{ match:
  [patterns] }`. A pattern is the record (or, for changed, `{ path, from,
  to }`) with only the parts a seed varies left open: `{ "$like": name }`
  for a resolver, constraint, requirement or effect identifier of the fuzz
  model's naming grammar, an integer (an attempt or a count), the error a
  fuzz resolver's attempt ended with (its thrown message or its timeout,
  one class: quirk b excuses either), a fuzz derivation's or effect's
  thrown error and id (on 2.0's side of quirk b's pairing shift: 1.35's
  extra attempt error pairs with 2.0's next error of the stream), or an absent side, and `[*]` for an array index under the entry's path. A changed
  pattern's `to` may instead be `{ "$lt": "from" }`: 2.0's number is below
  1.35's, for a quirk whose approval says which way a count moves (quirk
  z: 2.0 holds fewer pending timers, so a 2.0 timer leak is not excused).
  A changed pattern may add `record`, a pattern 1.35's whole record must
  fit, so the change is excused only inside a record of that shape: (av)'s
  changed-items entry admits a changed item only in a batch call whose
  items repeat on 1.35 (`batchItemsRepeated`), never 2.0 dropping a
  distinct item.
  In a missing or extra console entry's pattern, `{ "$text": name }` may
  stand where the contract masks an argument's wording (`{ "$incidental":
  "string" }`): it matches only an argument printed in the named wording
  (diff/fingerprint.ts `TEXT`: `resolverThrew`, the development warning a
  resolver's unhandled error prints, and `dateWriteByKey`, 1.35's second
  non-JSON warning for a Date written to a namespaced fact). Row o's entry
  (`l3-quirk-o-fuzz-console-warn-missing`) uses `dateWriteByKey`, so in a
  namespaced Date case it no longer excuses any other warning 2.0 lacks
  (it had been excusing the source-gate warning, which the masked console
  pairing named in place of the Date warning). Quirk b's console entry used
  `resolverThrew`, but narrowed to that warning it covered no fuzz case and
  was removed (the census failed it as stale; on main it had been covering
  row o's warnings); the self-tests in diff/self/fingerprints.test.ts keep
  that class covered through a synthetic entry. The comparison keeps the unmasked record for missing and
  extra console records only (`Difference.raw`), and only a `$text` pattern
  reads it: every other comparison, report and entry sees the mask. The
  census rejects an unknown `$text`, and one in any other entry. Field names,
  tags, structure, array lengths and every other value stay literal, so a
  fuzz entry no longer excuses an unrelated record kind or key.

The `$like` classes (diff/fingerprint.ts `LIKE`; `generalize` reads a value
as the first that matches, in the order below):

| Class | Matches |
| --- | --- |
| `integer` | any integer: an attempt, a count, a duration |
| `requirementId` | a single resolver's requirement id: `A0:{}` |
| `requirementType` | a single resolver's requirement type: `A0` |
| `resolver` | a single resolver's id, own or namespaced: `r0`, `a::r0` |
| `constraint` | a constraint id: `c0`, `a::c0` |
| `resolverTag` | a single resolver's record tag: `a.r0` |
| `effectTag` | an effect's record tag: `a.x0` |
| `attemptError` | a single resolver's attempt error: `a.r0 attempt 1`, or `Resolver "a::r0" timed out after 3ms` |
| `batchResolver` | the batched resolver's id (L7): `rb`, `a::rb` |
| `batchConstraint` | a constraint that feeds the batched resolver: `b0`, `a::b1` |
| `batchRequirementType` | a batch requirement's type: `AB` |
| `batchRequirementId` | a batch requirement's id: `AB:{"item":"0.1"}` |
| `batchItem` | a batch requirement's item, `<source>.<index>`: `0.1` |
| `batchTag` | the batched resolver's record tag: `a.rb` |
| `batchAttemptError` | a batched call's or item's error: `a.rb attempt 1`, `a.rb 0.1 attempt 1`, or `Batch resolver "rb" timed out after 3ms` |

`absent`, `settleTimeout`, `thrownError` and `thrower` are matched only
where a pattern names them (`generalize` never writes them).

The census requires one of them on every entry. They were added by
`scripts/fingerprint-divergences.ts`, which records what each entry covered
on the current engines (the PR run; for fuzz samples, the fuzz at seeds
1–20 and 24301 at the PR run count plus seed 24301 at 5000, so a bound
describes its record class rather than one seed's literals: `--rebound
--seeds 1-20` regenerates every bound that way, each entry run as the old
wildcard over its class) and writes exactly that: an excuse per distinct record with its
count, or the patterns the covered records generalize to (for a fuzz entry
that covered nothing itself, the records of its class). That only narrows
an entry, so it keeps its `approvedBy`, `date` and `reason`: narrowing an
approved entry needs no new approval. A new entry, or one that excuses
more, needs Jason's sign-off as before.

An entry may also say `ends: true`: the approved quirk it covers ends the
comparison of a fuzz case. It exists for a quirk whose consequences
cascade: when 2.0 re-dispatches a resolver that 1.35 does not (or the other
way round), every later record of that case differs, differently for each
seed, so entries written per record at the PR seed fail the nightly seeds,
and entries wide enough for every seed would hide unrelated differences in
every fuzz case. In each fuzz case, on each engine, the first difference
whose covering entry has `ends` is the stop: it passes, and the stop covers
every stream of the case. The owner's decision (Jason, 2026-11-01): "Stop
all streams: when an approved quirk ends a case, drop every stream's
unmatched records after the last record both engines matched before the
stop. That reads 'stops comparing that case' as the whole case. It applies
only to cases with the quirk's trigger, and everything before the shared
match point is still checked." Three rules drop a difference, in
`diff/compare.ts`:

- **After the shared match point** (`SharedPoint`, `isPastSharedPoint`): a
  missing or extra record, in any stream, after the last record both
  engines matched before the stop. Each trace has one global record order
  (every stream's records, and the step and async markers, in one array).
  The two traces are linked only by the records both have: each pair the
  alignment matched, in any stream, and each step and async marker. A
  shared match point is such a link where the two prefixes it closes hold
  the same links (no matched pair has one record before it and the other
  after). Each stream is aligned on its own, so one stream's pairs can cross
  another's (1.35's error paired with a later 2.0 error, while 2.0's
  records between them pair with 1.35's after it); no shared point falls
  inside a crossing. The stop's point is the latest one before the stop's
  record in every trace the stop is in.
- **Past the stop** (`isPastStop`): strictly after the stop, or beside it,
  in the same gap (records one trace has and the other lacks, between the
  same two matched records, in either trace). "After" within one trace is
  the trace order; across the two traces only a matched record between
  them orders two records (a later step or phase, or more matched records
  before it). This is how a changed record (a matched pair) after the stop
  is dropped.
- **A changed pair that straddles the stop** (`straddlesStop`): a changed
  record after the shared match point with either of its two records past
  the stop in its own trace. The owner's decision (Jason, 2026-11-01): "Yes,
  drop straddling pairs: a changed record whose 2.0 half or 1.35 half is
  past the stop, and that sits after the shared match point, is dropped, as
  its two halves would be if left unpaired. A pair with both halves before
  the stop is still checked, so no difference from before the quirk is
  hidden." A changed record at or before the shared point is never dropped
  (from a real comparison it is never past the stop either).

A difference before the shared match point is still reported, in every
stream, and a covered one passes, as before; only an `ends` entry
stops (an ordinary entry covers its difference and the case goes on), and
only in a case with its `when` triggers; other engines are compared in
full, and the case still counts toward the fuzz floors. The run prints where each case ended as an
advisory, and the census's fuzz line says how many cases ended early, at
which step on average and how many at step 0, so a stop that comes too
early shows. `ends` is valid only on a signed entry for scenario `fuzz`
with engine `v2`, an `op`, and a `path` when the op is `changed` (none
when it is `moved`; the
census rejects it anywhere else, and rejects a hand scenario titled
`fuzz`): hand scenarios are always compared to their end. An `ends` entry
that never stopped a case is stale like any other, and it must carry
`when` (below), so it stops only the cases that can show its quirk.

An engine under test that passes the timer-callback budget after an `ends`
stop on that same engine is not a hang: the case is discarded like a 1.35
runaway, counted toward the same max(1% of cases, 2) limit, and the census's
fuzz line says how many were "discarded after a stop". The owner's decision
(Jason, 2026-11-02, in chat): "Discard after the stop", the option that
reads: once an approved stop rule has ended the comparison, a 2.0 runaway
past it is discarded like a 1.35 runaway, inside the existing 1% runaway
limit, and reported in the census line; a 2.0 runaway with no stop rule
before it still fails. The stop must come
first (diff/scenario.ts `stopsBefore`). The runaway starts where that
engine's timer callbacks pass the reference's own total (the count where
1.35 settled), not where the budget ran out: from there on the engine is
doing work the reference never did, so a record there may be the loop's
own. The stop's record in that engine's trace must come strictly before
that point, or, for a missing stop, its step and phase must end before the
one the runaway started in. A runaway with no stop, before the stop, or on
an engine the stop is not on is still a hang; so is a loop whose own
records match an `ends` entry, and a loop that started before the stop
and ran out of budget after it. Differences before the stop are still
checked.

A fuzz entry may say `when: [<trigger>, …]`: it then covers a difference
only in a fuzz case that has every trigger it lists (diff/scenario.ts
`covers`). Without `when`, a fuzz entry applies to every fuzz case,
including the many that cannot show its quirk. Each case computes its
triggers from its spec (diff/fuzz/model.ts `specTriggers`; the names are
lib/fuzz.ts `FUZZ_TRIGGERS`), reading the options the case really passes:

| Trigger | The case has it when |
| --- | --- |
| `resolverRetry` | `errorBoundary.onResolverError` is `"retry"` and the case has a resolver |
| `resolverRetryLater` | `errorBoundary.onResolverError` is `"retry-later"` and the case has a resolver |
| `constraintRetryLater` | `errorBoundary.onConstraintError` is `"retry-later"` and the case has a constraint. Never set today: the model always passes `"skip"` |
| `retryPolicy` | some resolver has a `retry` policy (more than one attempt) |
| `timeout` | some resolver has a `timeout` |
| `resolverRejects` | some resolver can reject: it fails at least once (`fails` > 0), or its `timeout` is no longer than its wait (`delay`), so the timeout can fire before it writes |
| `settleStop` | the case has a resolver. A settle step leaves its `settle()` waiting only when its drive gives up (500 timer jumps) with a run in flight or re-dispatched, and a `stop`, `destroy` or the teardown's `destroy()` always follows a settle step (every case ends with one), so the spec cannot narrow it further |
| `restart` | the steps have a `stop` with a `start` after it and no `destroy` anywhere before that `start` (1.35 ignores `start()` after `destroy()`) |
| `disable` | some `errorBoundary` strategy is `"disable"` and the case has what it applies to: a resolver (`onResolverError`) or an effect (`onEffectError`) |
| `throw` | some `errorBoundary` strategy is `"throw"` and the case has what it applies to: a resolver (effects then skip) |
| `namespacedDateWrite` | the case has two modules (the model namespaces them only then, as `a` and `b`) and one has the Date fact `when`, which its init sets to a `Date`, so a Date is written to a namespaced fact (row o: 1.35 warns of it twice, by `a.when` and `a::when`) |
| `ownWriteRetracts` | some resolver's write can retract its own constraint: it writes the fact its constraint's condition reads (`writes` is `fact`) a value below the condition's `atLeast`, so the run that wrote it can be retracted after it reported complete (row t's third path). A module b constraint's cross condition reads module a's fact 0, which b's resolvers never write |
| `batched` | the case has the batched resolver (L7). Quirk g and rows (ap), (as) and (au) need nothing more of the spec: a retraction, a later add or a settle step can reach any batch, and which one a case makes depends on its steps' timing |
| `batchWithResults` | the batched resolver is `resolveBatchWithResults` |
| `batchFallback` | the batched resolver has only `resolve()`, the fallback (row (at)) |
| `batchMixed` | two constraints feed the batched resolver, so a batch can mix them (quirk k) |
| `batchAbortOn` | some constraint that feeds the batched resolver has `abortOn` (quirk k; RFC B-1) |
| `batchSiblings` | the batch's sources can raise more than one requirement at once (their `items` add up to two or more), so a write can retract one and keep a sibling wanted (quirk g) |
| `batchFails` | some call of the batched resolver fails (`fails` > 0): a thrown batch or fallback run, or failed items of a with-results call |
| `batchAllFail` | a with-results call fails every item (`failing` `"all"`, `fails` > 0): quirk h and row (ar) |
| `batchSomeFail` | a with-results call fails every second item (`failing` `"some"`, `fails` > 0) and the sources can raise two requirements, so a call can fail some items and not others (quirk i) |
| `batchRetry` | the batched resolver has a retry policy (more than one attempt) |
| `batchTimeout` | the batched resolver has a `timeoutMs` |
| `batchMaxSize` | the batch has a `maxSize` (1 or 2), so a queue holding a requirement twice (row (av) on 1.35) can fill it and flush a step before the other engine's window timer |
| `navigated` | history is on (L8) and some step restores a snapshot into the facts: `back`, `forward`, `goTo`, `replay`, or `roundtrip` (its import restores the current snapshot) |
| `navigatedBusy` | a navigation can run while work is in flight (L8; U14 pins 1.35's shapes by hand, the L8 RFC's rule 3): the case has a resolver, and some navigation comes before any settle step, or after a step other than a history step since the last settle step |

The model passes every strategy as a string; a function strategy would
make `specTriggers` throw rather than guess. The census rejects an unknown
trigger, an empty or repeated list, and `when` on an entry for a hand
scenario (a hand scenario has no triggers, so such an entry would cover
nothing).

A fuzz entry may also say `group: "<id>"` (for example `"quirk-a"`): one
signed decision whose quirk shows in several shapes, one entry per shape.
The census counts every entry of a group as used when any entry of the
group covered a difference in the run, because one seed shows only some of
the shapes; an entry with no group is checked alone. The entries of a
group must have the same `approvedBy` and the same `when` (the census
rejects a group that differs), and a group none of whose entries covered
anything is stale as a whole. `group` changes only the stale check, never
what an entry covers.

## Frozen 1.35 contracts (`contracts/`)

What 2.0 must keep, as checks: see `contracts/STABILITY.md` for the tiers,
the evolution rules and the frozen write-log record. They run in the
`conformance:checks` project (core must be built: two of them read
`packages/core/dist`), and every file under `contracts/` is in
`harness.lock.json`.

- `api-surface.test.ts`: the public API of every entry point, printed from
  the built `.d.ts`, plus every declaration an export reaches (`#ref:` keys), equals
  `api-surface.json` (written from the published 1.35.0). Any difference,
  addition included, must be listed in `api-changes.json`; removals and
  changes need Jason's `approvedBy`, additions may be `pending-gate` (the
  census prints them). Stale entries fail.
- `types.test.ts`: compiles `types/check.ts` against 1.35.0's and the
  workspace's built declarations: `SystemLike`, the 46 hook names
  (`types/frozen.ts`) and signatures, every `ObservationEvent` type and
  payload, the `inspect()` shape.
- `golden.test.ts`: `golden/` holds what 1.35.0 writes for one script
  (history export, persistence data, signed snapshot, audit chain). Each
  must still be 1.35.0's output; the workspace must read each as 1.35.0 does
  (tampered and expired reads must fail), write the same bytes for the
  signed snapshot and audit chain, and 1.35.0 must read the workspace's
  history and persistence output as it reads its own.

Each test file also tampers with a copy (a removed export, a renamed hook, a
changed golden byte, an engine that reads or writes differently) and
expects the check to fail. `pnpm --filter @directive-run/conformance
contracts:freeze` rewrites the snapshot and goldens from `directive-v1`;
run it only when the v1 pin moves, then `oracle:update`.

## Layers

`layers.rules.json` (hand-written) gives each file the layer whose behaviour
it tests. `layers.json` (generated) places every test, by the name vitest
reports, at the highest feature it actually uses — see `lib/layers.ts`.
`helpers/layer-gate.ts` fails any test it cannot place.

- `pin: true` marks a correctness file. Its tests may not sit above the rule
  except through a feature listed in `allowAbove`, with the reason.
- `instruments` are features a pinned file uses only to observe. They do not
  raise its tests; the generated file lists them as `pulledDown`, meaning the
  rule's layer must provide them. Today L2 must expose resolver outcome hooks
  (`plugins`), `system.inspect()` for requirement state, and a microtask
  flush.
- Files in the `internals` category are skipped on v2 until WHITE-BOX.md
  triage moves them out. On v2, tests above `current` are skipped too.
- **The vehicle is not a feature.** `createSystem` and `createModule` are how
  every runtime test builds a system, so they do not place it
  (`lib/layers.ts` `VEHICLES`); namespacing, several modules and
  crossModuleDeps still place a test at L1 through their option keys.
- **Per-test placement; the file's rule is a default.** A test is placed by
  the features found in its own body, its describes' hooks and declarations,
  and the file-level code it reaches. The L0 reads, writes and definitions
  (`facts`, `derive`, `events`, `dispatch`, `read`, `subscribe`, `watch`,
  `batch`, and the `init`/`derive`/`events`/`effects` options) count as
  found without raising anything. Only a test that builds a system and shows
  nothing beyond the vehicle and the schema builders (`t`) takes its file's
  `rule`: a lifecycle test in an L3 file that only calls `system.start()`
  sits at L3, while the same file's "facts proxy reads and writes values"
  sits at L0. Basic effects (run, cleanup, auto-tracking) are L0; `deps`,
  `on` and `prev` lift a test to L4; module `hooks`, `initialFacts` and
  `tickMs` are L3. Reflection on an engine object
  (`Object.getOwnPropertyDescriptor`, `Reflect.*`) is L1. Data-form
  derivations (a predicate or `$template` as `compute`) are L11: the
  predicate DSL evaluates them. Dynamic definitions are L10 however the
  registry is reached (`const d = system.derive as Any; d.register(…)`).

## The v2 ratchet (`v2-passing.json`)

The census only proves that v2 runs what the gate allows and that those
tests pass. The ratchet proves nothing core-next once passed stops passing,
above `current` included:

- `pnpm --filter @directive-run/conformance ratchet` runs the four v2
  projects with the layer gate opened (`DIRECTIVE_V2_ALL=1`; only this script
  sets it, and a census run with it set fails) and fails if any test listed
  in `v2-passing.json` does not pass on core-next's source **and** its dist
  twin. CI runs it after the census.
- `ratchet --update` adds every test that now passes on both. It never
  removes one. Run it in the engine PR that made them pass: the file is not a
  harness file, so it may change alongside `packages/core-next`.
- Removing a test means adding a `removed` entry (`project`, `file`, `test`,
  `reason`) in a PR labelled `oracle-change`; the Oracle guard (from the base
  branch) fails a PR that drops a listed test without both
  (`lib/ratchet.ts` `checkShrink`).

## Threat model

The oracle has to resist **accidental** weakening: an agent or a person who,
while making some other change in the same pull request, edits the harness
until a failing engine goes green — narrows an include, adds a setup file,
skips a test, loosens a rule. Every such edit is made to fail loudly or to
need a visible label. It does **not** try to stop a maintainer with write
access who means to weaken it: such a person can relabel, change branch
protection or edit the workflows on main. That is a review problem, not a
tooling one.

## Changing the oracle

The harness and the correctness baseline are the oracle. Changing them is a
deliberate act, made visible on the pull request:

- **`oracle-change` label for any harness change.** The harness is the
  package's own (`vitest.config.ts`, `tsconfig.json`, `package.json`,
  `helpers/`, `self/`, `lib/`, `diff/`, `contracts/`, `scripts/`, `layers.rules.json`,
  `aheadOfV1.json`, `v1-pin.json`, `oracle-baseline.json`,
  `harness.lock.json`) plus what decides how it runs from outside:
  `.github/workflows/*.yml`, the root `package.json`, `pnpm-workspace.yaml`,
  `.npmrc`, and the `pnpm-lock.yaml` entries that resolve `directive-v1` and
  vitest (`lib/lockfile.ts`; other lockfile changes do not count). A PR
  touching any of it fails the **Oracle guard** workflow without the label.
- **The guard never runs the PR's code.** `.github/workflows/oracle-guard.yml`
  uses `pull_request_target`: the workflow and the scripts it runs come from
  the base branch. The head is read only as data through the GitHub API (the
  changed-file list, the labels in the event payload, and `pnpm-lock.yaml`,
  `v2-passing.json` and `diff/divergences.json` at both ends as text) and is
  never checked out, installed or executed. The token is
  read-only and no secrets are used. A PR therefore cannot rewrite the rule
  that judges it; a change to the guard takes effect from the PR after it
  merges.
- **The correctness baseline only tightens.** `oracle-baseline.json` records
  every pinned file, its instruments and allowAbove reasons, and the layer of
  every test in a pinned file. Without regenerating it, pins and instruments
  may only grow, allowAbove may only shrink, and no correctness test may
  move up a layer.
- **The lock catches what the label misses locally.** `harness.lock.json` is
  checked by the census and the tree-mode guard, so an edit made without
  `oracle:update` fails `pnpm conformance` before it reaches a PR.
- **Engine and oracle land separately.** A PR that touches
  `packages/core-next/**` and any of the package's harness files fails, label
  or not. Ported `tests/` may change alongside the engine.
- **Except signed divergences (Jason, 2026-11-01).** An engine change that
  makes an approved difference visible may carry its entry: the PR's harness
  files may be only `diff/divergences.json`, with or without
  `harness.lock.json` (never the lock alone), and every entry it adds or
  changes (by `id`, against the base) must have a non-empty `approvedBy`,
  and a changed entry must be signed afresh (a new `approvedBy` or `date`).
  Removing an entry needs no signature, since it only tightens the oracle
  (an engine fix that closes a divergence drops its entry in the same PR).
  The label is still required, the census still
  fails an entry that covers no real difference, and a head the guard cannot
  parse fails closed.

To change the harness: edit, run `oracle:update`, run `pnpm conformance`,
open the PR with the `oracle-change` label, and say in the description what
the oracle now accepts that it did not before.

## What main enforces today, and after the Phase 0 gate

- The `conformance` job blocks: it has no `continue-on-error`, and it is a
  required status check on main. A red check-expects, census, ratchet or
  tree-mode guard fails the run.

## When it fails

| What fails | What it means | What to do |
| --- | --- | --- |
| `check-expects` | A port no longer matches core's test, core gained or changed a test, or a committed file was edited | `pnpm --filter @directive-run/conformance port`, review the diff, commit |
| `check-expects`: a pinned test above its rule | A correctness test started using a higher-layer feature | Add an `instruments` entry if it only observes, or an `allowAbove` reason if the feature is part of the rule |
| `layer-gate`: no entry for a test | A test name the generator could not see | Re-run the port; if it persists, the title is computed — check `lib/tests.ts` |
| local fails, v1 passes | A 1.x regression in the workspace | Fix core |
| v1 fails on a newly ported test, local passes | The behaviour is in the workspace but not in a release | Add the test to `aheadOfV1.json` (pin it behind) |
| both fail | The port or the test is broken | Fix the original in core, re-port |
| engine identity | A project resolves the wrong engine, or something mocks or wraps core | Fix `vitest.config.ts` or remove the mock |
| census | The run skipped, filtered or dropped tests, the config changed, or a harness file differs from the lock | Undo the change, or make it deliberately (Changing the oracle) |
| diff: "engines differ" | The engine under test behaves differently from 1.35 | Fix the engine; if the difference is intended, ask Jason to approve a `divergences.json` entry |
| diff: a hook never fired | A plugin hook no scenario or fuzz case reaches | Add a scenario that fires it, or list it in `diff/unfired-hooks.json` with a reason |
| diff: a source fault went unnoticed | A faulted copy of core passes every scenario | Add the scenario that would catch it |
| diff: "not deterministic" | The reference run twice gave different traces: the scenario or recorder depends on something outside the run | Fix the scenario or the recorder; never a divergence |
| diff: a stale divergence | An approved difference no longer occurs | Remove the entry |
| ratchet: a listed test no longer passes | core-next regressed something it once passed (on source, or only in the built dist: a mangled member, the folded dev check) | Fix core-next; removing the entry needs a reason and the `oracle-change` label |
| oracle-guard (tree) | The baseline loosened, or a harness file differs from the lock | Undo it, or `oracle:update` and label the PR |
| Oracle guard (PR) | The PR changes the harness without the `oracle-change` label, or changes core-next and the harness together (beyond signed divergences) | Label it if the change is deliberate; split engine and oracle PRs, or have Jason sign the divergence |

## The v1 pin rule

- Each release moves the pin. The PR right after a release publishes bumps
  the `directive-v1` alias in `package.json` to that version, runs
  `pin:v1` (which downloads the tarball, checks it against the lockfile
  integrity and records every file's hash in `v1-pin.json`) and empties
  `aheadOfV1.json` of what it shipped. It carries the `oracle-change` label. (Not the Version Packages PR itself:
  the version must exist on npm before the frozen lockfile can pin it.)
- `aheadOfV1.json` lists, by port path and test name, tests whose behaviour no
  release has shipped yet, each with a reason. No wildcards. v1 skips exactly
  these (the census fails if one passes or anything else is skipped); local
  still runs them. It is a harness file, so changes carry the label.

Never published. Do not edit `tests/` or `layers.json` by hand.

Phase 0 gate decisions (targets, frozen contracts, the four 1.35 bugs): [`contracts/GATE-0.md`](contracts/GATE-0.md).
