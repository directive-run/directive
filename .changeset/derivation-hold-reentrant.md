---
"@directive-run/core": patch
---

A plugin that writes in response to a batch no longer silences every derivation
notification for the life of the process.

`onFactsBatch` is broadcast to plugins before the batch's derivation hold is
released, so a plugin that writes there opens a nested batch from inside that
window. The engine kept a single release closure, so the nested hold overwrote
the outer one and the outer release was lost — the hold count never returned to
zero, and from that point `watch`, `subscribe`, and every framework hook built
on them stopped firing.

Derived values still read correctly on demand, and nothing throws, so the
symptom looks like a bug in whatever renders rather than in the runtime.

Holds are now tracked as a stack. A batch still announces once, not per write.
