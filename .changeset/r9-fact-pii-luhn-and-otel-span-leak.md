---
"@directive-run/ai": patch
---

`createFactPIIGuardrail` Luhn validation + `attachSourcesToOtel` span-leak fix + `walkDepth` option

Three targeted fixes against the Tier 1 phases shipped immediately
before this patch.

**`createFactPIIGuardrail` — credit-card false positives.** The R9
self-review found the inlined `\b(?:\d[ -]?){13,19}\b` regex would
sweep up phone numbers, tracking IDs, and any 13-19 digit sequence
formatted with separators as credit cards. The shipping path now
mirrors `pii-enhanced.ts`'s detection: a broader 4-4-4-4 / 13-19
unseparated regex paired with a synchronous Luhn checksum validator.
Phone numbers, sequence IDs, and other long digit runs that don't pass
Luhn are NOT redacted. The canonical Visa test number
(`4111 1111 1111 1111`) continues to redact correctly.

**`createFactPIIGuardrail` — `walkDepth` option for nested objects.**
The previous one-level object walk silently passed deeper PII (e.g.
`{ profile: { email } }`) through unredacted. The R9 review flagged
this as a security limitation that wasn't documented. The plugin now
accepts an optional `walkDepth: 1 | 2 | 3 | 4 | 5` (default `1`,
clamped to `[1, 5]` to prevent pathological recursion on cyclic
structures). Arrays, Maps, and Sets remain out of scope at any depth —
consumers with those shapes should pass a `customDetector` that walks
the consumer-specific structure.

**`attachSourcesToOtel` — active spans no longer leak on unsubscribe.**
The R9 review found the helper's returned unsubscribe just detached the
`system.observe()` subscriber, leaving every active `directive.source.attached`
span open forever in the collector. The helper now ends each active
span with status `OK` and a `directive.detached: true` attribute when
the consumer detaches the wiring. Collectors that retain unfinished
spans no longer accumulate them across `attachSourcesToOtel` /
unsubscribe cycles.

Tests: +3 regression tests (Luhn rejection on non-card 16-digit
sequences, `walkDepth: 1` default leaves nested PII alone, `walkDepth: 3`
walks deeper). Fact-PII test file 8 → 11; `otel-sources.test.ts` test 4
rewritten to assert the new no-leak contract; AI suite 1503 → 1506.
