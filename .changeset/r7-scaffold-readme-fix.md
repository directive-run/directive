---
"@directive-run/scaffold": patch
---

Repair the README quickstart, which treated `generateModule("name")` as returning a string. It returns a `GeneratedScaffold` object `{ moduleSource, runnerSource, suggestedFilenames, runnable }` — anyone pasting from the README into `writeFileSync(file, source)` got files containing `[object Object]`.

The quickstart now destructures the paired (moduleSource, runnerSource) bundle, walks through the `runnable` flag's meaning, documents the previously-unlisted `generateRunner` export, and adds a "Writing to disk" section showing the two-file drop with the `suggestedFilenames` hint.

No code changes.
