---
"@directive-run/core": minor
---

Multi-module systems no longer fail silently.

- **Resolvers in a module with `crossModuleDeps` get flat facts.** `ctx.facts.draft = ""` now works, as the types always said. Before, the runtime handed resolvers the cross-module proxy, the typed write threw, and the requirement stayed unmet with nothing logged. The old `ctx.facts.self.x` and `ctx.facts.<dep>.x` spellings keep working and warn once in development.
- **A source's `publish("START")` dispatches its own module's `START`.** In a namespaced system the name was dispatched unscoped, so the event was dropped while still being counted as published. Names that already contain `::` are dispatched as written.
- **Source `key` / `active` gates read the module's own facts.** They were handed the whole flat store (`facts["loop::running"]`), so `facts.running` was always undefined and the source never attached. Gates are now scoped like constraints (`facts.self.*` / `facts.{dep}.*` with `crossModuleDeps`), read-only, and a write is reported as a `phase: "gate"` error. The flat `"ns::fact"` read still works and warns once in development.
- **Source ids are namespaced (`loop::boot`).** The same source id in two modules, or one factory module registered under two names, no longer throws a definition collision. Ids in `inspect().sources` and source plugin hooks change accordingly in namespaced systems.
- **A publish with no handler is a drop.** It now counts toward `dropCount` with the new `lastDropReason: "unknown-event"` and fires `onSourceDrop` instead of `onSourcePublish`, in production too. `SourceDropReason` gains the `"unknown-event"` member; an exhaustive `switch` over it needs a new case.
- **Unhandled errors are visible in development.** When a resolver, constraint, or derivation throws and falls through to the default `"skip"` strategy with no `errorBoundary` handler configured, Directive warns once per source with the error and, for resolvers, the requirement that stays unmet. Effects already log every throw. Production behavior is unchanged.
- Writing through the cross-module facts proxy (`facts.draft` where `facts.self.draft` was meant) now warns in development with the right spelling.
