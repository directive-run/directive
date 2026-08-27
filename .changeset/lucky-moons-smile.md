---
"@directive-run/core": minor
---

Modules can now be removed from a running system with `system.unregisterModule(name)`

A system's module set could grow at runtime but never shrink. `registerModule` shipped a while
back; there was no way to undo it, so every module registered was permanent for the life of the
system. That made a whole family of patterns unbuildable — anything where instances come and go.
A representative unit repeated N times, a per-match or per-turn module opened and closed as play
moves on, a detailed submodel swapped in while you look at something closely and dropped when you
look away. Each of those needs instances to retire, and the only workaround was a registry of
manually disabled modules shadowing the real one, which is a second source of truth by another name.

```ts
await system.unregisterModule("turn:42");
system.registerModule("turn:43", createTurnModule({ id: 43 }));
```

Teardown runs in the reverse order of registration, and the order matters. Sources detach first so
nothing new arrives mid-teardown. Resolvers go next, because an in-flight one holds a facts proxy
over keys that are about to stop existing. Constraints come before derivations so nothing recomputes
a value on its way out. Facts go last.

In-flight resolvers are aborted through `context.signal`. A resolver that watches the signal stops
promptly; one that ignores it runs to completion and its writes land nowhere, since the facts are
gone. The returned promise settles once that work has genuinely finished rather than merely been
told to stop — those are different moments, and the later one is what a caller registering a
replacement under the same name actually needs.

Batched resolvers are included in both halves of that: an in-flight batch is aborted and waited for,
not skipped. The wait is bounded at ten seconds — a resolver that ignores its signal and never
settles would otherwise hang the call forever, and detaching has already happened by then, so giving
up on the wait costs nothing but the orphaned work. A write from a resolver that outlived its module
is dropped rather than applied, so it cannot resurrect a fact with no schema entry and no tags, and
cannot reach whatever instance took the name next.

A module's `hooks.onStop` throwing is reported and does not abort the unregister. It runs after
teardown, so letting it escape would leave a namespace that could be neither unregistered again nor
registered again.

Two smaller additions come with it. `system.observe()` gains `module.registered` and
`module.unregistered` events, which carry the module boundary that a stream of individual definition
events cannot express — replay needs to know where one instance ended and the next began. And
plugins gain matching `onModuleRegistered` / `onModuleUnregistered` hooks.

Registering a module again under a name that was previously unregistered works, including with a
freshly built schema. The declaration is removed on unregister rather than merely the values,
because a fact's type and its tags are fixed once registered and leaving a stale declaration behind
would make re-registration throw — the one thing this API exists to allow.
