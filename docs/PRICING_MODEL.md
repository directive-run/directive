# Pricing Model

## Current Approach

Everything free, adoption-first, MIT licensed. Build traction before monetization.

## What Stays Free Forever

- **Core library** (`@directive-run/core`) — constraint engine, facts, derivations, effects, resolvers
- **Local DevTools** (`@directive-run/devtools`) — standalone debug UI, WebSocket server, all 13 views
- **AI orchestrator** (`@directive-run/ai`) — single/multi-agent, guardrails, breakpoints, streaming
- **Framework adapters** (`@directive-run/react`, `vue`, `svelte`, `solid`, `lit`)
- **Documentation & examples** — full docs site, interactive examples, blog

## Future Premium Features

| Feature | Description |
|---------|-------------|
| **Cloud-hosted DevTools** | Remote debug UI with persistent storage, no local server needed |
| **Team collaboration** | Shared debug sessions, annotations, role-based access |
| **Long-term trace storage** | Query historical agent runs, compare sessions over time |
| **Performance profiling** | Token cost trends, latency heatmaps, optimization suggestions |
| **Enterprise licensing** | SLA, priority support, custom integrations, SSO |

## Pricing Tiers

| Tier | Price | Target |
|------|-------|--------|
| **Free** | $0 | Solo devs, hobbyists, open source |
| **Pro** | $19–29/mo | Professional developers, small teams |
| **Team** | $49–99/mo | Teams needing collaboration + shared sessions |
| **Enterprise** | Custom | Large orgs needing SLA, SSO, compliance |

## Timeline

1. **Now** — Everything free. Focus on adoption, docs, and developer experience.
2. **After traction** — Publish `@directive-run/devtools` as standalone npm package.
3. **First paid feature** — Cloud-hosted DevTools (remote debug without running local server).
4. **After paying customers** — Team features (shared sessions, annotations, RBAC).

## Key Principle

Never take away free features. Only add new paid capabilities on top. The open source core must always be fully functional without any paid dependency.
