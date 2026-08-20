---
"@directive-run/core": patch
---

Two fixes to `createAuditLedger`, both in the class of "the control damages the
thing it was controlling".

**Installing the ledger no longer freezes application state.** Entries are
frozen so a consumer cannot mutate a payload in place and forge the chain — but
the freeze was applied to whatever it was handed, and what it was handed was the
application's own fact value. Recording a change froze that object, and reading
a nested property afterwards threw a proxy invariant error. The ledger now takes
its own copy first. That is also a stronger guarantee than before: a value
mutated after it was recorded no longer changes what the record says. A value
that cannot be copied is kept as-is and left unfrozen, on the grounds that a
payload which could in principle be mutated is better than an audit control that
mutates the system.

**An exported ledger verifies again.** The chain is hashed over a stable
stringification that encodes a present-but-undefined key, and `JSON.stringify`
drops it — so an entry carrying one, which the first write of any fact does,
hashed one way live and another way after export. Anyone exporting the trail and
checking it was told it had been altered, by the tool whose job is to answer
that question. Keys with no value are now omitted before the entry is built, so
it is hashed over what an export can carry.
