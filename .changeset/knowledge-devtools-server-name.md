---
"@directive-run/knowledge": patch
"@directive-run/claude-plugin": patch
---

Fix the DevTools server example in the AI debug and observability guide: the factory is `createDevToolsServer({ transport, timeline })`, not `createDevtoolsServer({ timeline, port })`.
