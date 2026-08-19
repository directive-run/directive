---
"@directive-run/core": patch
---

A plugin that writes in response to a batch no longer silences every derivation
notification, or causes a batch to be announced twice.

`onFactsBatch` is broadcast to plugins before the batch's derivation hold is
released, so a plugin that writes there opens a nested batch from inside that
window. The engine kept a single release closure, so the nested hold overwrote
the outer one and the outer release was lost — the hold count never returned to
zero, and from that point `watch`, `subscribe`, and every framework hook built
on them stopped firing for the life of the process. Derived values still read
correctly on demand and nothing threw, so the symptom looks like a bug in
whatever renders.

Holds are now tracked per batch: released once when the batch's derivations have
been invalidated, and unwound to the depth the batch opened at when it ends —
including when it throws. A nested batch can no longer release the hold of the
batch it is running inside, which was announcing that outer batch early and then
again when it finished.

A batch announces once, on the nested path as well as the plain one.
