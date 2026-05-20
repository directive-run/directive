---
"@directive-run/ai": minor
---

PII guardrails: split detection from redaction

`detectPII` is now **detection-only**. The `redact` and `redactionStyle`
options have been removed — `detectPII(text, options)` returns a
`PIIDetectionResult` whose `redactedText` is always `undefined`. A new
`detectAndRedactPII` helper covers the previous one-shot detect-and-redact
shape.

This is a small shape change on a utility export that hadn't reached a
stable 1.x API contract; the migration is a one-line drop-in. Treating it
as a `minor` reflects the practical migration cost rather than a wholesale
v2 commitment.

### Migration

Calls that relied on `detectPII(text, { redact: true, redactionStyle })`
no longer compile. Pick the form that matches your usage:

```ts
// Before
const result = await detectPII(text, { redact: true, redactionStyle: "typed" });
// result.redactedText -> the redacted string

// After (one-shot, equivalent shape)
import { detectAndRedactPII } from "@directive-run/ai";
const result = await detectAndRedactPII(text, { style: "typed" });
// result.redactedText -> the redacted string

// After (separated — detect once, redact later)
import { detectPII, redactPII } from "@directive-run/ai";
const result = await detectPII(text);
const redacted = result.detected ? redactPII(text, result.items, "typed") : text;
```

`detectAndRedactPII` accepts every `detectPII` option plus an optional
`style?: RedactionStyle`, and populates `redactedText` only when PII is
actually detected (`undefined` otherwise).

### Also in this release

- **`national_id` is now detectable** as a first-class `PIIType`.
- **`redactPII` overlap handling fixed** — overlapping or adjacent matches
  no longer corrupt the redacted output.
- **New PII type exports** for consumers building custom detectors and
  redaction flows (`PIIDetectionResult`, `DetectedPII`, `PIIType`,
  `PIIDetector`, `RedactionStyle`).
