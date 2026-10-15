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
pnpm conformance                                 # check-expects, then every project
pnpm --filter @directive-run/conformance typecheck
pnpm --filter @directive-run/conformance port    # re-copy after core's tests change
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
  project loads the engine it claims (the pinned npm version, or the
  workspace source), for every entry point.
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

## When it fails

| What fails | What it means | What to do |
| --- | --- | --- |
| `check-expects` | A port no longer matches core's test, core gained or changed a test, or a committed file was edited | `pnpm --filter @directive-run/conformance port`, review the diff, commit |
| `check-expects`: a pinned test above its rule | A correctness test started using a higher-layer feature | Add an `instruments` entry if it only observes, or an `allowAbove` reason if the feature is part of the rule |
| `layer-gate`: no entry for a test | A test name the generator could not see | Re-run the port; if it persists, the title is computed — check `lib/tests.ts` |
| local fails, v1 passes | A 1.x regression in the workspace | Fix core |
| v1 fails on a newly ported test, local passes | The behaviour is in the workspace but not in a release | Add the test to `aheadOfV1.json` (pin it behind) |
| both fail | The port or the test is broken | Fix the original in core, re-port |
| engine identity | A project resolves the wrong engine | Fix `vitest.config.ts` |

## The v1 pin rule

- Each release moves the pin. The PR right after a release publishes bumps
  the `directive-v1` alias in `package.json` to that version and empties
  `aheadOfV1.json` of what it shipped. (Not the Version Packages PR itself:
  the version must exist on npm before the frozen lockfile can pin it.)
- `aheadOfV1.json` lists, by port path and test name, tests whose behaviour no
  release has shipped yet. v1 skips them; local still runs them.

Never published. Do not edit `tests/` or `layers.json` by hand.
