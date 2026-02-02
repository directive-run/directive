/**
 * Shopping Cart Store with Directive Integration
 *
 * Demonstrates:
 * - Zustand for simple state management
 * - Directive for sync constraints and validation
 */

import { create } from "zustand";
import {
  directiveMiddleware,
  type ZustandConstraint,
  type ZustandResolver,
} from "directive/zustand";
import type {
  CartState,
  CartStore,
  SyncCartRequirement,
  ValidateStockRequirement,
  FetchInventoryRequirement,
} from "./types.js";

// Simulated API
const api = {
  syncCart: async (items: CartState["items"]): Promise<void> => {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 500));
    // Randomly fail 10% of the time for demo
    if (Math.random() < 0.1) {
      throw new Error("Network error");
    }
    console.log("[API] Cart synced:", items.length, "items");
  },

  fetchInventory: async (): Promise<CartState["inventory"]> => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Simulated inventory
    return {
      "product-1": 10,
      "product-2": 5,
      "product-3": 0, // Out of stock
      "product-4": 100,
    };
  },

  validateStock: async (
    itemId: string,
    quantity: number,
    inventory: CartState["inventory"]
  ): Promise<{ valid: boolean; available: number }> => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const available = inventory[itemId] ?? 0;
    return { valid: quantity <= available, available };
  },
};

// Constraints
const constraints: Record<string, ZustandConstraint<CartState>> = {
  // Sync cart when items change and not recently synced
  syncOnChange: {
    when: (state) => {
      if (state.synced) return false;
      if (state.items.length === 0) return false;
      // Debounce: only sync if last sync was >2s ago or never
      const now = Date.now();
      if (state.lastSyncTime && now - state.lastSyncTime < 2000) return false;
      return true;
    },
    require: (state): SyncCartRequirement => ({
      type: "SYNC_CART",
      items: state.items,
    }),
    priority: 10,
  },

  // Fetch inventory on startup
  fetchInventoryOnStart: {
    when: (state) => Object.keys(state.inventory).length === 0,
    require: { type: "FETCH_INVENTORY" } as FetchInventoryRequirement,
    priority: 100, // High priority - run first
  },
};

// Resolvers
const resolvers: Record<string, ZustandResolver<CartState, any>> = {
  syncCart: {
    handles: (req): req is SyncCartRequirement => req.type === "SYNC_CART",
    resolve: async (req, { setState }) => {
      try {
        await api.syncCart(req.items);
        setState((s) => ({
          synced: true,
          lastSyncTime: Date.now(),
          syncError: null,
        }));
      } catch (error) {
        setState({
          syncError: error instanceof Error ? error.message : "Sync failed",
        });
      }
    },
  },

  fetchInventory: {
    handles: (req): req is FetchInventoryRequirement =>
      req.type === "FETCH_INVENTORY",
    resolve: async (req, { setState }) => {
      const inventory = await api.fetchInventory();
      setState({ inventory });
    },
  },

  validateStock: {
    handles: (req): req is ValidateStockRequirement =>
      req.type === "VALIDATE_STOCK",
    resolve: async (req, { getState, setState }) => {
      const { inventory, items } = getState();
      const result = await api.validateStock(
        req.itemId,
        req.requestedQuantity,
        inventory
      );

      if (!result.valid) {
        // Adjust quantity to available stock
        const updatedItems = items.map((item) =>
          item.id === req.itemId
            ? { ...item, quantity: result.available }
            : item
        );
        setState({ items: updatedItems, synced: false });
        console.log(
          `[Stock] Adjusted ${req.itemId} quantity to ${result.available}`
        );
      }
    },
  },
};

// Create the store with Directive middleware
export const useCartStore = create<CartStore>(
  directiveMiddleware(
    (set, get) => ({
      // State
      items: [],
      synced: true,
      lastSyncTime: null,
      syncError: null,
      inventory: {},

      // Actions
      addItem: (item) => {
        set((state) => {
          const existing = state.items.find((i) => i.id === item.id);
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i
              ),
              synced: false,
            };
          }
          return {
            items: [...state.items, { ...item, quantity: 1 }],
            synced: false,
          };
        });
      },

      removeItem: (id) => {
        set((state) => ({
          items: state.items.filter((i) => i.id !== id),
          synced: false,
        }));
      },

      updateQuantity: (id, quantity) => {
        set((state) => ({
          items: state.items.map((i) =>
            i.id === id ? { ...i, quantity: Math.max(0, quantity) } : i
          ),
          synced: false,
        }));
      },

      clearCart: () => {
        set({ items: [], synced: false });
      },

      markSynced: () => {
        set({ synced: true, lastSyncTime: Date.now() });
      },

      setSyncError: (error) => {
        set({ syncError: error });
      },

      setInventory: (inventory) => {
        set({ inventory });
      },
    }),
    {
      constraints,
      resolvers,
      debug: true,
      onRequirementCreated: (req) => {
        console.log("[Directive] Requirement created:", req.type);
      },
      onRequirementResolved: (req) => {
        console.log("[Directive] Requirement resolved:", req.type);
      },
    }
  )
);

// Derived values (computed from state)
export function useCartTotal() {
  return useCartStore((state) =>
    state.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  );
}

export function useCartItemCount() {
  return useCartStore((state) =>
    state.items.reduce((sum, item) => sum + item.quantity, 0)
  );
}

export function useIsItemOutOfStock(productId: string) {
  return useCartStore((state) => (state.inventory[productId] ?? 0) === 0);
}

export function useAvailableStock(productId: string) {
  return useCartStore((state) => state.inventory[productId] ?? 0);
}
