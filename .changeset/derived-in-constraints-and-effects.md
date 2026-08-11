---
"@directive-run/core": minor
---

**Constraints and effects now receive `derived`, the same way derivations already do.** A constraint's `when()` and `require()` take it as a second argument; an effect's `run()` takes it third, after `facts` and `prev`.

```typescript
constraints: {
  reset: {
    when: (facts, derived) => derived.tooHigh,
    require: { type: "RESET" },
  },
},
effects: {
  log: {
    run: (facts, prev, derived) => console.log(derived.summary),
  },
},
```

Until now a derivation body was called `(facts, derived)` and a constraint or effect was called with facts alone, so a module that wanted to gate on its own derivation had one route: close over `system.derive` and read through that.

That route is the single-module accessor. `createSystem({ module })` puts a module's derivations directly on `system.derive`; `createSystem({ modules })` puts a *module name* there and the derivations one level down. So the identical read that returned a value in the first shape returns `undefined` in the second — the gate goes falsy, the constraint never fires, the effect logs nothing, and no error is raised at any point. A module that worked alone stopped working when composed, silently, and the silence was the expensive part.

The parameter closes that off. It is scoped to the reading module, so `derived.total` means this module's `total` whatever else the system contains, and it is the same object a derivation body gets — no new concept. Reads through it are tracked: a constraint or a synchronous effect that consults a derivation is woken when that derivation moves, without naming it in `deps`. An async effect still has to declare its dependencies, because its reads happen past an `await` where auto-tracking cannot see them — that is unchanged, and unchanged for facts too.

Nothing breaks. The argument is added at the end of each signature, so every existing `when: (facts) => …` and `run: (facts, prev) => …` keeps its meaning and its types. Reaching back through `system.derive` still works in a single-module system; it is simply no longer the only way, and the new way survives composition.

One behavioral consequence worth knowing about if you have effects with no explicit `deps`: a derivation read through the new parameter registers as an outside watcher, which is what makes the wake-up work. An effect that reads a derivation and previously ran only on its fact dependencies will now also re-run when that derivation goes stale. That is the intended behavior, and it only applies to code that adopts the parameter.
