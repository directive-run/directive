# @directive-run/conformance (private)

The 2.0 oracle. Core's black-box tests, copied unchanged and run against more
than one engine:

| Project | Engine |
| --- | --- |
| `conformance:v1`, `conformance:v1:prod` | the published release pinned by the `directive-v1` npm alias (now `@directive-run/core@1.35.0`), development and production builds. The reference. |
| `conformance:local`, `conformance:local:prod` | the workspace's `packages/core` source |
| `conformance:v2` (commented slot) | core-next, from Phase 1 |
| `conformance:checks` | the tamper tests for `check-expects` |

```bash
pnpm --filter @directive-run/core build          # two tests use the built package
pnpm conformance                                 # check-expects, census, oracle guard
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
- `harness.lock.json` pins the sha256 of every harness file (config, helpers,
  self tests, lib, scripts, tsconfig, package.json, `aheadOfV1.json`,
  `oracle-baseline.json`). Any harness edit needs `oracle:update`, and a PR
  that changes the lock needs the `oracle-change` label.
- `scripts/oracle-guard.ts` (`lib/guard.ts`) enforces the rules for changing
  the oracle, below.
- `tsconfig.json` typechecks the ports against workspace source, so ported
  `expectTypeOf` and `@ts-expect-error` lines are enforced. `noUnusedLocals`
  is off: a declared rewrite can leave an original's helper unused.

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
  `helpers/`, `self/`, `lib/`, `scripts/`, `layers.rules.json`,
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

- **Today:** the `conformance` job runs on every push with
  `continue-on-error: true`, so a red oracle is visible but does not block a
  merge. The Oracle guard workflow runs on every PR but is not a required
  check. Nothing here changes repository settings.
- **At the Phase 0 gate (Jason's decision):** make `conformance` and
  `Oracle guard` required status checks on main, decide whether
  `enforce_admins` applies to them, and remove `continue-on-error` from the
  `conformance` job (the TODO in ci.yml). Until then the guarantees above
  hold only as far as people respect a red check.

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
