# RFC: L12 plugins and distributable snapshots

Status: draft for review, revision 2 (after the design review). No engine or oracle code merges from this document.
Tree: branch `p12/l12-rfc`, cut from `main` at `1ffe8cad` (L0 to L7 gated; L8 built and waiting for its gate; L9 built, its gate after L8's; L10 and L11 have RFCs, PRs #396 and #397, and are not built; `layers.rules.json` `current` is `"L7"`). Nothing in `packages/conformance` or `packages/core-next/src` is changed by this PR.

## Changes since revision 1

**In plain terms:** the design review found that no core seam is needed, and it found things the RFC had wrong or left open. Each is folded in below. The gap counts and the probes are unchanged.

1. **The audit ledger is an `observe()` consumer.** It listens through `sys.observe(onEvent)` with 14 `case` labels; its hooks give only lifecycle markers. core-next's `toObservations` lacks the two `resolver.clobber.loop.*` events (H4) and `module.registered` and `module.unregistered` (new row H5). H4 is a precondition for L12c, not a residue. L12a now builds both.
2. **(by) names its check and its narrow fix.** `verify.ts:162–171` forgives a break at a tombstone unconditionally. The fix rejects it only for a tombstone with the in-module mark, which leaves two 1.35 tests green. The come-back condition is those two tests, not a hash change, because the fix changes no hash.
3. **The fuzz claim is corrected.** The fuzz always installs one plugin, the recorder, which defines all 46 hooks. The no-plugin path is never fuzzed, which matters for the seams' "no reader, no work" claims. A `clobberLoopPlugin` draw is added after U12 and L11.
4. **`compareClauses` is listed as a dependency on L11**, and the RFC says how core-next provides it.
5. **27 mutants** in L8, L9 and L11 code are killed only by L12 tests, and those layers' gates ignore them. New section "Mutation debt owed to L8, L9 and L11" lists the 27 by layer, with an `observe()`-based pin for each layer.
6. **Size: no seam.** The review's sketch measured +424 B (`minimal`), +430 (`two-module`), +433 (`aperture`), 0 (`floor`) and +456 (`full-entry`), gzip. The target is now about 550 to 650 B; the +750 B cap stays.
7. **(bv)** notes that no repo test signs data more than 50 levels deep, and that `version` still uses the lossy `stableStringify`.
8. **The owner section** keeps its owner line, and each numbered question now carries the option taken. The A1 and (by) rows are updated.

## What we are building

L12 is two things that 1.35 ships side by side. The first is **distributable snapshots**: `system.getDistributableSnapshot()` and `watchDistributableSnapshot()`, which hand a chosen set of derivations and facts to another process (a cache, a client, an edge worker), and the root tools that check, compare and sign such a snapshot. The second is **the plugins**: logging, devtools, performance, observability with its OTLP exporter, the circuit breaker, the clobber alert and clobber loop, and the audit ledger.

The plan's row reads "Plugins (logging, devtools, performance, observability, OTLP, circuit breaker, audit ledger), clobber alert/loop, signed/distributable snapshots | all 19 plugins/__tests__, snapshot-signing | +6.5 KB | opt-in". Jason's Phase 4 answer, "Keep the order (Recommended)" (2026-11-05), settles the shape, as at L8 to L11: the alphas keep 1.35's API. His "Full checks everywhere" gives L12 this document, the oracle first, the mutation gate, the random tests and two reviewers. When this document and 1.35 disagree, 1.35 wins; a difference is built only if the owner approves it as a lettered row.

Five terms, used throughout:

- **A distributable snapshot** is the object `getDistributableSnapshot()` returns: `{ data, createdAt, expiresAt?, version?, metadata? }`. `data` holds the chosen derivations and facts. `version` is a short hash of `data`.
- **A signed snapshot** is a distributable snapshot with `signature` (an HMAC-SHA256 in hex, made with a secret the server keeps) and `algorithm: "hmac-sha256"`.
- **A plugin** is an object with hook functions (`onFactSet`, `onResolverComplete` and the rest) passed to `createSystem({ plugins })`. **A hook** is one of 1.35's 46 named callbacks.
- **The `./plugins` entry** is `@directive-run/core/plugins`, a separate import. Both packages say `"sideEffects": false`, so a bundler keeps a plugin only if the app imports it (**tree-shaking**).
- **The engine side** is the part of L12 that lives on every system, whether or not the app uses it: here, the two distributable-snapshot methods.

**Much of the row's ground is already laid.** core-next carried these over at L3 to L9.

| Plan item | State in core-next | Where |
|---|---|---|
| The 46 hook names, mapped from one kind of record | Built: 39 of the 46 fire. 6 are L10's (`onDefinitionRegister`, `Assign`, `Unregister`, `Call`, `onModuleRegistered`, `onModuleUnregistered`). `onFactDelete` is never emitted by 1.35 either | `src/api/plugins.ts:39–110`; `diff/unfired-hooks.json` |
| The plugin manager: order, error isolation, async `onInit` | Built (L3) | `src/api/plugins.ts` |
| `notify.clobberLoopDetected` and `clobberLoopResolved`, with the depth-4 cap | Built (L9a); pinned at L9 by L9-pre-a's U11, not yet merged | `src/api/plugins.ts:233–290` |
| The two clobber-loop events, and `module.registered` and `module.unregistered`, reaching an `observe()` listener | **Not built.** 1.35 hands the clobber event object to every observer (probe C1), and its observer bridge maps the two module hooks (`core/engine.ts:3146–3148`). The audit ledger reads the clobber events there | `toObservations` (`src/api/observe.ts:17–177`) has no case for any of the four. The module types exist (`src/types/system.ts:1152–1153`); L10 brings the hooks |
| `getDistributableSnapshot`, `watchDistributableSnapshot` | **Not built.** In development each throws `featureMissing` naming layer 12 | `src/api/missing.ts:68` |
| The snapshot tools: `isSnapshotExpired`, `validateSnapshot`, `diffSnapshots`, `signSnapshot`, `verifySnapshotSignature`, `isSignedSnapshot` | **Not built**; not exported from the root | `contracts/next-unshipped.json` |
| The ten plugin exports and `CircuitBreakerOpenError` | **Stubs** with 1.35's names and types, each throwing `featureMissing` naming layer 12 | `src/plugins/index.ts` |
| `createAuditLedger` and `memorySink` as **root** exports (1.35 has them in both entries) | **Not built**; absent from the root | `contracts/next-unshipped.json`; 1.35 `index.ts:217–220` |
| The status plugin: `createRequirementStatusPlugin`, `createStatusHook`, `createSystemWithStatus` | **Not built**; not in the plan's row | `contracts/next-unshipped.json` (L12) |
| `stableStringify`, which `hashObject` and signing are built on | Built | `src/api/requirements.ts:27` |
| The persistence plugin | Built (L6) | `src/plugins/persistence.ts` |

**Reading the table:** the census's 11 names missing at L12 are the six snapshot tools, the two audit-ledger root exports and the three status-plugin names. The hook adapter the plan asks for is already the way core-next calls plugins; L12 adds no hook.

**In plain terms:** L12 is one small part that every system carries (the two snapshot methods, about 0.55 to 0.65 KB), and a large set of plugins that only an app that imports one pays for (about 27.5 KB of 1.35's code in all). No plugin needs anything from the core that is not already there, except six hooks that L10 brings, the data-form explanations that L11 brings, and four observer events (two clobber-loop, two module) that L12a adds because the audit ledger reads its events through `observe()`, which hooks do not replace. The probes found five 1.35 behaviours a user could notice: a signed snapshot that holds `undefined` or a `Date` fails to verify once it has travelled as JSON; a value forged more than 50 levels deep verifies; the audit ledger's strong verify throws "reserved for v2"; a watched snapshot does not notice a change to a fact it includes; and the audit ledger's own known gap, a tampered entry just before an erasure marker passes `verify()`. They are the candidate rows (bu) to (by).

## Gap analysis, measured

**In plain terms:** at a forced L12, 348 of the 349 tests placed at L12 fail on v2, every one because the piece is not built. One passes for the wrong reason. Another 320 fail for L8, L9, L10 and L11 reasons that those layers settle.

What I ran: `layers.rules.json` `current` set to `"L12"` in the working copy only. Then, from `packages/conformance`, `npx vitest run --project conformance:v2 --project conformance:v2:prod`, then `--project conformance:v2:dist`, then `--project conformance:diff`, each with the JSON reporter (each exited 1, as expected). Then `git checkout -- layers.rules.json`; `current` read `"L7"` again and `git status --short` was empty. core and core-next were built first (`pnpm --filter … build`, exit 0).

| Run | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| `conformance:v2` and `conformance:v2:prod`, together, at forced L12 | 3,342 | 1,907 | 668 | 767 |
| `conformance:v2:dist` at forced L12 | 3,260 | 1,829 | 664 | 767 |
| `conformance:diff` at forced L12 | 434 | 412 | 22 | 0 |

| Layer of the failing test (from `layers.json`) | v2 and v2:prod | v2:dist |
|---|---|---|
| **L12** | **348** | **348** |
| L11 (predicate tools, `doctor`, data forms) | 201 | 201 |
| L10 (dynamic definitions; 6 are `mutants-derivations` cases whose generated titles do not match `layers.json`, each "d.register is not a function") | 109 | 107 |
| L8 (the history pins of approved rows) | 8 | 6 |
| L9 (the two `registerKeys` tests L9's B3 moves to L10, in L9-pre-a, not yet merged) | 2 | 2 |
| **Total** | **668** | **664** |

**Reading the table:** only the first row is L12 work. The `dist` run lacks four production-only files' failures. The L8, L9, L10 and L11 rows belong to the L8 gate, L9-pre-a and the L10 and L11 builds; L12 cannot gate before them (Precondition 2).

**The 348 L12 failures, by what is missing.** Every one fails on a stub or a missing export; none fails on a wrong answer.

| What fails | Tests | Files | The error |
|---|---|---|---|
| **Circuit breaker** | 80 | `circuit-breaker` | 61 "createCircuitBreaker is not in 2.0.0-alpha yet", 8 the same for `CircuitBreakerOpenError`, 10 a message assertion that met the stub's message instead ("failureThreshold must be >= 1" and three other messages), 1 an expected no-throw |
| **Audit ledger** | 79 | `audit-ledger` (45 of 46), `-forgery` (10), `-payloads` (9), `-batched-writes` (6), `-rotation` (6), `-latch` (3) | "createAuditLedger is not a function", "memorySink is not a function": the tests import them from the root, where core-next has no such name |
| **Devtools** | 68 | `devtools` (60), `devtools-when-explain` (8) | "devtoolsPlugin is not in 2.0.0-alpha yet" |
| **Logging** | 56 | `logging` | "loggingPlugin is not in 2.0.0-alpha yet" |
| **Performance** | 34 | `performance` | "performancePlugin …" |
| **Observability** | 11 | `observability-agent-metrics` | "createObservability …" |
| **Clobber alert** | 9 | `clobber-alert` (9 of 16) | "clobberAlertPlugin …" |
| **Signing** | 6 | `utils/snapshot-signing` | "signSnapshot is not a function" |
| **Distributable snapshots** | 4 | `system` (3), `ssr` (1) | "getDistributableSnapshot is not in 2.0.0-alpha yet" |
| **Docs snippet** | 1 | `docs-snippet-compiles` | the audit ledger's root export |
| **Total** | **348** | | |

**What `layers.json` places at L12.** 349 tests, in 16 files with an L12 rule and two with older rules (`system.test.ts` and `ssr.test.ts`, through `member .getDistributableSnapshot`). The placements come from the generated file's `by` reasons: `import createAuditLedger` (76), `import createCircuitBreaker` (72), `import devtoolsPlugin` (68), `import loggingPlugin` (56), `import performancePlugin` (34), `import memorySink` (31), `import CircuitBreakerOpenError` (13), `import createObservability` and `createAgentMetrics` (11 each), `import clobberAlertPlugin` (9), `import signSnapshot` and `verifySnapshotSignature` (6 each), `member .getDistributableSnapshot` (4). All 349 are black-box. 348 fail.

**One placed test passes on v2 and could not fail for the reason it is named for.** `audit-ledger.test.ts:852`, "verify() detects tamper of the entry just before a tombstone", is an `it.fails`: 1.35's own known gap, pinned so it is tracked (the comment at `:831`). On v2 the body throws at `memorySink()`, and a throwing body satisfies `it.fails`. It starts to bite when L12c builds the ledger (U11; the candidate (by)).

**25 clobber tests are not in L12's 349.** All 18 of `clobber-loop.test.ts` and 7 of `clobber-alert.test.ts` are placed at L13, each with the single reason `import flushMicrotasks` (from `@directive-run/core/testing`). That import is a one-line microtask flush, and it is not what the tests are about. This is the shape L9 found for the data-form introspection tests (L9's U14), and it has the same fix (U12). Until then, a forced L12 never runs the clobber-loop plugin's tests.

**Not in the oracle at all.** 1.35's `plugins/__tests__` has 19 files. The oracle has 17 under `tests/plugins`: 15 at L12, and `persistence` and `hydration-scope` at L6. The other two, `audit-ledger-payload-shapes` (5 tests) and `devtools-helpers` (44), test internals and are listed as white-box at L12 (`WHITE-BOX.md:38–39`); core-next's own unit tests must cover them (U14). The status plugin's three names have no test at L12: their two diff scenarios sit at L13 (U13).

**L12 depends on L10 and L11.** Read from the tests: `audit-ledger-latch` calls `registerModule` (`:53`), `audit-ledger` calls `constraints.assign` (`:675`), `devtools-when-explain` calls `constraints.register` and `unregister` (`:283, 292`), and `logging` asserts the `onDefinition*` hooks (10 references), all L10's. `audit-ledger` (3), `devtools-when-explain` (5) and `devtools` (1) use data-form `when`s, which are L11's, and `devtools-when-explain` reads L11's `whenExplain`. `devtools` turns on L9's trace in 36 places, which is built. `clobberLoopPlugin` needs `compareClauses` from L11's `doctor` file (under the plugin table), and the audit ledger needs L12a's observer channel (H4, H5).

| Failing diff test | Layer | Why |
|---|---|---|
| "logging and performance plugins on a clobbered charge" (94 differences) | L12 | v2 throws at `createSystem`: `loggingPlugin` is a stub |
| "clobber alert and clobber loop plugins" (148) | L12 | the same, `clobberAlertPlugin` |
| "the audit ledger chains entries and verifies" (68) | L12 | the same, `createAuditLedger` |
| "circuit breaker opens, rejects and half-opens" (7) | L12 | the step throws at `createCircuitBreaker` |
| "snapshot signing and verification" (7) | L12 | the step throws at `getDistributableSnapshot` |
| "distributable snapshots" (3), in `l6-persistence-schema` | L12 | the same |
| "notify: clobber-loop channels reach plugins" (2), in `l3-lifecycle-plugins` | L12 | **1 real difference**: the plugins hear both events on v2 (L9a built them), but 1.35 also hands each event to the observer, and v2 does not |
| 7 L8 scenarios, 2 L10, 5 L11 | L8, L10, L11 | their layers' features |
| The fuzz, "random systems trace identically on every engine" | L8 and L9 | Seed 24301 shrinks to one module with `history: true`, `trace: true` and a `roundtrip` step, and no plugin of the model's own: the recorder is always installed (below) |

**Reading the table:** L12 owns 7 of the 22. Six are "not built"; the seventh is a missing observer channel, the one L12 behaviour core-next gets wrong today rather than lacks.

**The mutation gate.** I did not list the `mutation-nightly.yml` runs for this RFC; a `gate: L12` run is Precondition 1. The triage files hold 55 entries with `layer: "L12"`: 47 in `mutation-triage/engine.json` and 8 in `constraints.json`. 28 are `feature-layer`: all are the distributable snapshots in `engine.json` ("distributable snapshots (L12). Corrected from L6 at L6-pre-a"). 27 are `later-layer`: mutants in L8, L9 and L11 code (history navigation, fact-tag recording, `explainWhen`, the data-form `when` guard) whose only killing tests are L12 plugin tests. **That second group is a finding, and a debt owed to other layers.** Some L8, L9 and L11 behaviour is checked only through the audit ledger and devtools. A `later-layer` entry whose `layer` is L12 is deferred below L12 (`MUTATION.md:189`), and the gate counts only entries "for Ln or below" (`:204–206`), so the L8, L9 and L11 gates pass with all 27 unpinned, and an L12 test cannot kill them at a lower gate. The 27, by owning layer, and the pins that move them down are under "Mutation debt owed to L8, L9 and L11". To read the gate when it runs: `tsx scripts/mutation-score.ts --gate L12 --at <reports>` (`MUTATION.md:197–206`).

## The design: each 1.35 rule, the mechanism that keeps it, and its pin

Where a row says "verified", the probe ran it against the published 1.35 (`packages/conformance/node_modules/directive-v1`, `1.35.0`), in development and production. The output is under "Evidence". The rest is read from the code; 1.35 line numbers are in `packages/core/src/`.

### Where it lives

**In plain terms:** the two snapshot methods become a part that `createSystem` wires, as every earlier layer's were. The plugins stay where 1.35 has them, in `./plugins`, with the root re-exports 1.35 has. No core seam is needed: the design review sketched the part and measured it (Size).

| Option | Keeps 1.35's API? | Who pays the bytes |
|---|---|---|
| **O1. A part, `withDistributable`, wired by `createSystem`; the plugins and tools as 1.35 exports them** | Yes | Every `createSystem` build pays the part (about 0.55 to 0.65 KB). A plugin or a snapshot tool costs only an app that imports it, and `full-entry` |
| O2. The methods only through an import (`distributable()`) | No: a 1.35 program's `system.getDistributableSnapshot()` would be undefined | Only apps that import it. This is a beta question |

**Reading the table:** O1 is the alpha rule. The part reads what the core already offers: the derivation ids, a derivation's value, the facts as an object, and a subscription to derivations (`namespaced.ts:76` has `toInternalKey` for the `"a.count"` form). The design review wrote exactly this (a part on `system.derive`, `facts` and `subscribe`, the djb2 loop and the H4 cases) and measured it: `floor` did not move (Size). L12a's first commit still says if it finds it needs a seam, and comes back if `floor` moves.

### Distributable snapshots

**In plain terms:** `getDistributableSnapshot` copies the chosen derivations and facts into `data`, stamps it, and can add a lifetime, a version hash and metadata. `watchDistributableSnapshot` calls back with a fresh snapshot whenever a watched derivation changes the data.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| D1 | `getDistributableSnapshot(options)` returns `{ data, createdAt }`, plus `expiresAt` (`createdAt + ttlSeconds × 1000`, only when `ttlSeconds > 0`), `version` (`hashObject(data)`, only with `includeVersion`) and `metadata` (the caller's object, by reference) (`core/engine.ts:4092–4221`). Verified, D1. | The same, in `withDistributable`. | `system.test` "Distributable Snapshot" (3); diff "distributable snapshots" |
| D2 | `data` holds every derivation by default, or `includeDerivations` less `excludeDerivations`, then each `includeFacts` key; a fact of the same name as a derivation overwrites it (`engine.ts:4119–4189`). Verified, D1b: the default is every derivation and no fact. | The same order. | diff "distributable snapshots" |
| D3 | An unknown derivation or fact key is ignored; development warns, naming the keys and what is available; production is silent (`engine.ts:4130–4141, 4174–4183`). Verified, D2. | The same; the warning is development text. | U4 |
| D4 | A derivation that throws is left out of `data`; development warns "Skipping derivation …"; production is silent (`engine.ts:4154–4165`). Verified, D3. | The same. | U4 |
| D5 | A namespaced system takes `"a.display"` and returns `data` nested by namespace, `{ a: { display, count } }` (`core/system.ts:699–738`). Verified, D7. | The same, through `toInternalKey` and a nesting step. | `ssr` "distributable snapshot round-trip"; U4 |
| D6 | `watchDistributableSnapshot(options, callback)` subscribes to the watched derivations only. It takes a snapshot to seed the version, then on each derivation change takes another, with `includeVersion` forced on, and calls back only if the version moved (`engine.ts:4223–4296`). A change to an included **fact** that changes no watched derivation is not seen. Verified, D4: a `plan` write gave no call; the next `count` write gave one, carrying the new `plan`. | Without (bx): copied. With (bx): the included facts are watched too. | U1 |
| D7 | The callback runs synchronously inside the write, once per batch, and every snapshot it gets has `version`, asked for or not. Verified, D4 and D6. | The same. | U2, U16 |
| D8 | With nothing to watch (an empty `includeDerivations`, or every one excluded), development warns "No derivations to watch. Callback will never be called."; the return is a no-op function (`engine.ts:4258–4268`). Verified, D5. | The same. | U3 |
| D9 | `version` is `hashObject`: 1.35's djb2 over `stableStringify`, 8 hex characters, 32 bits (`utils/utils.ts:394–402`). Two different `data` values can share a version, and the watch then drops the second. Verified, V1: `"3a323634"`. | The same hash (B-default C). | Not pinned: needs a collision (U15) |

**Reading the table:** D6 is the user-visible problem. A client that mirrors `includeFacts: ["plan"]` keeps a stale plan until some derivation happens to move.

### Snapshot signing and the snapshot tools

**In plain terms:** a server signs a snapshot with a secret, sends it, and later checks that nothing in it changed and that it has not expired. 1.35 signs `stableStringify` of five fields, which is not the JSON the snapshot travels as.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| G1 | `signSnapshot(snapshot, secret)` signs `stableStringify({ data, createdAt, expiresAt, version, metadata })` with HMAC-SHA256 through Web Crypto, and returns the snapshot with `signature` (64 hex characters) and `algorithm` (`utils/utils.ts:738–763, 841–870`). Verified, S1: a plain snapshot verifies before and after `JSON.parse(JSON.stringify(…))`. | The same, as root exports. | `snapshot-signing` (6); diff "snapshot signing and verification" |
| G2 | `verifySnapshotSignature` recomputes the signature, compares it in constant time, and returns false if `expiresAt` has passed, unless `ignoreExpiry` (`utils.ts:798–839, 876–887`). `metadata` and `expiresAt` are covered. Verified, S7 and S8: at exactly `expiresAt` it is true, a millisecond later false; an edited `metadata` or an added `expiresAt` fails. | The same. | U8 |
| G3 | The signed form is `stableStringify`'s, not JSON's: `undefined` is written `undefined`, a `Date` as `D:<iso>`. JSON drops an `undefined` key and turns a `Date` into a string, so a snapshot holding either verifies where it was signed and **fails after it travels as JSON** (`utils.ts:181–289`). Verified, S2: a derivation returning `undefined` gave `direct: true, viaJson: false`; S3, the same for a `Date`. | Without (bu): copied. With (bu): sign `data` and `metadata` in their JSON form, inside 1.35's envelope. | U5 |
| G4 | Below 50 levels, `stableStringify` writes `"[max depth exceeded]"`, so nothing deeper is signed; a function is written `"[function]"`, the same text as that string. Verified, S5: a value changed 60 levels down **still verified**; S6: the string `"[function]"` verified in place of a function. | Without (bv): copied. With (bv): refuse to sign what the signature cannot cover. | U6 |
| G5 | An empty secret throws the platform's "Zero-length key is not supported" (Node's Web Crypto). Verified, S4. | The same: the platform's error, not a Directive message. | U7 |
| G6 | `isSnapshotExpired` is `expiresAt !== undefined && now > expiresAt`; `validateSnapshot` checks the shape and the expiry and throws 1.35's messages; `diffSnapshots` walks `data` into dotted paths; `isSignedSnapshot` checks for a string `signature` (`utils.ts:436–720`). Verified, S7 and S9. | The same. | `snapshot-signing`; U8 |

**Reading the table:** G3 breaks the use the documentation gives ("Store in JWT, Redis, or send to client", `utils.ts:721–736`) for any snapshot with an `undefined` derivation, which is an ordinary value. G4 is a forgery: a signature that covers less than the data. Both are candidates.

**Two facts about (bv) that the design review added.** No test in the repo signs data more than 50 levels deep. The files that sign (`conformance/tests/utils/snapshot-signing.test.ts`, 1.35's copy `core/src/utils/__tests__/snapshot-signing.test.ts`, `conformance/contracts/lib/golden.ts:294–300`, `conformance/diff/scenarios/l12-plugins.test.ts`) use shallow data, and the only 50-level test is of `stableStringify` alone (`core-next/src/__tests__/p3f4-built-layer-names.test.ts:174–180`). So (bv) bends no 1.35 test, and U6 is its only pin. And `version` still uses the lossy `stableStringify`: `hashObject` (`utils.ts:394–402`) hashes it, so two `data` values that differ only below 50 levels, or by a function against the string `"[function]"`, get the same `version`. (bu) and (bv) change what is signed, not what `version` hashes, so a watch still drops a callback for such a change (it compares versions, D6), the same loss as U15's collision.

### The hook adapter and the observer channel

**In plain terms:** core-next already calls 1.35's hooks from its own records. One channel is missing: 1.35 also tells observers about clobber loops.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| H1 | 46 hook names (`core/types/plugins.ts`), called in plugin order, each throw logged and never rethrown (`core/plugins.ts`). | Built: one record kind per hook (`src/api/plugins.ts:39–110`). L12 adds none; L10 adds its six. | the L3 tests and diff scenarios |
| H2 | `onFactDelete` is never called; a deleted fact reports through `onFactSet` and `onFactsBatch` (`plugins.ts:399` defines the broadcast; nothing calls it). | The same: not emitted (`diff/unfired-hooks.json`). | diff "a fact delete" |
| H3 | `notify.clobberLoopDetected(event)` and `clobberLoopResolved(event)` call each plugin's hook with the event, silent once destroyed or with no listener, capped at depth 4 (`engine.ts:2895–2919`). | Built (L9a, `src/api/plugins.ts:271–274`). | L9-pre-a's U11 |
| H4 | The same call hands **the same event object** to every `observe()` listener, with or without a `type` field, and an observer alone counts as a listener (`engine.ts:3227–3236`). Verified, C1: two events reached the observer, the first `===` the one passed, the second `{ fact: "no type" }` as given; C2: with no plugin, the observer still heard it. | Not built: `toObservations` (`src/api/observe.ts:17–177`) has no case for the two records. L12a adds one that passes the record's `event` through unchanged. core-next registers observers as plugins (`src/api/observe.ts:224`), so C2's count already holds. **A precondition for L12c, not a residue:** the audit ledger reads both events through `observe()` (below). | diff "notify: clobber-loop channels reach plugins" (the 1 difference); U9 |
| H5 | 1.35's observer bridge maps the hooks `onModuleRegistered` and `onModuleUnregistered` to the events `module.registered` and `module.unregistered`, each `{ type, id }` (`core/engine.ts:3146–3148`; types `core/types/system.ts:1152–1153`). | Not built: no case in `toObservations`. The kernel records come with L10's hooks (L10's RFC does not mention the observation events). L12a adds the two cases and the test. The ledger ignores them (its `default` arm, after `source.error`, `audit-ledger/index.ts:686`); they matter to every other observer, and to parity. | U17 |

**Reading the table:** the `notify` members are L9's. What L12a adds is the observer channel: H4's pass-through and H5's two module events. H4 is a precondition for L12c, as the next paragraph shows.

**The audit ledger is an `observe()` consumer.** It does not run on hooks. It attaches with `unobserve = sys.observe(onEvent)` (`plugins/audit-ledger/index.ts:717`), and `onEvent` has 14 `case` labels (`:553–686`): `constraint.evaluate`, `fact.change`, `resolver.write.rejected`, `resolver.clobber.loop.detected`, `resolver.clobber.loop.resolved`, `resolver.complete`, `resolver.error`, `system.init`, `system.start`, `system.stop`, `system.destroy`, `source.attach`, `source.detach`, `source.error`. Its own 8 hooks (`:759–799`: `onInit`, `onStop`, `onDestroy`, the three `onDefinition*`, `onSnapshot`, `onHistoryNavigate`) give lifecycle markers and cache refreshes, not the trail. So the ledger's real dependency is the observer channel. Two of its 14 labels, the clobber-loop pair, have no case in core-next's `toObservations` (H4), so a ledger on v2 would record no clobber-loop entry. L12a builds H4 and H5 before L12c builds the ledger. The ledger's reads are listed in `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l12/review/ledger2.txt`.

### The plugins

**In plain terms:** each plugin is ported as code into `src/plugins/`, under 1.35's name. Six are true plugins (they implement hooks). Four are tools a program calls itself.

Hook counts are the 1.35 hook names each source file mentions (`grep` over `packages/core/src/plugins`, checked against the 46 names); the system members are the `system.<name>` reads in the same files.

| Export | Kind | Hooks it uses | System members it reads | Placed tests | Needs from earlier layers |
|---|---|---|---|---|---|
| `loggingPlugin` | plugin | 37 | none | 56 | L10's `onDefinition*` |
| `devtoolsPlugin`, `emitDevToolsEvent`, `DEVTOOLS_EVENT_NAME` | plugin, with a graph, a DOM panel and an AI bridge | 33 | `facts`, `derive`, `history`, `inspect` | 68, plus 44 white-box | L9's trace, L10's `register`, L11's `whenExplain` |
| `performancePlugin` | plugin | 12 | none | 34 | none |
| `clobberAlertPlugin` | plugin | 3 (`onInit`, `onResolverWriteRejected`, `onDestroy`) | none | 9, plus 7 at L13 | none |
| `clobberLoopPlugin` | plugin | 6 | `meta` | 0, plus 18 at L13 | L9's `notify` members, which it calls to re-enter (`clobber-loop.ts:660, 733`); L10's `onDefinition*`; L11's `doctor` and `diffRules`, which it imports, and `compareClauses` (below) |
| `createAuditLedger`, `memorySink` | plugin and sink | 8, and `observe()` for the trail (14 `case` labels) | `history`, `meta`, `inspect` | 79, plus 5 white-box | L8's history, L9's meta, L10's `registerModule` and `assign`, L11's data forms, **L12a's observer channel (H4)** |
| `createObservability`, `createAgentMetrics` | tool | 0 | none | 11 | none |
| `createOTLPExporter` | tool | 0 (one `onError` name, which I did not check is a hook) | none | 0 | none |
| `createCircuitBreaker`, `CircuitBreakerOpenError` | tool | 0 | none | 80 | none |
| `normalizeTokenUsage` | tool | 0 | none | 0 | none |

**Reading the table:** the circuit breaker, observability, OTLP and token usage never touch a system; their 91 tests are a straight port. The rest read hooks and members core-next already has, except L10's and L11's, and the ledger's observer events (H4).

**`compareClauses` is a dependency on L11.** `clobberLoopPlugin` imports it (`plugins/clobber-loop.ts:21`, used at `:340`) from `core/doctor.ts:224`. That file exports it, but the package root does not: `src/index.ts:207–215` exports `doctor` and its types only. So it is not in the census, and the L11 RFC does not list it. core-next provides it the way 1.35 does. L11's `src/api/doctor.ts` port keeps `compareClauses` as a file-level export, with no root export, and L12c imports it from there. `doctor` itself already calls it (`doctor.ts:424`), so L11 pays for it either way; L11's slice needs that one line. `flattenPredicate` and `LeafClause`, from `rules-diff`, are root exports and need nothing extra. On `full-entry` the clobber loop's copy dedupes against L11's.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| P1 | Each plugin and tool, its options, its messages and its output, as `plugins/<name>.ts`. | Ported as code into `src/plugins/<name>.ts`; the stubs in `src/plugins/index.ts` go. Each plugin reads only hooks and public members, so it runs on the existing adapter. | the 348, by file |
| P2 | `createAuditLedger` and `memorySink` are exported from the root as well as `./plugins` (`index.ts:217–220`). | The same root re-export. | 55 + 25 audit-ledger failures ("is not a function") |
| P3 | The status plugin, `createRequirementStatusPlugin`, `createStatusHook` and `createSystemWithStatus`, are root exports (`index.ts:299, 356–357`); `layers.ts:67` places them at L12. | Ported in L12c. | U13 |
| P4 | The audit ledger chains entries with djb2 (`hashAlgo: "djb2-1"`, 8 hex characters) and `verify({ strong: true })` throws "[Directive] verify({ strong: true }) is reserved for v2 — v1 ships sync djb2 chain only. Use verify() (sync) for tamper detection." (`audit-ledger/hash.ts:11–15, 128–136, 360–380`). Verified, A1. | Without (bw): copied, message and all. | U10 |
| P5 | A tampered entry directly before an erasure marker (`system.entry-erased`) passes `verify()`; 1.35 pins it with `it.fails` (`audit-ledger.test.ts:831, 852`). | Without (by): copied, and the `it.fails` kept. With (by): `verify()` rejects a break at a tombstone that bears the in-module mark, unless the entry before it is also a tombstone (below). | U11; the two existing tests named below stay green |
| P6 | The devtools graph reads `system.facts`, `system.derive` and `system.history` (`plugins/devtools-graph.ts`), not engine internals. | Ported as 1.35 draws it. A6's "draws the real node graph" is A4. | `devtools` (60) |

**Reading the table:** P4 and P5 are the audit ledger's two weak points, both named in 1.35's own source. The ledger's error message says "reserved for v2"; 2.0 is v2, so a user may expect it to work there.

**(by), the missing check, named.** In `verify()` (`audit-ledger/verify.ts`), when an entry's `prevHash` does not match the walk, the code forgives the break if the entry itself is a tombstone or the one before it is (`:162–171`, `entryIsTombstone || prevIsTombstone`). The second half is right: `erase()` rewrites the original as a tombstone, so the next entry's `prevHash` no longer matches. The first half is the gap. `erase()` keeps the tombstone's own `prevHash` (`index.ts:881–887`, `prevHash: e.prevHash`), so a break *at* a tombstone cannot come from the erasure. It can only mean the entry before it was changed, and the code forgives it anyway. That is the `it.fails` case. One exception, read from the code and not run: with two adjacent erasures the second tombstone's `prevHash` is the hash of the original first entry, so a break at it is legitimate when the entry before it is also a tombstone (`verify.ts:63`, the comment on adjacent tombstones). **The narrow fix** rejects a break at a tombstone only when that tombstone bears the in-module mark (`isInternal(entry)`, `hash.ts:55`) and the entry before it is not a tombstone. That is the in-process ledger. An exported ledger has no marks, so it keeps 1.35's behaviour. Two 1.35 tests pin the opposite for an *unmarked* tombstone: `conformance/tests/plugins/audit-ledger.test.ts:1278` (the forged entry at `:1302`) and `audit-ledger-forgery.test.ts:315` (`:329`) write a tombstone with `prevHash: "deadbeef"` through `sink.write()` and expect `valid: true` with its seq in `unmarkedTombstoneSeqs`. A tombstone written that way has no mark, so the narrow fix leaves both green. The fix changes no hash, only a verdict. Evidence: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l12/review/missing-verify.txt`.

### A6's second half: the devtools graph

L9's RFC (A4, taken) built `why()` in L9c and moved the devtools graph to L12, where its tests are placed (`layers.rules.json:755–760`). What I found: 1.35's graph (`plugins/devtools-graph.ts`, 717 lines) draws from `system.facts`, `derive` and `history`, and the 60 `devtools` tests pin what it shows. "Draws the real node graph" would draw from core-next's own dependency graph instead, which is new output the oracle cannot check. So A6's second half is a choice, A4 below.

## Where it lives

**In plain terms:** one new part, the plugins as files under `src/plugins/`, the snapshot tools in `src/utils/`, and four observer cases (H4, H5). No core change.

| Piece | File | Change |
|---|---|---|
| `withDistributable` | `src/api/distributable.ts` (new) | D1 to D9 |
| The snapshot tools | `src/utils/snapshot.ts` (new), root exports | G1 to G6; `hashObject` beside the `stableStringify` core-next has |
| The observer channel | `src/api/observe.ts` | H4: a case for the two clobber-loop records, passing `event` through. H5: a case for each of the two module records |
| The plugins | `src/plugins/<name>.ts` (new), `src/plugins/index.ts` | P1; the stubs go |
| Root re-exports | `src/index.ts` | `createAuditLedger`, `memorySink`, the status plugin, the six snapshot tools |
| `withMissing`, `createSystem` | `src/api/missing.ts:68`, `src/api/system.ts` | The two layer-12 stubs go; the part is wired; it joins `size.mjs`'s beta list |
| The core | none | No seam: sketched and measured by the design review (Size) |

## The fuzz, designed in up front

**In plain terms:** the random tests always install one plugin, the recorder, and no other; they take no distributable snapshot. L12-pre teaches them the plugins and the snapshot.

What the model does today, read from the code: `diff/fuzz/model.ts` has no plugin, `notify`, distributable or signing draw (`grep -n -i "plugin|notify|distributable|sign"` matches only abort signals). The recorder already captures every hook (`diff/hooks.ts`) through its own recording plugin, so the 39 hooks are compared today; the plugins built on them are not.

**But the fuzz does install a plugin, always.** `runScenario` appends the recorder to every case, fuzz cases included (`diff/scenario.ts:1142–1145`, `plugins: [...plugins, rec.plugin]`), and the recorder defines all 46 hooks (`diff/record.ts:112–116`, a loop over `PLUGIN_HOOKS`, `diff/hooks.ts:13`). core-next's adapter builds a record when any plugin's hook reads it (`src/api/plugins.ts:161–171`, `wants_`), so in every random case every record kind is built. **What that means:** the path where records are skipped for want of a reader, the path with no plugin, is never fuzzed. A bug that shows only with no plugin is invisible to the fuzz. That matters for the "no reader, no work" claims the seams rest on (the trace, meta and tags of L9, and this RFC's claim under Performance that a plugin costs only its hooks). Those claims are checked by the conformance tests, which run with no recorder, and by the size and bench runs, not by the fuzz.

| L12 behaviour | The model reaches it today? | What L12-pre adds |
|---|---|---|
| `getDistributableSnapshot` (D1 to D5) | No | A `distributable` op: drawn include and exclude lists, `includeFacts`, `ttlSeconds`, `includeVersion`; records the result |
| `watchDistributableSnapshot` (D6, D7) | No | A module option that installs a watch at setup and records each callback |
| The audit ledger (P4) | No | A drawn `ledger` option: install `createAuditLedger()`, record `verify()` and the entries at each checkpoint. Its chain hashes every entry it records, so one hash compares everything it saw |
| Logging and performance | No | A drawn option for each; logging's lines are recorded as external events (as the scenario does); performance's numbers by contract |
| Clobber alert | No | Installed when the case draws an `abortOn` constraint, so clobbers happen |
| Clobber loop | No | After U12 (its 18 tests re-placed, so a forced L12 runs it) and the L11 gate (it imports `doctor`, `diffRules` and `compareClauses`): a drawn `clobberLoopPlugin` option beside clobber alert's. It re-enters through `notify` (`clobber-loop.ts:660, 733`), so it reaches the depth-4 cap (`src/api/plugins.ts:240, 257`) and H4 |
| The observer channel (H4, H5) | No | No draw of its own. Once `clobberLoopPlugin` is drawn, a random case does call `notify`, so H4 is reached if the recorder records observer events; L12-pre checks that and says. Diff scenario, U9 and U17 |
| Signing (G1 to G6) | No | Not added: the probes' shapes are hand pins (U5 to U8) |

**Reading the table:** the ledger is the strongest new check. Two engines that differ in anything the ledger records, its fields, order or count, give different chains, so the fuzz turns each such L3 to L11 difference into an L12 case. Which events the ledger records I read only as far as its hooks; L12-pre lists them when it adds the option.

**What is compared, and the new shapes.** `createdAt` and `expiresAt` come from the faked `Date`, which starts at 0 on both engines (`diff/scenario.ts`), so they are compared exactly. `version` and the ledger's hashes are compared exactly: the same input on both engines gives the same djb2. The performance plugin's durations are compared by contract, as L9's rule 1 does for the trace. Expect new shapes at the gate, as L7 to L9 met: the ledger will show any hook payload field the adapter fills differently (an `undefined` where 1.35 omits the key), and the order of a watch's callbacks inside a batch. This is a prediction from the earlier layers, not a measurement.

**Harness rules.** L8's ten and L9's three carry over. Three are new:

1. **Plugin timings are compared by contract**: every duration and rate the performance plugin and observability report.
2. **Each new op and option ships with a self-test**: one that drops a watch callback, one that edits a ledger entry.
3. **The L12-pre exit bar.** The 21 PR seeds at forced L12 leave at most 10 unexplained cases, as at L8 (A3). A case is explained if its shrunk form is "not built", or one of L8 to L11's items.

## Untested behaviours, and what will pin each

**In plain terms:** 17 items have no pin at L12. Eleven came from the probes; six from the forced run, from reading the oracle and from the design review.

| # | Behaviour | Evidence | Pinned by | Slice |
|---|---|---|---|---|
| U1 | A watch does not see a change to an included fact; the next derivation change carries it | D4 | A diff scenario; shows (bx) | L12-pre |
| U2 | A watch calls back synchronously in the write, once per batch | D4, D6 | A diff scenario | L12-pre |
| U3 | A watch with nothing to watch warns in development, returns a no-op, never calls | D5 | A conformance test in each mode | L12-pre |
| U4 | Unknown keys and a throwing derivation are skipped; development warns, production does not; namespaced keys nest | D2, D3, D7 | A conformance test in each mode | L12-pre |
| U5 | A signed snapshot holding `undefined` or a `Date` verifies in place and fails after JSON | S2, S3 | A conformance test; shows (bu) | L12-pre |
| U6 | A change below 50 levels verifies; `"[function]"` verifies for a function | S5, S6 | A conformance test; shows (bv) | L12-pre |
| U7 | An empty secret throws | S4 | A conformance test that asserts a throw, not the platform's text | L12-pre |
| U8 | Verify is true at exactly `expiresAt` and false after; `metadata` and an added `expiresAt` are covered | S7, S8 | A conformance test | L12-pre |
| U9 | The clobber-loop events reach observers as the same object, with no `type` added, with no plugin | C1, C2; the ledger's two `case` labels (`audit-ledger/index.ts:620, 639`) | A conformance test beside the diff scenario; the ledger tests then read them through `observe()` | L12-pre |
| U10 | `verify({ strong: true })` throws 1.35's message; entries carry `hashAlgo: "djb2-1"` and 8-character hashes | A1 | A conformance test; shows (bw) if approved | L12-pre |
| U11 | The `it.fails` ledger test passes on v2 because `memorySink` is missing | the forced run; `audit-ledger.test.ts:852` | Make it bite: assert 1.35's outcome (`verify().valid` is true after the tamper) in a plain test, keeping the comment (an oracle change); shows (by) | L12-pre |
| U12 | 25 clobber tests sit at L13 for `import flushMicrotasks` | the forced run; `layers.json` | Re-place, not rewrite: `instruments: ["import flushMicrotasks"]` on both files' rules, as L9's U14 did. Expected L12 | L12-pre |
| U13 | The status plugin's three names have no L12 test | `next-unshipped.json`; the L13 scenarios | A conformance test at L12: the plugin tracks a requirement's status; `createSystemWithStatus` wires it | L12-pre |
| U14 | 49 white-box tests (`audit-ledger-payload-shapes`, `devtools-helpers`) are not in the oracle | `WHITE-BOX.md:38–39` | core-next unit tests in L12c and L12d, by the same names | L12c, L12d |
| U15 | `version` is 32 bits; a collision drops a watch callback | D9; `utils.ts:394–402` | Not pinned: needs a collision | none |
| U16 | Every watch snapshot has `version`, asked for or not | D4 (`hasVersion: true`) | Part of U2's scenario | L12-pre |
| U17 | `registerModule` and `unregisterModule` reach an `observe()` listener as `module.registered` and `module.unregistered`, each `{ type, id }` | `core/engine.ts:3146–3148`; no oracle test asserts them (a search of `tests` and `diff`) | A conformance test; it fails on v2 until L10 builds `registerModule` and L12a maps the records | L12-pre |

**Reading the table:** U1, U5, U6, U10 and U11 are where the candidates live. Each pins 1.35's behaviour now and shows the difference only with an approved, signed entry. U12 and U13 are placements; without them a forced L12 never runs the clobber-loop plugin or the status plugin.

## Mutation debt owed to L8, L9 and L11

**In plain terms:** 27 mutants in lower-layer code are killed only by L12's plugin tests. Those layers' gates do not count them, so they can pass with the mutants alive. Pins based on `observe()` at each owning layer make the lower gates kill them.

Why it is a debt and not L12's: a `later-layer` entry with `layer: "L12"` is deferred below L12 (`MUTATION.md:189`), and the gate counts entries "for Ln or below" (`:204–206`). So the L8, L9 and L11 gates pass with all 27 unpinned, and an L12 test cannot kill at a lower gate. I read the 27 from `mutation-triage/*.json` with `python3 -I` (exit 0; the script is `dump27.py` in the l12 scratch folder). The 27 are the `later-layer` entries with `layer: "L12"`; the other 28 L12 entries are the distributable snapshots.

| Owning layer | Mutants | Entries (triage file, line; mutants at that line) | What kills them today | Pin to add |
|---|---|---|---|---|
| **L8** | **13** | `engine.json` 839 (1); 896 (4); 1622 (1); 1623 (1); 1732 (3); 1799 (1); 1800 (2): history navigation, its write accounting and the `onSnapshot` bridge | `audit-ledger.test.ts` "snapshot / history.navigate lifecycle"; `devtools.test.ts` "time-travel events records timetravel.jump events on goBack" | An `observe()` listener over a `goBack`, a `goForward`, a restore and a snapshot, asserting each `fact.change` event's `key`, `prev`, `next` and `origin`, and the order and count of events; plus a hook recorder for `onHistoryNavigate` and `onSnapshot` |
| **L9** | **5** | `engine.json` 2477, 2478, 2489, 2494 (fact-tag recording; 1 each); 2679 (1, the `meta` member object) | `audit-ledger.test.ts` "captures fact.change with prior + next"; "PII redaction redacts pii-tagged fact values by default" | A test that reads `system.meta` for each tagged fact's tags, the way the ledger does, beside an `observe()` listener on the same writes |
| **L11** | **9** | `constraints.json` 411 (1), 412 (2), 440 (1), 502 (1), 1811 (3): data-form `when` normalisation, its guard and `explainWhen`; `engine.json` 3787 (1, `whenSpec` in `inspect()`) | `audit-ledger.test.ts` "captures constraint.evaluate with whenSpec + whenExplain"; `devtools-when-explain.test.ts` | An `observe()` listener over a data-form `when` constraint, asserting the `constraint.evaluate` event's `active` and `whenExplain`, and `inspect().constraints[].whenSpec`; a function `when` beside it for contrast |
| **Total** | **27** | | | |

**Where each pin goes.** In the owning layer's pre work, because none of the three has gated: L8 is built and waits for its gate, L9's gate follows it, and L11 is not built. Each pin is then that layer's debt, found by its own `gate: L8`, `gate: L9` or `gate: L11` run. L12-pre adds a pin only for a layer whose pre work has already closed without it. **Done means:** the same mutants report Killed at their owning layer's gate, and the triage entries are re-layered to that layer by its pre work, so the L12 gate has nothing left that only a plugin test kills.

**Read, not run:** the layer of each entry comes from its note and the mutated line. Two are my reading and each owning layer's pre confirms them by running its gate: 2679 (the note says "dynamic definitions API"; the line is the `meta` object, so L9) and 3787 (the `whenSpec` read in `inspect()`, so L11).

## Performance

**In plain terms:** a plugin costs nothing until it is installed; the snapshot part costs nothing until it is called.

I did not run the bench: no L12 code exists. What L12 must keep:

- No workload slower than `main` by more than 5% after any L12 slice. `withDistributable` subscribes to nothing until `watchDistributableSnapshot` is called.
- A plugin's cost is its hooks. The adapter already builds a record only when some plugin's hook reads it (`plugins.ts`, `wants_`), so a performance plugin with 12 hooks makes the other 27 kinds cost nothing. The random tests never check that claim, because the recorder reads every hook (The fuzz, above); the conformance tests, which run with no recorder, do.
- A watch takes one snapshot per derivation change, as in 1.35 (D6). With (bx), one per included fact change too.
- L12b adds a `plugins-100` workload (B2): logging and performance installed, 100 writes. Time and bytes, judged at 1.0 or better against 1.35.

## Slice plan

**In plain terms:** an oracle slice, four build slices, and the gate.

| Slice | Builds | Done means (checkable) | Tier |
|---|---|---|---|
| Precondition 1 | A `gate: L12` run of `mutation-nightly.yml`. | The L12 layer gate reports PASS, or its debt entries are listed as L12-pre work. The 27 `later-layer` entries are not L12's debt: they are owed to L8, L9 and L11 (Mutation debt, above). | test oracle; coordinator |
| Precondition 2 | The L8 gate, L9-pre-a and the L9 gate, and L10 and L11 built and gated, with `compareClauses` kept as a file-level export of L11's `doctor` port. | `current` is L11; the 320 non-L12 failures at forced L12 are gone or signed. | coordinator |
| L12-pre (oracle) | U1 to U13, U16 and U17; U11 made to bite; U12 and U13 placements; the fuzz additions and rules 1 to 3 (B1), each with a self-test, the `clobberLoopPlugin` draw after U12 and the L11 gate; the `observe()` pins for the 27 mutants where their owning layer's pre work has closed; any other mutation debt. | The 21 PR seeds at forced L12 leave at most 10 unexplained cases. New tests pass on `conformance:v1` and `v1:prod` and fail on v2 only as predicted. `pnpm census`, `check:expects` and `oracle:update` exit 0. `oracle-change` label. | test oracle; Sonnet implementer, Fable correctness reviewer |
| L12a (every build) | `withDistributable` (D1 to D9), the six snapshot tools (G1 to G6), the observer channel (H4, H5), which L12c's ledger reads. (bu), (bv), (bx) if approved. The part joins `size.mjs`'s beta list. | The 4 distributable and 6 signing tests pass on v2, v2:prod and v2:dist; diff "distributable snapshots", "snapshot signing and verification" and "notify: clobber-loop channels reach plugins" match 1.35 or differ only by signed entries. core-next `test`, `typecheck`, `build`, `size:check` with the exact development-string count. The PR reports the part's bytes against A1 before L12b starts. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L12b (tools and observer plugins) | Logging, performance, observability and agent metrics, OTLP, token usage, the circuit breaker; `plugins-100` (B2). | 181 tests pass (56 + 34 + 11 + 80); diff "logging and performance plugins …" and "circuit breaker …" match. Per-plugin bytes reported against the table in Size. | core; Sonnet implementer, one reviewer |
| L12c (clobber, ledger, status) | Clobber alert, clobber loop, the audit ledger with its root exports, the status plugin; U14's 5 ledger unit tests. (bw), (by) if approved. Reads L12a's observer channel (H4, H5) and L11's `compareClauses`. | 9 + 25 (re-placed) + 79 tests pass, and U13; diff "clobber alert and clobber loop plugins" and "the audit ledger …" match. | core; Opus implementer, Sonnet plus Fable reviewers |
| L12d (devtools) | `devtoolsPlugin`, the graph, the panel, the AI bridge; U14's 44 helper unit tests. A4 as decided. | 68 tests pass. | core; Sonnet implementer, one reviewer |
| L12-gate | `current` to L12, `ratchet --update`, diff and fuzz at L12, the 28 feature-layer triage entries converted, `GATE-12.md`, `/principal` on L12. | 0 L12 failures on v2, v2:dist and v2:prod. The census exits 0. PR fuzz passes at L12. At most 3 gate runs, then Jason. | test oracle; Sonnet plus the coordinator's read of each entry |

**Reading the table:** L12a is the only slice that touches every app, so it lands first and reports its bytes. L12b to L12d change only `./plugins` and the root exports, and are paid for by importers and `full-entry`.

## Size

**In plain terms:** the part every app carries is about 0.6 KB of 1.35's code. The design review's sketch of it measured +424 B on `minimal`; with the namespaced wrappers the sketch lacks, the target is about 550 to 650 B. The plugins are about 27.5 KB of 1.35's code, paid only by an app that imports one; the per-plugin costs are below. The recommended caps stay: +750 B on the app fixtures, 0 B on `floor`, and +31.0 KB on `full-entry`, which imports every export.

**core-next on this branch.** `node scripts/size.mjs --check` in `packages/core-next` (production, minified, gzip 9; exit 0): `minimal` 35,282 B; `two-module` 35,373 B; `floor` 11,022 B; `aperture` 40,150 B; `full-entry` 37,551 B; `minimal`, beta wiring, 27,956 B. 1.35's `minimal` is 49,313 B, `two-module` 49,414 B, `aperture` 53,871 B. These are the post-L9 sizes the L11 RFC used; L10 and L11 are not built.

**1.35's L12 code, measured.** The method is the L9 and L11 RFCs': esbuild 0.27.7 (tsup's copy, as `scripts/size.mjs` uses), production (`#is-development` resolved to `dev-false.ts`), minified, gzip 9 by node zlib. Each export is bundled from `packages/core/src` with tree-shaking. "Over the engine" leaves every file under `src/core/` external, because an app already carries the engine, except the L11 tools (`doctor`, `rules-diff`, the compilers), which an app need not have. The engine-side methods are lifted by line range (`engine.ts:4092–4297`, `system.ts:699–785`), wrapped in one function whose free names are parameters, and minified; the wrapper's own cost is subtracted.

| Engine side (every `createSystem` build) | Minified | Gzip |
|---|---|---|
| `getDistributableSnapshot` and `watchDistributableSnapshot`, the engine's | 958 B | 505 B |
| The system's namespaced wrappers | 529 B | 206 B |
| Both, in one bundle | 1,455 B | 604 B |
| The wrapper's own cost | 56 B | 76 B |
| **The engine side, net** | | **528 B** |
| `hashObject` with 1.35's `stableStringify` (core-next has its own `stableStringify`, so only the djb2 loop is new: reasoned, about 50 B) | 1,160 B | 593 B |

**Reading the table:** the engine side is about 0.58 KB of 1.35's bytes: 528 B and the hash loop.

**The seam, sketched and measured.** The design review wrote the part against the core as it is, with no seam: a part on `system.derive`, `facts` and `subscribe`, the djb2 loop and the H4 cases. It ran `node scripts/size.mjs --check` before and after (production, minified, gzip 9; `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l12/review/size-before.log` and `size-after.log`). The check exits 1 on the sketch, because each fixture is over its current budget by 414 to 446 B; that is how the cost shows.

| Fixture (gzip) | Before | With the sketch | Change |
|---|---|---|---|
| `minimal` | 35,282 B | 35,706 B | **+424 B** |
| `two-module` | 35,373 B | 35,803 B | +430 B |
| `aperture` | 40,150 B | 40,583 B | +433 B |
| `floor` | 11,022 B | 11,022 B | **0 B** |
| `full-entry` | 37,551 B | 38,007 B | +456 B |

**Reading the table:** no seam is needed, because `floor` did not move. Not in the sketch: the system's namespaced wrappers (D5; 206 B of 1.35's bytes, measured above), (bx)'s fact subscription and H5's two cases. For the wrappers I estimate about 100 to 200 B more once ported (reasoned, not run). So the part costs about 520 to 630 B before (bx) and H5, and the target is 550 to 650 B. I could not confirm from the logs whether the sketch includes (bx); I treat it as not included. The `full-entry` figure is the part alone: the plugins and tools come on top.

| What an importer pays, over the engine | Minified | Gzip |
|---|---|---|
| `loggingPlugin` | 3,567 B | 1,192 B |
| `performancePlugin` | 1,987 B | 738 B |
| `createObservability`, `createAgentMetrics` (with token usage) | 6,765 B | 2,710 B |
| `createOTLPExporter` | 3,645 B | 1,589 B |
| `createCircuitBreaker`, `CircuitBreakerOpenError` | 2,760 B | 1,152 B |
| `normalizeTokenUsage` | 604 B | 322 B |
| `clobberAlertPlugin` | 1,474 B | 721 B |
| `clobberLoopPlugin` (it imports L11's `doctor` and `rules-diff`) | 12,358 B | 4,381 B |
| `createAuditLedger`, `memorySink` | 14,277 B | 5,274 B |
| `devtoolsPlugin`, `emitDevToolsEvent`, `DEVTOOLS_EVENT_NAME` (graph, panel, AI bridge) | 42,959 B | **12,359 B** |
| The status plugin (three names) | 1,968 B | 744 B |
| The six snapshot tools | 3,662 B | 1,530 B |
| `signSnapshot`, `verifySnapshotSignature`, `isSignedSnapshot` | 2,138 B | 970 B |
| **Every L12 plugin, in one bundle** | 89,101 B | **27,547 B** |
| `./plugins/index.ts`, whole (with persistence, which core-next has) | 90,878 B | 28,352 B |

**Reading the table:** devtools is 45% of the plugins. An app that imports one compiler-free plugin pays 0.3 to 2.7 KB for it; the clobber loop and the ledger pay 4.4 and 5.3 KB, partly for the L11 tools and the predicate redactor they share. The rows sum to more than the one bundle, because each carries its own copy of shared helpers, so a row is the most one plugin costs.

**How much of 1.35's size a port pays.** L7 landed at 0.61 of 1.35's isolated bytes, 12% over its first cap. L8 at 0.88, 26% above its high estimate. L9 at 0.87, 9% above its middle estimate, at 98% of its cap, with its seam 35% over its sketch. **L7, L8 and L9 each landed above an estimate made for it.** L10 and L11 are not built.

| Estimate | Basis | `minimal` grows by |
|---|---|---|
| What core-next lacks of the engine side | 528 B measured and about 50 B of hash loop | about 0.58 KB of 1.35's bytes |
| Low | 0.58 KB at L7's 0.61 | about 0.35 KB |
| Middle, revision 1's target (superseded) | 0.58 KB at L9's 0.87 | about 0.50 KB |
| **The sketch, the target** | Measured +424 to +433 B for the part without the wrappers, plus 100 to 200 B for them (reasoned) | **about 0.55 to 0.65 KB** |
| High | 0.58 KB at 1.0, a straight copy | about 0.58 KB |
| The earlier misses repeated | The top of the target, 0.65 KB, at L9's +9%, L7's +12%, L8's +26% | 0.71, 0.73 and 0.82 KB |
| (bx) a watch sees included facts | Reasoned: a fact subscription beside the derivation one | +40 to 80 B |
| H5 the two module cases | Reasoned: two more arms beside the clobber ones | +20 to 40 B |
| (bu), (bv) signing | In the snapshot tools, root exports: importers and `full-entry` only | 0 B on the app fixtures; +60 to 120 B on `full-entry` |
| (bw) strong verify, (by) the tombstone gap | In the ledger: importers and `full-entry` only | 0 B on the app fixtures |
| `floor` | The part is outside the core; no seam (read, not built) | 0 B |
| The plugins and tools, on `full-entry` only | 27,547 B, the snapshot tools 1,530 B and the status plugin 744 B, measured; ported as code, at 1.0 | about 29.8 KB |

**Reading the table:** the plan's +6.5 KB fits neither half. The part every app carries is about a twelfth of it. The plugins are more than four times it, and only importers pay them.

**The basis for +750 B, kept.** The sketch puts the part at about 0.52 to 0.63 KB before (bx) and H5; with them (+60 to 120 B) the range is about 0.58 to 0.75 KB. So +750 B is still the smallest round cap above the measured range, and L9's and L7's misses repeated on the top of the target (0.71 and 0.73 KB) fit under it. L8's (0.82 KB) would not, and would come back under A1. I would not raise it on a guess: a larger cap is a larger allowance to spend. **L12a's target is about 0.55 to 0.65 KB**, and its PR reports the part's bytes before L12b starts.

| Fixture | Cap (post-L11 plus) | At most, if L11 lands at its target | At most, if L11 lands at its cap |
|---|---|---|---|
| `minimal` | +750 B | 44,132 B | 45,832 B |
| `two-module` | +750 B | about 44,220 B | 45,923 B |
| `aperture` | +750 B | 49,000 B | 50,700 B |
| `full-entry` | +31.0 KB: a straight-copy cap (the measured 1.35 bytes of the plugins and tools, 29.8 KB, plus the engine cap, (bu) and (bv), rounded up). `full-entry` dedupes L11's helpers that the clobber loop's and the ledger's rows each carry a copy of, so a port should land under it | | the post-L11 size plus 31.0 KB |
| `floor` | +0 B | | |

The L11 figures are the L11 RFC's (rev 2, A1): `minimal` 43,382 B at target and 45,082 B at cap, `aperture` 48,250 B and 49,950 B; `two-module` is taken as `minimal` plus 91 B, its gap today. `floor` at 0 B means any byte there comes back with a reason; L12a says if it needs a seam. The caps are differences over the size L11 merges at; the L12-gate re-reads that base.

**The alpha minimal app against 1.35.** At L12's target (550 to 650 B) over L11's target, `minimal` is about 43,932 to 44,032 B, 5,281 to 5,381 B (about 11%) under 1.35's 49,313 B. At both caps it is 45,832 B, 3,481 B (7%) under. `aperture` at both caps is 50,700 B against 1.35's 53,871 B. The alphas keep 1.35's API, so the alpha app ends L12 within about 3.5 KB of 1.35, and L13 is still to come.

**The beta line.** `withDistributable` joins `size.mjs`'s beta list (`BETA_OMITTED`, `scripts/size.mjs:544`), so the minimal beta line does not move at L12: about 28.3 KB after L11 by the L11 RFC's projection, about 43% under 1.35, or about 1.45 KB less if PR #399's correction lands. At the beta, an app that skips the part drops it; the plugins were never in it.

## What the plan got wrong, or left out

- **"+6.5 KB" mixes two costs.** About 0.55 to 0.65 KB reaches every app (the snapshot methods); about 27.5 KB of 1.35's plugin code reaches only an app that imports a plugin, and `full-entry`.
- **"Opt-in" holds for the plugins and not for the snapshot methods.** `system.getDistributableSnapshot` is on every 1.35 system, so the part is in every `createSystem` build until the beta.
- **"All 19 plugins/__tests__"** is 15 L12 files in the oracle, two white-box files (49 tests, `WHITE-BOX.md:38–39`) that are not, and two L6 files (persistence, hydration scope).
- **25 clobber tests sit at L13** for a flush helper (U12), so a forced L12 never runs the clobber-loop plugin.
- **The clobber-loop `notify` members are L9's.** What is left at L12 is the observer channel (H4 for the clobber events, H5 for the module events), which the audit ledger reads, and the two plugins.
- **The status plugin is missing from the row.** Its three names are L12 in the census and have no L12 test (U13).
- **The audit ledger is a root export too.** 80 of the 348 failures are "is not a function" at the root, not a stub.
- **Four of the ten are not plugins.** The circuit breaker, observability, OTLP and token usage never touch a system.
- **The hook adapter is built.** 39 of 1.35's 46 hooks fire; six are L10's and `onFactDelete` never fires in 1.35.
- **L12 cannot gate before L10 and L11.** Its tests register and assign definitions, assert the `onDefinition*` hooks and use data-form `when`s.
- **27 mutants in L8, L9 and L11 code are killed only by L12 tests.** Those layers' gates pass with them unpinned (`MUTATION.md:189, 204–206`), and an L12 test cannot kill them at a lower gate. `observe()`-based pins at each owning layer move them down (Mutation debt).
- **The audit ledger runs on `observe()`, not hooks.** Its 14 `case` labels read the observer channel; core-next lacks two of them and the module pair (H4, H5).

## Decisions for the owner

**Questions for Jason.** Ten answers settle L12. Each is taken under the owner's instruction. The table after them gives each a product verdict, so Jason can bulk-approve.

1. **A1, the L12 size.** O1: `withDistributable` wired by `createSystem`, the plugins and tools as 1.35 exports them; up to +750 B (target about 550 to 650 B) on `minimal`, `two-module` and `aperture` over their post-L11 size, +31.0 KB on `full-entry`, 0 B on `floor`. **Recommend: approve.** **Option taken: approved (O1; the caps as recommended).**
2. **A2, do deep fuzz runs gate L12, or report?** **Recommend: "Gate on short seeds; deep runs report"**, as at L8 to L11. **Option taken: gate on short seeds; deep runs report.**
3. **A3, fuzz-ready before the gate.** **Recommend: approve L8's brakes unchanged**, with the L10 and L11 gates as the precondition. **Option taken: approved, as L8's brakes.**
4. **A4, A6's devtools graph.** **Recommend: port 1.35's graph in L12d; draw the real node graph only after the gate, in development only, or at the beta.** **Option taken: option 1, port 1.35's graph in L12d.**
5. **(bu), a signed snapshot verifies after it travels as JSON.** **Recommend: approve.** **Option taken: approved, in L12a.**
6. **(bv), signing refuses what it cannot cover.** **Recommend: approve.** **Option taken: approved, in L12a.**
7. **(bw), the audit ledger's strong verify (SHA-256).** **Recommend: decline.** **Option taken: declined; pin 1.35 (U10), no entry.**
8. **(bx), a watched snapshot sees its included facts change.** **Recommend: approve.** **Option taken: approved, in L12a.**
9. **(by), `verify()` catches a tampered entry just before an erasure marker.** **Recommend: approve, with a come-back.** **Option taken: approved, in L12c, with the come-back on the two tests (P5).**
10. **B1 to B5.** **Recommend: approve.** **Option taken: approved.**

A "no", or no answer yet, means the slice keeps 1.35's behaviour, pins it with a core-next test, and writes no entry.

| Decision | Product verdict | Recommendation | Option taken |
|---|---|---|---|
| **A1** the snapshot part wired by `createSystem`, the plugins as 1.35 exports them, and the L12 budgets | Same behaviour; every `createSystem` build grows by about 0.4 to 0.75 KB, most likely 0.55 to 0.65 KB, until the beta; a plugin costs only an app that imports it (0.3 to 12.4 KB each) | Approve: +750 B (target 550 to 650 B) on three fixtures, +31.0 KB on `full-entry`, 0 B on `floor`; come back above that | **Approved** under the owner's instruction: O1, the caps as recommended |
| **A2** deep runs report, short seeds gate | No behaviour change; decides when L12 can merge | "Gate on short seeds; deep runs report" | **Taken**: gate on short seeds; deep runs report |
| **A3** fuzz-ready before the gate | No behaviour change; bounds the gate's cost | Approve | **Taken**: approve |
| **A4** the devtools graph | Same, if 1.35's graph is ported: the 60 tests pin it. A real-graph view is new development-only output the oracle cannot check | Port 1.35's in L12d; the real-graph view after the gate or at the beta | **Taken**: port 1.35's graph in L12d; the real-graph view is not built at L12 |
| **(bu)** sign a snapshot's `data` and `metadata` in their JSON form | Better, visible: a snapshot with an `undefined` derivation or a `Date` verifies after a trip through Redis, a cookie or a fetch, where in 1.35 it always fails. A snapshot of plain JSON values signs to the same bytes as in 1.35, so signatures made by 1.35 still verify | Approve, in L12a | **Taken**: approve, in L12a |
| **(bv)** refuse to sign data deeper than 50 levels, or holding a cycle | Better, rare but a forgery: in 1.35 a value changed below 50 levels still verifies. An app with data that deep now gets a throw at signing, and `verify` returns false | Approve, in L12a | **Taken**: approve, in L12a |
| **(bw)** a SHA-256 ledger chain and `verify({ strong: true })` | Better if built, but new: a ledger whose chain resists a determined forger. Needs an async chain, a second `hashAlgo` and its own design | Decline at L12; keep 1.35's djb2 chain and message; revisit at the beta | **Taken**: decline; pin 1.35 (U10); no entry |
| **(bx)** a watch calls back when an included fact changes the data | Better, visible: a client mirroring `includeFacts` stays current. A watch now calls back more often, and costs every build about 40 to 80 B | Approve, in L12a | **Taken**: approve, in L12a |
| **(by)** `verify()` catches the entry just before an erasure marker | Better, rare but a forgery: 1.35's own pinned gap. A ledger that was quietly edited there now reports invalid | Approve, in L12c; come back if either of the two tests that pin an unmarked tombstone (`audit-ledger.test.ts:1278`, `audit-ledger-forgery.test.ts:315`) fails with the fix | **Taken**: approve, in L12c, with that come-back |
| **B1** the fuzz additions and harness rules 1 to 3 | No behaviour change | Approve | **Taken**: approve |
| **B2** a `plugins-100` workload | No behaviour change | Approve | **Taken**: approve |
| **B3** the placements: U12's 25 clobber tests to L12, U13's status-plugin test | No behaviour change; layer placements | Approve | **Taken**: approve |
| **B4** signing for approved rows | No behaviour change; the census needs signed entries | Approve | **Taken**: approve |
| **B5** L12 waits for the L10 and L11 gates | No behaviour change; an order | Approve | **Taken**: approve |

*"Owner instruction 2026-11-15: 'I approve you for to do everything'. Under it, Claude takes each recommended option below. The owner may overrule any of them."*

### A. Decisions

#### A1 where L12 lives, and the L12 budgets

- **What 1.35 does.** Every system has `getDistributableSnapshot` and `watchDistributableSnapshot`. The plugins are a separate entry, `./plugins`, with `sideEffects: false`, and the core imports none of them (the L11 RFC, rev 2, A1: `grep 'from "../plugins"'` over `src/core/*.ts` and `src/index.ts`, no matches). The snapshot tools, the audit ledger and the status plugin are also root exports; tree-shaking keeps an unused one out.
- **What 2.0 would do.** `withDistributable`, a part wired by `createSystem`, with no core seam. The plugins ported as files under `src/plugins/`, the tools under `src/utils/`, exported as 1.35 exports them.
- **The measured basis.** The engine side is 528 B of 1.35's bytes and about 50 B of hash loop; the plugins are 27,547 B in one bundle; the snapshot tools 1,530 B; the status plugin 744 B (Size). The design review's sketch of the part, with no seam, measured +424 B on `minimal`, +430 `two-module`, +433 `aperture`, 0 `floor` and +456 `full-entry`. L7, L8 and L9 each landed above an estimate made for it.
- **Product verdict.** Same behaviour. `minimal` grows from its post-L11 size by about 0.55 to 0.65 KB, at most 0.75 KB. An app that imports a plugin pays that plugin's row.
- **Recommendation.** Approve O1 and a raise with a written reason in each slice: +750 B over the post-L11 size on `minimal`, `two-module` and `aperture` (target 550 to 650 B), +31.0 KB on `full-entry`, 0 B on `floor`. Do the attribution step first: find the bytes, move cold code, fold duplicates. L12a reports the part's bytes before L12b starts. Come back if a slice lands above a cap.
- **The size story.** After L12, at the caps, the alpha `minimal` is 45,832 B, 3,481 B (7%) under 1.35's 49,313 B; at the targets about 43,932 to 44,032 B, 11% under. The beta line does not move at L12 (about 28.3 KB, 43% under 1.35), provided `withDistributable` joins the beta list.
- **Option taken.** The recommended one.

#### A2 do deep fuzz runs gate L12, or report?

- **What L8 to L11 chose.** "Gate on short seeds; deep runs report".
- **Why L12 is no different.** The ledger and the watch are new views of hooks and derivations the fuzz already compares, so the deep runs will mostly find new shapes of approved rows.
- **Recommendation.** The gate merges when the 21 PR seeds pass at L12; nightly deep runs report; any case triaged as a real 2.0 bug blocks at once.
- **Option taken.** "Gate on short seeds; deep runs report".

#### A3 fuzz-ready before the gate

- **What L8 chose.** L8-pre leaves at most 10 unexplained cases; the gate is capped at 3 runs, then goes to Jason; case files store v2's trace; earlier follow-ups land first.
- **What L12 adds.** Rule 1 (plugin timings by contract) is the L12-specific brake, and it is B1. The precondition is the L10 and L11 gates, not only L11's.
- **Recommendation.** Approve L8's brakes unchanged.
- **Option taken.** Approved, as L8's brakes.

#### A4 A6's devtools graph

- **What 1.35 does.** The devtools graph draws facts, derivations and history from `system.facts`, `derive` and `history` (`plugins/devtools-graph.ts`); the `devtools` tests pin it.
- **Option 1, port 1.35's graph (recommended).** In L12d, as code. Parity, checked by 60 tests.
- **Option 2, draw core-next's real dependency graph.** New output, development only, built on the graph read L9c's `why()` uses. The oracle cannot check it; it needs its own tests.
- **Recommendation.** Option 1 now. Option 2 after the L12 gate, as its own slice, only if L9c built `why()` and L12 lands inside A1; otherwise at the beta. Devtools is already the largest import (12.4 KB).
- **Option taken.** Option 1: port 1.35's graph in L12d; Option 2 is not built at L12.

### Candidate divergences

#### (bu) a signed snapshot verifies after it travels as JSON

- **What 1.35 does.** It signs `stableStringify` of the snapshot's five fields. That form writes `undefined` and a `Date` in ways JSON does not, so a snapshot holding either verifies where it was signed and fails once it has been through `JSON.stringify` and `JSON.parse` (G3; S2, S3).
- **What 2.0 would do.** Keep 1.35's envelope exactly (the five fields, sorted, an absent one written `undefined`, as `stableStringify` writes it), and write `data` and `metadata` in their JSON form: sorted keys, as `JSON.stringify` would send them (`undefined` keys dropped, a `Date` through its `toJSON`). The envelope must stay as it is: most snapshots lack `version` or `metadata`, and a JSON envelope would drop those keys and change every signature. For a snapshot whose `data` and `metadata` are plain JSON values, the bytes are then 1.35's, so a signature 1.35 made still verifies on 2.0, and the other way round. Reasoned, not run; L12a pins it with U5 turned round and a cross-version test.
- **Product verdict.** Better, visible: the documented use (sign on the server, store or send, verify later) works for every snapshot, not only for those without `undefined`.
- **Recommendation.** Approve, in L12a.
- **Option taken.** Approved: build in L12a.

#### (bv) signing refuses what it cannot cover

- **What 1.35 does.** Below 50 levels the signed form says `"[max depth exceeded]"`, so a deep value can be changed and still verify; a function and the string `"[function]"` sign the same (G4; S5, S6).
- **What 2.0 would do.** With (bu), the canonical JSON form has no placeholders: a function is dropped, as JSON drops it, and a cycle throws, as `JSON.stringify` does. Data deeper than 50 levels makes `signSnapshot` throw and `verifySnapshotSignature` return false. Reasoned, not run.
- **Product verdict.** Better, rare but a forgery: no signature covers less than the data it vouches for. An app that signs data nested more than 50 levels now gets a throw.
- **What it leaves.** No repo test signs data deeper than 50 levels (the files are listed under G4), so no 1.35 test bends. `version` keeps the lossy `stableStringify` (C): a change below level 50 does not move it.
- **Recommendation.** Approve, in L12a, with (bu).
- **Option taken.** Approved: build in L12a.

#### (bw) the audit ledger's strong verify

- **What 1.35 does.** The chain is djb2, 32 bits, "collision-prone against a determined attacker, by design" (`audit-ledger/hash.ts:128`). `verify({ strong: true })` throws "reserved for v2" (A1).
- **What 2.0 would do.** A SHA-256 chain (`hashAlgo: "sha256-1"`) and a `verify({ strong: true })` that checks it. Web Crypto's digest is asynchronous, so the append path, the sink and `verify` would need an asynchronous form: a design of its own.
- **Product verdict.** Better if built, but it is a new feature, not a fix, and the oracle cannot check it.
- **Recommendation.** Decline at L12. Keep 1.35's chain and its message, pin them (U10), and revisit at the beta. The message's "reserved for v2" reads oddly on 2.0-alpha; changing it is part of the beta's decision.
- **Option taken.** Declined: keep 1.35's djb2 chain; pin it (U10). No entry.

#### (bx) a watched snapshot sees its included facts change

- **What 1.35 does.** `watchDistributableSnapshot` subscribes to the watched derivations only. A write to an `includeFacts` key that moves no watched derivation never calls back; the next derivation change carries it (D6; D4).
- **What 2.0 would do.** Subscribe to the included facts too, and keep 1.35's version check, so a callback still fires only when `data` changed. Reasoned, not run.
- **Product verdict.** Better, visible: a client or cache that mirrors facts through a watch stays current. A watch that includes facts calls back more often than in 1.35. Every build pays about 40 to 80 B.
- **Recommendation.** Approve, in L12a.
- **Option taken.** Approved: build in L12a.

#### (by) `verify()` catches a tampered entry just before an erasure marker

- **What 1.35 does.** An erasure (`ledger.erase(...)`) writes a marker entry, `system.entry-erased`. If the entry directly before the marker is edited, `verify()` still says valid. 1.35's test pins this as a known gap with `it.fails` (P5; `audit-ledger.test.ts:831, 852`).
- **What 2.0 would do.** Reject a break at a tombstone that bears the in-module mark (`isInternal(entry)`), unless the entry before it is also a tombstone (adjacent erasures). The missing check is at `audit-ledger/verify.ts:162–171`, where a break at a tombstone is forgiven unconditionally; `erase()` keeps the tombstone's own `prevHash` (`index.ts:887`), so such a break can only mean the entry before it was changed. Only in-process ledgers carry marks, so an exported ledger keeps 1.35's behaviour. Two 1.35 tests pin the opposite for an unmarked tombstone (`audit-ledger.test.ts:1278`, `audit-ledger-forgery.test.ts:315`); the narrow fix leaves both green (under P5). Read from the code and the two tests, not run; L12c's PR runs them.
- **Product verdict.** Better, rare but a forgery, in a plugin whose job is to show tampering.
- **Recommendation.** Approve, in L12c. Come back if either of those two tests fails with the fix. The fix changes no hash, so a ledger written by 1.35 still verifies on 2.0 unless it holds this very tamper.
- **Option taken.** Approved: build in L12c, with the come-back.

### B. Recommendations the owner may overrule

#### B1 the fuzz additions and harness rules

- **Recommendation.** In L12-pre: the `distributable` op, the watch option, the drawn ledger, logging, performance, clobber-alert and (after U12 and the L11 gate) clobber-loop options, and rules 1 to 3, each with a self-test. They run on 1.35 from L12-pre, and on v2 only once `current` is L12.

#### B2 the `plugins-100` workload

- **Recommendation.** Logging and performance installed, 100 writes; time and bytes; judged at 1.0 or better against 1.35 at the gate. Approve the shape before L12b.

#### B3 the placements

- **Recommendation.** In L12-pre: `instruments: ["import flushMicrotasks"]` on the rules for `clobber-loop.test.ts` and `clobber-alert.test.ts` (U12), and a conformance test for the status plugin at L12 (U13).

#### B4 signing

- **Recommendation.** Each build slice signs the entries for approved rows "on the owner's instruction", as at L2, L3 and L7 to L9 (GATE-2 rule 1). Declined rows get no entry.

#### B5 L12 waits for L10 and L11

- **Recommendation.** L12-pre may land at any time; L12a may land once L11 is gated; L12b to L12d, and the gate, after both. L12b's tools need neither, and may land with L12a.

### C. Engineering defaults that keep parity (no decision needed)

- **`version` stays 1.35's 32-bit djb2 over `stableStringify`**, and a watch forces it on.
- **`createdAt` is `Date.now()`; `expiresAt` only for `ttlSeconds > 0`; `metadata` by reference**, as 1.35.
- **Unknown keys and a throwing derivation are skipped; the warnings are development text**, as 1.35.
- **An empty secret throws the platform's error.**
- **`onFactDelete` stays silent**, and the plugin manager logs a hook's throw without rethrowing it.
- **The clobber-loop events reach observers as the object given**, with no `type` added.
- **Each plugin's options, defaults and messages are 1.35's**, including the circuit breaker's "failureThreshold must be >= 1" and the ledger's "reserved for v2".
- **`createAuditLedger` and `memorySink` are exported from the root and from `./plugins`**, as 1.35.
- **The `featureMissing` stubs for layer 12 go** when their pieces land.

## Evidence: probes

**What I ran.** Each command's output went to a file, and I read the files back, not a pipe.

- **The forced L12 runs.** `sed` set `current` to `"L12"` in `packages/conformance/layers.rules.json`; then the three `npx vitest run` commands under "Gap analysis", JSON reporter, each exit 1; then `git checkout -- layers.rules.json` (`current` `"L7"`, `git status --short` empty). A script joined each failure to `layers.json` by file and title. Files: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l12/v2.json`, `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l12/v2dist.json`, `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l12/diff.json`, the summary `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l12/summ.txt`, the failures with their layers in `v2.json.fails.txt` beside it, and the diff and fuzz messages in `fuzzmsg.txt`.
- **The L12 placements.** `python3 -I l12tests.py layers.json l12-tests.tsv` (exit 0): 349 tests, by file and reason, in `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l12/l12tests.log`; the clobber files' placements by a second read of `layers.json`.
- **Size.** `node measure.mjs ~/dev/directive2-l12rfc` (exit 0), esbuild 0.27.7; output in `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l12/size/size.log`, each bundle as `<piece>.<mode>.min.js` beside it. core-next's fixtures: `node scripts/size.mjs --check` (exit 0), in `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l12/next-size.log`.
- **Hooks.** The 46 names from `packages/core/src/core/types/plugins.ts` and the 39 quoted in `packages/core-next/src/api/plugins.ts`, compared with `comm` (`hooks135.txt`, `hooksnext.txt` in the l12 scratch folder); each plugin file's names by `grep -o` against the 46.
- **Mutation triage.** A `python3 -I` read of `mutation-triage/*.json` (exit 0): 55 entries with `layer: "L12"` (28 feature-layer, 27 later-layer), none naming L12 only in a note.
- **The probes.** `node probe.mjs <dist> <out.json>` against the published 1.35, `dist/development` and `dist/production`, exit 0 for both. Development and production gave the same results except D2, D3 and D5, where only development warned, and the clock values. Source: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l12/probe/probe.mjs`; output: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l12/probe/out-dev.json` and `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l12/probe/out-prod.json`.

**What I read, not ran.** 1.35's `core/engine.ts:2823–2919, 3190–3240, 4085–4300`, `core/system.ts:695–790`, `utils/utils.ts:175–290, 394–900`, `plugins/index.ts`, `audit-ledger/hash.ts` (the lines cited), `index.ts:217–220, 299, 356–378`; core-next's `src/api/plugins.ts:1–130, 225–290`, `src/api/missing.ts`, `src/plugins/index.ts`, `src/api/observe.ts:224`, `src/api/namespaced.ts:76`, `src/api/requirements.ts:27`; the oracle's `layers.rules.json:1–140, 720–800`, `diff/unfired-hooks.json`, `contracts/next-unshipped.json`, `WHITE-BOX.md:38–39`, `audit-ledger.test.ts:828–925`, and the import lines of the 16 L12 files. The claims that `withDistributable` needs no core seam, that (bu) keeps plain-JSON signatures byte-identical, and the cost of (bx), are reasoned from those reads.

Every probe builds one module, `acct`: facts `name` ("Ada"), `count` (1) and `plan` ("free"); derivations `display` (`"Ada (1)"`), `boom` (throws once `count` passes 1) and `none` (returns `undefined`). The signing probes use a 32-character or one-character secret.

| Probe | Steps | 1.35 |
|---|---|---|
| D1 | `getDistributableSnapshot` with `display`, `count`, `ttlSeconds: 60`, `metadata`, `includeVersion` | `data` `{ display: "Ada (1)", count: 1 }`, `expiresAt` 60,000 ms after `createdAt`, `version` 8 hex characters, `metadata` as given |
| D1b | No options | `data` keys `display`, `boom`, `none`: every derivation, no fact |
| D2 | An unknown derivation and an unknown fact | Both ignored; development warned twice, naming what is available; production silent |
| D3 | `count` 2, then include `boom` | `boom` left out; development warned "Skipping derivation …"; production silent |
| D4 | Watch `display` with `includeFacts: ["plan"]`; write `plan`; write `count` 5; write `count` 5 again; batch `count` 6 and 7; unsubscribe; write `count` 8 | 0 calls after the `plan` write; 1 after `count` 5, carrying `plan: "pro"`; none for the equal write; 1 for the batch (`"Ada (7)"`); none after unsubscribing. Every callback snapshot had `version` |
| D5 | Watch with `includeDerivations: []` | Never called; a function back; development warned "No derivations to watch …" |
| D6 | Watch, write, read the count before and after a tick | 1 call already, synchronously; still 1 later |
| D7 | Namespaced module `a`; `a.display`, `a.count` | `{ a: { display: "Ada (1)", count: 1 } }` |
| S1 | Sign `{ data: { a: 1 }, createdAt: 0 }`; verify directly and after JSON | A 64-character signature; both true |
| S2 | Sign a snapshot whose `none` is `undefined`; verify directly and after JSON | `true`; `false` |
| S3 | Sign `{ at: new Date(0) }`; verify directly and after JSON | `true`; `false` |
| S4 | Sign with `""` | Threw "Zero-length key is not supported" |
| S5 | Sign 60 nested levels ending in `"a"`; verify the same with `"EVIL"` | The forgery verified: `true` |
| S6 | Sign `{ f: () => 1 }`; verify `{ f: "[function]" }` | `true` |
| S7 | Sign with `expiresAt: 1000`; verify at 1000 and 1001; `isSnapshotExpired` at 1000; `validateSnapshot` at 1001 | `true`, `false`, `false`, and the "Snapshot expired at 1970-01-01T00:00:01.000Z …" throw |
| S8 | Edit `metadata`; add `expiresAt` | Both fail |
| S9 | `diffSnapshots` of `{ a: 1, b: { c: 1 } }` and `{ a: 2, b: { c: 2 }, d: 1 }` | Changes `a`, `b.c` (changed), `d` (added); `versionChanged: false` |
| C1 | A plugin with `onClobberLoopDetected`, an observer; `notify.clobberLoopDetected` with a typed event, then with `{ fact: "no type" }` | The observer got both; the first was the same object; the second unchanged, with no `type` |
| C2 | The same with no plugin, only an observer | The observer heard it (1) |
| A1 | `createAuditLedger()` installed; one write; `verify()`; `verify({ strong: true })` | `{ valid: true, entryCount: 6, marksChecked: true }`; the strong call threw "… is reserved for v2 — v1 ships sync djb2 chain only …"; entries `hashAlgo: "djb2-1"`, 8-character hashes |
| V1 | `version` of `{ display: "Ada (2)" }` | `"3a323634"` |

**Reading the table:** D4 is (bx), S2 and S3 are (bu), S5 and S6 are (bv), A1 is (bw), and C1 and C2 are H4, the observer channel L12a builds. (by) comes from 1.35's own pinned test, not from a probe.

### Revision 2: evidence from the design review

**In plain terms:** the review's evidence is in `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l12/review/`. I checked each file and line below against the tree before writing it.

- **Files used.** `missing-verify.txt` (1.35's `verify.ts` and the `erase()` lines), `ledger2.txt` (the ledger's event reads), `obsunion.txt` (the observation union), `size-before.log` and `size-after.log` (the sketch), `triage.txt` (27 `later-layer`, 28 `feature-layer`).
- **Checked in the tree.** `audit-ledger/index.ts:717` (`sys.observe(onEvent)`), `:553–686` (14 `case` labels), `:759–799` (8 hooks), `:881–887` (`erase()` keeps `prevHash`); `verify.ts:63, 162–171, 190`; `hash.ts:55`; `core-next/src/api/observe.ts:17–177, 200, 224`; `core/engine.ts:3146–3148`; `core/types/system.ts:1152–1153`; `diff/scenario.ts:1142–1145`; `diff/record.ts:112–116`; `diff/hooks.ts:13` (46 names); `core-next/src/api/plugins.ts:161–171, 240, 257`; `clobber-loop.ts:21, 340, 660, 733`; `core/doctor.ts:224, 424`; `core/src/index.ts:207–215`; `MUTATION.md:189, 204–206`; the two tombstone tests; the size logs (35,282 to 35,706, 35,373 to 35,803, 40,150 to 40,583, 11,022 unchanged, 37,551 to 38,007).
- **Run.** `python3 -I dump27.py` over `mutation-triage/*.json` (exit 0): 27 `later-layer` entries with `layer: "L12"`, 13 L8, 5 L9 and 9 L11 by my reading.
- **Not verified.** The sketch's source (I have its logs only, so I cannot say whether it includes (bx)); the 100 to 200 B for the namespaced wrappers and the +20 to 40 B for H5 (reasoned); the layer of entries 2679 and 3787; the narrow (by) fix and its adjacent-tombstone exception (read, not run); whether L10's kernel records will carry the module events (L10's RFC does not say); that the recorder records observer events.
