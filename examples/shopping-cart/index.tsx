/**
 * Shopping Cart Example - React App
 *
 * Demonstrates:
 * - Zustand for simple state management
 * - Directive for constraint-driven sync and validation
 */

import React from "react";
import {
  useCartStore,
  useCartTotal,
  useCartItemCount,
  useAvailableStock,
} from "./store.js";
import type { CartItem } from "./types.js";

// Sample products
const PRODUCTS = [
  { id: "product-1", name: "TypeScript Handbook", price: 29.99 },
  { id: "product-2", name: "React Patterns Book", price: 34.99 },
  { id: "product-3", name: "Node.js Guide", price: 24.99 },
  { id: "product-4", name: "CSS Mastery", price: 19.99 },
];

// Product Card Component
function ProductCard({ product }: { product: (typeof PRODUCTS)[0] }) {
  const addItem = useCartStore((s) => s.addItem);
  const stock = useAvailableStock(product.id);
  const isOutOfStock = stock === 0;

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        opacity: isOutOfStock ? 0.5 : 1,
      }}
    >
      <h3 style={{ margin: 0 }}>{product.name}</h3>
      <p style={{ color: "#666" }}>${product.price.toFixed(2)}</p>
      <p style={{ fontSize: 12, color: isOutOfStock ? "red" : "green" }}>
        {isOutOfStock ? "Out of stock" : `${stock} in stock`}
      </p>
      <button
        onClick={() => addItem(product)}
        disabled={isOutOfStock}
        style={{
          padding: "8px 16px",
          background: isOutOfStock ? "#ccc" : "#007bff",
          color: "white",
          border: "none",
          borderRadius: 4,
          cursor: isOutOfStock ? "not-allowed" : "pointer",
        }}
      >
        Add to Cart
      </button>
    </div>
  );
}

// Cart Item Component
function CartItemRow({ item }: { item: CartItem }) {
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const stock = useAvailableStock(item.id);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 0",
        borderBottom: "1px solid #eee",
      }}
    >
      <div>
        <strong>{item.name}</strong>
        <div style={{ fontSize: 14, color: "#666" }}>
          ${item.price.toFixed(2)} each
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={() => updateQuantity(item.id, item.quantity - 1)}
          disabled={item.quantity <= 1}
          style={{ padding: "4px 8px" }}
        >
          -
        </button>
        <span style={{ minWidth: 30, textAlign: "center" }}>
          {item.quantity}
        </span>
        <button
          onClick={() => updateQuantity(item.id, item.quantity + 1)}
          disabled={item.quantity >= stock}
          style={{ padding: "4px 8px" }}
        >
          +
        </button>
        <button
          onClick={() => removeItem(item.id)}
          style={{
            padding: "4px 8px",
            marginLeft: 8,
            background: "#dc3545",
            color: "white",
            border: "none",
            borderRadius: 4,
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

// Sync Status Component
function SyncStatus() {
  const synced = useCartStore((s) => s.synced);
  const syncError = useCartStore((s) => s.syncError);
  const lastSyncTime = useCartStore((s) => s.lastSyncTime);

  return (
    <div
      style={{
        padding: 8,
        borderRadius: 4,
        background: synced ? "#d4edda" : syncError ? "#f8d7da" : "#fff3cd",
        color: synced ? "#155724" : syncError ? "#721c24" : "#856404",
        fontSize: 12,
        marginBottom: 12,
      }}
    >
      {synced ? (
        <>
          ✓ Synced{" "}
          {lastSyncTime && (
            <span style={{ opacity: 0.7 }}>
              at {new Date(lastSyncTime).toLocaleTimeString()}
            </span>
          )}
        </>
      ) : syncError ? (
        <>⚠ Sync error: {syncError} (will retry)</>
      ) : (
        <>⏳ Syncing...</>
      )}
    </div>
  );
}

// Cart Summary Component
function CartSummary() {
  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clearCart);
  const total = useCartTotal();
  const itemCount = useCartItemCount();

  if (items.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "#666" }}>
        Your cart is empty
      </div>
    );
  }

  return (
    <div>
      <SyncStatus />
      {items.map((item) => (
        <CartItemRow key={item.id} item={item} />
      ))}
      <div
        style={{
          marginTop: 16,
          paddingTop: 16,
          borderTop: "2px solid #333",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <strong>Total:</strong> ${total.toFixed(2)}
          <div style={{ fontSize: 12, color: "#666" }}>
            {itemCount} item{itemCount !== 1 ? "s" : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={clearCart}
            style={{
              padding: "8px 16px",
              background: "#6c757d",
              color: "white",
              border: "none",
              borderRadius: 4,
            }}
          >
            Clear Cart
          </button>
          <button
            style={{
              padding: "8px 16px",
              background: "#28a745",
              color: "white",
              border: "none",
              borderRadius: 4,
            }}
          >
            Checkout
          </button>
        </div>
      </div>
    </div>
  );
}

// Main App Component
export function ShoppingCartApp() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 20 }}>
      <h1>Shopping Cart Example</h1>
      <p style={{ color: "#666" }}>
        Demonstrates Directive + Zustand integration for automatic sync and
        stock validation.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
        {/* Products */}
        <div>
          <h2>Products</h2>
          {PRODUCTS.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>

        {/* Cart */}
        <div>
          <h2>Cart</h2>
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 16,
              minHeight: 200,
            }}
          >
            <CartSummary />
          </div>
        </div>
      </div>

      {/* How it works */}
      <div
        style={{
          marginTop: 40,
          padding: 20,
          background: "#f8f9fa",
          borderRadius: 8,
        }}
      >
        <h3>How Directive + Zustand Work Together</h3>
        <ul style={{ lineHeight: 1.8 }}>
          <li>
            <strong>Zustand</strong> handles simple state: items, quantities,
            sync status
          </li>
          <li>
            <strong>Directive</strong> adds constraints: "If cart modified and
            not synced → sync to server"
          </li>
          <li>
            <strong>Automatic sync</strong>: Directive detects unsynced changes
            and triggers sync resolver
          </li>
          <li>
            <strong>Inventory validation</strong>: Directive fetches inventory
            on startup
          </li>
          <li>
            <strong>Retry on failure</strong>: If sync fails, constraint stays
            active → will retry
          </li>
        </ul>
      </div>
    </div>
  );
}

export default ShoppingCartApp;
