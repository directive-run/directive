# Tests the conformance suite does not run, or does not count yet

`scripts/port.ts` copies a core test only when every import resolves to
something `@directive-run/core` publishes. The files below either do not
qualify or lean on `/internals`. This file proposes a fate for each.
Jason approved these fates at the Phase 0 gate on 2026-10-18. A retire still
waits until its black-box replacements pass on v1.

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

## White-box (13 files, 624 cases)

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
| `utils/__tests__/license.test.ts` | 15 | `generateNonce`, `validateLicenseKey` | **deleted at the Phase 0 gate (option a)** — see below | — |

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
source tree. Decided at the Phase 0 gate on 2026-10-18: **option (a)**, delete
it and its test from 1.x. The file was unreachable from every entry point, so
it never shipped in the published package. (Option (b), moving it to a
Directive Cloud package, was not taken.)

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
| `core/sources.test.ts` | 81 | `createSourcesManager` | rewrite as black-box tests through a module's `sources:` key (L5-pre; the 68 L5 cases are mapped below); the `source()` form is a port at the beta |
| `core/tracking.test.ts` | 13 | tracking primitives | **unit** for the L0 graph |
| `core/perf-correctness.test.ts` | 17 | six managers | rewrite |
| `utils/history.test.ts` | 39 | `createHistoryManager`, facts store | rewrite against `history()` |

## Required gaps

Behaviour the plan puts in a layer that no black-box test covers yet. Each
must be filled before that layer's gate.

- **L5 sources.** `sources.test.ts` drives `createSourcesManager`, so v2
  skips it. Needed: black-box tests through a module's `sources:` key
  covering attach/detach, the `key` and `active` gates (with module-local
  facts), linger, coalescing, `onEvict`, and module-scoped `publish`
  (including the `cross-module-event` and `unknown-event` drop reasons).
  Filled at L5-pre by the mapping below and the diff scenarios in
  `diff/scenarios/l5-sources-pins.test.ts`. `localId` is a field of the
  `inspect().sources` row, so it belongs at L9, with the row's counters.

### `sources.test.ts`: the 68 L5 cases (L5-pre)

The file has 81 cases. The other 13 are placed above L5 and stay with their
layers: 11 at L9 (`inspect().sources` and its counters, `meta`, the three
`source.*` `observe` events), 1 at L10 (`registerModule`) and 1 at L8 (the
replay guard). Of the 68: **10 ported**, **52 rewritten**,
**1 deferred to L9**, **4 deferred to L10**, **1 internal**. Every
replacement lives in `packages/core/src/core/__tests__/` and runs at L5:
`l5-sources-oracle`, `l5-sources-oracle-lifecycle`, `l5-sources-oracle-teardown`, `l5-sources-oracle-gates` and `l5-sources-oracle-ported` (`.test.ts` omitted). A ported case keeps its
title and assertions; a rewritten one tests the same behaviour through
`createSystem`, plugin source hooks and the source's own callbacks.

| # | Case | Fate | Black-box test, or reason |
| ---: | --- | --- | --- |
| 1 | attaches a single source on attachAll and detaches on cleanupAll | rewritten | `l5-sources-oracle` › plugins and a source's lifecycle › hear its attach at start, its publish, and its detach at stop, which unsubscribes it |
| 2 | attaches multiple sources in registration order, detaches in reverse | rewritten | `l5-sources-oracle-lifecycle` › sources follow attach order › at stop, with a gated source declared first (U7) |
| 3 | publish callback dispatches events into the supplied dispatcher with per-source attribution | rewritten | `l5-sources-oracle-lifecycle` › a publish › is attributed to the source that made it; › made inside attach at start is applied before start() returns (U5) |
| 4 | isolates attach failures — one bad source does not block others | rewritten | `l5-sources-oracle` › a source whose attach throws › is reported to plugins as an attach error, and the next source still attaches |
| 5 | rejects sources whose attach returns something other than a function | rewritten | `l5-sources-oracle-lifecycle` › an attach that does not return an unsubscribe function › is an attach error naming its module, and the source is never attached or detached (the message text is asserted as the original did) |
| 6 | isolates unsubscribe failures — one bad cleanup does not block others | rewritten | `l5-sources-oracle-lifecycle` › a source's unsubscribe at stop › that throws is a cleanup error, and the other sources still unsubscribe, in reverse |
| 7 | cleanupAll is idempotent — second call is a no-op | rewritten | `l5-sources-oracle-lifecycle` › a source's unsubscribe at stop › runs once: a second stop(), and destroy() after stop(), unsubscribe nothing more |
| 8 | forwards attach + cleanup failures to the optional onError sink | rewritten | `onSourceError` phases `attach` and `cleanup`: `l5-sources-oracle` › a source whose attach throws; `l5-sources-oracle-lifecycle` › … › that throws is a cleanup error |
| 9 | supports start→stop→start→stop lifecycle without leaking subscriptions | rewritten | `l5-sources-oracle-lifecycle` › stop then start › attaches the source again, and each cycle unsubscribes once |
| 10 | cleanupAll on an idle manager (never started) is a safe no-op | rewritten | `l5-sources-oracle-lifecycle` › a source's unsubscribe at stop › never runs on a system that was never started |
| 11 | clears the attached array after cleanup so memory does not grow across cycles | rewritten | `l5-sources-oracle-lifecycle` › stop then start (one attach and one unsubscribe per cycle; the array itself is internal) |
| 12 | registerDefinitions adds new sources before start; they attach at start | internal | `registerDefinitions` is a manager method. Its public form is a module's `sources:` at `createSystem`, which every test above uses; registering at runtime is `registerModule` (L10) |
| 13 | registerDefinitions attaches immediately if the system is already running | deferred to L10 | public behaviour, reachable only through `registerModule` (L10); see the L10 gap below |
| 14 | error messages name the module so multi-module collisions are debuggable | rewritten | the module reaches plugins as `onSourceError`'s `moduleId`: `l5-sources-oracle` › a source whose attach throws; and the logged line names the module and the source, as the original asserted: `l5-sources-oracle` › a source whose attach throws, in a named module |
| 15 | error message on missing unsubscribe function names the module | rewritten | `l5-sources-oracle-lifecycle` › an attach that does not return an unsubscribe function › names its module and its source in the message (the logged line and the plugin's error, both with `Module "the-mod"`, `Source "forgot"` and the "did not return an unsubscribe function" text) |
| 16 | attach that returns null / number / string is treated as missing cleanup | rewritten | `l5-sources-oracle-lifecycle` › the same test, over `undefined`, `null`, `0` and `"no"` |
| 17 | onAttach fires ONLY for sources whose attach succeeded (not for those that threw) | rewritten | `l5-sources-oracle` › a source whose attach throws (no attach is heard for it) |
| 18 | onAttach does NOT fire for sources that return a non-function (forgotten cleanup) | rewritten | `l5-sources-oracle-lifecycle` › an attach that does not return an unsubscribe function |
| 19 | onPublish fires with per-source attribution (not by event-name lookup) | rewritten | `l5-sources-oracle-lifecycle` › a publish › is attributed to the source that made it, when two sources publish the same event; and, with the `moduleId` asserted, › … to the module that declared its source, when two modules' sources publish the same event |
| 20 | onDetach fires in reverse-registration order before each unsubscribe | rewritten | `l5-sources-oracle-lifecycle` › sources follow attach order › at stop … each detach is heard before its unsubscribe, in reverse |
| 21 | registerDefinitions during attached phase fires onAttach immediately for new sources | deferred to L10 | public behaviour, reachable only through `registerModule` (L10); see the L10 gap below |
| 22 | re-registering an attached source unsubscribes the old one before attaching the new one | deferred to L10 | public behaviour, reachable only through `registerModule` (L10); see the L10 gap below |
| 23 | post-destroy publish is a silent no-op (does not crash, does not dispatch) | ported | `l5-sources-oracle-ported` |
| 24 | rejects source ids that match BLOCKED_PROPS (prototype pollution defense) | ported | `l5-sources-oracle-ported` |
| 25 | source publish dispatches into the system's event handlers | ported | `l5-sources-oracle-ported` |
| 26 | source unsubscribe runs at system.stop() | ported | `l5-sources-oracle-ported` |
| 27 | source unsubscribe runs at system.destroy() via stop() | ported | `l5-sources-oracle-ported` |
| 28 | multiple modules can each declare sources; ordering is per-module flat | ported | `l5-sources-oracle-ported` |
| 29 | dispatcher drops publishes whose event names walk the prototype chain | ported | `l5-sources-oracle-ported` |
| 30 | publishes between stop() and the next start() silently drop | ported | `l5-sources-oracle-ported` |
| 31 | manager: OLD source's captured publish ref no-ops after re-registration replaces the source | deferred to L10 | public behaviour, reachable only through `registerModule` (L10); see the L10 gap below |
| 32 | returning a Promise from attach() gets a Promise-specific error | rewritten | `l5-sources-oracle-lifecycle` › an attach that does not return an unsubscribe function › is an attach error that names the Promise when attach returns one ("attach() must be synchronous" asserted on the logged line and the plugin's error) |
| 33 | onPublish only fires for accepted publishes (not for engine-rejected drops) | rewritten | `l5-sources-oracle` › a publish the engine refuses › is a drop with its reason …; the accepted half: `l5-sources-oracle` › plugins and a source's lifecycle |
| 34 | onDrop fires with the engine's drop reason on rejected publishes | rewritten | `l5-sources-oracle` › a publish the engine refuses › is a drop with its reason: an empty name, a blocked name, a name with no handler (each hook's `moduleId` is asserted, here the module `m`; the recorders in the lifecycle, gates and main files all log it) |
| 35 | onDrop fires with reason "coalesced" on the lastWriteWins manager drop | rewritten | `l5-sources-oracle-gates` › coalesce › lastWriteWins dispatches only the last of a burst … |
| 36 | lastError.message is truncated at SOURCE_ERROR_MESSAGE_MAX (256) chars | deferred to L9 | `inspect().sources[].lastError`; the cut itself is pinned through plugins by `l5-sources-oracle-lifecycle` › a source error's message › reaches plugins cut to its first 256 characters |
| 37 | onError callback receives an Error whose message is truncated to SOURCE_ERROR_MESSAGE_MAX | rewritten | `l5-sources-oracle-lifecycle` › a source error's message › reaches plugins cut to its first 256 characters |
| 38 | coalesce: lastWriteWins debounces same-event-name publishes per microtask | rewritten | `l5-sources-oracle-gates` › coalesce › lastWriteWins dispatches only the last of a burst (its `publishCount` / `dropCount` are L9 `inspect()` counters) |
| 39 | coalesce: lastWriteWins keys per-event-name (storm does not drop one-shots) | rewritten | `l5-sources-oracle-gates` › coalesce › lastWriteWins coalesces per event name, and flushes in first-publish order |
| 40 | coalesce: "all" and unset behave like "none" — every publish dispatches synchronously | rewritten | `l5-sources-oracle-gates` › coalesce › "all", and no coalesce option, dispatch every publish at once |
| 41 | RFC 0008: reportError routes mid-flight errors with phase: 'runtime' | rewritten | `l5-sources-oracle-lifecycle` › reportError › reports a runtime error to plugins while attached … (the row's `errorCount` is L9) |
| 42 | RFC 0008: reportError after detach is a silent no-op (matches publish-detached semantics) | rewritten | `l5-sources-oracle-lifecycle` › reportError › … and does nothing after detach |
| 43 | RFC 0009: cleanupAllAsync awaits async unsubscribes; cleanupAll fire-and-forgets them | rewritten | `l5-sources-oracle-teardown` › an async unsubscribe › is not awaited by stop(), and is awaited by stopAsync() |
| 44 | RFC 0009: evictAll fires onEvict in registration order, isolates failures | rewritten | `l5-sources-oracle-teardown` › evict() › runs each source's onEvict in order, and a throwing one is a runtime error …; the order with a gated source: `l5-sources-oracle-lifecycle` › sources follow attach order › at evict (U7) |
| 45 | RFC 0009: evictAll is a no-op for sources without onEvict | rewritten | `l5-sources-oracle-teardown` › evict() › with no onEvict on the source resolves, and unsubscribes it once |
| 46 | cleanupAllAsync isolates a hung unsubscribe via timeout | rewritten | `l5-sources-oracle-teardown` › an async unsubscribe › that hangs is given up on by stopAsync() as a cleanup error … |
| 47 | evictAll isolates a hung onEvict via timeout | rewritten | `l5-sources-oracle-teardown` › evict() › gives up on an onEvict that hangs as a runtime error … |
| 48 | evictTimeoutMs override wins over the package default for cleanupAllAsync | rewritten | `l5-sources-oracle-teardown` › an async unsubscribe › is waited on for its own evictTimeoutMs … |
| 49 | evictTimeoutMs override wins over the package default for evictAll | rewritten | `l5-sources-oracle-teardown` › evict() › waits on an onEvict for its own evictTimeoutMs … |
| 50 | evictTimeoutMs: Infinity disables the cap for that source only | rewritten | `l5-sources-oracle-teardown` › evict() › with evictTimeoutMs Infinity reports no error for an onEvict that finishes |
| 51 | does not attach or publish before the gate first opens (rising edge) | rewritten | `l5-sources-oracle-gates` › an active gate › attaches nothing before it first opens, attaches on its rising edge … |
| 52 | runs unsubscribe when the gate closes (not just at destroy) | rewritten | `l5-sources-oracle-gates` › an active gate › … and unsubscribes when it closes |
| 53 | re-key tears the old subscription down BEFORE attaching the new one | rewritten | `l5-sources-oracle-gates` › a key gate › passes the key to attach, and a re-key tears the old subscription down before attaching the new one |
| 54 | re-key gives the coalesce buffer a fresh start (no stale pending) | rewritten | `l5-sources-oracle-gates` › a key gate › gives a re-keyed source an empty coalesce buffer … |
| 55 | evictAll skips a detached / never-attached (null-key) source | rewritten | `l5-sources-oracle-teardown` › evict() › skips a gated source whose gate never opened, or opened and closed again |
| 56 | keyFn that throws fails closed (detaches, lastError.phase === 'gate') | rewritten | `l5-sources-oracle-gates` › a key gate › that throws fails closed … with phase gate (`lastError` is L9) |
| 57 | keyFn that returns a non-(string\|null) value fails closed with phase 'gate' | rewritten | `l5-sources-oracle-gates` › a key gate › that returns neither a string nor null fails closed with phase gate |
| 58 | gateLingerMs cancels teardown on a transient falling edge | rewritten | `l5-sources-oracle-gates` › gateLingerMs › cancels the teardown when the gate opens again inside the window |
| 59 | gateLingerMs fires teardown on a sustained falling edge | rewritten | `l5-sources-oracle-gates` › gateLingerMs › tears down at the end of the window when the gate stays closed |
| 60 | re-key with gateLingerMs defers the teardown+reattach to the end of the window | rewritten | `l5-sources-oracle-gates` › gateLingerMs › defers a re-key's teardown and attach to the end of the window |
| 61 | a key that walks to a THIRD value mid-linger tears the committed channel down immediately (no unbounded open) | rewritten | `l5-sources-oracle-gates` › gateLingerMs › tears the committed key down at once when the key moves to a third value |
| 62 | `active` returning a truthy non-boolean fails CLOSED (does not attach) | rewritten | `l5-sources-oracle-gates` › an active gate › that returns a truthy non-boolean fails closed; exactly true attaches |
| 63 | in-flight publish after gate-close is dropped with lastDropReason 'gate-closed' | rewritten | `l5-sources-oracle-gates` › an active gate › drops a publish made through the handle after the gate closed, as gate-closed (`lastDropReason` is L9) |
| 64 | `active` sugar is equivalent to the hand-written `key` form | rewritten | `l5-sources-oracle-gates` › an active gate › is the same as the key form … |
| 65 | declaring BOTH key and active throws at registration | ported | `l5-sources-oracle-ported` (the `createSystem` half; the manager half is the same check) |
| 66 | ungated sources behave exactly as before (backward-compat) | rewritten | `l5-sources-oracle-gates` › an ungated source › attaches once at start with no gate context … |
| 67 | passes the resolved key to attach via ctx.key | rewritten | `l5-sources-oracle-gates` › a key gate › passes the key to attach … |
| 68 | a failing attach backs off instead of retrying on every reconcile | ported | `l5-sources-oracle-ported` |
- **L10 sources (register after start, re-registration).** Rows 13, 21, 22
  and 31 above are public behaviour that only `registerModule` reaches: a
  module registered after start attaches its sources at once and fires
  `onAttach`; re-registering an attached source unsubscribes the old one
  before attaching the new one; and the old source's captured `publish` is a
  no-op afterwards. `unregister-module.test.ts` covers none of these. The only
  pin, `sources.test.ts:759` ("emits source.attach immediately when a module
  is registered after start"), sits in the internals file v2 skips. Needed:
  black-box tests through `registerModule` for all four, before the L10 gate.
- **L2 coalescing.** The four coalescing tests in
  `reconcile-timing-rules.test.ts` count history snapshots per pass, so they
  sit at L8 (`allowAbove` in layers.rules.json). Needed: the same four rules
  observed without history (pass count through a plugin hook or `inspect()`).
- **L2 requirement identity.** Content-derived requirement ids (see
  `requirements.test.ts` above).
