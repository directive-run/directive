---
title: About Directive
url: /about
---

State management shouldn't require you to be the runtime.

Directive is an open-source runtime for TypeScript that replaces manual state orchestration with declarative constraints. Hardened by 3,050+ tests, designed to scale from UI state to AI agent coordination.

## Engineering Standards

Every change goes through architecture review, security audit, and runtime hardening analysis. The constraint engine, resolver pipeline, and effects system are continuously stress-tested.

- 3,050+ tests passing
- 0 runtime dependencies
- 12 packages

Directive is built in the open. Contributions, bug reports, and RFCs are welcome on GitHub.

Key project attributes:

- **Open Source** -- MIT licensed, built in the open
- **Zero Dependencies** -- Tree-shakeable, ~28KB gzipped
- **TypeScript-First** -- Full type inference, zero codegen

## What It Does

Most state management libraries ask you to describe how things change. Directive asks you to describe what must be true. You declare constraints -- rules about your system's valid states -- and the runtime resolves them automatically. When facts change, constraints evaluate, requirements emerge, and resolvers execute. No manual wiring, no action dispatching, no forgotten edge cases.

## Why It Exists

Directive was born from building a game engine. When managing dozens of interconnected systems -- physics, rendering, AI, audio -- it became clear that traditional state management doesn't scale. Every state change triggered a cascade of manual orchestration: check this flag, update that dependency, notify these listeners. The realization was simple -- state management shouldn't require you to be the runtime.

## Where It's Going

Directive is heading toward AI agent orchestration, where autonomous systems need to declare goals and let the runtime coordinate their resolution. The same constraint-driven model that manages UI state can manage multi-agent workflows, real-time collaboration, and complex business logic. Framework-agnostic by design, with developer experience at the core.

## Built by Sizls

Sizls is a small collective of talented individuals led by Jason Comes that ships developer tools, apps, and interactive experiences -- relentlessly.

Directive is our open-source work. Everything else is the stuff we can't stop building. The source is on GitHub -- contributions, bug reports, and RFCs are welcome.

- LinkedIn: https://www.linkedin.com/in/jasonwcomes/
- GitHub: https://github.com/directive-run/directive
