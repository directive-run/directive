---
"@directive-run/el": patch
---

XSS / prototype-pollution / inline-handler-injection hardening for the shared sanitize-props path used by `el()` and the JSX runtime.

The previous deny-set only covered the markup-injection sinks (`innerHTML`, `outerHTML`, `srcdoc`). `Object.assign(element, props)` would happily forward three other dangerous shapes:

- `__proto__`, `constructor`, `prototype` — prototype-pollution vectors reaching the element's prototype chain. Now mirrors `@directive-run/core`'s `BLOCKED_PROPS` so the deny-sets cannot drift.
- String-valued `on<Event>` keys — `el("img", { onerror: facts.x })` would register an inline JS handler whenever `facts.x` was a string. Function-valued handlers (the legitimate JSX path) still pass through unchanged.

`sanitizeProps` now iterates own keys via `Object.entries` rather than spreading (which copies an own-key `__proto__` straight through), applies the deny-set, and rejects unsafe handler keys. The JSX runtime mirrors the same filter on its `rest` object.

Adds 4 regression tests covering each rejection path plus the function-handler preserve path.
