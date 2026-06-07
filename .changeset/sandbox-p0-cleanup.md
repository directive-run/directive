---
"@directive-run/sandbox": minor
---

Close the remaining 4 P0s from the Phase A AE audit (`docs/AE-AUDIT-SANDBOX.md`). With the v0.3.0 property-access bypass already closed, this release lands the SSRF defense, Vercel-compatible temp-file location, facts-proxy console serialization, and derivations in the snapshot.

- **P0-A1 — Temp-file location works on Vercel read-only FS.** Bundle now writes to `os.tmpdir()` (with a fallback to the package dir if `/tmp` is somehow unwritable). Bundler rewrites `@directive-run/*` imports to absolute `file://` URLs via `createRequire(...).resolve()` so the worker doesn't need a `node_modules` chain above the temp file. Unblocks `directive.run/api/run-sandbox` and any other deploy target with a read-only filesystem outside `/tmp`.
- **P0-S2 — SSRF wrapper.** New `installFetchWrapper()` patches `globalThis.fetch` in the worker BEFORE the user's bundle imports anything. Rejects loopback (127.0.0.0/8, `::1`, `localhost`), link-local (169.254.0.0/16 — includes AWS/GCP/Azure IMDS at `.169.254`), RFC-1918 private (10/8, 172.16-31/12, 192.168/16), multicast / reserved, IPv4-mapped IPv6 in literal or hex form (`::ffff:a9fe:a9fe`), and non-HTTP(S) protocols. Catches `@directive-run/query`'s internal fetch calls — the validator never saw them because they live in external module bodies.
- **P0-DM1 — `console.log(system.facts)` no longer renders `{}`.** Worker's `captureConsole` now detects Directive's facts proxy via the `$store.toObject()` and `$snapshot()` escape hatches, serializes via the snapshot, falls back to `JSON.stringify` for non-Directive values. Pre-fix, `console.log("[start] facts:", system.facts)` rendered as `[start] facts: {}` because `JSON.stringify` on the FactsStore proxy returned `"{}"` while `result.facts` correctly held the snapshot — two contradictory views in the same response.
- **P0-DM2 — Derivations in `SandboxResult.derived`.** Host pre-extracts derivation key names from source files via a brace/paren-balanced scanner that handles both multi-line and compact `derive: { isPositive: ... }` forms. Worker iterates `system.derive[key]` after settle for each key. Modules whose primary product is a derivation (`status`, `isReady`, `total`, etc.) now surface the computed value alongside facts.

New unit suites at `__tests__/fetch-wrapper.test.ts` (18 cases — protocols, IPv4 ranges, IPv6 ranges, localhost variants) and `__tests__/key-extractor.test.ts` (8 cases — multi-line, single-line, multi-file dedupe, quoted-key tolerance). Extended `__tests__/run-in-sandbox.test.ts` with end-to-end derivation + facts-proxy verification.

**Remaining P0:** P0-S3 (Origin allowlist + per-IP rate limit on `/api/run-sandbox`) lives in the `directive-docs` repo; that commit ships alongside this release.
