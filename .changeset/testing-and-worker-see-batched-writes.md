---
"@directive-run/core": minor
---

**The testing utilities and the worker adapter now see writes made inside a
batch.** They were the last two consumers watching only the unbatched hook, and
nearly every write a running system makes is batched: event handlers, effects,
resolvers before their first `await`, the opening state, and every history
navigation.

**`assertFactChanges` was under-reporting.** A fact that changed four times was
recorded as having changed once, so an assertion that a value did not change
passed for a value that did — inside the tooling written to catch that. Counts
from `getFactsHistory()` and `assertFactChanges()` will be higher after this,
and the module's own `init` writes now appear too. If a test asserts an exact
count, expect to update the number; the previous one was missing whatever the
system did through a batch.

**The worker adapter was letting the main thread drift.** `FACT_CHANGED` is the
only path a fact value has across the boundary — there is no wholesale sync
behind it — so a worker-backed application missed every write an event handler
made, and its view diverged from the worker's with nothing reporting it. Derived
values were not gated the same way, so the mirror could be told a computed value
had changed while never being told the fact it is computed from had: two numbers
on screen contradicting each other, both delivered by a channel that looked
healthy.

**Three things that came with recording those writes**, each of which the
codebase had already solved once elsewhere:

- The worker posts one message per *run* of writes to a key rather than one per
  write, matching how the observation stream coalesces. A handler writing one
  key five hundred times in a batch sends one message, not five hundred — each
  of which is a structured clone across a thread boundary and a render on the
  other side, carrying values the main thread can never observe.
- A test system keeps the most recent 10,000 fact changes, configurable with
  `maxFactsHistory`, and says so when it drops any. The log holds the value
  before and after every change, so it pins every intermediate object a test
  produces, and that is now nearly every write.
- `assertFactChanges` and `assertFactSet` on a namespaced system accept either
  the short name or the namespaced one. They matched the short name only, so two
  modules with a same-named fact shared a count while the name that would have
  told them apart matched nothing — which began failing as soon as each module's
  opening write was recorded.
