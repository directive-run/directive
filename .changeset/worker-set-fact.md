---
"@directive-run/core": patch
---

**Writing a fact into a worker system works.** `SET_FACT` and `SET_FACTS` threw
for every worker system, which means the main thread could not write to a worker
at all — `workerClient.setFact()` and `.setFacts()` were both dead.

A worker always builds a namespaced system, whose top-level facts object exposes
a namespace per module and correctly refuses a flat `module::fact` assignment,
since that name belongs to a module rather than to the system. It was being
assigned flat anyway, so the proxy rejected it. `setFacts` probed for a store on
the same object, did not find one, and fell through to the same failing path.

Writes now go through the module that owns the fact, and `setFacts` applies them
in one batch so a set of facts that belong together arrive together. A key naming
no module reports that rather than being dropped — these arrive from the far side
of a thread boundary, where a typo has nothing else to announce it.
