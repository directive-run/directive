---
"@directive-run/core": minor
"@directive-run/ai": minor
---

Multi-module systems no longer fail silently.

**Resolvers in a module with `crossModuleDeps`**

- `ctx.facts` is flat access to the module's own facts (`ctx.facts.draft = ""`), as the types always said. Before, the runtime handed resolvers the cross-module proxy, the typed write threw, and the requirement stayed unmet with nothing logged.
- New typed, read-only `ctx.deps.<ns>` reads declared dependencies (`ctx.deps.auth.token`). Types: `CrossModuleResolverContext`, `CrossModuleResolversDef`, `ResolverDeps`.
- Another module's facts are read-only from a resolver. A write through `ctx.deps.<ns>` or the legacy `ctx.facts.<ns>` throws in development and is ignored in production. Emit a requirement or dispatch an event the other module owns instead.
- The legacy `ctx.facts.self.x` / `ctx.facts.<ns>.x` spellings still read, and warn once per system in development, pointing at `ctx.facts` / `ctx.deps`.
- `"self" in ctx.facts` and `"<ns>" in ctx.facts` answer `true`, but `Object.keys(ctx.facts)` lists only the module's own facts (it used to list `self` and the dep namespaces).
- Namespaced resolvers now receive `ctx.requeue()` and `ctx.snapshot()`; the wrapper used to drop them.

**Sources in a namespaced system**

- `publish("START")` dispatches the source's own module's `START` (`loop::START`). A name containing `::` is dispatched as written. A blocked name (`__proto__`, `constructor`, `prototype`) passes through unprefixed so it is still reported as `blocked-event-name`.
- Plugin hooks (`onSourcePublish`, `onSourceDrop`) and `source.publish` / `source.drop` observation events report the prefixed event name (`loop::START`).
- `key` / `active` gates read the module's own facts, scoped like constraints: `facts.running`, or `facts.self.*` / `facts.{dep}.*` with `crossModuleDeps`. They used to receive the whole flat store. Gate facts are typed from the module schema (`SourcesDef<F>`, `SourceGateFacts`), read-only, and a write is reported as a `phase: "gate"` error. A flat `"ns::fact"` read still works and warns once per system. A bare read in a module with `crossModuleDeps` warns once with the `facts.self.x` spelling. Gate proxies are cached, so evaluating gates allocates nothing per reconcile.
- Source ids are namespaced (`loop::boot`), so the same id in two modules, or one factory module registered twice, no longer throws a definition collision. The prefixed id appears in `inspect().sources[i].id`, plugin source hooks, `source.*` observation events, the audit ledger's `sourceId`, and the `source.id` OpenTelemetry attribute from `attachSourcesToOtel`.
- New `localId` (the id the module declared, `boot`) on `inspect().sources[i]` and every `source.*` observation event, and a `source.local_id` OpenTelemetry attribute. It equals `id` in a single-module system. Label sources with `${moduleId}/${localId}`; `${moduleId}::${id}` now prints `loop::loop::boot`.
- Source definitions keep their prototype and property descriptors when namespaced, so class-based sources and non-enumerable `meta` work.

**Unhandled publishes are drops**

- A publish with no handler no longer counts toward `publishCount` or fires `onSourcePublish`. It counts toward `dropCount` with `lastDropReason: "unknown-event"` and fires `onSourceDrop` / `source.drop`, in production too.
- `SourceDropReason` gains `"unknown-event"`; an exhaustive `switch` over it needs a new case.

**Blocked keys in namespaced systems**

- `__proto__`, `constructor` and `prototype` are rejected as keys in facts, events, derive, effects, sources, constraints and resolvers in namespaced systems, as they already were in single-module systems. The check used to run on the prefixed keys and could never match.

**New development warnings**

- An error that falls through to the default `"skip"` strategy with no `errorBoundary` handler warns once per source (resolvers, constraints, derivations), with the requirement that stays unmet. Effects already log every throw.
- A write at the top level of the cross-module facts proxy in a derivation, constraint or effect warns once per system: those read facts and never write them.
- Every multi-module warning above is deduplicated per system, not per process, with a cap on how many keys are remembered.
