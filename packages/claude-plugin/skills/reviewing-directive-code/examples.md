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
