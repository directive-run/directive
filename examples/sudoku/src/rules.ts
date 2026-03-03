/**
 * Pure Sudoku Logic
 *
 * Zero Directive imports. All functions are pure and operate on a flat
 * 81-element grid where 0 represents an empty cell and 1-9 are values.
 */

// ============================================================================
// Types
// ============================================================================

/** 81-element array. 0 = empty, 1-9 = value. */
export type Grid = number[];

export type Difficulty = "easy" | "medium" | "hard";

export interface Conflict {
  index: number;
  value: number;
  peerIndex: number;
}

export interface CellPosition {
  row: number;
  col: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Timer durations in seconds per difficulty. */
export const TIMER_DURATIONS: Record<Difficulty, number> = {
  easy: 20 * 60,
  medium: 15 * 60,
  hard: 10 * 60,
};

/** Number of given (pre-filled) cells per difficulty. */
export const GIVENS_COUNT: Record<Difficulty, number> = {
  easy: 46,
  medium: 36,
  hard: 26,
};

/** Maximum hints allowed per game. */
export const MAX_HINTS = 3;

/** Timer urgency thresholds in seconds. */
export const TIMER_WARNING_THRESHOLD = 120;
export const TIMER_CRITICAL_THRESHOLD = 30;

/** Timer effect thresholds in seconds. */
export const TIMER_EFFECT_WARNING = 60;
export const TIMER_EFFECT_CRITICAL = 30;

// ============================================================================
// Coordinate Helpers
// ============================================================================

export function toRowCol(index: number): CellPosition {
  return {
    row: Math.floor(index / 9),
    col: index % 9,
  };
}

export function toIndex(row: number, col: number): number {
  return row * 9 + col;
}

/** Which 3x3 box (0-8) does this cell belong to? */
export function getBox(row: number, col: number): number {
  return Math.floor(row / 3) * 3 + Math.floor(col / 3);
}

/** All 9 indices in a given row. */
export function getRowIndices(row: number): number[] {
  const indices: number[] = [];
  for (let col = 0; col < 9; col++) {
    indices.push(toIndex(row, col));
  }

  return indices;
}

/** All 9 indices in a given column. */
export function getColIndices(col: number): number[] {
  const indices: number[] = [];
  for (let row = 0; row < 9; row++) {
    indices.push(toIndex(row, col));
  }

  return indices;
}

/** All 9 indices in a given 3x3 box (0-8). */
export function getBoxIndices(box: number): number[] {
  const startRow = Math.floor(box / 3) * 3;
  const startCol = (box % 3) * 3;
  const indices: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      indices.push(toIndex(startRow + r, startCol + c));
    }
  }

  return indices;
}

/** All peer indices (same row, column, or box) excluding the cell itself. */
export function getPeers(index: number): number[] {
  const { row, col } = toRowCol(index);
  const box = getBox(row, col);
  const peerSet = new Set<number>();

  for (const i of getRowIndices(row)) {
    peerSet.add(i);
  }
  for (const i of getColIndices(col)) {
    peerSet.add(i);
  }
  for (const i of getBoxIndices(box)) {
    peerSet.add(i);
  }

  peerSet.delete(index);

  return [...peerSet];
}

// ============================================================================
// Validation
// ============================================================================

/** Find all conflicts (duplicate values in same row, column, or box). */
export function findConflicts(grid: Grid): Conflict[] {
  const conflicts: Conflict[] = [];
  const seen = new Set<string>();

  function checkGroup(indices: number[]): void {
    for (let i = 0; i < indices.length; i++) {
      const val = grid[indices[i]];
      if (val === 0) {
        continue;
      }
      for (let j = i + 1; j < indices.length; j++) {
        if (grid[indices[j]] === val) {
          const keyA = `${indices[i]}-${indices[j]}`;
          const keyB = `${indices[j]}-${indices[i]}`;
          if (!seen.has(keyA)) {
            seen.add(keyA);
            seen.add(keyB);
            conflicts.push({
              index: indices[i],
              value: val,
              peerIndex: indices[j],
            });
            conflicts.push({
              index: indices[j],
              value: val,
              peerIndex: indices[i],
            });
          }
        }
      }
    }
  }

  for (let r = 0; r < 9; r++) {
    checkGroup(getRowIndices(r));
  }
  for (let c = 0; c < 9; c++) {
    checkGroup(getColIndices(c));
  }
  for (let b = 0; b < 9; b++) {
    checkGroup(getBoxIndices(b));
  }

  return conflicts;
}

/** Are all 81 cells filled (non-zero)? */
export function isBoardComplete(grid: Grid): boolean {
  return grid.every((v) => v !== 0);
}

/** Is the board complete with no conflicts? */
export function isBoardValid(grid: Grid): boolean {
  return isBoardComplete(grid) && findConflicts(grid).length === 0;
}

// ============================================================================
// Candidates
// ============================================================================

/** Valid digits (1-9) that can be placed in a cell without conflict. */
export function getCandidates(grid: Grid, index: number): number[] {
  if (grid[index] !== 0) {
    return [];
  }

  const used = new Set<number>();
  for (const peer of getPeers(index)) {
    if (grid[peer] !== 0) {
      used.add(grid[peer]);
    }
  }

  const candidates: number[] = [];
  for (let d = 1; d <= 9; d++) {
    if (!used.has(d)) {
      candidates.push(d);
    }
  }

  return candidates;
}

// ============================================================================
// Helpers
// ============================================================================

/** Create an array of 81 empty Sets for per-cell notes. */
export function createEmptyNotes(): Set<number>[] {
  return Array.from({ length: 81 }, () => new Set<number>());
}
