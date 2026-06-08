---
"@directive-run/sandbox": patch
---

Include the full stack trace, error `code`, and `cause` chain in `SandboxResult.errors` when the user's bundle throws during dynamic import. Previously only `err.message` was captured, which stripped the frame-by-frame location and made debugging crashes inside framework code (e.g. `createSystem`-time null derefs) impossible from the transcript alone. Facts-snapshot failures also now include their stack. No API change; only the strings inside `errors[]` get richer.
