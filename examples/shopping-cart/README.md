# Shopping Cart Example

Demonstrates Directive + Zustand integration for automatic sync and stock validation.

## Run It

```bash
# Install dependencies
pnpm install zustand

# Run with your React setup
```

## What This Demonstrates

### The Philosophy: "Directive WITH Zustand"

Instead of replacing Zustand, Directive complements it:
- **Zustand** handles what it's good at: simple state management
- **Directive** adds what's missing: constraint-driven orchestration

### Zustand Handles

```typescript
// Simple state
{
  items: CartItem[];
  synced: boolean;
  lastSyncTime: number | null;
  inventory: Inventory;
}

// Simple actions
addItem: (item) => set({ items: [...items, item], synced: false });
removeItem: (id) => set({ items: items.filter(...) });
```

### Directive Adds

```typescript
// Constraint: "If cart modified and not synced → sync to server"
constraints: {
  syncOnChange: {
    when: (state) => !state.synced && state.items.length > 0,
    require: { type: 'SYNC_CART', items: state.items }
  }
}

// Resolver: HOW to fulfill the sync requirement
resolvers: {
  syncCart: {
    handles: (req) => req.type === 'SYNC_CART',
    resolve: async (req, { setState }) => {
      await api.syncCart(req.items);
      setState({ synced: true, lastSyncTime: Date.now() });
    }
  }
}
```

## Key Patterns

### 1. Middleware Wrapping

Directive wraps Zustand's `setState` to:
1. Let the state change happen normally
2. Sync state to Directive facts
3. Trigger constraint evaluation
4. Execute resolvers for unmet requirements

### 2. Debounced Sync

The constraint includes a debounce check:

```typescript
when: (state) => {
  if (state.synced) return false;
  // Only sync if last sync was >2s ago
  if (state.lastSyncTime && Date.now() - state.lastSyncTime < 2000) return false;
  return true;
}
```

This prevents rapid-fire syncs while editing.

### 3. Priority Ordering

```typescript
constraints: {
  fetchInventory: { priority: 100 },  // Run first
  syncOnChange: { priority: 10 },     // Run after inventory loaded
}
```

### 4. Automatic Retry

If the sync resolver fails, the constraint stays active (synced = false), so Directive will retry on the next reconciliation cycle.

## When to Use Directive with Zustand

| Scenario | Use Directive? |
|----------|---------------|
| Simple get/set state | No, Zustand alone |
| Sync state to server | Yes - constraint-driven |
| Validate before action | Yes - guardrails |
| Coordinate multiple stores | Yes - cross-store constraints |
| Complex async flows | Yes - resolver orchestration |

## Try It

1. Add items to cart → watch sync status
2. Add more items quickly → debounce prevents rapid syncs
3. Add product-3 (out of stock) → stock validation
4. Check console for Directive logs

## Files

- `types.ts` - Type definitions
- `store.ts` - Zustand store with Directive middleware
- `index.tsx` - React components
