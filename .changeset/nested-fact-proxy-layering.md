---
"@directive-run/core": patch
---

Read cost of an object fact no longer grows with the number of writes

Updating an object fact the ordinary way — `facts.map = { ...facts.map, k: v }` —
copies the development-mode warning wrapper the store just handed back into the
new object. Reading it again wrapped the wrapper, so every update added a Proxy
layer: read cost grew with the number of writes and the whole chain stayed live.

An eight-key map measured 38 ms for 5,000 full reads after 8 writes, 1,400 ms
after 48, and 8,164 ms after 108. After the fix, 13 ms at every point.

Both wrap sites now return a value that is already wrapped instead of wrapping it
again. Production builds were never affected — the wrapper only exists in
development — but development is where the slowdown looked like a bug in the
consumer's own code.
