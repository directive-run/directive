---
name: scaffolding-directive-modules
description: "Generate Directive module scaffolds with schema, init, derivations, constraints, resolvers, and matching test files. Use when asked to scaffold, generate, or create a new module from scratch, or when the user describes a feature and wants the boilerplate created."
---

# Scaffolding Directive Modules

## Prerequisites

This skill applies when the project uses `@directive-run/core`. If not found in `package.json`, suggest installing it: `npm install @directive-run/core`.

## When Claude Should Use This Skill

### Auto-Invoke Triggers
- User asks to "scaffold a module" or "generate a module"
- User describes a feature and wants boilerplate created
- User asks for a "starter" or "template" for a Directive module
- User wants to create a module with tests in one step

### Exclusions — Use a Different Skill
- User wants to understand Directive concepts → `getting-started-with-directive`
- User has existing code and wants patterns guidance → `writing-directive-modules`
- User wants to review existing code → `reviewing-directive-code`

---

## Module Scaffold Template

## Step 1: Identify the Domain

Ask the user (or infer from context):
1. What is the module managing? (e.g., "user authentication", "shopping cart")
2. What state does it track? (e.g., "login status, user profile, tokens")
3. What actions should happen automatically? (e.g., "redirect when not logged in", "fetch profile on login")

## Step 2: Generate Module

```typescript
import { createModule, t } from "@directive-run/core";

// Module: {module-name}
// Purpose: {one-line description}

export const {camelCaseName} = createModule("{kebab-case-name}", {
  schema: {
    // State — all facts must have type builders
    // {factName}: t.{type}(),
  },

  init: (facts) => {
    // Set ALL schema keys to sensible defaults
    // No async work, no side effects
  },

  derive: {
    // Computed values — pure functions, auto-tracked
    // {derivedName}: (facts) => {computation},
    // Composition: {name}: (facts, derive) => derive.other && facts.x,
  },

  constraints: {
    // Business rules: when X is true, require Y
    // {constraintName}: {
    //   when: (facts) => {condition},
    //   require: { type: "REQUIREMENT_TYPE", ...payload },
    // },
  },

  resolvers: {
    // Async handlers for requirements
    // {resolverName}: {
    //   requirement: "REQUIREMENT_TYPE",
    //   resolve: async (req, context) => {
    //     // Fulfill the requirement
    //   },
    // },
  },
});
```

## Step 3: Generate Test File

```typescript
import { describe, it, expect } from "vitest";
import { createTestSystem } from "@directive-run/core/testing";
import { {camelCaseName} } from "./{kebab-case-name}";

describe("{kebab-case-name}", () => {
  function createTest() {
    return createTestSystem({ module: {camelCaseName} });
  }

  describe("initialization", () => {
    it("sets default values", () => {
      const system = createTest();
      // expect(system.facts.{fact}).toBe({default});
    });
  });

  describe("derivations", () => {
    it("computes {derivedName}", () => {
      const system = createTest();
      // system.facts.{fact} = {value};
      // expect(system.derive.{derivedName}).toBe({expected});
    });
  });

  describe("constraints + resolvers", () => {
    it("triggers {requirement} when {condition}", async () => {
      const system = createTest();
      // system.facts.{fact} = {trigger value};
      // await system.settle();
      // expect(system.facts.{result}).toBe({expected});
    });
  });
});
```

## Scaffold Decision Tree

```
What kind of module?
│
├── Simple state container (no async)
│   → schema + init + derive
│   → Skip constraints/resolvers
│   → Example: counter, feature-flags
│
├── Data-fetching module
│   → schema includes loading/error/data states
│   → Constraint triggers fetch when needed
│   → Resolver fetches with retry policy
│   → Example: dashboard-loader, auth-flow
│
├── Form/validation module
│   → schema for field values + validation state
│   → Constraints check validity rules
│   → Resolver submits form data
│   → Example: contact-form, form-wizard
│
├── Multi-module coordination
│   → Multiple modules + crossModuleDeps
│   → createSystem({ modules: { a, b } })
│   → Example: multi-module, permissions
│
└── AI orchestrator module
│   → Use createAgentOrchestrator or createMultiAgentOrchestrator
│   → See building-ai-orchestrators skill
```

## Common Schema Patterns

### Loading State

```typescript
schema: {
  status: t.string<"idle" | "loading" | "success" | "error">(),
  data: t.object<DataType | null>(),
  error: t.string<string | null>(),
},
init: (facts) => {
  facts.status = "idle";
  facts.data = null;
  facts.error = null;
},
```

### Resource State (Generic)

```typescript
schema: {
  resource: t.object<ResourceState<T>>(),
},
// Where ResourceState<T> = { status, data, error, lastFetched }
```

### Authentication

```typescript
schema: {
  isAuthenticated: t.boolean(),
  user: t.object<User | null>(),
  token: t.string<string | null>(),
  loginError: t.string<string | null>(),
},
```

### Pagination

```typescript
schema: {
  items: t.array<Item>(),
  page: t.number(),
  pageSize: t.number(),
  total: t.number(),
  hasMore: t.boolean(),
},
```

## Naming Rules (Enforced)

```
Module variable:    camelCase       const userAuth = createModule(...)
Module string:      kebab-case      createModule("user-auth", ...)
Fact keys:          camelCase       isLoggedIn, userName
Derivation keys:    camelCase       canEdit, isAdmin
Constraint keys:    camelCase       enforceLogin, requireProfile
Resolver keys:      camelCase       fetchProfile, submitLogin
Requirement types:  UPPER_SNAKE     "FETCH_PROFILE", "SUBMIT_LOGIN"
Test describe:      kebab-case      describe("user-auth", ...)
```

## Reference Files

Supporting knowledge files loaded with this skill:
- `core-patterns.md` — Patterns and API reference
- `schema-types.md` — Type builders and schema patterns
- `naming.md` — Naming conventions
