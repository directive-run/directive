---
name: reviewing-directive-code
description: "Review Directive code for anti-patterns, naming violations, missing error boundaries, constraint/resolver misuse, and performance issues. Use when asked to review, audit, or improve existing Directive modules, systems, or orchestrators."
---

# Reviewing Directive Code

## Prerequisites

This skill applies when the project uses `@directive-run/core`. If not found in `package.json`, suggest installing it: `npm install @directive-run/core`.

## When Claude Should Use This Skill

### Auto-Invoke Triggers
- User asks to "review my Directive code" or "audit this module"
- User asks "is this the right pattern" or "am I doing this correctly"
- User wants a code review of constraint/resolver/module code
- User asks about Directive best practices for existing code
- User suspects they have anti-patterns or performance issues

### Exclusions – Use a Different Skill
- User wants to write NEW code from scratch → `writing-directive-modules`
- User wants to write tests → `testing-directive-code`
- User wants to migrate FROM another library → `migrating-to-directive`

---

## Review Checklist

## 1. Module Structure

```
✓ Module name is kebab-case
✓ Schema keys are camelCase
✓ All facts have explicit type builders (t.string(), t.number(), etc.)
✓ init() sets ALL schema keys (no undefined facts)
✓ No business logic in init() – just defaults
```

### Anti-Patterns

```typescript
// BAD: Missing type builder
schema: { count: 0 }
// GOOD: Explicit type builder
schema: { count: t.number() }

// BAD: Business logic in init
init: (facts) => {
  facts.count = localStorage.getItem("count") ?? 0;
}
// GOOD: Use a resolver for async/side-effect init
init: (facts) => {
  facts.count = 0;
}
```

## 2. Derivations

```
✓ Derivations are pure functions (no side effects)
✓ No mutations inside derive functions
✓ Using derive-to-derive composition correctly (via second arg)
✓ Not duplicating fact values (derive should compute, not mirror)
```

### Anti-Patterns

```typescript
// BAD: Side effect in derivation
derive: {
  status: (facts) => {
    console.log("computing status"); // side effect!
    return facts.isReady ? "ready" : "loading";
  }
}

// BAD: Mirroring a fact (useless derivation)
derive: {
  currentCount: (facts) => facts.count  // just use facts.count
}

// GOOD: Meaningful computation
derive: {
  isOverBudget: (facts) => facts.spent > facts.budget,
  budgetStatus: (facts, derived) => derived.isOverBudget ? "over" : "under",
}
```

## 3. Constraints

```
✓ when() is a pure predicate (no side effects)
✓ require returns a typed requirement with UPPER_SNAKE_CASE type
✓ Async constraints have explicit deps: []
✓ Priority is set when multiple constraints may conflict
✓ No redundant constraints (check if constraint already exists)
```

### Anti-Patterns

```typescript
// BAD: Side effect in when()
when: (facts) => {
  analytics.track("constraint-checked"); // side effect!
  return facts.count > 10;
}

// BAD: Requirement type not UPPER_SNAKE_CASE
require: { type: "fetchData" }
// GOOD:
require: { type: "FETCH_DATA" }

// BAD: Async constraint without deps
constraints: {
  check: {
    async: true,
    when: async (facts) => await validate(facts.input),
    require: { type: "HANDLE_INVALID" },
    // Missing: deps: ["input"]
  }
}
```

## 4. Resolvers

```
✓ Resolver params use (req, context) – not (req, ctx)
✓ Resolver handles errors (try/catch or error boundaries)
✓ Deduplication key set for idempotent requirements
✓ Retry policy configured for network/external calls
✓ Not doing work that belongs in a constraint or effect
```

### Anti-Patterns

```typescript
// BAD: Abbreviated context parameter
resolve: async (req, ctx) => { ... }
// GOOD:
resolve: async (req, context) => { ... }

// BAD: No error handling for external calls
resolve: async (req, context) => {
  const data = await fetch("/api/data");
  context.facts.data = await data.json();
}
// GOOD: With retry
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    retry: { attempts: 3, backoff: "exponential" },
    resolve: async (req, context) => {
      const data = await fetch("/api/data");
      context.facts.data = await data.json();
    },
  }
}

// BAD: Resolver checking conditions (that's a constraint's job)
resolve: async (req, context) => {
  if (context.facts.isReady) {
    // do something
  }
}
```

## 5. Effects

```
✓ Effects are fire-and-forget (not resolving requirements)
✓ Effects have cleanup functions for subscriptions
✓ Not mutating critical state in effects (use resolvers instead)
✓ Prev parameter used for change detection
```

## 6. System Composition

```
✓ Multi-module: crossModuleDeps declared for cross-module constraints
✓ No circular dependencies between modules
✓ Plugins added at system level, not module level
✓ Single module uses { module: x }, multi uses { modules: { a, b } }
```

## 7. Performance Review

```
✓ Derivations don't do expensive computation on every change
✓ Constraints are not overly broad (when() triggers on minimal deps)
✓ Resolvers use deduplication keys to prevent duplicate work
✓ Batch resolvers used for N+1 scenarios
✓ Effects don't trigger cascading mutations
```

## 8. Naming Convention Audit

```
Module names:    kebab-case        ("user-auth", "shopping-cart")
Fact keys:       camelCase         (isLoggedIn, userName)
Derivation keys: camelCase         (canEdit, totalPrice)
Constraint keys: camelCase         (enforceAuth, validateInput)
Resolver keys:   camelCase         (fetchProfile, submitOrder)
Requirement type: UPPER_SNAKE_CASE (FETCH_PROFILE, SUBMIT_ORDER)
Event types:     UPPER_SNAKE_CASE  (USER_CLICKED, FORM_SUBMITTED)
```

## Review Output Format

When reviewing, output findings as:

```
## Review: [module-name]

### Issues Found
| Severity | Issue | Location |
|----------|-------|----------|
| Critical | ... | file:line |
| Major | ... | file:line |
| Minor | ... | file:line |

### Recommendations
1. ...
2. ...
```

## Reference Files

Supporting knowledge files loaded with this skill:
- `anti-patterns.md` – Full anti-pattern catalog with fixes
- `core-patterns.md` – Correct patterns to recommend
- `naming.md` – Naming conventions reference
