/**
 * Types for Shopping Cart Example
 */

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface Inventory {
  [productId: string]: number;
}

export interface CartState {
  items: CartItem[];
  synced: boolean;
  lastSyncTime: number | null;
  syncError: string | null;
  inventory: Inventory;
}

export interface CartActions {
  addItem: (item: Omit<CartItem, "quantity">) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  markSynced: () => void;
  setSyncError: (error: string | null) => void;
  setInventory: (inventory: Inventory) => void;
}

export type CartStore = CartState & CartActions;

// Requirements
export interface SyncCartRequirement {
  type: "SYNC_CART";
  items: CartItem[];
}

export interface ValidateStockRequirement {
  type: "VALIDATE_STOCK";
  itemId: string;
  requestedQuantity: number;
}

export interface FetchInventoryRequirement {
  type: "FETCH_INVENTORY";
}
