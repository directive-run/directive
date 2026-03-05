/**
 * Number Match — DOM Rendering & System Wiring
 *
 * Imports from module, starts system, renders the game grid and event timeline.
 */

import { type Tile, addLog, system, timeline } from "./module.js";

// ============================================================================
// System Startup
// ============================================================================

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
// Helpers
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

// ============================================================================
// Render
// ============================================================================

function render() {
  const table = system.facts.table as Tile[];
  const selected = system.facts.selected as string[];
  const poolCount = system.read("poolCount") as number;
  const removedCount = system.read("removedCount") as number;
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
    timelineEl.innerHTML =
      '<div class="nm-timeline-empty">Events appear after interactions</div>';
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

// ============================================================================
// Controls
// ============================================================================

document.getElementById("clear")!.addEventListener("click", () => {
  system.events.clearSelection();
});

document.getElementById("newgame")!.addEventListener("click", () => {
  timeline.length = 0;
  system.events.newGame();
});

// ============================================================================
// Initial Render
// ============================================================================

render();
addLog("Game started. Select two numbers that add to 10.");

// Signal to tests that initialization is complete
document.body.setAttribute("data-counter-ready", "true");
