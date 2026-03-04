# Examples

> Auto-generated from extracted examples. Do not edit manually.

## counter

```typescript
// Example: counter
// Source: examples/counter/src/main.ts
// Extracted for AI rules — DOM wiring stripped

/**
 * Number Match — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders the game grid and event timeline.
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

interface Tile {
  id: string;
  value: number;
}

interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: string;
}

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

const timeline: TimelineEntry[] = [];

function log(msg: string) {
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
// Schema - same structure as eleven-up
// ============================================================================

const schema = {
  facts: {
    pool: t.object<Tile[]>(),
    table: t.object<Tile[]>(),
    removed: t.object<Tile[]>(),
    selected: t.object<string[]>(),
    message: t.string(),
    moveCount: t.number(),
    gameOver: t.boolean(),
  },
  derivations: {
    poolCount: t.number(),
    removedCount: t.number(),
    selectedTiles: t.object<Tile[]>(),
    hasValidMoves: t.boolean(),
  },
  events: {
    newGame: {},
    selectTile: { tileId: t.string() },
    deselectTile: { tileId: t.string() },
    clearSelection: {},
  },
  requirements: {
    REMOVE_TILES: { tileIds: t.object<string[]>() },
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
          if (nums[i] + nums[j] === 10) return true;
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
        log(`EVENT selectTile: ${tileId}, selected now: [${facts.selected}]`);
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
  // Constraints - same pattern as eleven-up
  // ============================================================================
  constraints: {
    // When two selected tiles add to 10 -> remove them
    pairAddsTen: {
      priority: 100,
      when: (facts) => {
        if (facts.gameOver) return false;
        const selected = facts.table.filter((tile: Tile) =>
          facts.selected.includes(tile.id),
        );
        if (selected.length !== 2) return false;
        const result = selected[0].value + selected[1].value === 10;
        if (result)
          log(
            `CONSTRAINT pairAddsTen: TRUE (${selected[0].value} + ${selected[1].value})`,
          );
        return result;
      },
      require: (facts) => {
        log("CONSTRAINT pairAddsTen: producing REMOVE_TILES");
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
        if (result)
          log(
            `CONSTRAINT refillTable: TRUE (table: ${facts.table.length}, pool: ${facts.pool.length})`,
          );
        return result;
      },
      require: (facts) => {
        const count = Math.min(9 - facts.table.length, facts.pool.length);
        log(`CONSTRAINT refillTable: producing REFILL_TABLE count=${count}`);
        return { type: "REFILL_TABLE", count };
      },
    },

    // No moves left -> game over
    noMovesLeft: {
      priority: 190,
      when: (facts) => {
        if (facts.gameOver) return false;
        if (facts.table.length === 0) return false;
        if (facts.pool.length > 0) return false;
        const nums = facts.table.map((t: Tile) => t.value);
        for (let i = 0; i < nums.length; i++) {
          for (let j = i + 1; j < nums.length; j++) {
            if (nums[i] + nums[j] === 10) return false;
          }
        }
        log("CONSTRAINT noMovesLeft: TRUE");
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
        if (result) log("CONSTRAINT allCleared: TRUE");
        return result;
      },
      require: (facts) => ({
        type: "END_GAME",
        reason: `You win! Cleared all tiles in ${facts.moveCount} moves!`,
      }),
    },
  },

  // ============================================================================
  // Resolvers - same multi-fact mutation pattern as eleven-up
  // ============================================================================
  resolvers: {
    removeTiles: {
      requirement: "REMOVE_TILES",
      resolve: async (req, context) => {
        log("RESOLVER removeTiles: START");
        const tilesToRemove = context.facts.table.filter((tile: Tile) =>
          req.tileIds.includes(tile.id),
        );

        // Multiple fact mutations
        log("RESOLVER removeTiles: setting table");
        context.facts.table = context.facts.table.filter(
          (tile: Tile) => !req.tileIds.includes(tile.id),
        );
        log("RESOLVER removeTiles: setting removed");
        context.facts.removed = [...context.facts.removed, ...tilesToRemove];
        log("RESOLVER removeTiles: clearing selected");
        context.facts.selected = [];
        log("RESOLVER removeTiles: incrementing moveCount");
        context.facts.moveCount++;
        log("RESOLVER removeTiles: setting message");
        context.facts.message = `Removed ${tilesToRemove[0].value} + ${tilesToRemove[1].value} = 10!`;
        log("RESOLVER removeTiles: DONE");
      },
    },

    refillTable: {
      requirement: "REFILL_TABLE",
      resolve: async (req, context) => {
        log(`RESOLVER refillTable: START (count: ${req.count})`);
        const newTiles = context.facts.pool.slice(0, req.count);
        context.facts.pool = context.facts.pool.slice(req.count);
        context.facts.table = [...context.facts.table, ...newTiles];
        log(
          `RESOLVER refillTable: DONE (table now: ${context.facts.table.length})`,
        );
      },
    },

    endGame: {
      requirement: "END_GAME",
      resolve: async (req, context) => {
        log(`RESOLVER endGame: ${req.reason}`);
        context.facts.gameOver = true;
        context.facts.message = req.reason;
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: numberMatch,
  plugins: [devtoolsPlugin({ name: "number-match" })],
  debug: { timeTravel: true, runHistory: true },
});
system.start();

// ============================================================================
// DOM References
// ============================================================================

// Stats

// Timeline

// ============================================================================
// Render
// ============================================================================

function escapeHtml(text: string): string {

  return div.innerHTML;
}


// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(
  [
    "table",
    "selected",
    "pool",
    "removed",
    "moveCount",
    "message",
    "gameOver",
    "poolCount",
    "removedCount",
    "selectedTiles",
    "hasValidMoves",
  ],
  render,
);

// Button handlers


// Initial render
render();
log("Game started. Select two numbers that add to 10.");

// Signal to tests that initialization is complete
```

## contact-form

```typescript
// Example: contact-form
// Source: examples/contact-form/src/main.ts
// Extracted for AI rules — DOM wiring stripped

/**
 * Contact Form — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders the form and event timeline.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";

// ============================================================================
// Constants
// ============================================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MS = 10_000; // 10 seconds (shorter for demo)

// ============================================================================
// Timeline
// ============================================================================

interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: string;
}

const timeline: TimelineEntry[] = [];

function addTimelineEntry(event: string, detail: string, type: string) {
  timeline.unshift({ time: Date.now(), event, detail, type });
}

function log(msg: string) {
  console.log(`[contact-form] ${msg}`);

  // Classify and add to timeline
  if (msg.startsWith("Sending:")) {
    addTimelineEntry("submit", msg.replace("Sending: ", ""), "submit");
  } else if (msg.includes("succeeded")) {
    addTimelineEntry("success", msg, "submit");
  } else if (msg.includes("failed")) {
    addTimelineEntry("error", msg, "error");
  } else if (msg.startsWith("Status:")) {
    addTimelineEntry("status", msg.replace("Status: ", ""), "field");
  } else if (msg.includes("Auto-resetting")) {
    addTimelineEntry("auto-reset", msg, "reset");
  } else if (msg === "Form reset") {
    addTimelineEntry("reset", "Form cleared", "reset");
  } else if (msg.includes("ready")) {
    addTimelineEntry("init", msg, "field");
  }
}

// ============================================================================
// Schema
// ============================================================================

const schema = {
  facts: {
    name: t.string(),
    email: t.string(),
    subject: t.string(),
    message: t.string(),
    touched: t.object<Record<string, boolean>>(),
    status: t.string<"idle" | "submitting" | "success" | "error">(),
    errorMessage: t.string(),
    lastSubmittedAt: t.number(),
    submissionCount: t.number(),
  },
  derivations: {
    nameError: t.string(),
    emailError: t.string(),
    subjectError: t.string(),
    messageError: t.string(),
    isValid: t.boolean(),
    canSubmit: t.boolean(),
    messageCharCount: t.number(),
  },
  events: {
    updateField: { field: t.string(), value: t.string() },
    touchField: { field: t.string() },
    submit: {},
    reset: {},
  },
  requirements: {
    SEND_MESSAGE: {},
    RESET_AFTER_DELAY: {},
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================


// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: contactForm,
  plugins: [devtoolsPlugin({ name: "contact-form" })],
});
system.start();

// ============================================================================
// DOM References
// ============================================================================

// Form inputs

// Timeline

// ============================================================================
// Input Handlers
// ============================================================================

for (const [el, field] of [
  [nameInput, "name"],
  [emailInput, "email"],
  [subjectInput, "subject"],
  [messageInput, "message"],
] as const) {
}


// ============================================================================
// Render
// ============================================================================

function escapeHtml(text: string): string {

  return div.innerHTML;
}


// Subscribe to all relevant facts and derivations
system.subscribe(
  [
    "name",
    "email",
    "subject",
    "message",
    "touched",
    "status",
    "errorMessage",
    "lastSubmittedAt",
    "submissionCount",
    "nameError",
    "emailError",
    "subjectError",
    "messageError",
    "isValid",
    "canSubmit",
    "messageCharCount",
  ],
  render,
);

// Initial render
render();
log("Contact form ready. Fill in all fields and submit.");

// Signal to tests that initialization is complete
```

## newsletter

```typescript
// Example: newsletter
// Source: examples/newsletter/src/main.ts
// Extracted for AI rules — DOM wiring stripped

/**
 * Newsletter Signup - Vanilla Directive Example
 *
 * Demonstrates all six primitives with the simplest possible module:
 * - Facts: email, touched, status, errorMessage, lastSubmittedAt
 * - Derivations: emailError (touch-gated), isValid, canSubmit (rate-limited)
 * - Events: updateEmail, touchEmail, submit
 * - Constraints: subscribe (status === 'submitting'), resetAfterSuccess
 * - Resolvers: simulated async subscribe, auto-reset after delay
 * - Effects: logging status transitions
 *
 * Uses a simulated setTimeout instead of a real API so no account is needed.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";

// ============================================================================
// Constants
// ============================================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MS = 10_000; // 10 seconds (shorter for demo)

// ============================================================================
// Schema
// ============================================================================

const schema = {
  facts: {
    email: t.string(),
    touched: t.boolean(),
    status: t.string<"idle" | "submitting" | "success" | "error">(),
    errorMessage: t.string(),
    lastSubmittedAt: t.number(),
  },
  derivations: {
    emailError: t.string(),
    isValid: t.boolean(),
    canSubmit: t.boolean(),
  },
  events: {
    updateEmail: { value: t.string() },
    touchEmail: {},
    submit: {},
  },
  requirements: {
    SUBSCRIBE: {},
    RESET_AFTER_DELAY: {},
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

const newsletter = createModule("newsletter", {
  schema,

  init: (facts) => {
    facts.email = "";
    facts.touched = false;
    facts.status = "idle";
    facts.errorMessage = "";
    facts.lastSubmittedAt = 0;
  },

  derive: {
    emailError: (facts) => {
      if (!facts.touched) {
        return "";
      }
      if (!facts.email.trim()) {
        return "Email is required";
      }
      if (!EMAIL_REGEX.test(facts.email)) {
        return "Enter a valid email address";
      }

      return "";
    },

    isValid: (facts) => EMAIL_REGEX.test(facts.email),

    canSubmit: (facts, derive) => {
      if (!derive.isValid) {
        return false;
      }
      if (facts.status !== "idle") {
        return false;
      }
      if (
        facts.lastSubmittedAt > 0 &&
        Date.now() - facts.lastSubmittedAt < RATE_LIMIT_MS
      ) {
        return false;
      }

      return true;
    },
  },

  events: {
    updateEmail: (facts, { value }) => {
      facts.email = value;
    },

    touchEmail: (facts) => {
      facts.touched = true;
    },

    submit: (facts) => {
      facts.touched = true;
      facts.status = "submitting";
    },
  },

  constraints: {
    subscribe: {
      when: (facts) => facts.status === "submitting",
      require: { type: "SUBSCRIBE" },
    },

    resetAfterSuccess: {
      when: (facts) => facts.status === "success",
      require: { type: "RESET_AFTER_DELAY" },
    },
  },

  resolvers: {
    // Simulated submission — no API account needed
    subscribe: {
      requirement: "SUBSCRIBE",
      resolve: async (req, context) => {
        log(`Subscribing: ${context.facts.email}`);

        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Simulate occasional failure (20% chance)
        if (Math.random() < 0.2) {
          context.facts.status = "error";
          context.facts.errorMessage =
            "Simulated error — try again (20% failure rate for demo).";
          log("Subscription failed (simulated)");

          return;
        }

        context.facts.status = "success";
        context.facts.lastSubmittedAt = Date.now();
        log("Subscription succeeded");
      },
    },

    resetAfterDelay: {
      requirement: "RESET_AFTER_DELAY",
      resolve: async (req, context) => {
        log("Auto-resetting in 5 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
        context.facts.email = "";
        context.facts.touched = false;
        context.facts.status = "idle";
        context.facts.errorMessage = "";
        log("Form reset");
      },
    },
  },

  effects: {
    logSubscription: {
      deps: ["status"],
      run: (facts, prev) => {
        if (!prev) {
          return;
        }

        if (facts.status !== prev.status) {
          log(`Status: ${prev.status} → ${facts.status}`);
        }
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: newsletter,
  plugins: [devtoolsPlugin({ name: "newsletter" })],
});
system.start();

// ============================================================================
// Logging helper
// ============================================================================

function log(msg: string) {
  console.log(`[newsletter] ${msg}`);
}

// ============================================================================
// DOM Bindings
// ============================================================================


// ============================================================================
// Render
// ============================================================================


// Subscribe to all relevant facts and derivations
system.subscribe(
  [
    "email",
    "touched",
    "status",
    "errorMessage",
    "lastSubmittedAt",
    "emailError",
    "isValid",
    "canSubmit",
  ],
  render,
);

// Initial render
render();
log("Newsletter signup ready. Enter an email and subscribe.");
```

## feature-flags

```typescript
// Example: feature-flags
// Source: examples/feature-flags/src/module.ts
// Pure module file — no DOM wiring

/**
 * Feature Flags Directive Module (Example)
 *
 * Mirrors the real feature flag system running on directive.run.
 * 8 flags with two interaction patterns:
 *
 * 1. Maintenance mode &ndash; disables chat, search, playground, and vote API
 * 2. Onboarding toast &rarr; depends on brand switcher (constraint auto-enables)
 */
import { createModule, t } from "@directive-run/core";

export const featureFlagsModule = createModule("feature-flags", {
  schema: {
    facts: {
      // Individual feature toggles
      chatEnabled: t.boolean(),
      searchEnabled: t.boolean(),
      playgroundEnabled: t.boolean(),
      brandSwitcherEnabled: t.boolean(),
      themeSelectorEnabled: t.boolean(),
      onboardingToastEnabled: t.boolean(),
      versionSelectorEnabled: t.boolean(),
      voteApiEnabled: t.boolean(),

      // Context
      maintenanceMode: t.boolean(),
    },
    derivations: {
      canUseChat: t.boolean(),
      canUseSearch: t.boolean(),
      canUsePlayground: t.boolean(),
      canUseBrandSwitcher: t.boolean(),
      canUseThemeSelector: t.boolean(),
      canShowOnboardingToast: t.boolean(),
      canUseVersionSelector: t.boolean(),
      canUseVoteApi: t.boolean(),
      enabledCount: t.number(),
      allFeaturesEnabled: t.boolean(),
    },
    events: {
      configure: {
        chatEnabled: t.boolean(),
        searchEnabled: t.boolean(),
        playgroundEnabled: t.boolean(),
        brandSwitcherEnabled: t.boolean(),
        themeSelectorEnabled: t.boolean(),
        onboardingToastEnabled: t.boolean(),
        versionSelectorEnabled: t.boolean(),
        voteApiEnabled: t.boolean(),
      },
      setMaintenanceMode: { enabled: t.boolean() },
      toggleFlag: { flag: t.string(), enabled: t.boolean() },
      resetAll: {},
    },
    requirements: {
      ENABLE_BRAND_SWITCHER: {},
      LOG_MAINTENANCE_WARNING: {},
    },
  },

  init: (facts) => {
    facts.chatEnabled = true;
    facts.searchEnabled = true;
    facts.playgroundEnabled = true;
    facts.brandSwitcherEnabled = true;
    facts.themeSelectorEnabled = true;
    facts.onboardingToastEnabled = true;
    facts.versionSelectorEnabled = true;
    facts.voteApiEnabled = true;

    facts.maintenanceMode = false;
  },

  derive: {
    canUseChat: (facts) => facts.chatEnabled && !facts.maintenanceMode,
    canUseSearch: (facts) => facts.searchEnabled && !facts.maintenanceMode,
    canUsePlayground: (facts) =>
      facts.playgroundEnabled && !facts.maintenanceMode,
    canUseBrandSwitcher: (facts) => facts.brandSwitcherEnabled,
    canUseThemeSelector: (facts) => facts.themeSelectorEnabled,
    canShowOnboardingToast: (facts) =>
      facts.onboardingToastEnabled && facts.brandSwitcherEnabled,
    canUseVersionSelector: (facts) => facts.versionSelectorEnabled,
    canUseVoteApi: (facts) => facts.voteApiEnabled && !facts.maintenanceMode,
    enabledCount: (facts) => {
      let count = 0;
      if (facts.chatEnabled) count++;
      if (facts.searchEnabled) count++;
      if (facts.playgroundEnabled) count++;
      if (facts.brandSwitcherEnabled) count++;
      if (facts.themeSelectorEnabled) count++;
      if (facts.onboardingToastEnabled) count++;
      if (facts.versionSelectorEnabled) count++;
      if (facts.voteApiEnabled) count++;

      return count;
    },
    allFeaturesEnabled: (facts) =>
      facts.chatEnabled &&
      facts.searchEnabled &&
      facts.playgroundEnabled &&
      facts.brandSwitcherEnabled &&
      facts.themeSelectorEnabled &&
      facts.onboardingToastEnabled &&
      facts.versionSelectorEnabled &&
      facts.voteApiEnabled,
  },

  events: {
    configure: (facts, payload) => {
      facts.chatEnabled = payload.chatEnabled;
      facts.searchEnabled = payload.searchEnabled;
      facts.playgroundEnabled = payload.playgroundEnabled;
      facts.brandSwitcherEnabled = payload.brandSwitcherEnabled;
      facts.themeSelectorEnabled = payload.themeSelectorEnabled;
      facts.onboardingToastEnabled = payload.onboardingToastEnabled;
      facts.versionSelectorEnabled = payload.versionSelectorEnabled;
      facts.voteApiEnabled = payload.voteApiEnabled;
    },

    setMaintenanceMode: (facts, { enabled }) => {
      facts.maintenanceMode = enabled;
    },

    toggleFlag: (facts, { flag, enabled }) => {
      const key = flag as keyof typeof facts;
      if (key in facts && typeof facts[key] === "boolean") {
        (facts as Record<string, boolean>)[key] = enabled;
      }
    },

    resetAll: (facts) => {
      facts.chatEnabled = true;
      facts.searchEnabled = true;
      facts.playgroundEnabled = true;
      facts.brandSwitcherEnabled = true;
      facts.themeSelectorEnabled = true;
      facts.onboardingToastEnabled = true;
      facts.versionSelectorEnabled = true;
      facts.voteApiEnabled = true;
      facts.maintenanceMode = false;
    },
  },

  constraints: {
    onboardingRequiresBrandSwitcher: {
      when: (facts) =>
        facts.onboardingToastEnabled && !facts.brandSwitcherEnabled,
      require: { type: "ENABLE_BRAND_SWITCHER" },
    },

    maintenanceWarning: {
      when: (facts) => facts.maintenanceMode,
      require: { type: "LOG_MAINTENANCE_WARNING" },
    },
  },

  resolvers: {
    enableBrandSwitcher: {
      requirement: "ENABLE_BRAND_SWITCHER",
      resolve: async (req, context) => {
        context.facts.brandSwitcherEnabled = true;
      },
    },

    logMaintenanceWarning: {
      requirement: "LOG_MAINTENANCE_WARNING",
      resolve: async (req, context) => {
        console.warn(
          "[feature-flags] Maintenance mode is active. Chat, search, playground, and vote API are disabled.",
        );
      },
    },
  },

  effects: {
    logChanges: {
      deps: [
        "chatEnabled",
        "searchEnabled",
        "playgroundEnabled",
        "brandSwitcherEnabled",
        "themeSelectorEnabled",
        "onboardingToastEnabled",
        "versionSelectorEnabled",
        "voteApiEnabled",
        "maintenanceMode",
      ],
      run: (facts, prev) => {
        if (!prev) {
          return;
        }

        const flags = [
          "chatEnabled",
          "searchEnabled",
          "playgroundEnabled",
          "brandSwitcherEnabled",
          "themeSelectorEnabled",
          "onboardingToastEnabled",
          "versionSelectorEnabled",
          "voteApiEnabled",
          "maintenanceMode",
        ] as const;

        for (const flag of flags) {
          if (facts[flag] !== prev[flag]) {
            console.log(
              `[feature-flags] ${flag}: ${prev[flag]} → ${facts[flag]}`,
            );
          }
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

    discount: (facts, derive) => {
      const sub = derive.subtotal as number;

      return sub * (facts.self.couponDiscount / 100);
    },

    tax: (facts, derive) => {
      const sub = derive.subtotal as number;
      const disc = derive.discount as number;

      return (sub - disc) * 0.08;
    },

    total: (_facts, derive) => {
      const sub = derive.subtotal as number;
      const disc = derive.discount as number;
      const tx = derive.tax as number;

      return sub - disc + tx;
    },

    hasOverstockedItem: (facts) => {
      return facts.self.items.some(
        (item: CartItem) => item.quantity > item.maxStock,
      );
    },

    freeShipping: (_facts, derive) => {
      const sub = derive.subtotal as number;

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
        const items = facts.self.items as CartItem[];
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
  },
});
```

## form-wizard

```typescript
// Example: form-wizard
// Source: examples/form-wizard/src/form-wizard.ts
// Pure module file — no DOM wiring

/**
 * Form Wizard — Directive Modules
 *
 * Two-module system demonstrating multi-step form validation,
 * constraint-driven step advancement, cross-module async email
 * availability checking, and persistence of draft data.
 *
 * - wizard module: step navigation, field data, derivations for per-step
 *   validity, constraints to advance/submit, resolvers for step transitions.
 * - validation module: cross-module email availability check using
 *   crossModuleDeps on the wizard schema.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin, persistencePlugin } from "@directive-run/core/plugins";

// ============================================================================
// Types
// ============================================================================

export type PlanType = "free" | "pro" | "enterprise";

// ============================================================================
// Wizard Schema
// ============================================================================

export const wizardSchema = {
  facts: {
    currentStep: t.number(),
    totalSteps: t.number(),
    advanceRequested: t.boolean(),
    email: t.string(),
    password: t.string(),
    name: t.string(),
    company: t.string(),
    plan: t.string<PlanType>(),
    newsletter: t.boolean(),
    submitted: t.boolean(),
  },
  derivations: {
    step0Valid: t.boolean(),
    step1Valid: t.boolean(),
    step2Valid: t.boolean(),
    currentStepValid: t.boolean(),
    canAdvance: t.boolean(),
    canGoBack: t.boolean(),
    progress: t.number(),
    isLastStep: t.boolean(),
  },
  events: {
    requestAdvance: {},
    goBack: {},
    setField: { field: t.string(), value: t.object<unknown>() },
    reset: {},
  },
  requirements: {
    ADVANCE_STEP: {},
    SUBMIT_FORM: {},
  },
} satisfies ModuleSchema;

// ============================================================================
// Helpers
// ============================================================================

/** Inline step validity check for use in constraints (which only receive facts). */
function isStepValid(facts: Record<string, unknown>, step: number): boolean {
  if (step === 0) {
    return (
      (facts.email as string).includes("@") &&
      (facts.password as string).length >= 8
    );
  }
  if (step === 1) {
    return (facts.name as string).trim().length > 0;
  }
  if (step === 2) {
    return (facts.plan as string) !== "";
  }

  return false;
}

// ============================================================================
// Wizard Module
// ============================================================================

export const wizardModule = createModule("wizard", {
  schema: wizardSchema,

  init: (facts) => {
    facts.currentStep = 0;
    facts.totalSteps = 3;
    facts.advanceRequested = false;
    facts.email = "";
    facts.password = "";
    facts.name = "";
    facts.company = "";
    facts.plan = "free";
    facts.newsletter = false;
    facts.submitted = false;
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    step0Valid: (facts) => {
      return facts.email.includes("@") && facts.password.length >= 8;
    },

    step1Valid: (facts) => {
      return facts.name.trim().length > 0;
    },

    step2Valid: (facts) => {
      return facts.plan !== "";
    },

    currentStepValid: (facts, derive) => {
      if (facts.currentStep === 0) {
        return derive.step0Valid;
      }
      if (facts.currentStep === 1) {
        return derive.step1Valid;
      }
      if (facts.currentStep === 2) {
        return derive.step2Valid;
      }

      return false;
    },

    canAdvance: (facts, derive) => {
      return (
        derive.currentStepValid && facts.currentStep < facts.totalSteps - 1
      );
    },

    canGoBack: (facts) => {
      return facts.currentStep > 0;
    },

    progress: (facts) => {
      return Math.round(((facts.currentStep + 1) / facts.totalSteps) * 100);
    },

    isLastStep: (facts) => {
      return facts.currentStep === facts.totalSteps - 1;
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    requestAdvance: (facts) => {
      facts.advanceRequested = true;
    },

    goBack: (facts) => {
      if (facts.currentStep > 0) {
        facts.currentStep = facts.currentStep - 1;
      }
    },

    setField: (facts, { field, value }) => {
      (facts as Record<string, unknown>)[field] = value;
    },

    reset: (facts) => {
      facts.currentStep = 0;
      facts.advanceRequested = false;
      facts.email = "";
      facts.password = "";
      facts.name = "";
      facts.company = "";
      facts.plan = "free";
      facts.newsletter = false;
      facts.submitted = false;
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    submit: {
      priority: 60,
      when: (facts) => {
        const isLastStep = facts.currentStep === facts.totalSteps - 1;
        const stepValid = isStepValid(facts, facts.currentStep);

        return facts.advanceRequested && isLastStep && stepValid;
      },
      require: { type: "SUBMIT_FORM" },
    },

    advance: {
      priority: 50,
      when: (facts) => {
        const isLastStep = facts.currentStep === facts.totalSteps - 1;
        const stepValid = isStepValid(facts, facts.currentStep);

        return facts.advanceRequested && !isLastStep && stepValid;
      },
      require: { type: "ADVANCE_STEP" },
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    advanceStep: {
      requirement: "ADVANCE_STEP",
      resolve: async (req, context) => {
        context.facts.currentStep = context.facts.currentStep + 1;
        context.facts.advanceRequested = false;
      },
    },

    submitForm: {
      requirement: "SUBMIT_FORM",
      timeout: 10000,
      resolve: async (req, context) => {
        // Simulate API submission
        await new Promise((resolve) => setTimeout(resolve, 800));
        context.facts.submitted = true;
        context.facts.advanceRequested = false;
      },
    },
  },
});

// ============================================================================
// Validation Schema
// ============================================================================

export const validationSchema = {
  facts: {
    emailAvailable: t.boolean(),
    checkingEmail: t.boolean(),
    emailChecked: t.string(),
  },
  derivations: {},
  events: {},
  requirements: {
    CHECK_EMAIL: { email: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Validation Module
// ============================================================================

export const validationModule = createModule("validation", {
  schema: validationSchema,

  crossModuleDeps: { wizard: wizardSchema },

  init: (facts) => {
    facts.emailAvailable = true;
    facts.checkingEmail = false;
    facts.emailChecked = "";
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    checkEmail: {
      when: (facts) => {
        const email = facts.wizard.email;
        const checked = facts.self.emailChecked;

        return email.includes("@") && email !== checked;
      },
      require: (facts) => ({
        type: "CHECK_EMAIL",
        email: facts.wizard.email,
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    checkEmail: {
      requirement: "CHECK_EMAIL",
      resolve: async (req, context) => {
        context.facts.checkingEmail = true;

        try {
          // Simulate API availability check
          await new Promise((resolve) => setTimeout(resolve, 500));
          context.facts.emailAvailable = req.email !== "taken@test.com";
          context.facts.emailChecked = req.email;
        } finally {
          context.facts.checkingEmail = false;
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
    wizard: wizardModule,
    validation: validationModule,
  },
  plugins: [
    devtoolsPlugin({ name: "form-wizard" }),
    persistencePlugin({
      storage: localStorage,
      key: "form-wizard-draft",
      include: [
        "wizard::email",
        "wizard::name",
        "wizard::company",
        "wizard::plan",
        "wizard::currentStep",
      ],
    }),
  ],
});
```
