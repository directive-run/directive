/**
 * Sudoku – Directive Module
 *
 * Constraint-driven Sudoku game. Sudoku IS a constraint satisfaction problem:
 * no duplicates in rows, columns, or 3x3 boxes. The game rules map directly
 * to Directive's constraint→resolver flow.
 *
 * Also demonstrates temporal constraints (countdown timer) and runtime
 * reconfiguration (difficulty modes) – patterns not shown in checkers.
 *
 * Pure Sudoku logic lives in rules.ts; puzzle generation in generator.ts.
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import { generatePuzzle } from "./generator.js";
import {
  type Conflict,
  type Difficulty,
  type Grid,
  MAX_HINTS,
  TIMER_CRITICAL_THRESHOLD,
  TIMER_DURATIONS,
  TIMER_EFFECT_CRITICAL,
  TIMER_EFFECT_WARNING,
  TIMER_WARNING_THRESHOLD,
  createEmptyNotes,
  findConflicts,
  getCandidates,
  getPeers,
  isBoardComplete,
  toRowCol,
} from "./rules.js";

// ============================================================================
// Schema
// ============================================================================

export const sudokuSchema = {
  facts: {
    grid: t.object<Grid>(),
    solution: t.object<Grid>(),
    givens: t.object<Set<number>>(),
    selectedIndex: t.object<number | null>(),
    difficulty: t.object<Difficulty>(),
    timerRemaining: t.number(),
    timerRunning: t.boolean(),
    gameOver: t.boolean(),
    won: t.boolean(),
    message: t.string(),
    notesMode: t.boolean(),
    notes: t.array<Set<number>>(),
    hintsUsed: t.number(),
    errorsCount: t.number(),
    hintRequested: t.boolean(),
  },
  derivations: {
    conflicts: t.array<Conflict>(),
    conflictIndices: t.object<Set<number>>(),
    hasConflicts: t.boolean(),
    filledCount: t.number(),
    progress: t.number(),
    isComplete: t.boolean(),
    isSolved: t.boolean(),
    selectedPeers: t.array<number>(),
    highlightValue: t.number(),
    sameValueIndices: t.object<Set<number>>(),
    candidates: t.array<number>(),
    timerDisplay: t.string(),
    timerUrgency: t.object<"normal" | "warning" | "critical">(),
  },
  events: {
    newGame: { difficulty: t.object<Difficulty>() },
    selectCell: { index: t.number() },
    inputNumber: { value: t.number() },
    toggleNote: { value: t.number() },
    toggleNotesMode: {},
    requestHint: {},
    tick: {},
  },
  requirements: {
    SHOW_CONFLICT: {
      index: t.number(),
      value: t.number(),
      row: t.number(),
      col: t.number(),
    },
    GAME_WON: {
      timeLeft: t.number(),
      hintsUsed: t.number(),
      errors: t.number(),
    },
    GAME_OVER: {
      reason: t.string(),
    },
    REVEAL_HINT: {
      index: t.number(),
      value: t.number(),
    },
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

export const sudokuGame = createModule("sudoku", {
  schema: sudokuSchema,
  snapshotEvents: ["inputNumber", "toggleNote", "requestHint", "newGame"],

  init: (facts) => {
    const { puzzle, solution } = generatePuzzle("easy");
    const givens = new Set<number>();
    for (let i = 0; i < 81; i++) {
      if (puzzle[i] !== 0) {
        givens.add(i);
      }
    }

    facts.grid = puzzle;
    facts.solution = solution;
    facts.givens = givens;
    facts.selectedIndex = null;
    facts.difficulty = "easy";
    facts.timerRemaining = TIMER_DURATIONS.easy;
    facts.timerRunning = true;
    facts.gameOver = false;
    facts.won = false;
    facts.message =
      "Fill in the grid. No duplicates in rows, columns, or boxes.";
    facts.notesMode = false;
    facts.notes = createEmptyNotes();
    facts.hintsUsed = 0;
    facts.errorsCount = 0;
    facts.hintRequested = false;
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    conflicts: (facts) => {
      return findConflicts(facts.grid);
    },

    conflictIndices: (facts, derive) => {
      const indices = new Set<number>();
      const givens = facts.givens;
      for (const c of derive.conflicts) {
        // Only highlight player-placed cells, not givens
        if (!givens.has(c.index)) {
          indices.add(c.index);
        }
      }

      return indices;
    },

    hasConflicts: (_facts, derive) => {
      return derive.conflicts.length > 0;
    },

    filledCount: (facts) => {
      let count = 0;
      const grid = facts.grid;
      for (let i = 0; i < 81; i++) {
        if (grid[i] !== 0) {
          count++;
        }
      }

      return count;
    },

    progress: (_facts, derive) => {
      return Math.round((derive.filledCount / 81) * 100);
    },

    isComplete: (facts) => {
      return isBoardComplete(facts.grid);
    },

    isSolved: (_facts, derive) => {
      return derive.isComplete && !derive.hasConflicts;
    },

    selectedPeers: (facts) => {
      const sel = facts.selectedIndex;
      if (sel === null) {
        return [];
      }

      return getPeers(sel);
    },

    highlightValue: (facts) => {
      const sel = facts.selectedIndex;
      if (sel === null) {
        return 0;
      }

      return facts.grid[sel];
    },

    sameValueIndices: (facts, derive) => {
      const val = derive.highlightValue;
      if (val === 0) {
        return new Set<number>();
      }

      const indices = new Set<number>();
      const grid = facts.grid;
      for (let i = 0; i < 81; i++) {
        if (grid[i] === val) {
          indices.add(i);
        }
      }

      return indices;
    },

    candidates: (facts) => {
      const sel = facts.selectedIndex;
      if (sel === null) {
        return [];
      }

      return getCandidates(facts.grid, sel);
    },

    timerDisplay: (facts) => {
      const remaining = facts.timerRemaining;
      const mins = Math.max(0, Math.floor(remaining / 60));
      const secs = Math.max(0, remaining % 60);

      return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    },

    timerUrgency: (facts) => {
      const remaining = facts.timerRemaining;
      if (remaining <= TIMER_CRITICAL_THRESHOLD) {
        return "critical";
      }
      if (remaining <= TIMER_WARNING_THRESHOLD) {
        return "warning";
      }

      return "normal";
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    newGame: (facts, { difficulty }) => {
      const { puzzle, solution } = generatePuzzle(difficulty);
      const givens = new Set<number>();
      for (let i = 0; i < 81; i++) {
        if (puzzle[i] !== 0) {
          givens.add(i);
        }
      }

      facts.grid = puzzle;
      facts.solution = solution;
      facts.givens = givens;
      facts.selectedIndex = null;
      facts.difficulty = difficulty;
      facts.timerRemaining = TIMER_DURATIONS[difficulty];
      facts.timerRunning = true;
      facts.gameOver = false;
      facts.won = false;
      facts.message =
        "Fill in the grid. No duplicates in rows, columns, or boxes.";
      facts.notesMode = false;
      facts.notes = createEmptyNotes();
      facts.hintsUsed = 0;
      facts.errorsCount = 0;
      facts.hintRequested = false;
    },

    selectCell: (facts, { index }) => {
      if (facts.gameOver) {
        return;
      }
      facts.selectedIndex = index;
    },

    inputNumber: (facts, { value }) => {
      if (facts.gameOver) {
        return;
      }

      const sel = facts.selectedIndex;
      if (sel === null) {
        return;
      }

      const givens = facts.givens;
      if (givens.has(sel)) {
        facts.message = "That cell is locked.";

        return;
      }

      if (facts.notesMode && value !== 0) {
        // In notes mode, toggle the pencil mark instead
        const notes = [...facts.notes];
        notes[sel] = new Set(notes[sel]);
        if (notes[sel].has(value)) {
          notes[sel].delete(value);
        } else {
          notes[sel].add(value);
        }
        facts.notes = notes;
        facts.message = "";

        return;
      }

      // Place or clear a number
      const grid = [...facts.grid];
      grid[sel] = value;
      facts.grid = grid;

      // Clear notes for this cell when placing a number
      if (value !== 0) {
        const notes = [...facts.notes];
        notes[sel] = new Set();
        // Also clear this value from peer notes
        for (const peer of getPeers(sel)) {
          if (notes[peer].has(value)) {
            notes[peer] = new Set(notes[peer]);
            notes[peer].delete(value);
          }
        }
        facts.notes = notes;
      }

      facts.message = "";
    },

    toggleNote: (facts, { value }) => {
      if (facts.gameOver) {
        return;
      }

      const sel = facts.selectedIndex;
      if (sel === null) {
        return;
      }

      const givens = facts.givens;
      if (givens.has(sel)) {
        return;
      }

      // Only allow notes on empty cells
      if (facts.grid[sel] !== 0) {
        return;
      }

      const notes = [...facts.notes];
      notes[sel] = new Set(notes[sel]);
      if (notes[sel].has(value)) {
        notes[sel].delete(value);
      } else {
        notes[sel].add(value);
      }
      facts.notes = notes;
    },

    toggleNotesMode: (facts) => {
      facts.notesMode = !facts.notesMode;
    },

    requestHint: (facts) => {
      if (facts.gameOver) {
        return;
      }
      if (facts.hintsUsed >= MAX_HINTS) {
        facts.message = "No hints remaining.";

        return;
      }

      const sel = facts.selectedIndex;
      if (sel === null) {
        facts.message = "Select a cell first.";

        return;
      }

      const givens = facts.givens;
      if (givens.has(sel)) {
        facts.message = "That cell is already filled.";

        return;
      }

      if (facts.grid[sel] !== 0) {
        facts.message = "Clear the cell first, or select an empty cell.";

        return;
      }

      // Signal the hintAvailable constraint to fire
      facts.hintRequested = true;
    },

    tick: (facts) => {
      if (!facts.timerRunning || facts.gameOver) {
        return;
      }
      facts.timerRemaining = Math.max(0, facts.timerRemaining - 1);
    },
  },

  // ============================================================================
  // Constraints – The Showcase
  // ============================================================================

  constraints: {
    // Highest priority: timer expiry ends the game immediately
    timerExpired: {
      priority: 200,
      when: (facts) => {
        if (facts.gameOver) {
          return false;
        }

        return facts.timerRemaining <= 0;
      },
      require: () => ({
        type: "GAME_OVER",
        reason: "Time's up!",
      }),
    },

    // Detect conflicts on player-placed cells
    detectConflict: {
      priority: 100,
      when: (facts) => {
        if (facts.gameOver) {
          return false;
        }
        const conflicts = findConflicts(facts.grid);
        const givens = facts.givens;

        return conflicts.some((c) => !givens.has(c.index));
      },
      require: (facts) => {
        const conflicts = findConflicts(facts.grid);
        const givens = facts.givens;
        const playerConflict = conflicts.find((c) => !givens.has(c.index));
        const idx = playerConflict?.index ?? 0;
        const { row, col } = toRowCol(idx);

        return {
          type: "SHOW_CONFLICT",
          index: idx,
          value: playerConflict?.value ?? 0,
          row: row + 1,
          col: col + 1,
        };
      },
    },

    // Puzzle solved: all cells filled with no conflicts
    puzzleSolved: {
      priority: 90,
      when: (facts) => {
        if (facts.gameOver) {
          return false;
        }

        return (
          isBoardComplete(facts.grid) && findConflicts(facts.grid).length === 0
        );
      },
      require: (facts) => ({
        type: "GAME_WON",
        timeLeft: facts.timerRemaining,
        hintsUsed: facts.hintsUsed,
        errors: facts.errorsCount,
      }),
    },

    // Hint available: player requested a hint on an empty cell
    hintAvailable: {
      priority: 70,
      when: (facts) => {
        if (facts.gameOver) {
          return false;
        }
        if (!facts.hintRequested) {
          return false;
        }

        const sel = facts.selectedIndex;
        if (sel === null) {
          return false;
        }

        return facts.grid[sel] === 0;
      },
      require: (facts) => {
        const sel = facts.selectedIndex as number;
        const solution = facts.solution;

        return {
          type: "REVEAL_HINT",
          index: sel,
          value: solution[sel],
        };
      },
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    showConflict: {
      requirement: "SHOW_CONFLICT",
      resolve: async (req, context) => {
        context.facts.errorsCount = context.facts.errorsCount + 1;
        context.facts.message = `Conflict at row ${req.row}, column ${req.col} – duplicate ${req.value}.`;
      },
    },

    gameWon: {
      requirement: "GAME_WON",
      resolve: async (req, context) => {
        context.facts.timerRunning = false;
        context.facts.gameOver = true;
        context.facts.won = true;

        const mins = Math.floor(
          (TIMER_DURATIONS[context.facts.difficulty] - req.timeLeft) / 60,
        );
        const secs =
          (TIMER_DURATIONS[context.facts.difficulty] - req.timeLeft) % 60;
        context.facts.message = `Solved in ${mins}m ${secs}s! Hints: ${req.hintsUsed}, Errors: ${req.errors}`;
      },
    },

    gameOver: {
      requirement: "GAME_OVER",
      resolve: async (req, context) => {
        context.facts.timerRunning = false;
        context.facts.gameOver = true;
        context.facts.won = false;
        context.facts.message = req.reason;
      },
    },

    revealHint: {
      requirement: "REVEAL_HINT",
      resolve: async (req, context) => {
        const grid = [...context.facts.grid];
        grid[req.index] = req.value;
        context.facts.grid = grid;

        // Clear notes for the hinted cell and remove value from peer notes
        const notes = [...context.facts.notes];
        notes[req.index] = new Set();
        for (const peer of getPeers(req.index)) {
          if (notes[peer].has(req.value)) {
            notes[peer] = new Set(notes[peer]);
            notes[peer].delete(req.value);
          }
        }
        context.facts.notes = notes;

        context.facts.hintRequested = false;
        context.facts.hintsUsed = context.facts.hintsUsed + 1;
        context.facts.message = `Hint revealed! ${MAX_HINTS - context.facts.hintsUsed} remaining.`;
      },
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    timerWarning: {
      deps: ["timerRemaining"],
      run: (facts) => {
        const remaining = facts.timerRemaining;
        if (remaining === TIMER_EFFECT_WARNING) {
          console.log("[Sudoku] 1 minute remaining!");
        }
        if (remaining === TIMER_EFFECT_CRITICAL) {
          console.log("[Sudoku] 30 seconds remaining!");
        }
      },
    },

    gameResult: {
      deps: ["gameOver"],
      run: (facts) => {
        if (facts.gameOver) {
          if (facts.won) {
            console.log(
              `[Sudoku] Puzzle solved! Difficulty: ${facts.difficulty}, Hints: ${facts.hintsUsed}, Errors: ${facts.errorsCount}`,
            );
          } else {
            console.log(`[Sudoku] Game over: ${facts.message}`);
          }
        }
      },
    },
  },
});
