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
  One inserted hook is one difference, not a cascade.
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
  system in the same engine instance). PR CI runs the fixed seed for 205
  cases (`FUZZ_DEFAULT_RUNS`); the census fails fewer than 200 compared (`lib/fuzz.ts`
  `FUZZ_FLOOR`) or more than max(1% of cases, 2) runaways — and
  `.github/workflows/diff-fuzz-nightly.yml` runs 5,000 from a random seed
  it prints; failures shrink and print the seed and spec.
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

Advisories are printed with the scenario and never fail it. Changing this
table, or `diff/compare.ts`, changes the contract: it is an oracle change
(label) and Jason's call (CODEOWNERS).

**Divergences.** An intended difference between the engines goes in
`diff/divergences.json`, keyed by what differs, never by trace index:
`{ id, scenario, stream, kind, reason, approvedBy, date }`, optionally
narrowed by `engine`, `step`, `op` (`missing` / `extra` / `changed`) and
`path` (inside the entry; a prefix covers everything under it). **Jason
approves every entry; an agent never adds one, and never fills in
`approvedBy`.** The census fails an entry that is incomplete or unsigned,
or that covered no difference in the run (stale). The file is part of the
harness, so adding one needs `oracle:update` and the `oracle-change`
label, and CODEOWNERS puts it under Jason's review.

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
  changed-file list, the labels in the event payload, `pnpm-lock.yaml` as
  text) and is never checked out, installed or executed. The token is
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
| Oracle guard (PR) | The PR changes the harness without the `oracle-change` label, or changes core-next and the harness together | Label it if the change is deliberate; split engine and oracle PRs |

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
