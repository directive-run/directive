---
"@directive-run/ai": minor
---

New `@directive-run/ai/workers-ai` entry point: `createWorkersAIRunner({ binding: env.AI })` runs an agent through a Cloudflare Workers AI binding, with no API key and no fetch. It reports the token counts Workers AI returns, and says plainly when a response reports none, so a spend cap charges its estimate instead of a made-up zero. It also exports `WORKERS_AI_PRICING`, a dated rate table (checked 2026-10-30) with the real paid Cloudflare prices. This first version buffers the full answer and does not stream.
