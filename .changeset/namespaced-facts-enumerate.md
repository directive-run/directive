---
"@directive-run/core": minor
---

**A namespaced module's facts enumerate again.** `{ ...facts }`, `Object.keys(facts)` and `JSON.stringify(facts)` produced `{}` for any module in a multi-module system, while every individual property read returned the right value.

Spread is the ordinary way to snapshot a module's state, so the empty object did not read as a broken accessor — it read as an empty module. Anything built on a spread was quietly working from nothing: a snapshot passed to a helper, a payload assembled for an event, a serialized fact set written to disk.

```typescript
const system = createSystem({ modules: { auth: authModule } });

system.facts.auth.token; // "abc" — always worked
{ ...system.facts.auth }; // {} — now { token: "abc" }
```

The facts proxy translates unprefixed names to the flat store's prefixed keys, and it carried traps for reading, writing, `in` and `delete` but none for enumeration. A proxy without an `ownKeys` trap enumerates as empty no matter what it holds.

A module sees only its own keys, unprefixed; another module's facts in the same store stay out of the result. `util.inspect` and any debugger that leans on it now show the real fact set instead of `{}`.

**Two consequences worth reading before you upgrade.** This is a minor, not a patch, because of them.

*Spreading facts now registers dependencies, so an effect or derivation that spreads may stop running as often.* Enumeration goes through the same read path as a property access, so each enumerated key is tracked. Before this change a spread touched nothing, the body recorded no dependencies at all, and Directive treats "no recorded dependencies" as "dependencies unknown" — which means run on every reconcile. So a body whose only fact access was a spread woke on every write in the system, including writes to other modules' facts. It now wakes on its own module's facts and nothing else. That is the correct behaviour and it is what the same code does in a single-module system, but if you had come to rely on the over-firing, this is where it went:

```typescript
effects: {
  audit: {
    run: (facts) => { send({ ...facts }); },  // was: fired on every reconcile
                                              // now: fires on this module's facts
  },
}
```

Name a fact explicitly if you want a body to track something the spread does not reach.

*Values that were hidden are now emitted.* `JSON.stringify(system.facts)` walked a namespaced module and got `{}`. It now serializes the real fact set. If you log, persist or ship a serialized system — a crash report, a debug dump, a state snapshot — check what is in those facts first. Anything you would not have put in the log yourself is in it now.
