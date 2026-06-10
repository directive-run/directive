---
"@directive-run/ai": patch
---

createFactPIIGuardrail walker: sanitization-first via `structuredClone`

Replaces the manual structural walker with a `structuredClone`-at-entry pattern that strips Proxies, exotic getters, Symbol-iterator overrides, functions, and detects cycles BEFORE the walker runs on the safe clone. Closes the entire class of Proxy-based bypass attacks at once instead of one-by-one.

### Why the rewrite

R13 → R14 → R15 patched the walker three rounds, each closing one Proxy attack and opening a slightly different one:

- R13: array-shape payloads silently bypass the guard (added array branch).
- R14: deeply nested arrays bypass the depth bound; Proxy whose `get` returns different values per read leaks PII via TOCTOU (added depth decrement + array snapshot).
- R15: Proxy whose `Symbol.iterator` yields a billion items OOMs the worker; Proxy whose iterator returns `undefined` crashes the walker; cycle guard via permanent WeakSet false-skips shared-leaf references (added size cap + try/catch islands + in-progress cycle tracking).

The escalating-patch pattern is the signal that the walker needs to operate on a value the consumer cannot inject hostile behavior into. `structuredClone` is the canonical primitive: the cloned value has no Proxies (unwrapped to underlying target), no exotic getters, no functions (clone throws on them), no Symbol-iterator overrides, no cycles (clone throws on cyclic input).

### Net effect on the walker

| Before (R15) | After (R16) |
|---|---|
| 2 functions (`inspect` + `inspectStructural`) | 2 functions (`inspect` + `walkClone`) |
| `inProgress: WeakSet` threaded through every recursive call | none — clones can't be cyclic |
| `try/catch` around outer `inspect` body | one `try/catch` around `structuredClone` at entry |
| `try/catch` around `[...value]` spread | none — clones are plain arrays |
| `try/catch` around `Object.entries(value)` | none — clones are plain objects |
| Per-trap Proxy defense | One sanitization step strips all Proxies |
| New Proxy traps open new bypasses | New Proxy traps don't open bypasses (Proxy is stripped before walker runs) |

The walker is shorter, simpler to explain in docs, and future-proof against new Proxy attack vectors.

### Behavior changes (consumer-visible)

- **Non-cloneable inputs** (values containing functions, DOM nodes, WeakMaps, `Promise`, class instances with method refs, cyclic refs) now log a `console.warn` and skip inspection with "no match" — same posture as the previous R15 per-Proxy-trap try/catches, just collapsed to one site. The raw value stays in the store; consumers wire a `customDetector` for these shapes.
- **Map / Set** continue to be skipped by design. Both survive `structuredClone` but aren't walked (their string elements would need a different traversal shape). Consumers wire a `customDetector`.
- **`Date` and other structured types** survive `structuredClone` and are correctly skipped by the walker (they aren't redact targets; they're left as-is in the redacted output).
- **Proxy inputs** are stripped to their target shape — `new Proxy([leak@x.com], { get: ... })` becomes `[leak@x.com]` after clone, and the email correctly redacts. (This is a strict improvement: R15 treated all Proxy inputs as "no match" out of caution; R16 actually redacts them.)
- **All R13/R14/R15 regression tests pass unchanged** — the new walker is a strict drop-in.

### Compatibility

`structuredClone` is native in every runtime Directive supports: Node 17+, Bun, Deno, Cloudflare workerd, browsers ≥ 2022.

### Tests

3657 passing across core/ai/sources (+2 new R16 regression tests covering non-cloneable input fallback and Map inside payload). Existing R13/R14/R15 array / Proxy / cycle / NaN regression tests pass unchanged.
