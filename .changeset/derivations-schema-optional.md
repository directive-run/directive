---
"@directive-run/core": patch
---

`schema.derivations` is optional again, as its documentation always claimed.

Omitting the section made every derivation's expected return type resolve to
`never`, so nothing you returned type-checked:

```
Type 'boolean' is not assignable to type 'never'.
```

The runtime has always inferred these; only the types refused. Declaring the
section still constrains each return type exactly, so nothing changes for
modules that already declare it.
