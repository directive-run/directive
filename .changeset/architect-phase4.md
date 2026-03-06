---
"@directive-run/architect": minor
---

Phase 4: Hardening + Innovation

**Security & Fixes:**
- Sandbox: constrain Object/Array in SAFE_GLOBALS, block arrow functions, validate single expressions
- Destroyed guard on all mutation methods
- Facts-specific approval level (`safety.approval.facts`)
- Ring buffer (O(1) FIFO) replaces Array.shift() in audit, outcomes, adaptive context
- Active definitions cache with invalidation
- README corrections (assertApproved, outcomeTracking, fallback strategies type)
- Testing utilities (derivations on TestSystem, MockAgentRunner, silent default)

**New Features:**
- **Pause/resume** — automatic triggers queue while paused, manual analyze still works
- **Learning mode** — FeedbackStore tracks approve/reject decisions with reasons, injects feedback context into LLM prompts
- **Intent-based stories** — resolve user stories into architect config via LLM, lazy resolution on first analyze() or explicit ready()
- **Cross-system orchestration** — composite system proxy with namespaced facts (systemName::factKey), per-system and aggregate health scoring
