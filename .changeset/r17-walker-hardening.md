---
"@directive-run/ai": patch
---

R17 walker hardening — `createFactPIIGuardrail`:

- Top-level array cap (`MAX_ARRAY_SCAN = 10_000`) is now applied BEFORE `structuredClone` rather than after. Previously, a 1M-element array shipped as one realtime row would consume CPU inside `structuredClone` before the walker ever saw it. (Regression of R15-CRIT-1 introduced by the R16 rewrite.)
- `Error.message` strings are now scanned for PII. `Error` instances preserve through `structuredClone`, but the walker's `Object.entries` path skipped them. The walker now extracts `Error.message` and runs the synchronous regex scanner; matches surface via `onBlocked` for log scrubbing wiring (the `Error` instance itself is read-only, so it cannot be redacted in place).
- `Date`, `RegExp`, `TypedArray` (`Int8Array`, `Uint8Array`, ...), `DataView`, `ArrayBuffer`, and `Blob` are now short-circuited in the object branch. Previously, the walker would iterate their entries (mostly no-op, but TypedArrays expose numeric byte keys that could in theory trigger false matches). Pass a `customDetector` to inspect these structures.
- `onFactSet` now skips the inspection step when the incoming `value === _prev`. The redact follow-up store write would otherwise re-enter the hook and trigger a wasted `structuredClone` + scan on the already-redacted token strings (a real CPU hit at 10k publishes/sec).

Closes R17 Security CRIT-1, Architecture C1, Distrib C1. Documentation tail: `docs/rfcs/README.md` updated to reflect the R16 walker rewrite as shipped (v1.19.3) + R17 hardening as v1.19.6. `packages/knowledge/core/choosing-primitives.md` fixes "six primitives" → "seven primitives" (the `source` primitive count was off-by-one).
