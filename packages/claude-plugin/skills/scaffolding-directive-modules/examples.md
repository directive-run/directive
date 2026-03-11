# Examples

> Auto-generated from extracted examples. Do not edit manually.

## counter

```typescript
// Example: counter
// Source: examples/counter/src/module.ts
// Pure module file — no DOM wiring

/**
 * Number Match — Directive Module
 *
 * Types, schema, helpers, module definition, timeline, and system creation
 * for a tile-matching game where pairs must add to 10.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";

// ============================================================================
// Types
// ============================================================================

export interface Tile {
  id: string;
  value: number;
}

export interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: string;
}

// ============================================================================
// Helpers
// ============================================================================

// Create a pool of numbered tiles (1-9, four of each = 36 tiles)
function createPool(): Tile[] {
  const tiles: Tile[] = [];
  let id = 0;
  for (let copy = 0; copy < 4; copy++) {
    for (let value = 1; value <= 9; value++) {
      tiles.push({ id: `t${id++}`, value });
    }
  }
  // Shuffle
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }

  return tiles;
}

// ============================================================================
// Timeline
// ============================================================================

export const timeline: TimelineEntry[] = [];

export function addLog(msg: string) {
  console.log(`[NumberMatch] ${msg}`);

  // Classify and add significant events to the timeline
  let event = "";
  let detail = "";
  let type = "info";

  if (msg.startsWith("EVENT selectTile")) {
    event = "tile selected";
    const match = msg.match(/selectTile: (t\d+)/);
    detail = match ? match[1] : "";
    type = "selection";
  } else if (msg.includes("pairAddsTen: TRUE")) {
    event = "match found";
    const match = msg.match(/\((.+)\)/);
    detail = match ? match[1] : "";
    type = "match";
  } else if (msg === "RESOLVER removeTiles: DONE") {
    event = "tiles removed";
    detail = "";
    type = "match";
  } else if (msg.includes("refillTable: DONE")) {
    event = "refill";
    const match = msg.match(/table now: (\d+)/);
    detail = match ? `table: ${match[1]} tiles` : "";
    type = "refill";
  } else if (msg.startsWith("RESOLVER endGame:")) {
    event = "game over";
    detail = msg.replace("RESOLVER endGame: ", "");
    type = "gameover";
  } else if (msg.includes("New game") || msg.includes("Game started")) {
    event = "new game";
    detail = msg;
    type = "newgame";
  } else {
    // Skip verbose intermediate messages (RESOLVER steps, CONSTRAINT produce)
    return;
  }

  timeline.unshift({ time: Date.now(), event, detail, type });
}

// ============================================================================
// Schema
// ============================================================================

export const schema = {
  facts: {
    pool: t.array<Tile>(),
    table: t.array<Tile>(),
    removed: t.array<Tile>(),
    selected: t.array<string>(),
    message: t.string(),
    moveCount: t.number(),
    gameOver: t.boolean(),
  },
  derivations: {
    poolCount: t.number(),
    removedCount: t.number(),
    selectedTiles: t.array<Tile>(),
    hasValidMoves: t.boolean(),
  },
  events: {
    newGame: {},
    selectTile: { tileId: t.string() },
    deselectTile: { tileId: t.string() },
    clearSelection: {},
  },
  requirements: {
    REMOVE_TILES: { tileIds: t.array<string>() },
    REFILL_TABLE: { count: t.number() },
    END_GAME: { reason: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

const numberMatch = createModule("number-match", {
  schema,

  init: (facts) => {
    const pool = createPool();
    facts.pool = pool.slice(9);
    facts.table = pool.slice(0, 9);
    facts.removed = [];
    facts.selected = [];
    facts.message = "Select two numbers that add to 10";
    facts.moveCount = 0;
    facts.gameOver = false;
  },

  derive: {
    poolCount: (facts) => facts.pool.length,
    removedCount: (facts) => facts.removed.length,
    selectedTiles: (facts) =>
      facts.table.filter((tile: Tile) => facts.selected.includes(tile.id)),
    hasValidMoves: (facts) => {
      const nums = facts.table.map((t: Tile) => t.value);
      for (let i = 0; i < nums.length; i++) {
        for (let j = i + 1; j < nums.length; j++) {
          if (nums[i] + nums[j] === 10) {
            return true;
          }
        }
      }

      return false;
    },
  },

  events: {
    newGame: (facts) => {
      const pool = createPool();
      facts.pool = pool.slice(9);
      facts.table = pool.slice(0, 9);
      facts.removed = [];
      facts.selected = [];
      facts.message = "New game! Select two numbers that add to 10";
      facts.moveCount = 0;
      facts.gameOver = false;
    },
    selectTile: (facts, { tileId }) => {
      if (!facts.selected.includes(tileId) && !facts.gameOver) {
        facts.selected = [...facts.selected, tileId];
        addLog(
          `EVENT selectTile: ${tileId}, selected now: [${facts.selected}]`,
        );
      }
    },
    deselectTile: (facts, { tileId }) => {
      facts.selected = facts.selected.filter((id: string) => id !== tileId);
    },
    clearSelection: (facts) => {
      facts.selected = [];
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================
  constraints: {
    // When two selected tiles add to 10 -> remove them
    pairAddsTen: {
      priority: 100,
      when: (facts) => {
        if (facts.gameOver) {
          return false;
        }
        const selected = facts.table.filter((tile: Tile) =>
          facts.selected.includes(tile.id),
        );
        if (selected.length !== 2) {
          return false;
        }
        const result = selected[0].value + selected[1].value === 10;
        if (result) {
          addLog(
            `CONSTRAINT pairAddsTen: TRUE (${selected[0].value} + ${selected[1].value})`,
          );
        }

        return result;
      },
      require: (facts) => {
        addLog("CONSTRAINT pairAddsTen: producing REMOVE_TILES");

        return {
          type: "REMOVE_TILES",
          tileIds: [...facts.selected],
        };
      },
    },

    // Refill table when tiles are removed
    refillTable: {
      priority: 50,
      when: (facts) => {
        const result =
          !facts.gameOver && facts.table.length < 9 && facts.pool.length > 0;
        if (result) {
          addLog(
            `CONSTRAINT refillTable: TRUE (table: ${facts.table.length}, pool: ${facts.pool.length})`,
          );
        }

        return result;
      },
      require: (facts) => {
        const count = Math.min(9 - facts.table.length, facts.pool.length);
        addLog(`CONSTRAINT refillTable: producing REFILL_TABLE count=${count}`);

        return { type: "REFILL_TABLE", count };
      },
    },

    // No moves left -> game over
    noMovesLeft: {
      priority: 190,
      when: (facts) => {
        if (facts.gameOver) {
          return false;
        }
        if (facts.table.length === 0) {
          return false;
        }
        if (facts.pool.length > 0) {
          return false;
        }
        const nums = facts.table.map((t: Tile) => t.value);
        for (let i = 0; i < nums.length; i++) {
          for (let j = i + 1; j < nums.length; j++) {
            if (nums[i] + nums[j] === 10) {
              return false;
            }
          }
        }
        addLog("CONSTRAINT noMovesLeft: TRUE");

        return true;
      },
      require: (facts) => ({
        type: "END_GAME",
        reason: `Game over! Removed ${facts.removed.length} of 36 tiles.`,
      }),
    },

    // Win condition
    allCleared: {
      priority: 200,
      when: (facts) => {
        const result =
          !facts.gameOver &&
          facts.table.length === 0 &&
          facts.pool.length === 0;
        if (result) {
          addLog("CONSTRAINT allCleared: TRUE");
        }

        return result;
      },
      require: (facts) => ({
        type: "END_GAME",
        reason: `You win! Cleared all tiles in ${facts.moveCount} moves!`,
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================
  resolvers: {
    removeTiles: {
      requirement: "REMOVE_TILES",
      resolve: async (req, context) => {
        addLog("RESOLVER removeTiles: START");
        const tilesToRemove = context.facts.table.filter((tile: Tile) =>
          req.tileIds.includes(tile.id),
        );

        // Multiple fact mutations
        addLog("RESOLVER removeTiles: setting table");
        context.facts.table = context.facts.table.filter(
          (tile: Tile) => !req.tileIds.includes(tile.id),
        );
        addLog("RESOLVER removeTiles: setting removed");
        context.facts.removed = [...context.facts.removed, ...tilesToRemove];
        addLog("RESOLVER removeTiles: clearing selected");
        context.facts.selected = [];
        addLog("RESOLVER removeTiles: incrementing moveCount");
        context.facts.moveCount++;
        addLog("RESOLVER removeTiles: setting message");
        context.facts.message = `Removed ${tilesToRemove[0].value} + ${tilesToRemove[1].value} = 10!`;
        addLog("RESOLVER removeTiles: DONE");
      },
    },

    refillTable: {
      requirement: "REFILL_TABLE",
      resolve: async (req, context) => {
        addLog(`RESOLVER refillTable: START (count: ${req.count})`);
        const newTiles = context.facts.pool.slice(0, req.count);
        context.facts.pool = context.facts.pool.slice(req.count);
        context.facts.table = [...context.facts.table, ...newTiles];
        addLog(
          `RESOLVER refillTable: DONE (table now: ${context.facts.table.length})`,
        );
      },
    },

    endGame: {
      requirement: "END_GAME",
      resolve: async (req, context) => {
        addLog(`RESOLVER endGame: ${req.reason}`);
        context.facts.gameOver = true;
        context.facts.message = req.reason;
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  module: numberMatch,
  plugins: [devtoolsPlugin({ name: "number-match" })],
  history: true,
  trace: true,
});
```

## auth-flow

```typescript
// Example: auth-flow
// Source: examples/auth-flow/src/auth-flow.ts
// Pure module file — no DOM wiring

/**
 * Auth Flow — Directive Module
 *
 * Demonstrates constraint `after` ordering, auto-tracked derivations
 * driving constraints, resolvers with retry, effects for cleanup,
 * and time-based reactivity (token expiry countdown).
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import {
  type User,
  mockFetchUser,
  mockLogin,
  mockRefresh,
} from "./mock-auth.js";

// ============================================================================
// Types
// ============================================================================

export type AuthStatus =
  | "idle"
  | "authenticating"
  | "authenticated"
  | "refreshing"
  | "expired";

export interface EventLogEntry {
  timestamp: number;
  event: string;
  detail: string;
}

// ============================================================================
// Schema
// ============================================================================

export const authFlowSchema = {
  facts: {
    email: t.string(),
    password: t.string(),
    token: t.string(),
    refreshToken: t.string(),
    expiresAt: t.number(),
    user: t.object<User | null>(),
    status: t.string<AuthStatus>(),
    loginRequested: t.boolean(),
    now: t.number(),
    tokenTTL: t.number(),
    refreshBuffer: t.number(),
    loginFailRate: t.number(),
    refreshFailRate: t.number(),
    eventLog: t.array<EventLogEntry>(),
  },
  derivations: {
    isAuthenticated: t.boolean(),
    isExpiringSoon: t.boolean(),
    canRefresh: t.boolean(),
    tokenTimeRemaining: t.number(),
    canLogin: t.boolean(),
  },
  events: {
    setEmail: { value: t.string() },
    setPassword: { value: t.string() },
    requestLogin: {},
    logout: {},
    forceExpire: {},
    setTokenTTL: { value: t.number() },
    setRefreshBuffer: { value: t.number() },
    setLoginFailRate: { value: t.number() },
    setRefreshFailRate: { value: t.number() },
    tick: {},
  },
  requirements: {
    LOGIN: { email: t.string(), password: t.string() },
    REFRESH_TOKEN: { refreshToken: t.string() },
    FETCH_USER: { token: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Helpers
// ============================================================================

function addLogEntry(facts: any, event: string, detail: string): void {
  const log = [...facts.eventLog];
  log.push({ timestamp: Date.now(), event, detail });
  facts.eventLog = log;
}

// ============================================================================
// Module
// ============================================================================

export const authFlowModule = createModule("auth-flow", {
  schema: authFlowSchema,

  init: (facts) => {
    facts.email = "alice@test.com";
    facts.password = "password";
    facts.token = "";
    facts.refreshToken = "";
    facts.expiresAt = 0;
    facts.user = null;
    facts.status = "idle";
    facts.loginRequested = false;
    facts.now = Date.now();
    facts.tokenTTL = 30;
    facts.refreshBuffer = 5;
    facts.loginFailRate = 0;
    facts.refreshFailRate = 0;
    facts.eventLog = [];
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    isAuthenticated: (facts) => facts.status === "authenticated",

    isExpiringSoon: (facts) => {
      if (facts.token === "") {
        return false;
      }

      return facts.now > facts.expiresAt - facts.refreshBuffer * 1000;
    },

    canRefresh: (facts) => {
      return facts.refreshToken !== "" && facts.status !== "refreshing";
    },

    tokenTimeRemaining: (facts) => {
      if (facts.token === "") {
        return 0;
      }

      return Math.max(0, Math.round((facts.expiresAt - facts.now) / 1000));
    },

    canLogin: (facts) => {
      return (
        facts.email.trim() !== "" &&
        facts.password.trim() !== "" &&
        (facts.status === "idle" || facts.status === "expired")
      );
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    setEmail: (facts, { value }) => {
      facts.email = value;
    },

    setPassword: (facts, { value }) => {
      facts.password = value;
    },

    requestLogin: (facts) => {
      facts.loginRequested = true;
      facts.status = "authenticating";
      facts.token = "";
      facts.refreshToken = "";
      facts.expiresAt = 0;
      facts.user = null;
      facts.eventLog = [];
    },

    logout: (facts) => {
      facts.token = "";
      facts.refreshToken = "";
      facts.expiresAt = 0;
      facts.user = null;
      facts.status = "idle";
      facts.loginRequested = false;
    },

    forceExpire: (facts) => {
      facts.expiresAt = 0;
    },

    setTokenTTL: (facts, { value }) => {
      facts.tokenTTL = value;
    },

    setRefreshBuffer: (facts, { value }) => {
      facts.refreshBuffer = value;
    },

    setLoginFailRate: (facts, { value }) => {
      facts.loginFailRate = value;
    },

    setRefreshFailRate: (facts, { value }) => {
      facts.refreshFailRate = value;
    },

    tick: (facts) => {
      facts.now = Date.now();
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    needsLogin: {
      priority: 100,
      when: (facts) => {
        return facts.loginRequested && facts.status === "authenticating";
      },
      require: (facts) => ({
        type: "LOGIN",
        email: facts.email,
        password: facts.password,
      }),
    },

    refreshNeeded: {
      priority: 90,
      when: (facts) => {
        const isExpiringSoon =
          facts.token !== "" &&
          facts.now > facts.expiresAt - facts.refreshBuffer * 1000;
        const canRefresh =
          facts.refreshToken !== "" && facts.status !== "refreshing";

        return isExpiringSoon && canRefresh && facts.status === "authenticated";
      },
      require: (facts) => ({
        type: "REFRESH_TOKEN",
        refreshToken: facts.refreshToken,
      }),
    },

    needsUser: {
      priority: 80,
      after: ["refreshNeeded"],
      when: (facts) => {
        return (
          facts.token !== "" &&
          facts.user === null &&
          facts.status !== "authenticating"
        );
      },
      require: (facts) => ({
        type: "FETCH_USER",
        token: facts.token,
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    login: {
      requirement: "LOGIN",
      timeout: 10000,
      resolve: async (req, context) => {
        addLogEntry(context.facts, "login", "Authenticating...");

        try {
          const tokens = await mockLogin(
            req.email,
            req.password,
            context.facts.loginFailRate,
            context.facts.tokenTTL,
          );
          context.facts.token = tokens.token;
          context.facts.refreshToken = tokens.refreshToken;
          context.facts.expiresAt = Date.now() + tokens.expiresIn * 1000;
          context.facts.status = "authenticated";
          context.facts.user = null; // trigger needsUser constraint
          addLogEntry(
            context.facts,
            "login-success",
            `Token: ${tokens.token.slice(0, 12)}...`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          context.facts.status = "idle";
          context.facts.loginRequested = false;
          addLogEntry(context.facts, "login-error", msg);
          throw err;
        }
      },
    },

    refreshToken: {
      requirement: "REFRESH_TOKEN",
      retry: { attempts: 2, backoff: "exponential" },
      timeout: 10000,
      resolve: async (req, context) => {
        context.facts.status = "refreshing";
        addLogEntry(context.facts, "refresh", "Refreshing token...");

        try {
          const tokens = await mockRefresh(
            req.refreshToken,
            context.facts.refreshFailRate,
            context.facts.tokenTTL,
          );
          context.facts.token = tokens.token;
          context.facts.refreshToken = tokens.refreshToken;
          context.facts.expiresAt = Date.now() + tokens.expiresIn * 1000;
          context.facts.status = "authenticated";
          addLogEntry(
            context.facts,
            "refresh-success",
            `New token: ${tokens.token.slice(0, 12)}...`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          context.facts.token = "";
          context.facts.refreshToken = "";
          context.facts.expiresAt = 0;
          context.facts.status = "expired";
          addLogEntry(context.facts, "refresh-error", msg);
          throw err;
        }
      },
    },

    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, context) => {
        addLogEntry(context.facts, "fetch-user", "Fetching user profile...");

        try {
          const user = await mockFetchUser(req.token);
          context.facts.user = user;
          addLogEntry(
            context.facts,
            "fetch-user-success",
            `${user.name} (${user.role})`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          addLogEntry(context.facts, "fetch-user-error", msg);
        }
      },
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    logStatusChange: {
      deps: ["status"],
      run: (facts, prev) => {
        if (prev && prev.status !== facts.status) {
          addLogEntry(facts, "status", `${prev.status} → ${facts.status}`);
        }
      },
    },
  },
});
```

## shopping-cart

```typescript
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
  history: { maxSnapshots: 50 },
  trace: true,
});
```

## dashboard-loader

```typescript
// Example: dashboard-loader
// Source: examples/dashboard-loader/src/dashboard-loader.ts
// Pure module file — no DOM wiring

/**
 * Dashboard Loader — Directive Module
 *
 * Demonstrates loading & error states with concurrent resource fetching,
 * configurable delays/failure rates, retry with exponential backoff,
 * and combined status derivations.
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import {
  type Permissions,
  type Preferences,
  type Profile,
  fetchMockPermissions,
  fetchMockPreferences,
  fetchMockProfile,
} from "./mock-api.js";

// ============================================================================
// Types
// ============================================================================

export type ResourceStatus = "idle" | "loading" | "success" | "error";

export interface ResourceState<T> {
  data: T | null;
  status: ResourceStatus;
  error: string | null;
  attempts: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface EventLogEntry {
  timestamp: number;
  event: string;
  resource: string;
  detail: string;
}

function makeIdleResource<T>(): ResourceState<T> {
  return {
    data: null,
    status: "idle",
    error: null,
    attempts: 0,
    startedAt: null,
    completedAt: null,
  };
}

// ============================================================================
// Schema
// ============================================================================

export const dashboardLoaderSchema = {
  facts: {
    userId: t.string(),
    profile: t.object<ResourceState<Profile>>(),
    preferences: t.object<ResourceState<Preferences>>(),
    permissions: t.object<ResourceState<Permissions>>(),
    profileDelay: t.number(),
    preferencesDelay: t.number(),
    permissionsDelay: t.number(),
    profileFailRate: t.number(),
    preferencesFailRate: t.number(),
    permissionsFailRate: t.number(),
    loadRequested: t.boolean(),
    eventLog: t.array<EventLogEntry>(),
  },
  derivations: {
    loadedCount: t.number(),
    totalResources: t.number(),
    allLoaded: t.boolean(),
    anyError: t.boolean(),
    anyLoading: t.boolean(),
    combinedStatus: t.string(),
    canStart: t.boolean(),
  },
  events: {
    setUserId: { value: t.string() },
    start: {},
    retryResource: { resource: t.string() },
    reloadAll: {},
    setDelay: { resource: t.string(), value: t.number() },
    setFailRate: { resource: t.string(), value: t.number() },
  },
  requirements: {
    FETCH_PROFILE: { userId: t.string() },
    FETCH_PREFERENCES: { userId: t.string() },
    FETCH_PERMISSIONS: { userId: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Helpers
// ============================================================================

function addLogEntry(
  facts: any,
  event: string,
  resource: string,
  detail: string,
): void {
  const log = [...facts.eventLog];
  log.push({ timestamp: Date.now(), event, resource, detail });
  facts.eventLog = log;
}

// ============================================================================
// Module
// ============================================================================

export const dashboardLoaderModule = createModule("dashboard-loader", {
  schema: dashboardLoaderSchema,

  init: (facts) => {
    facts.userId = "";
    facts.profile = makeIdleResource<Profile>();
    facts.preferences = makeIdleResource<Preferences>();
    facts.permissions = makeIdleResource<Permissions>();
    facts.profileDelay = 1000;
    facts.preferencesDelay = 1500;
    facts.permissionsDelay = 2000;
    facts.profileFailRate = 0;
    facts.preferencesFailRate = 0;
    facts.permissionsFailRate = 0;
    facts.loadRequested = false;
    facts.eventLog = [];
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    loadedCount: (facts) => {
      const resources = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ] as ResourceState<unknown>[];

      return resources.filter((r) => r.status === "success").length;
    },

    totalResources: () => 3,

    allLoaded: (facts) => {
      const resources = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ] as ResourceState<unknown>[];

      return resources.every((r) => r.status === "success");
    },

    anyError: (facts) => {
      const resources = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ] as ResourceState<unknown>[];

      return resources.some((r) => r.status === "error");
    },

    anyLoading: (facts) => {
      const resources = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ] as ResourceState<unknown>[];

      return resources.some((r) => r.status === "loading");
    },

    combinedStatus: (facts, derived) => {
      const loaded = derived.loadedCount;
      const anyErr = derived.anyError;
      const anyLoad = derived.anyLoading;
      const allIdle = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ].every((r: any) => r.status === "idle");

      if (allIdle) {
        return "Not started";
      }

      const errCount = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ].filter((r: any) => r.status === "error").length;

      if (anyLoad) {
        return `Loading ${loaded} of 3...`;
      }

      if (anyErr && loaded > 0) {
        return `${errCount} failed, ${loaded} loaded`;
      }

      if (anyErr) {
        return `${errCount} failed`;
      }

      return "All loaded";
    },

    canStart: (facts) => {
      const id = facts.userId.trim();
      const allIdle = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ].every((r: any) => r.status === "idle");

      return id.length > 0 && allIdle;
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    setUserId: (facts, { value }) => {
      facts.userId = value;
    },

    start: (facts) => {
      const id = facts.userId.trim();
      if (id.length === 0) {
        return;
      }

      // Reset all resources to idle so constraints re-fire
      facts.profile = makeIdleResource<Profile>();
      facts.preferences = makeIdleResource<Preferences>();
      facts.permissions = makeIdleResource<Permissions>();
      facts.loadRequested = true;
      facts.eventLog = [];
    },

    retryResource: (facts, { resource }) => {
      const res = (facts as any)[resource] as ResourceState<unknown>;
      if (!res || res.status !== "error") {
        return;
      }

      (facts as any)[resource] = {
        ...res,
        status: "idle",
        error: null,
      };
    },

    reloadAll: (facts) => {
      facts.profile = makeIdleResource<Profile>();
      facts.preferences = makeIdleResource<Preferences>();
      facts.permissions = makeIdleResource<Permissions>();
      facts.eventLog = [];
    },

    setDelay: (facts, { resource, value }) => {
      const key = `${resource}Delay` as keyof typeof facts;
      if (key in facts) {
        (facts as any)[key] = value;
      }
    },

    setFailRate: (facts, { resource, value }) => {
      const key = `${resource}FailRate` as keyof typeof facts;
      if (key in facts) {
        (facts as any)[key] = value;
      }
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    needsProfile: {
      priority: 100,
      when: (facts) => {
        const id = facts.userId.trim();
        const profile = facts.profile;

        return facts.loadRequested && id !== "" && profile.status === "idle";
      },
      require: (facts) => ({
        type: "FETCH_PROFILE",
        userId: facts.userId.trim(),
      }),
    },

    needsPreferences: {
      priority: 90,
      when: (facts) => {
        const id = facts.userId.trim();
        const prefs = facts.preferences;

        return facts.loadRequested && id !== "" && prefs.status === "idle";
      },
      require: (facts) => ({
        type: "FETCH_PREFERENCES",
        userId: facts.userId.trim(),
      }),
    },

    needsPermissions: {
      priority: 80,
      when: (facts) => {
        const id = facts.userId.trim();
        const perms = facts.permissions;

        return facts.loadRequested && id !== "" && perms.status === "idle";
      },
      require: (facts) => ({
        type: "FETCH_PERMISSIONS",
        userId: facts.userId.trim(),
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    fetchProfile: {
      requirement: "FETCH_PROFILE",
      retry: { attempts: 3, backoff: "exponential" },
      timeout: 10000,
      resolve: async (req, context) => {
        const prev = context.facts.profile;
        context.facts.profile = {
          ...prev,
          status: "loading",
          attempts: prev.attempts + 1,
          startedAt: prev.startedAt ?? Date.now(),
        };
        addLogEntry(
          context.facts,
          "loading",
          "profile",
          `Attempt ${prev.attempts + 1}`,
        );

        try {
          const data = await fetchMockProfile(
            req.userId,
            context.facts.profileDelay,
            context.facts.profileFailRate,
          );
          context.facts.profile = {
            data,
            status: "success",
            error: null,
            attempts: context.facts.profile.attempts,
            startedAt: context.facts.profile.startedAt,
            completedAt: Date.now(),
          };
          addLogEntry(context.facts, "success", "profile", data.name);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          context.facts.profile = {
            ...context.facts.profile,
            status: "error",
            error: msg,
            completedAt: Date.now(),
          };
          addLogEntry(context.facts, "error", "profile", msg);
          throw err;
        }
      },
    },

    fetchPreferences: {
      requirement: "FETCH_PREFERENCES",
      retry: { attempts: 2, backoff: "exponential" },
      resolve: async (req, context) => {
        const prev = context.facts.preferences;
        context.facts.preferences = {
          ...prev,
          status: "loading",
          attempts: prev.attempts + 1,
          startedAt: prev.startedAt ?? Date.now(),
        };
        addLogEntry(
          context.facts,
          "loading",
          "preferences",
          `Attempt ${prev.attempts + 1}`,
        );

        try {
          const data = await fetchMockPreferences(
            req.userId,
            context.facts.preferencesDelay,
            context.facts.preferencesFailRate,
          );
          context.facts.preferences = {
            data,
            status: "success",
            error: null,
            attempts: context.facts.preferences.attempts,
            startedAt: context.facts.preferences.startedAt,
            completedAt: Date.now(),
          };
          addLogEntry(
            context.facts,
            "success",
            "preferences",
            `${data.theme} / ${data.locale}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          context.facts.preferences = {
            ...context.facts.preferences,
            status: "error",
            error: msg,
            completedAt: Date.now(),
          };
          addLogEntry(context.facts, "error", "preferences", msg);
          throw err;
        }
      },
    },

    fetchPermissions: {
      requirement: "FETCH_PERMISSIONS",
      retry: { attempts: 3, backoff: "exponential" },
      timeout: 15000,
      resolve: async (req, context) => {
        const prev = context.facts.permissions;
        context.facts.permissions = {
          ...prev,
          status: "loading",
          attempts: prev.attempts + 1,
          startedAt: prev.startedAt ?? Date.now(),
        };
        addLogEntry(
          context.facts,
          "loading",
          "permissions",
          `Attempt ${prev.attempts + 1}`,
        );

        try {
          const data = await fetchMockPermissions(
            req.userId,
            context.facts.permissionsDelay,
            context.facts.permissionsFailRate,
          );
          context.facts.permissions = {
            data,
            status: "success",
            error: null,
            attempts: context.facts.permissions.attempts,
            startedAt: context.facts.permissions.startedAt,
            completedAt: Date.now(),
          };
          addLogEntry(
            context.facts,
            "success",
            "permissions",
            `${data.role} (${data.features.join(", ")})`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          context.facts.permissions = {
            ...context.facts.permissions,
            status: "error",
            error: msg,
            completedAt: Date.now(),
          };
          addLogEntry(context.facts, "error", "permissions", msg);
          throw err;
        }
      },
    },
  },
});
```
