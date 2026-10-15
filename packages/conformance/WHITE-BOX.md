# Tests the conformance suite does not run

`scripts/port.ts` copies a core test only when every import resolves to
something `@directive-run/core` publishes. The 15 files below do not, so they
stay in `packages/core` and run only against 1.x. This file proposes a fate for
each one. **Nothing is decided here** — the fates are confirmed at the Phase 0
gate, and no test is deleted or rewritten before then.

Regenerate the inventory with `pnpm --filter @directive-run/conformance port`;
`scripts/classification.json` holds the exact imports.

## Fates

- **split** — most of the file tests public behaviour. Move the public cases to
  a black-box file the port picks up; leave the internal cases in core.
- **rewrite** — the internal call stands in for behaviour the public API can
  reach. Rewrite against the public API, same expectations.
- **unit** — a unit test of a module 2.0 keeps. Re-home it next to that module
  in core-next when the layer that owns it is built.
- **retire** — tests a 1.x implementation detail 2.0 removes (Proxies, flat
  keys, managers). Retires with 1.x; the behaviour it guarded must already be
  covered by a black-box test, which the gate checks.

## White-box (14 files, 639 cases)

| File | Cases | Internal imports | Proposed fate | Layer |
| --- | ---: | --- | --- | --- |
| `core/__tests__/multi-module-correctness.test.ts` | 35 | `createCrossModuleFactsProxy` (one test, lines ~481–510) | **split**: the 30 `createSystem` cases are black-box; the proxy case retires with Proxies | L1 / L5 |
| `core/__tests__/meta.test.ts` | 52 | `freezeMeta`, `isDerivationWithMeta` | **split**: 44 `createSystem` cases port; the two helper groups are **unit** | L9 |
| `core/__tests__/effects-lazy-prev-facts.test.ts` | 12 | `declaresPrevFacts` | **split**: the system cases port; the `declaresPrevFacts` block retires (2.0's double-buffered prev makes the arity sniff unnecessary) | L4 |
| `core/__tests__/sweep-under.test.ts` | 20 | dynamic `import("../sweep-under.js")` for `MAX_SWEEP_EVALUATIONS` (one case) | **split**, or export the constant: one case blocks 19 | L11 |
| `core/__tests__/predicate.test.ts` | 149 | `attributeError`, `freezeSpec`, `MAX_PREDICATE_DEPTH`, `isEmptyOrConfigPredicate`, `walkPredicate` | **split**: evaluation cases port through the public predicate API; walker and freeze cases are **unit** | L11 |
| `core/__tests__/predicate-describe.test.ts` | 55 | number-format cache internals | **split**: `describe` output cases port; cache-size cases are **unit** | L11 |
| `core/__tests__/effects.test.ts` | 53 | `derivationDep`, plus `createEffectsManager` / `createFacts` | **rewrite**: drives the effects manager directly; every case is reachable through `createSystem` | L0 / L4 |
| `core/__tests__/requirements.test.ts` | 32 | `createRequirementWithId` | **rewrite** the identity and key cases through constraints; requirement ids built from content become a frozen contract in 2.0 (resumable resolvers) | L2 |
| `core/__tests__/system-module-transform.test.ts` | 66 | `prefixModuleDefinition` | **retire**: the 1.x namespacing transform; 2.0 compiles modules into a blueprint. Gate: namespacing behaviour covered by module / multi-module tests | L1 |
| `core/__tests__/system-proxies.test.ts` | 98 | the namespaced Proxy factories, `SEPARATOR`, `toInternalKey`, `denormalizeFlatKeys` | **retire**: 2.0 replaces these Proxies with compiled accessors. Gate: the 98 cases' observable behaviour is covered black-box before retiring | L1 |
| `core/__tests__/facts-nested-proxy-layering.test.ts` | 3 | `DEV_PROXY_TARGET` | **retire** with the dev Proxy layering; keep its intent (no double-wrapping) as a black-box nested-write case | L1 |
| `plugins/__tests__/audit-ledger-payload-shapes.test.ts` | 5 | `asRecorded` | **unit** for the audit-ledger plugin | L12 |
| `plugins/__tests__/devtools-helpers.test.ts` | 44 | 15 devtools internals (buffers, limits, formatters) | **unit** for the devtools plugin | L12 |
| `utils/__tests__/license.test.ts` | 15 | `generateNonce`, `validateLicenseKey` | **unit**, or retire if licence checks are not part of 2.0 — needs Jason | — |

## Packaging (1 file, 7 cases)

| File | Cases | Why not ported | Proposed fate |
| --- | ---: | --- | --- |
| `__tests__/dev-mode-bundle.test.ts` | 7 | Reads core's `dist/` and `package.json` to check what each build ships | **retire** with the 1.x build; 2.0's size budgets and dev-text gates replace it |

## Ported, but leaning on `/internals` (9 files, 335 cases)

These run in the suite today (`internals` in `classification.json`) but call
1.35's manager factories or tracking primitives through
`@directive-run/core/internals`, which has no semver promise. core-next will
not ship the same managers, so each needs one of the fates above before it
counts toward `conformance:v2`:

| File | Cases | `/internals` values | Proposed fate |
| --- | ---: | --- | --- |
| `core/constraints.test.ts` | 24 | `createConstraintsManager`, `createFacts` | rewrite |
| `core/derivations.test.ts` | 27 | `createDerivationsManager`, `createFacts` | rewrite |
| `core/resolvers.test.ts` | 71 | `createResolversManager`, `createFacts` | rewrite |
| `core/error-boundary.test.ts` | 22 | `createErrorBoundaryManager` | rewrite |
| `core/plugins.test.ts` | 41 | `createPluginManager` | rewrite against `plugins: [...]` |
| `core/sources.test.ts` | 81 | `createSourcesManager` | rewrite against `source()` |
| `core/tracking.test.ts` | 13 | tracking primitives | **unit** for the L0 graph |
| `core/perf-correctness.test.ts` | 17 | six managers | rewrite |
| `utils/history.test.ts` | 39 | `createHistoryManager`, facts store | rewrite against `history()` |

Type-only imports of non-public types (`PrefixModuleOptions`,
`ClobberSummaryEvent`) are erased at runtime and do not block a port; they are
listed in `classification.json` as `typeOnlyNonPublic`.
