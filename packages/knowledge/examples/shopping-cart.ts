// Example: shopping-cart
// Source: examples/shopping-cart/src/shopping-cart.ts
// Pure module file — no DOM wiring

/**
 * Shopping Cart — Directive Modules
 *
 * Two modules:
 * - cart: Items, coupons, checkout with cross-module auth dependency
 * - auth: Simple authentication toggle for demo purposes
 *
 * Demonstrates cross-module constraints (`crossModuleDeps`),
 * constraint ordering (`after`), priority-based resolution,
 * and retry with exponential backoff.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import { processCheckout, validateCoupon } from "./mock-api.js";

// ============================================================================
// Types
// ============================================================================

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  maxStock: number;
  image: string;
}

// ============================================================================
// Auth Module
// ============================================================================

export const authSchema = {
  facts: {
    isAuthenticated: t.boolean(),
    userName: t.string(),
  },
  derivations: {
    isAuthenticated: t.boolean(),
  },
  events: {
    toggleAuth: {},
  },
  requirements: {},
} satisfies ModuleSchema;

export const authModule = createModule("auth", {
  schema: authSchema,

  init: (facts) => {
    facts.isAuthenticated = true;
    facts.userName = "Demo User";
  },

  derive: {
    isAuthenticated: (facts) => facts.isAuthenticated,
  },

  events: {
    toggleAuth: (facts) => {
      facts.isAuthenticated = !facts.isAuthenticated;
      if (!facts.isAuthenticated) {
        facts.userName = "";
      } else {
        facts.userName = "Demo User";
      }
    },
  },
});

// ============================================================================
// Cart Module
// ============================================================================

export const cartSchema = {
  facts: {
    items: t.array<CartItem>(),
    couponCode: t.string(),
    couponDiscount: t.number(),
    couponStatus: t.string<"idle" | "checking" | "valid" | "invalid">(),
    checkoutRequested: t.boolean(),
    checkoutStatus: t.string<"idle" | "processing" | "complete" | "failed">(),
    checkoutError: t.string(),
  },
  derivations: {
    subtotal: t.number(),
    itemCount: t.number(),
    isEmpty: t.boolean(),
    discount: t.number(),
    tax: t.number(),
    total: t.number(),
    hasOverstockedItem: t.boolean(),
    freeShipping: t.boolean(),
  },
  events: {
    addItem: {
      id: t.string(),
      name: t.string(),
      price: t.number(),
      maxStock: t.number(),
      image: t.string(),
    },
    removeItem: { id: t.string() },
    updateQuantity: { id: t.string(), quantity: t.number() },
    applyCoupon: { code: t.string() },
    clearCoupon: {},
    requestCheckout: {},
    resetCheckout: {},
  },
  requirements: {
    ADJUST_QUANTITY: {},
    VALIDATE_COUPON: { code: t.string() },
    PROCESS_CHECKOUT: {},
  },
} satisfies ModuleSchema;

export const cartModule = createModule("cart", {
  schema: cartSchema,

  crossModuleDeps: { auth: authSchema },

  init: (facts) => {
    facts.items = [
      {
        id: "headphones-1",
        name: "Wireless Headphones",
        price: 79.99,
        quantity: 1,
        maxStock: 5,
        image: "headphones",
      },
      {
        id: "keyboard-1",
        name: "Mechanical Keyboard",
        price: 129.99,
        quantity: 1,
        maxStock: 3,
        image: "keyboard",
      },
      {
        id: "hub-1",
        name: "USB-C Hub",
        price: 49.99,
        quantity: 2,
        maxStock: 10,
        image: "hub",
      },
    ];
    facts.couponCode = "";
    facts.couponDiscount = 0;
    facts.couponStatus = "idle";
    facts.checkoutRequested = false;
    facts.checkoutStatus = "idle";
    facts.checkoutError = "";
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    subtotal: (facts) => {
      return facts.self.items.reduce(
        (sum: number, item: CartItem) => sum + item.price * item.quantity,
        0,
      );
    },

    itemCount: (facts) => {
      return facts.self.items.reduce(
        (sum: number, item: CartItem) => sum + item.quantity,
        0,
      );
    },

    isEmpty: (facts) => {
      return facts.self.items.length === 0;
    },

    discount: (facts, derived) => {
      const sub = derived.subtotal;

      return sub * (facts.self.couponDiscount / 100);
    },

    tax: (facts, derived) => {
      const sub = derived.subtotal;
      const disc = derived.discount;

      return (sub - disc) * 0.08;
    },

    total: (_facts, derived) => {
      const sub = derived.subtotal;
      const disc = derived.discount;
      const tx = derived.tax;

      return sub - disc + tx;
    },

    hasOverstockedItem: (facts) => {
      return facts.self.items.some(
        (item: CartItem) => item.quantity > item.maxStock,
      );
    },

    freeShipping: (_facts, derived) => {
      const sub = derived.subtotal;

      return sub >= 75;
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    addItem: (facts, { id, name, price, maxStock, image }) => {
      const existing = facts.items.find((item: CartItem) => item.id === id);
      if (existing) {
        facts.items = facts.items.map((item: CartItem) =>
          item.id === id
            ? { ...item, quantity: Math.min(item.quantity + 1, item.maxStock) }
            : item,
        );
      } else {
        facts.items = [
          ...facts.items,
          { id, name, price, quantity: 1, maxStock, image },
        ];
      }
    },

    removeItem: (facts, { id }) => {
      facts.items = facts.items.filter((item: CartItem) => item.id !== id);
    },

    updateQuantity: (facts, { id, quantity }) => {
      if (quantity <= 0) {
        facts.items = facts.items.filter((item: CartItem) => item.id !== id);

        return;
      }

      facts.items = facts.items.map((item: CartItem) =>
        item.id === id ? { ...item, quantity } : item,
      );
    },

    applyCoupon: (facts, { code }) => {
      facts.couponCode = code;
      facts.couponStatus = "idle";
      facts.couponDiscount = 0;
    },

    clearCoupon: (facts) => {
      facts.couponCode = "";
      facts.couponDiscount = 0;
      facts.couponStatus = "idle";
    },

    requestCheckout: (facts) => {
      facts.checkoutRequested = true;
      facts.checkoutStatus = "idle";
      facts.checkoutError = "";
    },

    resetCheckout: (facts) => {
      facts.checkoutRequested = false;
      facts.checkoutStatus = "idle";
      facts.checkoutError = "";
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    quantityLimit: {
      priority: 80,
      when: (facts) => {
        const hasOverstocked = facts.self.items.some(
          (item: CartItem) => item.quantity > item.maxStock,
        );

        return hasOverstocked;
      },
      require: { type: "ADJUST_QUANTITY" },
    },

    couponValidation: {
      priority: 70,
      when: (facts) => {
        return (
          facts.self.couponCode !== "" && facts.self.couponStatus === "idle"
        );
      },
      require: (facts) => ({
        type: "VALIDATE_COUPON",
        code: facts.self.couponCode,
      }),
    },

    checkoutReady: {
      priority: 60,
      after: ["quantityLimit", "couponValidation"],
      when: (facts) => {
        const items = facts.self.items;
        const notEmpty = items.length > 0;
        const noOverstock = !items.some(
          (item: CartItem) => item.quantity > item.maxStock,
        );

        return (
          facts.self.checkoutRequested === true &&
          notEmpty &&
          noOverstock &&
          facts.auth.isAuthenticated === true
        );
      },
      require: { type: "PROCESS_CHECKOUT" },
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    adjustQuantity: {
      requirement: "ADJUST_QUANTITY",
      resolve: async (_req, context) => {
        context.facts.items = context.facts.items.map((item: CartItem) => {
          if (item.quantity > item.maxStock) {
            return { ...item, quantity: item.maxStock };
          }

          return item;
        });
      },
    },

    validateCoupon: {
      requirement: "VALIDATE_COUPON",
      key: (req) => `coupon-${req.code}`,
      resolve: async (req, context) => {
        context.facts.couponStatus = "checking";

        const result = await validateCoupon(req.code);

        if (result.valid) {
          context.facts.couponDiscount = result.discount;
          context.facts.couponStatus = "valid";
        } else {
          context.facts.couponDiscount = 0;
          context.facts.couponStatus = "invalid";
        }
      },
    },

    processCheckout: {
      requirement: "PROCESS_CHECKOUT",
      retry: { attempts: 2, backoff: "exponential" },
      resolve: async (_req, context) => {
        context.facts.checkoutStatus = "processing";

        try {
          const items = context.facts.items.map((item: CartItem) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
          }));

          await processCheckout(items, context.facts.couponCode);

          context.facts.checkoutStatus = "complete";
          context.facts.items = [];
          context.facts.couponCode = "";
          context.facts.couponDiscount = 0;
          context.facts.couponStatus = "idle";
          context.facts.checkoutRequested = false;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Checkout failed";
          context.facts.checkoutStatus = "failed";
          context.facts.checkoutError = msg;
          context.facts.checkoutRequested = false;
          throw err;
        }
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  modules: {
    cart: cartModule,
    auth: authModule,
  },
  plugins: [devtoolsPlugin({ name: "shopping-cart", panel: true })],
  debug: {
    timeTravel: true,
    maxSnapshots: 50,
    runHistory: true,
  },
});
