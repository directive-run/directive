---
"@directive-run/ai": patch
---

The Gemini runners defaulted to a model that no longer exists.

`createGeminiRunner` and `createGeminiStreamingRunner` used `gemini-2.0-flash`
when no model was named. That model was shut down on 2026-06-01, so the default
had been an unmakeable call for two and a half months. Nothing caught it: the
default is only reached when a caller names no model, and the failure arrives
from the provider, so it reads as a network problem rather than a stale
constant.

The default is now `gemini-2.5-flash` — the current model closest to what the
old default was chosen for, the inexpensive general-purpose one. It is exported
as `DEFAULT_GEMINI_MODEL` so a caller can read it rather than guess, though
anything with an opinion should name its own model: a default that names a
specific model ages by construction.

A test now requires every adapter's default to be a model its own rate table
prices. The rate table is the one thing in this package that has to be kept
current, so agreeing with it is a cheap standing check that the default still
exists.
