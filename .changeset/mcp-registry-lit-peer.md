---
"@directive-run/mcp": patch
---

**The baked package registry now reports `@directive-run/lit`'s full peer set.** It was missing `@directive-run/query`.

The registry is generated from the workspace at build time and shipped inside the package, so the server answers dependency questions from a snapshot rather than from the filesystem it is running against. When lit gained a `@directive-run/query` peer, the checked-in snapshot was not regenerated, and every published build since has carried the shorter list.

The cost lands on the tool's main audience. An assistant asking what `@directive-run/lit` requires got an answer that was wrong by omission — confident, well-formed, and missing a peer the install actually needs. That is worse than no answer, because nothing about the response invites a second look.

Regenerating is a build step, so the fix is the regenerated file rather than a code change. Nothing about the registry's shape or the tools that read it has moved.
