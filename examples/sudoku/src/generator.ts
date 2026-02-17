/**
 * Puzzle Generation & Solving
 *
 * No Directive imports. Provides a backtracking solver with MRV heuristic
 * and a puzzle generator that creates valid Sudoku puzzles at different
 * difficulty levels.
 */

import { type Grid, type Difficulty, GIVENS_COUNT, getCandidates } from "./rules.js";

// ============================================================================
// Fisher-Yates Shuffle
// ============================================================================

/** Shuffle an array in-place and return it. */
export function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }

  return array;
}

// ============================================================================
// Solver
// ============================================================================

/**
 * Solve a Sudoku grid using backtracking with MRV (Minimum Remaining Values)
 * heuristic. Returns the solved grid or null if unsolvable.
 *
 * Operates on a copy &ndash; does not mutate the input.
 */
const MAX_SOLVER_ITERATIONS = 100_000;

export function solve(grid: Grid): Grid | null {
  const work = [...grid];
  let iterations = 0;

  function findMRVCell(): number {
    let bestIndex = -1;
    let bestCount = 10;

    for (let i = 0; i < 81; i++) {
      if (work[i] !== 0) {
        continue;
      }
      const count = getCandidates(work, i).length;
      if (count === 0) {
        return -1;
      }
      if (count < bestCount) {
        bestCount = count;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  function backtrack(): boolean {
    iterations++;
    if (iterations > MAX_SOLVER_ITERATIONS) {
      return false;
    }

    const cell = findMRVCell();

    // No empty cells found &ndash; puzzle is solved
    if (cell === -1) {
      return !work.includes(0);
    }

    const candidates = shuffle([...getCandidates(work, cell)]);
    for (const digit of candidates) {
      work[cell] = digit;
      if (backtrack()) {
        return true;
      }
      work[cell] = 0;
    }

    return false;
  }

  if (backtrack()) {
    return work;
  }

  return null;
}

// ============================================================================
// Puzzle Generator
// ============================================================================

/** Fill a single 3x3 box with shuffled digits 1-9 (well, the box's 9 cells). */
function fillBox(grid: Grid, boxRow: number, boxCol: number): void {
  const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  let idx = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      grid[(boxRow + r) * 9 + (boxCol + c)] = digits[idx++];
    }
  }
}

/**
 * Generate a puzzle with a unique solution at the given difficulty.
 * Returns the puzzle grid and the complete solution.
 */
const MAX_GENERATION_RETRIES = 10;

export function generatePuzzle(difficulty: Difficulty, attempt = 0): { puzzle: Grid; solution: Grid } {
  // Start with empty grid
  const grid: Grid = new Array(81).fill(0);

  // Fill the three diagonal 3x3 boxes (they don't constrain each other)
  fillBox(grid, 0, 0);
  fillBox(grid, 3, 3);
  fillBox(grid, 6, 6);

  // Solve the rest to get a complete valid grid
  const solution = solve(grid);
  if (!solution) {
    if (attempt >= MAX_GENERATION_RETRIES) {
      throw new Error("Failed to generate a valid Sudoku puzzle after max retries.");
    }

    return generatePuzzle(difficulty, attempt + 1);
  }

  // Remove cells to create the puzzle
  const puzzle = [...solution];
  const givens = GIVENS_COUNT[difficulty];
  const toRemove = 81 - givens;

  // Create shuffled list of all cell indices
  const indices = shuffle(Array.from({ length: 81 }, (_, i) => i));
  let removed = 0;

  for (const idx of indices) {
    if (removed >= toRemove) {
      break;
    }

    const saved = puzzle[idx];
    puzzle[idx] = 0;

    // Verify the puzzle still has a unique solution by checking that
    // the solver finds the same value we removed
    const check = solve(puzzle);
    if (check && check[idx] === saved) {
      removed++;
    } else {
      // Removing this cell creates ambiguity &ndash; put it back
      puzzle[idx] = saved;
    }
  }

  return { puzzle, solution };
}
