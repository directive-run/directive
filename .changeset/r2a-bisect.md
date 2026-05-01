---
"@directive-run/timeline": minor
"@directive-run/cli": minor
---

R2.A: `directive bisect` — git-bisect for timelines

Binary-search a recorded timeline for the first frame whose inclusion in the replay prefix flips a user-supplied assertion from passing to failing. The CLI surface mirrors `git bisect run`, but operates over `ObservationEvent` frames instead of git commits.

**Why it lands now.** The R1 substrate (deterministic replay + matchers + cancellable HOC) made midpoint-replay-and-assert a one-line operation. Without R1.A's `replayTimeline()` and the determinism guarantees underneath it, every midpoint would be a non-trivial reconstruction; with it, bisect is a tiny binary-search loop over a primitive that already exists.

**`bisectTimeline()` library API** (`@directive-run/timeline`):

```ts
import { bisectTimeline, deserializeTimeline } from "@directive-run/timeline";

const bad = deserializeTimeline(JSON.parse(prodErrorReportText));
const result = await bisectTimeline(
  bad,
  () => {
    const sys = createSystem({ module: counterModule });
    sys.start();
    return sys;
  },
  (sys) => sys.facts.score >= 0,
);
console.log(`first failing frame: #${result.firstFailingFrameIndex}`);
```

Three failure modes are reported as discrete result fields rather than thrown errors, so the caller can branch deterministically:

- `noFailureFound: true` — assertion passes after replaying the full timeline; nothing to bisect.
- `failsOnEmptyReplay: true` — assertion fails on a freshly-started system before any frame replays; bug is in initialization.
- `nonDeterministic: true` — two full-timeline replays produced different oracle verdicts; bisection refuses (returns early).

Per-iteration cost is one full replay of `mid` frames. Iteration count is bounded by `2 + 1 + ceil(log2(N))` (determinism gate + empty probe + binary search). For a 10k-frame timeline that's ~14 iterations; for a 1k-frame timeline ~13.

**`directive bisect` CLI** (`@directive-run/cli`):

```sh
directive bisect bug-1234.json \
  --system test/bisect-system.ts \
  --assert 'facts.count >= 0'
```

The `--system` file must export a *factory* (a `createSystem` / `systemFactory` / default-export function returning a started Directive system) so bisect can instantiate a fresh hermetic system per midpoint replay. The `--assert` expression evaluates as a JS function body with `facts` and `system` in lexical scope. The CLI is a local-trust tool — don't relay these strings from untrusted callers.

**11 new library tests** (timeline): happy path, frame-0 trigger, no-failure, fails-on-empty, non-determinism detection, O(log N) iteration bound, factory-freshness invariant, async factories/oracles, determinism-check disable, 1-frame, 0-frame.

**10 new CLI tests** (cli): missing args, malformed JSON / assertion, factory-missing, full happy path with synthetic 4-frame timeline + JSON output, no-failure-found human output.
