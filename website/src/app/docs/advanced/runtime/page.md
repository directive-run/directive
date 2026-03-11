---
title: Runtime Dynamics
description: Register, override, toggle, and remove definitions at runtime. All four subsystems share the same dynamic interface.
---

Modify your system's behavior at runtime – register new definitions, override existing ones, toggle constraints and effects on and off. {% .lead %}

---

## Overview

Every definition declared in a module (constraints, resolvers, derivations, effects) can also be registered, overridden, toggled, and removed at runtime. All four subsystems share the same dynamic definition interface, making runtime modification predictable and consistent.

---

## The Dynamic Definition Interface

All four subsystems expose the same six methods:

| Method | Description |
|--------|-------------|
| `register(id, def)` | Add a new definition at runtime |
| `assign(id, def)` | Override an existing definition (static or dynamic) |
| `unregister(id)` | Remove a dynamically registered definition |
| `call(id, ...)` | Execute/evaluate a definition directly |
| `isDynamic(id)` | Check if a definition was registered at runtime |
| `listDynamic()` | List all dynamically registered IDs |

### Semantics

The methods behave consistently across all subsystems:

| Method | ID exists (static) | ID exists (dynamic) | ID doesn't exist |
|--------|-------------------|---------------------|--------------------|
| `register` | throws | throws | creates |
| `assign` | overrides | overrides | throws |
| `unregister` | dev warning, no-op | removes | dev warning, no-op |
| `call` | executes | executes | throws |

{% callout type="note" title="Deferred during reconciliation" %}
If you call `register`, `assign`, or `unregister` during a reconciliation cycle (e.g., inside a resolver or effect), the operation is automatically deferred and applied after the current cycle completes. This prevents mid-cycle inconsistencies.
{% /callout %}

---

## Registering New Definitions

Add definitions that didn't exist in the original module:

### Constraints

```typescript
system.constraints.register("emergencyOverride", {
  when: (facts) => facts.emergencyVehicle === true,
  require: { type: "TRANSITION", to: "green" },
  priority: 100,
});
```

### Resolvers

```typescript
system.resolvers.register("loadData", {
  requirement: "LOAD_DATA",
  resolve: async (req, context) => {
    const data = await fetch(`/api/data/${req.source}`);
    context.facts.data = await data.json();
  },
});
```

### Derivations

```typescript
system.derive.register("tripled", (facts) => facts.count * 3);

// Access like any other derivation
system.derive.tripled; // => 15
```

{% callout type="warning" title="Reserved names" %}
Derivation IDs cannot be `register`, `assign`, `unregister`, `call`, `isDynamic`, or `listDynamic` – these names are reserved for the runtime registration methods on the `derive` proxy.
{% /callout %}

### Effects

```typescript
system.effects.register("analytics", {
  run: (facts) => {
    trackEvent("page_view", { page: facts.currentPage });
  },
});
```

---

## Overriding Existing Definitions

Replace the implementation of a definition (static or dynamic) while keeping its ID:

```typescript
// Override a constraint's logic
system.constraints.assign("transition", {
  when: (facts) => facts.phase === "red" && facts.elapsed > 10,
  require: { type: "TRANSITION", to: "green" },
  priority: 200,
});

// Override a resolver's implementation
system.resolvers.assign("fetchUser", {
  requirement: "FETCH_USER",
  resolve: async (req, context) => {
    context.facts.user = await newUserService.get(req.userId);
  },
});

// Override a derivation's computation
system.derive.assign("doubled", (facts) => facts.count * 20);

// Override an effect's behavior
system.effects.assign("log", {
  run: (facts, prev) => {
    if (prev?.status !== facts.status) {
      console.log(`Status changed: ${facts.status}`);
    }
  },
});
```

When you `assign()` a static definition, the original is preserved internally – see the next section.

---

## Retrieving and Restoring Originals

When `assign()` overrides a static (module-defined) definition, Directive saves the original so you can restore it later:

```typescript
// 1. Override the original constraint
system.constraints.assign("transition", {
  when: (facts) => facts.override === true,
  require: { type: "FORCE_TRANSITION" },
});

// 2. Retrieve the original definition (before override)
const original = system.getOriginal("constraint", "transition");
// => the original constraint definition from the module

// 3. Restore the original, removing the override
const restored = system.restoreOriginal("constraint", "transition");
// => true (restoration succeeded)
```

### API

```typescript
// Get the original definition saved before assign() overrode it
system.getOriginal(
  type: "constraint" | "resolver" | "derivation" | "effect",
  id: string
): unknown | undefined

// Restore the original and remove the override tracking
system.restoreOriginal(
  type: "constraint" | "resolver" | "derivation" | "effect",
  id: string
): boolean  // true if restored, false if no original exists
```

The full lifecycle:

```typescript
// Original behavior
system.derive.doubled; // => 10

// Override
system.derive.assign("doubled", (facts) => facts.count * 100);
system.derive.doubled; // => 500

// Inspect the original
system.getOriginal("derivation", "doubled");
// => (facts) => facts.count * 2

// Restore
system.restoreOriginal("derivation", "doubled"); // => true
system.derive.doubled; // => 10 (back to original)
```

---

## Removing Dynamic Definitions

Remove definitions that were registered at runtime:

```typescript
// Remove a dynamically registered constraint
system.constraints.unregister("emergencyOverride");

// Remove a dynamically registered resolver
system.resolvers.unregister("loadData");

// Remove a dynamically registered derivation
system.derive.unregister("tripled");

// Remove a dynamically registered effect
system.effects.unregister("analytics");
```

Static (module-defined) definitions cannot be removed – calling `unregister()` on a static ID logs a dev warning and does nothing.

---

## Enable / Disable

Constraints and effects support toggling without removing the definition:

### Constraints

```typescript
// Disable a constraint – its when() function won't be called
system.constraints.disable("expensiveCheck");

// Re-enable for future reconciliation cycles
system.constraints.enable("expensiveCheck");

// Check current state
system.constraints.isDisabled("expensiveCheck"); // true
```

### Effects

```typescript
// Disable an effect – it won't run during reconciliation
system.effects.disable("verboseLogging");

// Re-enable later
system.effects.enable("verboseLogging");

// Check current state
system.effects.isEnabled("verboseLogging"); // false
```

{% callout type="note" title="call() respects disabled state" %}
`system.effects.call()` on a disabled effect is a no-op. Use `enable()` first if you need to execute it.
{% /callout %}

Use cases for toggling:
- **Feature flags** – disable constraints that gate unreleased features
- **A/B testing** – enable/disable constraint variants per user cohort
- **Maintenance windows** – suppress side effects during deploys
- **Debug mode** – toggle verbose logging effects

---

## Dynamic Module Registration

Add entire modules to a running namespaced system:

```typescript
const system = createSystem({
  modules: { auth: authModule },
});
system.start();

// Later, after dynamic import
const { chatModule } = await import('./features/chat');
system.registerModule("chat", chatModule);

// Immediately available
system.facts.chat.messages;
```

The module is fully wired – its constraints, resolvers, effects, and derivations all activate immediately. See [Multi-Module](/docs/advanced/multi-module) for composition patterns and restrictions.

---

## Introspection

Check whether definitions are dynamic and list all dynamic IDs:

```typescript
// Per-subsystem checks
system.constraints.isDynamic("emergencyOverride"); // true
system.constraints.isDynamic("transition");         // false (module-defined)
system.constraints.listDynamic();                   // ["emergencyOverride"]

system.resolvers.isDynamic("loadData");             // true
system.resolvers.listDynamic();                     // ["loadData"]

system.derive.isDynamic("tripled");                 // true
system.derive.listDynamic();                        // ["tripled"]

system.effects.isDynamic("analytics");              // true
system.effects.listDynamic();                       // ["analytics"]
```

---

## Use Cases

### Feature Flags

```typescript
// Toggle constraints based on feature flag service
if (!featureFlags.isEnabled("checkout-v2")) {
  system.constraints.disable("checkoutV2");
}
```

### Plugin-Provided Definitions

```typescript
function analyticsPlugin() {
  return {
    onInit(system) {
      system.effects.register("trackPageView", {
        run: (facts) => analytics.track("page_view", { page: facts.page }),
      });
    },
    onDestroy(system) {
      system.effects.unregister("trackPageView");
    },
  };
}
```

### A/B Testing

```typescript
// Override resolver behavior for test variant
if (userCohort === "B") {
  system.resolvers.assign("fetchRecommendations", {
    requirement: "FETCH_RECOMMENDATIONS",
    resolve: async (req, context) => {
      context.facts.recommendations = await mlService.getPersonalized(req.userId);
    },
  });
}
```

### Lazy Loading

```typescript
// Register resolvers only when a feature is first needed
const lazyLoadChat = async () => {
  const { chatModule } = await import('./features/chat');
  system.registerModule("chat", chatModule);
};
```

### Admin Overrides

```typescript
// Override constraint priorities for admin users
if (user.isAdmin) {
  system.constraints.assign("rateLimiter", {
    when: () => false,  // Admins bypass rate limiting
    require: { type: "RATE_LIMIT" },
  });
}
```

---

## Type Safety

Dynamic definition callbacks receive **typed `facts`** — you get autocomplete, error checking, and no manual casts in single-module systems:

```typescript
// ✅ facts.count is typed as number
system.constraints.register("highCount", {
  when: (facts) => facts.count > 10,
  require: { type: "LOAD_DATA", source: "dynamic" },
});

// ✅ context.facts is typed — facts.label is string
system.resolvers.register("loadData", {
  requirement: "LOAD_DATA",
  resolve: async (req, context) => {
    context.facts.label = `loaded from ${req.source}`;
  },
});

// ✅ facts.count is typed as number
system.derive.register("tripled", (facts) => facts.count * 3);
```

### Typed `call<T>()` for derivations

Use the type parameter on `call<T>()` to specify the return type:

```typescript
const value = system.derive.call<number>("tripled"); // => number
```

### Limitations

Accessing dynamic derivations as properties still requires a cast — TypeScript can't type a property that doesn't exist in the schema at compile time:

```typescript
// Dynamic property — TypeScript doesn't know about it
(system.derive as any).tripled; // cast required

// Prefer call<T>() instead
system.derive.call<number>("tripled"); // type-safe
```

In namespaced (multi-module) systems, control interfaces use the default unparameterized types since the flat `::` key format makes typed autocomplete confusing.

---

## Next Steps

- **[Constraints](/docs/constraints)** – Constraint definition and evaluation
- **[Resolvers](/docs/resolvers)** – Requirement resolution and retry
- **[Derivations](/docs/derivations)** – Computed values and composition
- **[Effects](/docs/effects)** – Side effects and cleanup
- **[Multi-Module](/docs/advanced/multi-module)** – Module composition and `registerModule()`
- **[Plugins](/docs/plugins/overview)** – Extend system behavior with lifecycle hooks
