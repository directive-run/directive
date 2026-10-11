---
"@directive-run/core": minor
"@directive-run/ai": minor
---

Multi-module systems no longer fail silently.

**Resolvers in a module with `crossModuleDeps`**

- `ctx.facts` is flat access to the module's own facts (`ctx.facts.draft = ""`), as the types always said. Before, the runtime handed resolvers the cross-module proxy, the typed write threw, and the requirement stayed unmet with nothing logged.
- New typed, read-only `ctx.deps.<ns>` reads declared dependencies (`ctx.deps.auth.token`). Types: `CrossModuleResolverContext`, `CrossModuleResolversDef`, `ResolverDeps`.
- Another module's facts are read-only from a resolver. A write through `ctx.deps.<ns>` throws in development and is ignored in production. Emit a requirement or dispatch an event the other module owns instead.
- `ctx.facts.self` and `ctx.facts.<ns>` are gone: `ctx.facts` holds the module's own facts only, for reads, writes, `in` and `Object.keys` (it used to expose `self` and the dep namespaces). Rewrite `ctx.facts.self.x` as `ctx.facts.x` and `ctx.facts.auth.x` as `ctx.deps.auth.x`.
- Namespaced resolvers now receive `ctx.requeue()` and `ctx.snapshot()`; the wrapper used to drop them.
- Changing a dependency's value in place (`ctx.deps.auth.user.name = …`, `ctx.deps.auth.roles.set(…)`) is reported in development once the resolver settles, naming the path, and the resolver fails. The values are the stored ones, unwrapped, so production pays nothing. It is the same check effects use.
- `ctx.facts.$store` and `ctx.facts.$snapshot()` in a namespaced resolver are scoped to the module's own facts. Keys are bare names (`"draft"`) or the module's own prefixed form; writing another module's key throws in development and is ignored in production, and reading one returns `undefined`. They used to reach the whole system's store.

**Sources in a namespaced system**

- `publish("START")` dispatches the source's own module's `START` (`loop::START`). A source publishes only its own module's events: a name containing `::` is prefixed like any other, matches no handler, and is dropped as `unknown-event`, with a development warning (once per source) naming the fix – dispatch the other module's event from a handler or resolver. A blocked name (`__proto__`, `constructor`, `prototype`) passes through unprefixed so it is still reported as `blocked-event-name`.
- Plugin hooks (`onSourcePublish`, `onSourceDrop`) and `source.publish` / `source.drop` observation events report the prefixed event name (`loop::START`).
- `key` / `active` gates read the module's own facts, scoped like constraints: `facts.running`, or `facts.self.*` / `facts.{dep}.*` with `crossModuleDeps`. They used to receive the whole flat store. Gate facts are typed from the module schema (`SourcesDef<F>`, `SourceGateFacts`), read-only, and a write is reported as a `phase: "gate"` error. There is no flat `"ns::fact"` form: such a read is `undefined`. A bare read in a module with `crossModuleDeps` warns once with the `facts.self.x` spelling. Gate proxies are cached, so evaluating gates allocates nothing per reconcile.
- In development, every gate – single-module and namespaced – reads through a read-only view: a top-level write, or a value changed in place (`facts.cfg.hz += 1`), is reported as a `phase: "gate"` error and the gate fails closed. Production hands the gate the facts directly.
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
- A source gate that throws, or that a development check fails, closes the gate and warns once per source.
- Every multi-module warning above is deduplicated per system, not per process, with a cap on how many keys are remembered.
