/**
 * Number Match — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders the game grid and event timeline.
 */

import { createModule, createSystem, t, type ModuleSchema } from "@directive-run/core";
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
          facts.selected.includes(tile.id)
        );
        if (selected.length !== 2) return false;
        const result = selected[0].value + selected[1].value === 10;
        if (result) log(`CONSTRAINT pairAddsTen: TRUE (${selected[0].value} + ${selected[1].value})`);
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
        const result = !facts.gameOver && facts.table.length < 9 && facts.pool.length > 0;
        if (result) log(`CONSTRAINT refillTable: TRUE (table: ${facts.table.length}, pool: ${facts.pool.length})`);
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
        const result = !facts.gameOver && facts.table.length === 0 && facts.pool.length === 0;
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
          req.tileIds.includes(tile.id)
        );

        // Multiple fact mutations
        log("RESOLVER removeTiles: setting table");
        context.facts.table = context.facts.table.filter(
          (tile: Tile) => !req.tileIds.includes(tile.id)
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
        log(`RESOLVER refillTable: DONE (table now: ${context.facts.table.length})`);
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
const poolEl = document.getElementById("pool")!;
const removedEl = document.getElementById("removed")!;
const movesEl = document.getElementById("moves")!;
const messageEl = document.getElementById("message")!;
const gridEl = document.getElementById("grid")!;

// Timeline
const timelineEl = document.getElementById("nm-timeline")!;

// ============================================================================
// Render
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

function render() {
  const table = system.facts.table as Tile[];
  const selected = system.facts.selected as string[];
  const poolCount = system.read("poolCount") as number;
  const removedCount = system.read("removedCount") as number;
  const selectedTiles = system.read("selectedTiles") as Tile[];
  const hasValidMoves = system.read("hasValidMoves") as boolean;
  const msg = system.facts.message as string;

  // --- Stats ---
  poolEl.textContent = String(poolCount);
  removedEl.textContent = String(removedCount);
  movesEl.textContent = String(system.facts.moveCount);
  messageEl.textContent = msg;

  // --- Grid ---
  gridEl.innerHTML = "";
  for (const tile of table) {
    const div = document.createElement("div");
    div.className = `tile${selected.includes(tile.id) ? " selected" : ""}`;
    div.textContent = String(tile.value);
    div.addEventListener("click", () => {
      if (selected.includes(tile.id)) {
        system.events.deselectTile({ tileId: tile.id });
      } else {
        system.events.selectTile({ tileId: tile.id });
      }
    });
    gridEl.appendChild(div);
  }

  // Empty slots
  for (let i = table.length; i < 9; i++) {
    const div = document.createElement("div");
    div.className = "tile empty";
    gridEl.appendChild(div);
  }

  // --- Timeline ---
  if (timeline.length === 0) {
    timelineEl.innerHTML = '<div class="nm-timeline-empty">Events appear after interactions</div>';
  } else {
    timelineEl.innerHTML = "";
    for (const entry of timeline) {
      const el = document.createElement("div");
      el.className = `nm-timeline-entry ${entry.type}`;

      const time = new Date(entry.time);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      el.innerHTML = `
        <span class="nm-timeline-time">${timeStr}</span>
        <span class="nm-timeline-event">${escapeHtml(entry.event)}</span>
        <span class="nm-timeline-detail">${escapeHtml(entry.detail)}</span>
      `;

      timelineEl.appendChild(el);
    }
  }
}

// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(
  ["table", "selected", "pool", "removed", "moveCount", "message", "gameOver",
   "poolCount", "removedCount", "selectedTiles", "hasValidMoves"],
  render
);

// Button handlers
document.getElementById("clear")!.addEventListener("click", () => {
  system.events.clearSelection();
});

document.getElementById("newgame")!.addEventListener("click", () => {
  timeline.length = 0;
  system.events.newGame();
});

// Initial render
render();
log("Game started. Select two numbers that add to 10.");

// Signal to tests that initialization is complete
document.body.setAttribute("data-counter-ready", "true");
