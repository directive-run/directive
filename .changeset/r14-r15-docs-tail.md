---
"@directive-run/knowledge": patch
"@directive-run/claude-plugin": patch
---

Knowledge docs tail — choosing-primitives matrix + LangChain/Vercel/LlamaIndex comparison

Closes the last two small docs items from R14 deferred list (the third — runnable `examples/ai-live-context/` Vite scaffold — is queued separately as a bigger work item).

- New `packages/knowledge/core/choosing-primitives.md` decision matrix for the six core primitives (`facts` / `derivations` / `events` / `constraints` / `resolvers` / `effects` / `sources`). Side-by-side comparisons for the common confusion pairs (`effect` vs `source`, `derivation` vs `resolver` vs `effect`, `event` vs `resolver`, `constraint` vs `derivation`). Worked example: a chat app that mirrors a Supabase realtime channel + calls a moderation API maps every layer to a single primitive — every external touch is a source or resolver, every state field is a fact or derivation, zero `useEffect` hooks.

- New "## What other agent frameworks have (and don't)" section in `ai-sources.md` comparing `runStream({ liveContext })` against LangChain / LangGraph / Vercel AI SDK / LlamaIndex across six capabilities (mid-generation fact updates, declarative source, interrupt + resume, Tier 0 PII guard at the publish→fact boundary, source × OTel out of the box, multi-system composition). Sets the pitch explicitly: Directive's differentiator is "your state engine and your agent runtime share one fact store" — not "we're a better LangChain."

- Added `choosing-primitives` to `getting-started-with-directive` skill so the matrix ships in the bundled claude-plugin and an LLM consuming the skill finds the decision tree on first use.
