# Directive Examples

40 runnable examples. Each folder is a standalone workspace package — `pnpm install` at the repo root then `cd examples/<name> && pnpm dev` (or the example's documented entry command) boots it.

This index is curated, not alphabetical. Start at the top.

## Start here

| Example | What it shows |
| --- | --- |
| [`counter`](./counter) | The simplest Directive demo — schema + constraint + resolver in ~50 lines, bound to a vanilla DOM via `@directive-run/el` |
| [`counter-react`](./counter-react) | Same module in React via `@directive-run/react` |
| [`counter-vue`](./counter-vue) | Same module in Vue via `@directive-run/vue` |
| [`counter-svelte`](./counter-svelte) | Same module in Svelte 5 via `@directive-run/svelte` |

## Adapters + state libs (drop-in patterns)

| Example | What it shows |
| --- | --- |
| [`schema-patterns`](./schema-patterns) | Side-by-side: builder vs zod vs type-assertion vs mixed schema styles |
| [`server`](./server) | Node HTTP server backed by a Directive system |
| [`multi-module`](./multi-module) | Composing two modules with cross-module constraints |
| [`dynamic-modules`](./dynamic-modules) | `system.registerModule()` to add modules to a running system |

## Async + data

| Example | What it shows |
| --- | --- |
| [`async-chains`](./async-chains) | Resolvers awaiting upstream resolvers via the requirement graph |
| [`batch-resolver`](./batch-resolver) | One resolver fulfills N requirements per tick |
| [`pagination`](./pagination) | Cursor-based pagination as a constraint loop |
| [`dashboard-loader`](./dashboard-loader) | Parallel data fetches funneled into a single derivation |
| [`optimistic-updates`](./optimistic-updates) | `withOptimistic` + rollback on resolver failure |
| [`debounce-constraints`](./debounce-constraints) | The constraint-driven debounce pattern (no `setTimeout` in user code) |
| [`websocket`](./websocket) | A source that publishes WebSocket frames into facts |
| [`url-sync`](./url-sync) | Browser URL ↔ facts, bidirectional |
| [`data-triggers`](./data-triggers) | A SQL-trigger-style example modeled in Directive |

## Forms + flows

| Example | What it shows |
| --- | --- |
| [`contact-form`](./contact-form) | Validate, submit, surface errors via derived state |
| [`form-wizard`](./form-wizard) | Multi-step wizard with step-scoped constraints |
| [`newsletter`](./newsletter) | Confirm-then-subscribe with email validation |
| [`auth-flow`](./auth-flow) | Login → session → role gating as constraint chain |
| [`permissions`](./permissions) | Role-based gating modeled as constraints |
| [`feature-flags`](./feature-flags) | Flag flips drive constraint re-evaluation |
| [`theme-locale`](./theme-locale) | User preferences as cross-cutting facts |

## AI

| Example | What it shows |
| --- | --- |
| [`ai-guardrails`](./ai-guardrails) | PII / prompt-injection guardrails over an LLM call |
| [`ai-checkpoint`](./ai-checkpoint) | Multi-stage AI pipeline with checkpointable state |
| [`provider-routing`](./provider-routing) | Route an AI call by cost / latency constraints |
| [`topic-guard`](./topic-guard) | Refuse off-topic prompts via a constraint |
| [`compliance-audit`](./compliance-audit) | Audit ledger + `predicateFromIntent` |
| [`fraud-analysis`](./fraud-analysis) | Multi-stage fraud-scoring pipeline with explainability |

## Games + interactive

| Example | What it shows |
| --- | --- |
| [`checkers`](./checkers) | Board game where every move is a constraint, the AI opponent a resolver |
| [`sudoku`](./sudoku) | Constraint propagation as the actual solver |
| [`number-match`](./number-match) | Tile-matching game with derived game state |
| [`goal-heist`](./goal-heist) | Multi-stage objective tracking |
| [`eleven-up`](./eleven-up) | Card-game scoring as constraints |

## Patterns + advanced

| Example | What it shows |
| --- | --- |
| [`shopping-cart`](./shopping-cart) | Cart + discounts + checkout as a single module |
| [`notifications`](./notifications) | A notifications hub modeled as a queue + drain |
| [`ab-testing`](./ab-testing) | Bucket assignment + variant rendering |
| [`error-boundaries`](./error-boundaries) | Resolver-error recovery patterns |
| [`time-machine`](./time-machine) | Time-travel snapshots + replay |

## Run any example

```bash
# from the repo root
pnpm install              # one-time, installs every workspace
cd examples/<name>
pnpm dev                  # or `pnpm start` / `pnpm test:builders` etc — see each README
```

Most examples are Vite apps that boot a dev server. CLI / Node examples document their entry command in the example's own README.

## Add a new example

Copy `examples/counter` as the template. Each example should:

1. Live in its own workspace package (`package.json` with `"private": true`).
2. Depend on `@directive-run/core` via `workspace:*` (plus whichever adapter / data layer it demonstrates).
3. Ship a `README.md` with a **What it shows** section and a **Run** section.
4. Use the canonical `src/module.ts` + `src/main.ts` layout when possible.
