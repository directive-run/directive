---
"@directive-run/core": patch
---

A frozen value stored in a fact can be read back in development mode. The nested
mutation warning proxy returned a wrapper for every nested object, which a Proxy
may not do for a non-configurable, non-writable property — so reading anything
under an `Object.freeze` threw a TypeError in development and worked in
production, where the wrapper is tree-shaken away.
