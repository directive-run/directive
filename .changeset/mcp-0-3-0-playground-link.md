---
"@directive-run/mcp": minor
---

Add `playground_link` tool: turn any TypeScript snippet (≤ 8 KB) into a `directive.run/playground` URL. The page decompresses the source from the URL hash, renders it with syntax highlighting, and offers a one-click **Open in StackBlitz** button that boots a real running Directive project with the snippet as `src/main.ts`. Source travels in the URL fragment (never sent to the server) and is compressed with lz-string.

Pair `playground_link` with any tool that returns code — `generate_module`, `get_example`, `fix_code` — to give the user a clickable "try it now" link in chat. v0.3.0 alpha kickoff per the production-readiness audit.
