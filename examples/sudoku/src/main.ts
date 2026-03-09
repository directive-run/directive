/**
 * Sudoku &ndash; DOM Rendering & System Wiring
 *
 * Creates the Directive system with time-travel debugging, subscribes to
 * state changes, and renders the Sudoku grid + controls to the DOM.
 */

import { createSystem } from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import { el } from "@directive-run/el";
import { MAX_HINTS } from "./rules.js";
import { sudokuGame, sudokuSchema } from "./sudoku.js";

// ============================================================================
// System (single module – direct access, no namespace)
// ============================================================================

const system = createSystem({
  module: sudokuGame,
  debug: { timeTravel: true, maxSnapshots: 200, runHistory: true },
  plugins: [devtoolsPlugin({ name: "sudoku" })],
});
system.start();

// All fact + derivation keys for subscribe-all
const allKeys = [
  ...Object.keys(sudokuSchema.facts),
  ...Object.keys(sudokuSchema.derivations),
];

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
    system.events.tick();
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
  const facts = system.facts;
  const derive = system.derive;

  const grid = facts.grid;
  const givens = facts.givens;
  const selectedIndex = facts.selectedIndex;
  const difficulty = facts.difficulty;
  const gameOver = facts.gameOver;
  const won = facts.won;
  const notesMode = facts.notesMode;
  const notes = facts.notes;
  const hintsUsed = facts.hintsUsed;
  const errorsCount = facts.errorsCount;

  const conflicts = derive.conflicts;
  const conflictIndices = derive.conflictIndices;
  const selectedPeers = derive.selectedPeers;
  const sameValueIndices = derive.sameValueIndices;
  const progress = derive.progress;
  const timerDisplay = derive.timerDisplay;
  const timerUrgency = derive.timerUrgency;

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
  const msg = facts.message;
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
  const cells: HTMLElement[] = [];
  for (let i = 0; i < 81; i++) {
    const value = grid[i];
    const isGiven = givens.has(i);
    const isSelected = i === selectedIndex;
    const isConflict = conflictIndices.has(i);
    const isPeer = peerSet.has(i);
    const isSameValue = sameValueIndices.has(i) && value !== 0;

    const row = Math.floor(i / 9);
    const col = i % 9;

    const classes = ["sudoku-cell"];
    if (isGiven) {
      classes.push("given");
    }
    if (isSelected) {
      classes.push("selected");
    }
    if (isConflict) {
      classes.push("conflict");
    }
    if (isPeer && !isSelected) {
      classes.push("peer");
    }
    if (isSameValue && !isSelected) {
      classes.push("same-value");
    }
    if (col % 3 === 0 && col !== 0) {
      classes.push("box-left");
    }
    if (row % 3 === 0 && row !== 0) {
      classes.push("box-top");
    }

    let children: (string | HTMLElement)[] = [];
    if (value !== 0) {
      children = [String(value)];
    } else if (notes[i] && notes[i].size > 0) {
      const noteDigits: HTMLElement[] = [];
      for (let d = 1; d <= 9; d++) {
        noteDigits.push(
          el("span", { className: "note-digit" }, notes[i].has(d) ? String(d) : ""),
        );
      }
      children = [el("div", { className: "notes-grid" }, ...noteDigits)];
    }

    const cell = el("div", {
      className: classes.join(" "),
      tabIndex: 0,
    }, ...children);
    cell.dataset.testid = `sudoku-cell-${i}`;
    cell.setAttribute(
      "aria-label",
      `Row ${row + 1}, Column ${col + 1}${value ? `, value ${value}` : ", empty"}`,
    );
    cell.addEventListener("click", () => {
      system.events.selectCell({ index: i });
    });

    cells.push(cell);
  }
  gridEl.replaceChildren(...cells);

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

system.subscribe(allKeys, render);

// ============================================================================
// Controls
// ============================================================================

// Number pad
for (let d = 0; d <= 9; d++) {
  const btn = document.getElementById(`sudoku-num-${d}`);
  if (btn) {
    btn.addEventListener("click", () => {
      system.events.inputNumber({ value: d });
    });
  }
}

// Notes toggle
notesToggle.addEventListener("click", () => {
  system.events.toggleNotesMode();
});

// Hint
hintBtn.addEventListener("click", () => {
  system.events.requestHint();
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
  system.events.newGame({ difficulty: system.facts.difficulty });
});

modalNewGame.addEventListener("click", () => {
  stopTimer();
  system.events.newGame({ difficulty: system.facts.difficulty });
});

// Difficulty mode buttons
modeEasy.addEventListener("click", () => {
  stopTimer();
  system.events.newGame({ difficulty: "easy" });
});

modeMedium.addEventListener("click", () => {
  stopTimer();
  system.events.newGame({ difficulty: "medium" });
});

modeHard.addEventListener("click", () => {
  stopTimer();
  system.events.newGame({ difficulty: "hard" });
});

// ============================================================================
// Keyboard Navigation
// ============================================================================

document.addEventListener("keydown", (e) => {
  const facts = system.facts;
  const sel = facts.selectedIndex;

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

    system.events.selectCell({ index: newRow * 9 + newCol });

    return;
  }

  // Number keys 1-9: input number
  if (e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    const value = Number.parseInt(e.key, 10);
    if (facts.notesMode) {
      system.events.toggleNote({ value });
    } else {
      system.events.inputNumber({ value });
    }

    return;
  }

  // Backspace / Delete: clear cell
  if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();
    system.events.inputNumber({ value: 0 });

    return;
  }

  // N: toggle notes mode
  if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    system.events.toggleNotesMode();

    return;
  }

  // H: request hint
  if (e.key === "h" || e.key === "H") {
    e.preventDefault();
    system.events.requestHint();

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
