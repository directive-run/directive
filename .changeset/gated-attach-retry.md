---
"@directive-run/core": patch
---

A gated source whose `attach` fails now retries instead of staying dark.

When a gate opened and `attach` threw — a transport briefly unavailable at the
moment a fact changed — the key was recorded as attached even though nothing
was. The next evaluation saw no change and did nothing, so the source stayed
detached until the key happened to move again.

`lastKey` now records what is attached rather than what was intended, so a
failed attach leaves the gate open and the next reconcile tries again. Retries
back off (250ms doubling to a 30s ceiling) so a transport that is simply down is
not re-attached on every reconcile of a busy system. A gate that moves to a new
key starts a fresh subscription immediately rather than waiting out the old
backoff.
