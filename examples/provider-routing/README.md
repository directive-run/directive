# Provider Routing

A smart provider router with circuit breakers that falls back across OpenAI, Anthropic, and Ollama.

## Features

- Three provider cards with per-provider stats and circuit state
- Circuit breaker pattern (closed, open, half-open)
- Automatic failover to healthy providers
- Event timeline showing routing decisions

## Run

```bash
pnpm install
pnpm dev
```
