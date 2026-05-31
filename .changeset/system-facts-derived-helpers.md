---
"@directive-run/core": minor
"@directive-run/el": minor
---

Add `SystemFacts<T>` and `SystemDerived<T>` type helpers to
`@directive-run/core` for extracting the typed facts and derivations
shape from any Directive system or module schema.

Both helpers accept a `SingleModuleSystem<S>`, a `NamespacedSystem<Modules>`,
or a raw `ModuleSchema`, and return the value shape — not the writable
proxy or the runtime-control surface. They make it possible to type
adapter callbacks, render functions, and selector helpers against the
schema's narrow types instead of falling back to `Record<string, unknown>`.

```ts
import { createSystem, type SystemFacts, type SystemDerived } from "@directive-run/core";

const system = createSystem({ module: trafficLight });

function paint(
  facts: SystemFacts<typeof system>,    // { phase: "red" | "green" | "yellow" }
  derived: SystemDerived<typeof system>, // { isRed: boolean }
) {
  return derived.isRed ? "STOP" : "GO";
}
```

`@directive-run/el`'s `bind`, `bindText`, and `mount` now thread the
schema into their updater callbacks, so a `bind(system, span, (el, facts) => ...)`
call gets `facts.phase` typed as the schema literal union instead of
`unknown` — no `as` casts required at the call site. Existing call
sites that did cast still compile; the casts are now noise.
