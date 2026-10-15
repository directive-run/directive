# Tests the conformance suite does not run, or does not count yet

`scripts/port.ts` copies a core test only when every import resolves to
something `@directive-run/core` publishes. The files below either do not
qualify or lean on `/internals`. This file proposes a fate for each.
**Nothing here is decided** — the fates are confirmed at the Phase 0 gate,
and no core test is deleted or rewritten before then.

`scripts/classification.json` holds the exact imports; `pnpm conformance`
fails if it drifts from what core's tests actually import.

## Fates

- **split** — most of the file tests public behaviour. Move the public cases to
  a black-box file the port picks up; leave the internal cases in core.
- **rewrite** — the internal call stands in for behaviour the public API can
  reach. Rewrite against the public API, same expectations.
- **unit** — a unit test of a module 2.0 keeps. Re-home it next to that module
  in core-next when the layer that owns it is built.
- **retire** — tests a 1.x implementation detail 2.0 removes. A file retires
  only after the black-box tests named for it below exist and pass on v1.

## White-box (14 files, 639 cases)

| File (`packages/core/src/…`) | Cases | Internal imports | Proposed fate | Layer |
| --- | ---: | --- | --- | --- |
| `core/__tests__/multi-module-correctness.test.ts` | 35 | `createCrossModuleFactsProxy` (one test, ~lines 481–510) | **split**: the 30 `createSystem` cases port; the proxy case retires with Proxies | L1 / L5 |
| `core/__tests__/meta.test.ts` | 52 | `freezeMeta`, `isDerivationWithMeta` | **split**: 44 `createSystem` cases port; the two helper groups are **unit** | L9 |
| `core/__tests__/effects-lazy-prev-facts.test.ts` | 12 | `declaresPrevFacts` | **split**: keep "an effect that declares `prev` gets the previous facts, one that does not still runs" as a public test; the arity-sniff block retires with the sniff | L4 |
| `core/__tests__/sweep-under.test.ts` | 20 | dynamic `import("../sweep-under.js")` for `MAX_SWEEP_EVALUATIONS` (one case) | **split**: move that case into a core-only file; the other 19 port. Do not export the constant | L11 |
| `core/__tests__/predicate.test.ts` | 149 | `attributeError`, `freezeSpec`, `MAX_PREDICATE_DEPTH`, `isEmptyOrConfigPredicate`, `walkPredicate` | **split**: evaluation cases port through the public predicate API; walker and freeze cases are **unit** | L11 |
| `core/__tests__/predicate-describe.test.ts` | 55 | number-format cache internals | **split**: `describe` output cases port; cache-size cases are **unit** | L11 |
| `core/__tests__/effects.test.ts` | 53 | `derivationDep`, `createEffectsManager`, `createFacts` | **rewrite**: drives the effects manager directly; every case is reachable through `createSystem` | L0 / L4 |
| `core/__tests__/requirements.test.ts` | 32 | `createRequirementWithId` | **rewrite**, and add one public test: requirement ids derived from content (same requirement → same id across runs and systems). 2.0 freezes that id as a contract for resumable resolvers | L2 |
| `core/__tests__/system-module-transform.test.ts` | 66 | `prefixModuleDefinition`, type `PrefixModuleOptions` | **retire** after its replacements exist (below). The type import retires with it; it is not made public | L1 |
| `core/__tests__/system-proxies.test.ts` | 98 | the namespaced Proxy factories, `SEPARATOR`, `toInternalKey`, `denormalizeFlatKeys` | **retire** after its replacements exist (below); 2.0 replaces these Proxies with compiled accessors | L1 |
| `core/__tests__/facts-nested-proxy-layering.test.ts` | 3 | `DEV_PROXY_TARGET` | **retire** with the dev Proxy layering; keep its intent as a black-box nested-write case | L1 |
| `plugins/__tests__/audit-ledger-payload-shapes.test.ts` | 5 | `asRecorded` | **unit** for the audit-ledger plugin | L12 |
| `plugins/__tests__/devtools-helpers.test.ts` | 44 | 15 devtools internals (buffers, limits, formatters) | **unit** for the devtools plugin | L12 |
| `utils/__tests__/license.test.ts` | 15 | `generateNonce`, `validateLicenseKey` | **Jason, at the Phase 0 gate** — see below | — |

### Black-box replacements required before a retire

`system-proxies` and `system-module-transform` guard namespacing. They retire
only once these exist as public tests and pass on v1:

1. **Namespaced reads and writes**: `system.facts.<ns>.<key>` reads, writes and
   `in`/`Object.keys` enumeration per module; a write to another module's fact
   from a module's own definitions is rejected (dev) / ignored (prod).
2. **Flat-key surfaces**: every API that accepts or reports a key
   (`observe`, `inspect`, `snapshot`/`restore`, history export, plugin hook
   payloads) uses the same `ns::key` spelling, and round-trips it.
3. **Prefixing every definition kind**: constraints, resolvers, effects,
   derivations, events and sources registered by a module are addressable
   under that module's namespace and only there, including `crossModuleDeps`
   reads (`ctx.deps`) and the `$store` escape hatch.
4. **Single-module systems**: no namespace prefix appears anywhere the user
   can see.
5. **Collision rules**: two modules with the same local key never alias; a
   module named like a key never aliases.

### The licence check

`src/utils/license.ts` validates `dk_live_` keys offline against an embedded
RSA public key. Nothing in core imports it: it is dead code that ships in the
source tree. Options for the Phase 0 gate (not acted on here):

- **(a)** Delete it, and its test, from 1.x.
- **(b)** Move it to a Directive Cloud package that owns licensing.

## Packaging (1 file, 7 cases)

| File | Cases | Why not ported | Proposed fate |
| --- | ---: | --- | --- |
| `__tests__/dev-mode-bundle.test.ts` | 7 | Reads core's `dist/` and `package.json` to check what each build ships | **retire** with the 1.x build; 2.0's size budgets and dev-text gates replace it |

`packages/core/__tests__/dist-types.test.ts` *is* ported: it typechecks a
consumer fixture against the engine's published declarations, which is a
contract every engine must keep. `src/core/__tests__/derivations-without-schema.test-d.ts`
is ported too; it has no runtime cases and is enforced by the suite's
`typecheck`.

## Ported, but leaning on `/internals` (10 files, 442 cases)

These run on v1 and local (`category: "internals"` in layers.json) but call
1.35's managers or tracking primitives through `@directive-run/core/internals`,
which has no semver promise. **`conformance:v2` skips them** until each has a
fate below; they do not count toward any 2.0 layer until then.

| File | Cases | `/internals` values | Proposed fate |
| --- | ---: | --- | --- |
| `core/constraints.test.ts` | 24 | `createConstraintsManager`, `createFacts` | rewrite |
| `core/derivations.test.ts` | 27 | `createDerivationsManager`, `createFacts` | rewrite |
| `core/facts.test.ts` | 107 | `createFacts`, `createFactsProxy`, `createFactsStore` | rewrite the store cases through `system.facts`; Proxy cases retire |
| `core/resolvers.test.ts` | 71 | `createResolversManager`, `createFacts` | rewrite |
| `core/error-boundary.test.ts` | 22 | `createErrorBoundaryManager` | rewrite |
| `core/plugins.test.ts` | 41 | `createPluginManager` | rewrite against `plugins: [...]` |
| `core/sources.test.ts` | 81 | `createSourcesManager` | rewrite against `source()` — **required gap, below** |
| `core/tracking.test.ts` | 13 | tracking primitives | **unit** for the L0 graph |
| `core/perf-correctness.test.ts` | 17 | six managers | rewrite |
| `utils/history.test.ts` | 39 | `createHistoryManager`, facts store | rewrite against `history()` |

## Required gaps

Behaviour the plan puts in a layer that no black-box test covers yet. Each
must be filled before that layer's gate.

- **L5 sources.** `sources.test.ts` drives `createSourcesManager`, so L5 has
  no black-box test. Needed: a public scenario set for `source()` covering
  attach/detach, the `key` and `active` gates (with module-local facts),
  linger, coalescing, `onEvict`, module-scoped `publish` (including the
  `cross-module-event` and `unknown-event` drop reasons), and `localId`.
- **L2 coalescing.** The four coalescing tests in
  `reconcile-timing-rules.test.ts` count history snapshots per pass, so they
  sit at L8 (`allowAbove` in layers.rules.json). Needed: the same four rules
  observed without history (pass count through a plugin hook or `inspect()`).
- **L2 requirement identity.** Content-derived requirement ids (see
  `requirements.test.ts` above).
