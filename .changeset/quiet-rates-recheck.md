---
"@directive-run/ai": patch
---

Re-checks the Anthropic, OpenAI, Gemini and Ollama rate tables against each
provider's own pricing page on 2026-11-12 and moves the four `*_PRICING_AS_OF`
dates. No rate changed, so the pinned digests are unchanged. Rows the providers
no longer list (retired or routed to another model) are kept for reconciling
past spend and are marked in the source as not re-verified.
