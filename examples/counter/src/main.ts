/**
 * Number Match — DOM Rendering & System Wiring
 *
 * Imports from module, starts system, renders the game grid and event timeline.
 */

import { el } from "@directive-run/el";
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
  gridEl.replaceChildren(
    ...table.map((tile) =>
      el("div", {
        className: `tile${selected.includes(tile.id) ? " selected" : ""}`,
        textContent: String(tile.value),
        onclick: () => {
          if (selected.includes(tile.id)) {
            system.events.deselectTile({ tileId: tile.id });
          } else {
            system.events.selectTile({ tileId: tile.id });
          }
        },
      }),
    ),
    ...Array.from({ length: Math.max(0, 9 - table.length) }, () =>
      el("div", { className: "tile empty" }),
    ),
  );

  // --- Timeline ---
  if (timeline.length === 0) {
    timelineEl.replaceChildren(
      el("div", { className: "nm-timeline-empty" }, "Events appear after interactions"),
    );
  } else {
    timelineEl.replaceChildren(
      ...timeline.map((entry) => {
        const time = new Date(entry.time);
        const timeStr = time.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        return el("div", { className: `nm-timeline-entry ${entry.type}` },
          el("span", { className: "nm-timeline-time" }, timeStr),
          el("span", { className: "nm-timeline-event" }, entry.event),
          el("span", { className: "nm-timeline-detail" }, entry.detail),
        );
      }),
    );
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
