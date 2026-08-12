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

The parameter closes that off. It is the same object a derivation body gets, and it is **scoped to the module that declared the derivation** — `derived.total` means this module's `total` whatever else the system contains, and there is no way to reach another module's derivations through it. That scoping is stricter than the facts proxy, which does offer cross-module access via `crossModuleDeps`; reading another module's *derivation* is not supported and returns `undefined`.

### When reads are tracked, and when they are not

A read through `derived` registers a dependency **on the auto-tracked path** — a synchronous body with no explicit `deps`, reading before any `await`. That body is re-evaluated when the derivation moves, without naming it anywhere.

Three cases do not track, and every one of them is the rule that already applies to facts:

- **`deps` is declared.** The array is the whole dependency set. A derivation read through `derived` but not named in `deps` will not wake the body.
- **`async: true` on a constraint.** The predicate runs outside the tracking context. Declare `deps`.
- **A read after an `await`.** Auto-tracking is a synchronous stack and has already closed. Name it in `deps`, or move the read above the first `await` — that keeps the body auto-tracked and is usually the smaller change.

### Compatibility

The argument is appended to each signature, so every existing `when: (facts) => …` and `run: (facts, prev) => …` keeps its meaning and its types. Code that *defines* constraints and effects is unaffected.

Code that **invokes** `when()` or `run()` directly — a test helper, a custom runner, an adapter calling into a definition — must pass the new argument, because the parameter is required rather than optional. That is a compile error, not a silent failure.

Reaching back through `system.derive` still works in a single-module system. It is simply no longer the only way, and the new way survives composition.

### One behavioral note

For an effect with no explicit `deps`: a derivation read through the new parameter registers that derivation as a dependency, so the effect now also re-runs when it goes stale. That is the parameter working as intended, and it applies only to code that adopts it.
