---
"@directive-run/core": patch
"@directive-run/el": patch
---

Fixes from a review of the 1.27.1 watched-set change, including a correction to what that release claimed.

**The prune no longer runs when there is nothing to prune.** Rebuilding the watched set costs a walk of every constraint's and every effect's dependency set, and 1.27.1 paid it on every reconcile — including systems where nothing reads a derivation at all, where there is nothing to gain because the invalidation walk already short-circuits on the same emptiness. Measured at 4% to 23% of a reconcile in that shape. It is now guarded.

**A disabled effect no longer pins what it read.** Disabling a constraint dropped its dependency set; disabling an effect did not, so every derivation that effect had read stayed watched for the life of the system — the same growth 1.27.1 set out to end, surviving in one path. The error boundary's disable strategy reaches this, so an effect that threw once pinned its derivations permanently.

**A derivation may be named after a member of Object.prototype.** `toString`, `valueOf` and `hasOwnProperty` resolved to the inherited builtin function instead of the derivation's value, so a constraint gated on one was unconditionally truthy, with no error anywhere.

**`@directive-run/el` now declares the core version it actually needs** — `^1.15.0` rather than `^1.0.0`. It imports two types that did not exist before 1.15.0, so the old range let a consumer install a core whose types cannot satisfy it while the package manager reported the peer as met.

**Correcting the 1.27.1 note.** That release reported the change as roughly 29 to 18 microseconds per reconcile. That measurement is real but was taken only on the shape where the change wins — a deep derivation chain behind narrow readers. On wide readers it was a 12% to 20% regression, and where nothing is watched it was a 4% to 23% regression for no benefit. The guard above removes the second case; the first remains a real trade and is now stated rather than implied.
