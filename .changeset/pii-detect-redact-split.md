---
"@directive-run/ai": major
---

PII guardrails: split detection from redaction

`detectPII` is now **detection-only**. The `redact` and `redactionStyle`
options have been removed — `detectPII(text, options)` returns a
`PIIDetectionResult` whose `redactedText` is always `undefined`.

### Breaking change

Calls that relied on `detectPII(text, { redact: true, redactionStyle })`
no longer compile. Migrate to one of:

- `detectAndRedactPII(text, options)` — **new helper**. Accepts every
  `detectPII` option plus an optional `style?: RedactionStyle`. Returns a
  `PIIDetectionResult` with `redactedText` populated when PII is detected
  (`undefined` otherwise).
- `redactPII(text, items, style)` — redact separately from a prior
  detection pass.

### Also in this release

- **`national_id` is now detectable** as a first-class `PIIType`.
- **`redactPII` overlap handling fixed** — overlapping/adjacent matches
  no longer corrupt the redacted output.
- **New PII type exports** for consumers building custom detectors and
  redaction flows.
