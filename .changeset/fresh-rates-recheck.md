---
"@directive-run/ai": patch
---

Re-checks the Anthropic, OpenAI, Gemini, Workers AI and Ollama rate tables
against each provider's own pricing page on 2026-11-15 and moves the five
`*_PRICING_AS_OF` dates. No existing rate changed. The tables now also price the
current models they were missing: the Claude 5.x family, the GPT-6 family and
other OpenAI text models, the Gemini 4 and 3.8 models, and every row of the
Workers AI LLM table. The pinned digests move for the four tables that gained
rows; Ollama's is unchanged.
