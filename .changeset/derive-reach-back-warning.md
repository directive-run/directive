---
"@directive-run/core": patch
---

**Reaching for a derivation where a module name belongs now says so, instead of returning `undefined`.**

`createSystem({ module })` puts a module's derivations directly on `system.derive`. `createSystem({ modules })` puts *module names* there and the derivations one level down. So `system.derive.total` returns a value in the first shape and `undefined` in the second — the gate goes falsy, the constraint never fires, the effect logs nothing, and no error is raised anywhere.

Constraints and effects receive `derived` as a parameter now, which removes the reason to reach back at all. But nothing was taken away: every module written before that still contains the read, and upgrading surfaces exactly none of them. Fixing an API does not disarm a trap.

In development, a read that resolves to no module is now checked against the derivations that do exist, and if it names one, the warning says which module owns it, how to read it from inside a constraint or effect, how to read it from outside one, and what modules the system actually has:

```
[Directive] system.derive.tooHigh is undefined — "tooHigh" is a derivation of
module "counter", not a module. This system was built with createSystem({ modules }),
where system.derive holds module names and the derivations are one level down.
Inside a constraint or effect, read the `derived` parameter instead:
`when: (facts, derived) => derived.tooHigh`. Outside one, use
system.derive.counter.tooHigh. This system's modules are: counter, bystander.
```

Once per name per system — per system rather than per process, because a second system is a second chance to make the same mistake and deserves to hear about it. Silent for names that match nothing, silent for the keys runtimes probe on any object they are handed (`$$typeof`, `toJSON`, `then`, and friends, which React's dev mode walks on every render), and silent in a single-module system where the read is correct.

Development only, and only on the miss path — a resolved module name never reaches it.
