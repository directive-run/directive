/**
 * Sudoku &ndash; DOM Rendering & System Wiring
 *
 * Creates the Directive system with time-travel debugging, subscribes to
 * state changes, and renders the Sudoku grid + controls to the DOM.
 */

import { createSystem } from "@directive-run/core";
import { sudokuGame } from "./sudoku.js";
import type { Grid, Difficulty, Conflict } from "./rules.js";
import { MAX_HINTS } from "./rules.js";

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  modules: { sudoku: sudokuGame },
  debug: { timeTravel: true, maxSnapshots: 200 },
});
system.start();

// ============================================================================
// DOM References
// ============================================================================

const gridEl = document.getElementById("sudoku-grid")!;
const timerEl = document.getElementById("sudoku-timer")!;
const messageEl = document.getElementById("sudoku-message")!;
const progressEl = document.getElementById("sudoku-progress")!;
const progressBarEl = document.getElementById("sudoku-progress-bar")!;
const hintsEl = document.getElementById("sudoku-hints-remaining")!;
const errorsEl = document.getElementById("sudoku-errors")!;
const notesToggle = document.getElementById("sudoku-notes-toggle")!;
const hintBtn = document.getElementById("sudoku-hint-btn")!;
const undoBtn = document.getElementById("sudoku-undo-btn")!;
const redoBtn = document.getElementById("sudoku-redo-btn")!;
const newGameBtn = document.getElementById("sudoku-new-game")!;
const modalEl = document.getElementById("sudoku-modal")!;
const modalTitle = document.getElementById("sudoku-modal-title")!;
const modalMessage = document.getElementById("sudoku-modal-message")!;
const modalNewGame = document.getElementById("sudoku-modal-new-game")!;
const modeEasy = document.getElementById("sudoku-mode-easy")!;
const modeMedium = document.getElementById("sudoku-mode-medium")!;
const modeHard = document.getElementById("sudoku-mode-hard")!;

// ============================================================================
// Timer
// ============================================================================

let timerInterval: ReturnType<typeof setInterval> | null = null;

function startTimer(): void {
  stopTimer();
  timerInterval = setInterval(() => {
    system.events.sudoku.tick();
  }, 1000);
}

function stopTimer(): void {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ============================================================================
// Render
// ============================================================================

function render(): void {
  const facts = system.facts.sudoku;
  const derive = system.derive.sudoku;

  const grid = facts.grid as Grid;
  const givens = facts.givens as Set<number>;
  const selectedIndex = facts.selectedIndex as number | null;
  const difficulty = facts.difficulty as Difficulty;
  const gameOver = facts.gameOver as boolean;
  const won = facts.won as boolean;
  const notesMode = facts.notesMode as boolean;
  const notes = facts.notes as Set<number>[];
  const hintsUsed = facts.hintsUsed as number;
  const errorsCount = facts.errorsCount as number;

  const conflicts = derive.conflicts as Conflict[];
  const conflictIndices = derive.conflictIndices as Set<number>;
  const selectedPeers = derive.selectedPeers as number[];
  const sameValueIndices = derive.sameValueIndices as Set<number>;
  const progress = derive.progress as number;
  const timerDisplay = derive.timerDisplay as string;
  const timerUrgency = derive.timerUrgency as string;

  const peerSet = new Set(selectedPeers);

  // Timer
  timerEl.textContent = timerDisplay;
  timerEl.className = "sudoku-timer";
  if (timerUrgency === "warning") {
    timerEl.classList.add("warning");
  } else if (timerUrgency === "critical") {
    timerEl.classList.add("critical");
  }

  // Manage timer interval
  if (facts.timerRunning && !gameOver && !timerInterval) {
    startTimer();
  } else if ((!facts.timerRunning || gameOver) && timerInterval) {
    stopTimer();
  }

  // Progress
  progressEl.textContent = `${progress}%`;
  progressBarEl.style.width = `${progress}%`;

  // Info
  hintsEl.textContent = `${MAX_HINTS - hintsUsed}`;
  errorsEl.textContent = `${errorsCount}`;

  // Message
  const msg = facts.message as string;
  if (msg) {
    messageEl.textContent = msg;
    messageEl.classList.remove("hidden");
  } else {
    messageEl.classList.add("hidden");
  }

  // Notes toggle – green when active for clear differentiation
  notesToggle.classList.toggle("notes-active", notesMode);
  gridEl.classList.toggle("notes-mode", notesMode);

  // Hint button
  const hintDisabled = hintsUsed >= MAX_HINTS || gameOver;
  (hintBtn as HTMLButtonElement).disabled = hintDisabled;

  // Difficulty toggle
  modeEasy.classList.toggle("active", difficulty === "easy");
  modeMedium.classList.toggle("active", difficulty === "medium");
  modeHard.classList.toggle("active", difficulty === "hard");

  // Grid
  gridEl.innerHTML = "";
  for (let i = 0; i < 81; i++) {
    const cell = document.createElement("div");
    const value = grid[i];
    const isGiven = givens.has(i);
    const isSelected = i === selectedIndex;
    const isConflict = conflictIndices.has(i);
    const isPeer = peerSet.has(i);
    const isSameValue = sameValueIndices.has(i) && value !== 0;

    const row = Math.floor(i / 9);
    const col = i % 9;

    cell.className = "sudoku-cell";
    cell.dataset.testid = `sudoku-cell-${i}`;
    cell.setAttribute("aria-label", `Row ${row + 1}, Column ${col + 1}${value ? `, value ${value}` : ", empty"}`);
    if (isGiven) {
      cell.classList.add("given");
    }
    if (isSelected) {
      cell.classList.add("selected");
    }
    if (isConflict) {
      cell.classList.add("conflict");
    }
    if (isPeer && !isSelected) {
      cell.classList.add("peer");
    }
    if (isSameValue && !isSelected) {
      cell.classList.add("same-value");
    }

    // Box borders
    if (col % 3 === 0 && col !== 0) {
      cell.classList.add("box-left");
    }
    if (row % 3 === 0 && row !== 0) {
      cell.classList.add("box-top");
    }

    if (value !== 0) {
      cell.textContent = String(value);
    } else if (notes[i] && notes[i].size > 0) {
      // Show pencil marks
      const notesGrid = document.createElement("div");
      notesGrid.className = "notes-grid";
      for (let d = 1; d <= 9; d++) {
        const noteCell = document.createElement("span");
        noteCell.className = "note-digit";
        if (notes[i].has(d)) {
          noteCell.textContent = String(d);
        }
        notesGrid.appendChild(noteCell);
      }
      cell.appendChild(notesGrid);
    }

    cell.tabIndex = 0;
    cell.addEventListener("click", () => {
      system.events.sudoku.selectCell({ index: i });
    });

    gridEl.appendChild(cell);
  }

  // Number pad
  for (let d = 1; d <= 9; d++) {
    const btn = document.getElementById(`sudoku-num-${d}`);
    if (btn) {
      // Count remaining instances of this digit
      let count = 0;
      for (let i = 0; i < 81; i++) {
        if (grid[i] === d) {
          count++;
        }
      }
      const remaining = 9 - count;
      const badge = btn.querySelector(".num-badge");
      if (badge) {
        badge.textContent = String(remaining);
        badge.classList.toggle("complete", remaining === 0);
      }
    }
  }

  // Modal
  if (gameOver) {
    modalEl.classList.remove("hidden");
    if (won) {
      modalTitle.textContent = "Puzzle Solved!";
      modalMessage.textContent = msg;
    } else {
      modalTitle.textContent = "Game Over";
      modalMessage.textContent = msg;
    }
  } else {
    modalEl.classList.add("hidden");
  }
}

// ============================================================================
// Subscribe
// ============================================================================

system.subscribeModule("sudoku", render);

// ============================================================================
// Controls
// ============================================================================

/**
 * Only snapshot board-changing actions (number input, notes, hints).
 * Selection, timer ticks, and UI toggles are excluded from undo history.
 */
function withSnapshot(fn: () => void): void {
  system.debug?.resume();
  fn();
  system.debug?.pause();
}

// Pause time-travel by default — only meaningful plays get snapshots
system.debug?.pause();

// Number pad
for (let d = 0; d <= 9; d++) {
  const btn = document.getElementById(`sudoku-num-${d}`);
  if (btn) {
    btn.addEventListener("click", () => {
      withSnapshot(() => system.events.sudoku.inputNumber({ value: d }));
    });
  }
}

// Notes toggle
notesToggle.addEventListener("click", () => {
  system.events.sudoku.toggleNotesMode();
});

// Hint
hintBtn.addEventListener("click", () => {
  withSnapshot(() => system.events.sudoku.requestHint());
});

// Undo / Redo
undoBtn.addEventListener("click", () => {
  system.debug?.goBack();
});

redoBtn.addEventListener("click", () => {
  system.debug?.goForward();
});

// New game
newGameBtn.addEventListener("click", () => {
  stopTimer();
  system.events.sudoku.newGame({ difficulty: system.facts.sudoku.difficulty as Difficulty });
});

modalNewGame.addEventListener("click", () => {
  stopTimer();
  system.events.sudoku.newGame({ difficulty: system.facts.sudoku.difficulty as Difficulty });
});

// Difficulty mode buttons
modeEasy.addEventListener("click", () => {
  stopTimer();
  system.events.sudoku.newGame({ difficulty: "easy" });
});

modeMedium.addEventListener("click", () => {
  stopTimer();
  system.events.sudoku.newGame({ difficulty: "medium" });
});

modeHard.addEventListener("click", () => {
  stopTimer();
  system.events.sudoku.newGame({ difficulty: "hard" });
});

// ============================================================================
// Keyboard Navigation
// ============================================================================

document.addEventListener("keydown", (e) => {
  const facts = system.facts.sudoku;
  const sel = facts.selectedIndex as number | null;

  // Arrow keys: move selection
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
    const current = sel ?? 40; // Center of grid if nothing selected
    const row = Math.floor(current / 9);
    const col = current % 9;

    let newRow = row;
    let newCol = col;
    if (e.key === "ArrowUp") {
      newRow = Math.max(0, row - 1);
    } else if (e.key === "ArrowDown") {
      newRow = Math.min(8, row + 1);
    } else if (e.key === "ArrowLeft") {
      newCol = Math.max(0, col - 1);
    } else if (e.key === "ArrowRight") {
      newCol = Math.min(8, col + 1);
    }

    system.events.sudoku.selectCell({ index: newRow * 9 + newCol });

    return;
  }

  // Number keys 1-9: input number
  if (e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    const value = parseInt(e.key, 10);
    if (facts.notesMode) {
      withSnapshot(() => system.events.sudoku.toggleNote({ value }));
    } else {
      withSnapshot(() => system.events.sudoku.inputNumber({ value }));
    }

    return;
  }

  // Backspace / Delete: clear cell
  if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();
    withSnapshot(() => system.events.sudoku.inputNumber({ value: 0 }));

    return;
  }

  // N: toggle notes mode
  if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    system.events.sudoku.toggleNotesMode();

    return;
  }

  // H: request hint
  if (e.key === "h" || e.key === "H") {
    e.preventDefault();
    withSnapshot(() => system.events.sudoku.requestHint());

    return;
  }

  // Escape: dismiss modal
  if (e.key === "Escape" && !modalEl.classList.contains("hidden")) {
    e.preventDefault();
    modalEl.classList.add("hidden");

    return;
  }

  // Ctrl/Cmd+Z: undo
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();
    if (e.shiftKey) {
      system.debug?.goForward();
    } else {
      system.debug?.goBack();
    }

    return;
  }
});

// Modal backdrop click to dismiss
modalEl.addEventListener("click", (e) => {
  if (e.target === modalEl) {
    modalEl.classList.add("hidden");
  }
});

// ============================================================================
// Initial Render
// ============================================================================

startTimer();
render();
