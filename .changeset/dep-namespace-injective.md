---
"@directive-run/core": patch
---

**A fact key can no longer impersonate a derivation in the dependency graph.**

A tracked dependency set is one flat `Set<string>` holding both fact keys and derivation IDs, kept apart by a separator character: a derivation goes in as the separator followed by its ID, a fact as its key verbatim. That namespace exists because a module may legally declare a fact and a derivation with the same name, and before it, writing one invalidated readers of the other.

It works only while no fact key itself starts with the separator. One that does is byte-for-byte the recorded form of the same-named derivation — so writing that fact wakes every constraint and effect reading the derivation, and a trace renders the fact under a `derive.` prefix. The original collision, moved one character to the right.

`createModule` now rejects a fact key or derivation ID containing the separator, with a message naming the character and what it collides with. Thrown unconditionally rather than warned in development: a wrong invalidation set produces wrong behavior in production, which is where the warning would be gone.

The separator is rejected anywhere in the name, not only at the front. Only a leading one collides today, but the character has no legitimate use in an identifier, and a rule that turned on position would leave the next reader to work out why.

Nothing that compiles today is affected — the check names a character no identifier written in source contains, and the note on the constant that claimed such a name was impossible has been corrected to say it is merely rejected.
