---
"@directive-run/ai": patch
---

Two fixes found by making the test double honour abort signals, plus the double
itself.

**`createMockAgentRunner` now honours `AbortSignal`.** Its configured delay was
a bare timer nothing could interrupt, and the signal was never read — so a test
written against it passed whether or not abort worked, because the mock always
ran to completion and returned a result. Two existing tests said so in their own
comments while asserting the opposite behaviour, and both were pinning the
double's blindness as though it were the contract.

**A cancelled loser in `race` is no longer reported as a failure.** When the
race cuts off the losing agents, an agent that honours the signal rejects, and
that rejection was recorded as an agent error. Errored agents are excluded from
the cancellation set, so `race_cancelled` did not fire — the event announced
cancellation only when the loser had ignored the signal and finished normally,
which is exactly when nothing had been cancelled. A deliberate stop also
surfaced as something going wrong.

**`dag` node and graph timeouts are verified for the first time.** Both tests
asserted that timed-out nodes reached `"completed"`, each with a comment
explaining that the double slept through the abort. They now assert the node is
cut off.

**Checkpoint resume is verified for the first time.** Disabling resume across
all six patterns previously failed one test out of 2,273; the five tests named
`"resumes from checkpoint"` asserted only that a result came back, which a run
that ignored the checkpoint and started over also produces. They now check which
agents ran and what input they were handed. The same change disables resume and
fails five.

Also: the root `build` script now builds `./packages/*` only, matching what CI
already gates on. `build:all` keeps the old behaviour. An example failing used to
abort the run before the libraries built, leaving a stale `dist` behind a green
suite.
