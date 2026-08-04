---
"@directive-run/core": patch
---

**A namespaced module's facts enumerate again.** `{ ...facts }`, `Object.keys(facts)` and `JSON.stringify(facts)` produced `{}` for any module in a multi-module system, while every individual property read returned the right value.

Spread is the ordinary way to snapshot a module's state, so the empty object did not read as a broken accessor — it read as an empty module. Anything built on a spread was quietly working from nothing: a snapshot passed to a helper, a payload assembled for an event, a serialized fact set written to disk.

```typescript
const system = createSystem({ modules: { auth: authModule } });

system.modules.auth.facts.token; // "abc" — always worked
{ ...system.modules.auth.facts }; // {} — now { token: "abc" }
```

The facts proxy translates unprefixed names to the flat store's prefixed keys, and it carried traps for reading, writing, `in` and `delete` but none for enumeration. A proxy without an `ownKeys` trap enumerates as empty no matter what it holds.

A module sees only its own keys, unprefixed; another module's facts in the same store stay out of the result. `util.inspect` and any debugger that leans on it now show the real fact set instead of `{}`.
