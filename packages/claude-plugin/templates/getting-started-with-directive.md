---
name: getting-started-with-directive
description: "Understand Directive fundamentals: what modules, facts, derivations, constraints, resolvers, and systems are, and how they fit together. Use when someone is new to Directive, asks 'what is Directive', wants to understand the mental model, or needs help choosing between Directive concepts."
---

# Getting Started with Directive

# When Claude Should Use This Skill

## Auto-Invoke Triggers
- User asks "what is Directive" or "how does Directive work"
- User is new to Directive and needs orientation
- User asks about the relationship between facts, constraints, and resolvers
- User asks "should I use a constraint or an effect" or similar conceptual questions
- User wants to understand the Directive mental model before writing code

## Exclusions — Use a Different Skill
- User already knows Directive and wants to write a specific module → `writing-directive-modules`
- User asks about specific constraint/resolver patterns → `writing-directive-constraints`
- User asks about multi-module systems or React → `building-directive-systems`
- User asks about testing → `testing-directive-code`
- User asks about AI agents → `building-ai-orchestrators`

---

# Directive Mental Model

Directive is a **constraint-driven runtime** for TypeScript. Instead of imperative state management, you:

1. **Declare facts** — observable state values
2. **Derive** computed values — auto-tracked, no manual deps
3. **Set constraints** — conditions that must be true (when X, require Y)
4. **Write resolvers** — how to fulfill requirements (async handlers)
5. **Compose into systems** — wire modules together with plugins

The runtime watches your facts, evaluates constraints, and dispatches requirements to resolvers automatically.

## Core Concepts Flow

```
Facts (state) → Derivations (computed)
     ↓
Constraints (when/require) → Requirements → Resolvers (async handlers)
     ↓
Effects (side effects, logging, sync)
```

## Key Terminology

| Term | What it is | Analogy |
|------|-----------|---------|
| **Fact** | A piece of observable state | Redux store field |
| **Derivation** | Auto-tracked computed value | Recoil selector |
| **Constraint** | "When X is true, require Y" declaration | Business rule |
| **Requirement** | A typed request emitted by a constraint | Redux action |
| **Resolver** | Async handler that fulfills requirements | Redux thunk |
| **Effect** | Fire-and-forget side effect on fact changes | useEffect |
| **Module** | Bundle of schema + init + derive + constraints + resolvers | Feature slice |
| **System** | Runtime that wires modules together | Redux store |

## Minimal Example

```typescript
import { createModule, createSystem, t } from "@directive-run/core";

const counter = createModule("counter", {
  schema: {
    count: t.number(),
    limit: t.number(),
  },

  init: (facts) => {
    facts.count = 0;
    facts.limit = 10;
  },

  derive: {
    isAtLimit: (facts) => facts.count >= facts.limit,
    remaining: (facts) => facts.limit - facts.count,
  },

  constraints: {
    enforceLimit: {
      when: (facts) => facts.count > facts.limit,
      require: { type: "RESET_COUNT" },
    },
  },

  resolvers: {
    resetCount: {
      requirement: "RESET_COUNT",
      resolve: async (req, context) => {
        context.facts.count = context.facts.limit;
      },
    },
  },
});

const system = createSystem({ module: counter });

// Read state
console.log(system.facts.count);     // 0
console.log(system.derive.isAtLimit); // false

// Mutate — constraints auto-evaluate
system.facts.count = 15;
// → constraint fires → resolver resets count to limit
```

## When to Use What

```
Need to store state?                    → schema + init (facts)
Need computed values from state?        → derive (derivations)
Need "if X then do Y" business logic?   → constraint + resolver
Need side effects (logging, sync)?      → effect
Need to compose multiple features?      → multi-module system
Need lifecycle hooks?                   → plugins
```

## Decision Tree: Constraint vs Effect vs Direct Mutation

```
Is it a business rule (if X then Y)?
├── YES → Constraint + Resolver
│   Examples: auth redirect, data fetch, validation enforcement
│
├── NO → Does it modify facts?
│   ├── YES → Direct mutation (system.facts.x = y)
│   │   Examples: user input, button click handlers
│   │
│   └── NO → Effect
│       Examples: logging, analytics, DOM sync, external API sync
```

## Common Patterns

### Schema Type Builders

```typescript
schema: {
  name: t.string(),                           // string
  age: t.number(),                            // number
  active: t.boolean(),                        // boolean
  role: t.string<"admin" | "user">(),         // union type
  profile: t.object<{ name: string }>(),      // typed object
  tags: t.array<string>(),                    // typed array
  data: t.object<Profile | null>(),           // nullable
}
```

### Naming Convention

```
Module name:    "kebab-case"     → createModule("user-auth", ...)
Fact keys:      camelCase        → schema: { isLoggedIn: t.boolean() }
Derivation:     camelCase        → derive: { canEdit: ... }
Constraint:     camelCase        → constraints: { enforceAuth: ... }
Resolver:       camelCase        → resolvers: { fetchProfile: ... }
Requirement:    UPPER_SNAKE_CASE → require: { type: "FETCH_PROFILE" }
```

## Reference Files

Supporting knowledge files loaded with this skill:
- `core-patterns.md` — Core patterns and API reference
- `api-skeleton.md` — Full API surface
