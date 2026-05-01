---
"@directive-run/timeline": patch
"@directive-run/mutator": minor
---

AE-review R2 fixes: critical security, correctness, and DX hardening across R1.A/B/C surfaces

Three parallel reviewers (security, architecture, DX, innovation) found 3 critical security + 2 critical architecture + 3 critical DX + ~20 major issues across the recently-shipped R1.A (timeline serialize/replay), R1.B (causal-graph matchers), and R1.C (cancellable mutator HOC) surfaces. This release closes the criticals and the highest-leverage majors.

### Timeline (patch — surface-compatible fixes)

- **R2 sec C-1: Spread-order RCE in `reconstructDispatch`.** `{ type: "MUTATE", ...next }` let an attacker-controlled `frames[i].event.next.type` field override the dispatch type. Untrusted prod-error JSON could re-route every replayed event to an arbitrary handler. Fix: spread-then-set (`{ ...next, type: "MUTATE" }`).
- **R2 sec C-2: Frame-shape validation in `deserializeTimeline`.** Per-frame validation of `ts`/`event`/`event.type`. Untrusted JSON with malformed frames now produces precise `TypeError` rejections instead of crashing the replay loop with bare exceptions.
- **R2 sec C-3: Matcher iteration robustness.** All five matchers now filter `frames()` through `isWellFormedFrame` before iterating. Hostile input produces clean assertion failures instead of TypeErrors.
- **R2 sec M-2: Structural equality in `toReachInMs`.** Replaced `JSON.stringify` equality with `structuredEqual` — NaN/undefined/Infinity no longer produce false-positive matches.
- **R2 sec M-4: `maxFrames` cap on `replayTimeline`.** Default 100,000 frames; prevents unbounded synchronous loops on hostile JSON dumps.
- **R2 arch M-2: `replayTimeline` returns `ReplayResult`** (`{ dispatched, skipped, truncated }`) instead of `void`. Lets callers verify the replay actually re-dispatched events instead of silently no-op'ing on non-mutator systems. Breaking change vs v0.2 only in type signature; existing call sites that ignored the return value continue to work.
- **R2 DX naming: `dispatchableOnly?: boolean`** is the new option name; `dispatchable?` is kept as a deprecated alias for v0.x compatibility. The original name read backwards ("dispatchable: true" sounded like "this thing IS dispatchable" not "filter to dispatchable").

### Mutator (minor — additive Error subclasses)

- **R2 sec M-1: `CancelError` Error-subclass for `signal.reason`.** New runtime carriers `CancelError`, `TimeoutCancelError`, `SupersededCancelError` ensure `signal.reason instanceof Error` checks succeed downstream. Plain-object reasons silently failed `fetch(url, {signal})` re-throw paths and `.catch(err => err instanceof Error)` filters in logging frameworks. The `CancelReason` type still works (Error subclasses expose the same `kind` field), so existing `signal.reason?.kind === 'superseded'` checks remain valid.
- **R2 arch M-5: Exported `cancelReason` factory** — `cancelReason.superseded()` and `cancelReason.timeout(afterMs)` produce typed Error subclasses. Single source of truth for both producers (cancellable internals) and consumers (handler abort observers).
- **R2 sec M-3: `cancelTimeout` cleanup error-shadowing fix.** A throwing `setTimeout`-cancel-handle (e.g. a hostile virtual clock) no longer replaces the original handler's exception. The cleanup is wrapped in try/catch.
- **R2 arch M-6: Peer dep tightened to `@directive-run/core@^1.3.0`.** `cancellable()`'s ergonomic test path imports `virtualClock` from core 1.3.0; consumers on 1.2.x would have hit a runtime error copying the README example.

### Innovation captures

`docs/IDEAS.md` updated with five new R2.A-E candidates surfaced post-ship — second-order ideas that ONLY became cheap to build because R1.A+B+C shipped together. Top pick: R2.A `directive bisect <good.json> <bad.json>` (2 days, BUILD CANDIDATE), git-bisect for timelines.

### Verification

- 4032 / 4033 tests pass workspace-wide (1 skipped, 0 failures).
- Per-package: timeline 30 / 30 (16 timeline + 14 matchers); mutator 30 / 30 (16 mutator + 14 cancellable, including new R2 regression tests for `CancelError` instance checks + finally-block error-shadowing).
- `pnpm -r --filter './packages/*' typecheck`: clean.
- `pnpm -r --filter './packages/*' build`: clean.

The Round 1 AE-review-loop typically converges in 3-5 rounds. R2 ships these critical+major fixes; R3 (verification round) is the next session if you want full convergence to "0 critical + 0 major."
