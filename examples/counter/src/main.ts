/**
 * Number Match - Vanilla Directive Example
 *
 * Mirrors the exact same pattern as the Eleven Up card game:
 * - Pool of items, 9 displayed on a grid
 * - Select items, constraint fires when pair adds to 10
 * - Resolver removes matched items + modifies multiple facts
 * - Refill constraint/resolver chain refills grid from pool
 *
 * This is a minimal repro to test whether the freeze bug occurs.
 */

import { createModule, createSystem, t, type ModuleSchema } from "directive";

// ============================================================================
// Types
// ============================================================================

interface Tile {
  id: string;
  value: number;
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
// Schema - same structure as eleven-up
// ============================================================================

const schema = {
  facts: {
    pool: t.any<Tile[]>(),
    table: t.any<Tile[]>(),
    removed: t.any<Tile[]>(),
    selected: t.any<string[]>(),
    message: t.string(),
    moveCount: t.number(),
    gameOver: t.boolean(),
  },
  derivations: {
    poolCount: t.number(),
    removedCount: t.number(),
    selectedTiles: t.any<Tile[]>(),
    hasValidMoves: t.boolean(),
  },
  events: {
    newGame: {},
    selectTile: { tileId: t.string() },
    deselectTile: { tileId: t.string() },
    clearSelection: {},
  },
  requirements: {
    REMOVE_TILES: { tileIds: t.any<string[]>() },
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
    // When two selected tiles add to 10 → remove them
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

    // No moves left → game over
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
      resolve: async (req, ctx) => {
        log("RESOLVER removeTiles: START");
        const tilesToRemove = ctx.facts.table.filter((tile: Tile) =>
          req.tileIds.includes(tile.id)
        );

        // Multiple fact mutations — this is what causes the freeze in eleven-up
        log("RESOLVER removeTiles: setting table");
        ctx.facts.table = ctx.facts.table.filter(
          (tile: Tile) => !req.tileIds.includes(tile.id)
        );
        log("RESOLVER removeTiles: setting removed");
        ctx.facts.removed = [...ctx.facts.removed, ...tilesToRemove];
        log("RESOLVER removeTiles: clearing selected");
        ctx.facts.selected = [];
        log("RESOLVER removeTiles: incrementing moveCount");
        ctx.facts.moveCount++;
        log("RESOLVER removeTiles: setting message");
        ctx.facts.message = `Removed ${tilesToRemove[0].value} + ${tilesToRemove[1].value} = 10!`;
        log("RESOLVER removeTiles: DONE");
      },
    },

    refillTable: {
      requirement: "REFILL_TABLE",
      resolve: async (req, ctx) => {
        log(`RESOLVER refillTable: START (count: ${req.count})`);
        const newTiles = ctx.facts.pool.slice(0, req.count);
        ctx.facts.pool = ctx.facts.pool.slice(req.count);
        ctx.facts.table = [...ctx.facts.table, ...newTiles];
        log(`RESOLVER refillTable: DONE (table now: ${ctx.facts.table.length})`);
      },
    },

    endGame: {
      requirement: "END_GAME",
      resolve: async (req, ctx) => {
        log(`RESOLVER endGame: ${req.reason}`);
        ctx.facts.gameOver = true;
        ctx.facts.message = req.reason;
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

const system = createSystem({ module: numberMatch });
system.start();

// ============================================================================
// Logging helper
// ============================================================================

const logEl = document.getElementById("log")!;
function log(msg: string) {
  console.log(`[NumberMatch] ${msg}`);
  const line = document.createElement("div");
  line.textContent = `${new Date().toLocaleTimeString()}: ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

// ============================================================================
// DOM Bindings
// ============================================================================

const poolEl = document.getElementById("pool")!;
const removedEl = document.getElementById("removed")!;
const movesEl = document.getElementById("moves")!;
const messageEl = document.getElementById("message")!;
const gridEl = document.getElementById("grid")!;

function render() {
  const table = system.facts.table as Tile[];
  const selected = system.facts.selected as string[];
  const poolCount = system.read("poolCount") as number;
  const removedCount = system.read("removedCount") as number;

  poolEl.textContent = String(poolCount);
  removedEl.textContent = String(removedCount);
  movesEl.textContent = String(system.facts.moveCount);
  messageEl.textContent = system.facts.message;

  // Render grid
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
}

// Subscribe to changes
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
  logEl.innerHTML = "";
  system.events.newGame();
});

// Initial render
render();
log("Game started. Select two numbers that add to 10.");
