/**
 * Checkers - Pure Game Logic
 *
 * Zero Directive imports. All pure functions operating on data.
 * Standard American checkers rules:
 * - 8x8 board, pieces on dark squares only
 * - Red moves first (upward from rows 5-7), Black from rows 0-2
 * - Captures are mandatory (forced jump rule)
 * - Multi-jump chains continue until no more jumps
 * - Kinging ends a multi-jump chain
 * - Kings move diagonally in all four directions
 * - A player loses when they have no valid moves
 */

// ============================================================================
// Types
// ============================================================================

export type Player = "red" | "black";

export interface Piece {
  player: Player;
  king: boolean;
}

export type Cell = Piece | null;

/** 64-element flat array, row-major 8x8 */
export type Board = Cell[];

export interface Move {
  from: number;
  to: number;
  captured: number | null;
}

// ============================================================================
// Board Helpers
// ============================================================================

export function toRowCol(index: number): [number, number] {
  return [Math.floor(index / 8), index % 8];
}

export function toIndex(row: number, col: number): number {
  return row * 8 + col;
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

export function isDarkSquare(row: number, col: number): boolean {
  return (row + col) % 2 === 1;
}

// ============================================================================
// Setup
// ============================================================================

/** Black pieces rows 0-2 (top), Red pieces rows 5-7 (bottom), dark squares only */
export function createInitialBoard(): Board {
  const board: Board = new Array(64).fill(null);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (!isDarkSquare(row, col)) continue;
      const idx = toIndex(row, col);
      if (row < 3) {
        board[idx] = { player: "black", king: false };
      } else if (row > 4) {
        board[idx] = { player: "red", king: false };
      }
    }
  }

  return board;
}

// ============================================================================
// Move Computation
// ============================================================================

type Direction = [number, number];

/** Diagonal directions a piece can move based on player/king status */
export function getMoveDirections(piece: Piece): Direction[] {
  if (piece.king) {
    return [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];
  }
  // Red moves up (negative row), Black moves down (positive row)
  return piece.player === "red"
    ? [
        [-1, -1],
        [-1, 1],
      ]
    : [
        [1, -1],
        [1, 1],
      ];
}

/** Non-capture diagonal moves for a piece at the given index */
export function getSimpleMoves(board: Board, index: number): Move[] {
  const piece = board[index];
  if (!piece) {
    return [];
  }

  const [row, col] = toRowCol(index);
  const moves: Move[] = [];

  for (const [dr, dc] of getMoveDirections(piece)) {
    const nr = row + dr;
    const nc = col + dc;
    if (inBounds(nr, nc) && board[toIndex(nr, nc)] === null) {
      moves.push({ from: index, to: toIndex(nr, nc), captured: null });
    }
  }

  return moves;
}

/** Capture moves (jump over opponent to empty square) */
export function getJumpMoves(board: Board, index: number): Move[] {
  const piece = board[index];
  if (!piece) {
    return [];
  }

  const [row, col] = toRowCol(index);
  const moves: Move[] = [];

  for (const [dr, dc] of getMoveDirections(piece)) {
    const midR = row + dr;
    const midC = col + dc;
    const landR = row + dr * 2;
    const landC = col + dc * 2;

    if (!inBounds(landR, landC)) continue;

    const midIdx = toIndex(midR, midC);
    const landIdx = toIndex(landR, landC);
    const midPiece = board[midIdx];

    if (
      midPiece &&
      midPiece.player !== piece.player &&
      board[landIdx] === null
    ) {
      moves.push({ from: index, to: landIdx, captured: midIdx });
    }
  }

  return moves;
}

/** Valid moves for a single piece. Jumps if available (forced capture), else simple moves. */
export function getValidMovesForPiece(board: Board, index: number): Move[] {
  const jumps = getJumpMoves(board, index);
  if (jumps.length > 0) {
    return jumps;
  }

  return getSimpleMoves(board, index);
}

/** All valid moves for a player. If ANY jump exists for any piece, ONLY jumps are returned. */
export function getAllValidMoves(board: Board, player: Player): Move[] {
  let allJumps: Move[] = [];
  let allSimple: Move[] = [];

  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (!piece || piece.player !== player) continue;
    allJumps = allJumps.concat(getJumpMoves(board, i));
    allSimple = allSimple.concat(getSimpleMoves(board, i));
  }

  return allJumps.length > 0 ? allJumps : allSimple;
}

/** Quick check: does the player have any jump moves available? */
export function playerHasJumps(board: Board, player: Player): boolean {
  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (!piece || piece.player !== player) continue;
    if (getJumpMoves(board, i).length > 0) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Board Mutation (immutable — returns new board)
// ============================================================================

/** Apply a move: move piece, remove captured piece if any */
export function applyMove(board: Board, move: Move): Board {
  const newBoard = [...board];
  newBoard[move.to] = newBoard[move.from];
  newBoard[move.from] = null;
  if (move.captured !== null) {
    newBoard[move.captured] = null;
  }

  return newBoard;
}

/** Check if piece at index should be kinged (on opponent's back row and not already a king) */
export function shouldKing(board: Board, index: number): boolean {
  const piece = board[index];
  if (!piece || piece.king) {
    return false;
  }
  const [row] = toRowCol(index);

  return (
    (piece.player === "red" && row === 0) ||
    (piece.player === "black" && row === 7)
  );
}

/** Return new board with piece at index promoted to king */
export function promotePiece(board: Board, index: number): Board {
  const piece = board[index];
  if (!piece) {
    return board;
  }
  const newBoard = [...board];
  newBoard[index] = { ...piece, king: true };

  return newBoard;
}

// ============================================================================
// Counting / Game Status
// ============================================================================

export function countPieces(board: Board): { red: number; black: number } {
  let red = 0;
  let black = 0;
  for (const cell of board) {
    if (cell?.player === "red") red++;
    else if (cell?.player === "black") black++;
  }

  return { red, black };
}

export function opponent(player: Player): Player {
  return player === "red" ? "black" : "red";
}

/** True if player has zero legal moves (they lose) */
export function hasNoValidMoves(board: Board, player: Player): boolean {
  return getAllValidMoves(board, player).length === 0;
}

// ============================================================================
// AI (minimax with alpha-beta pruning)
// ============================================================================

/** Heuristic board evaluation from `player`'s perspective */
export function evaluateBoard(board: Board, player: Player): number {
  let score = 0;
  const opp = opponent(player);

  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (!piece) continue;
    const [row, col] = toRowCol(i);
    let val = piece.king ? 2.5 : 1;

    // Back-row bonus (defensive)
    if (!piece.king) {
      if (piece.player === "red" && row >= 5) val += 0.5;
      if (piece.player === "black" && row <= 2) val += 0.5;
    }

    // Center control bonus (cols 2-5, rows 2-5)
    if (col >= 2 && col <= 5 && row >= 2 && row <= 5) val += 0.3;

    score += piece.player === player ? val : -val;
  }

  return score;
}

/** Get all possible multi-jump chains from a piece (for AI lookahead) */
export function getAllJumpSequences(board: Board, index: number): Move[][] {
  const piece = board[index];
  if (!piece) {
    return [];
  }

  const jumps = getJumpMoves(board, index);
  if (jumps.length === 0) {
    return [];
  }

  const sequences: Move[][] = [];

  for (const jump of jumps) {
    const newBoard = applyMove(board, jump);
    // Check if kinging would end the chain
    if (shouldKing(newBoard, jump.to)) {
      sequences.push([jump]);
      continue;
    }
    const continuations = getAllJumpSequences(newBoard, jump.to);
    if (continuations.length === 0) {
      sequences.push([jump]);
    } else {
      for (const cont of continuations) {
        sequences.push([jump, ...cont]);
      }
    }
  }

  return sequences;
}

/** Apply a full sequence of moves to a board */
function applyMoveSequence(board: Board, moves: Move[]): Board {
  let b = board;
  for (const m of moves) {
    b = applyMove(b, m);
    if (shouldKing(b, m.to)) {
      b = promotePiece(b, m.to);
    }
  }

  return b;
}

/** Minimax with alpha-beta pruning */
function minimax(
  board: Board,
  player: Player,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  aiPlayer: Player,
): number {
  const current = maximizing ? aiPlayer : opponent(aiPlayer);

  if (depth === 0 || hasNoValidMoves(board, current)) {
    return evaluateBoard(board, aiPlayer);
  }

  const moves = getAllValidMoves(board, current);

  if (maximizing) {
    let best = Number.NEGATIVE_INFINITY;
    for (const move of moves) {
      // Expand multi-jump chains
      if (move.captured !== null) {
        const sequences = getAllJumpSequences(board, move.from);
        for (const seq of sequences) {
          const newBoard = applyMoveSequence(board, seq);
          const score = minimax(
            newBoard,
            player,
            depth - 1,
            alpha,
            beta,
            false,
            aiPlayer,
          );
          best = Math.max(best, score);
          alpha = Math.max(alpha, score);
          if (beta <= alpha) break;
        }
        if (beta <= alpha) break;
      } else {
        let newBoard = applyMove(board, move);
        if (shouldKing(newBoard, move.to)) {
          newBoard = promotePiece(newBoard, move.to);
        }
        const score = minimax(
          newBoard,
          player,
          depth - 1,
          alpha,
          beta,
          false,
          aiPlayer,
        );
        best = Math.max(best, score);
        alpha = Math.max(alpha, score);
        if (beta <= alpha) break;
      }
    }

    return best;
  }
  let best = Number.POSITIVE_INFINITY;
  for (const move of moves) {
    if (move.captured !== null) {
      const sequences = getAllJumpSequences(board, move.from);
      for (const seq of sequences) {
        const newBoard = applyMoveSequence(board, seq);
        const score = minimax(
          newBoard,
          player,
          depth - 1,
          alpha,
          beta,
          true,
          aiPlayer,
        );
        best = Math.min(best, score);
        beta = Math.min(beta, score);
        if (beta <= alpha) break;
      }
      if (beta <= alpha) break;
    } else {
      let newBoard = applyMove(board, move);
      if (shouldKing(newBoard, move.to)) {
        newBoard = promotePiece(newBoard, move.to);
      }
      const score = minimax(
        newBoard,
        player,
        depth - 1,
        alpha,
        beta,
        true,
        aiPlayer,
      );
      best = Math.min(best, score);
      beta = Math.min(beta, score);
      if (beta <= alpha) break;
    }
  }

  return best;
}

/** Pick the best move for the AI player. Returns null if no moves available. */
export function pickAiMove(board: Board, player: Player): Move | null {
  const moves = getAllValidMoves(board, player);
  if (moves.length === 0) {
    return null;
  }

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestMove: Move = moves[0];

  // Dedupe by "from" index for jump moves to avoid evaluating same chain starts multiple times
  const seen = new Set<string>();

  for (const move of moves) {
    const key = `${move.from}-${move.to}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (move.captured !== null) {
      const sequences = getAllJumpSequences(board, move.from);
      for (const seq of sequences) {
        const newBoard = applyMoveSequence(board, seq);
        const score = minimax(
          newBoard,
          player,
          3,
          Number.NEGATIVE_INFINITY,
          Number.POSITIVE_INFINITY,
          false,
          player,
        );
        if (score > bestScore) {
          bestScore = score;
          bestMove = seq[0]; // Return first move of best sequence
        }
      }
    } else {
      let newBoard = applyMove(board, move);
      if (shouldKing(newBoard, move.to)) {
        newBoard = promotePiece(newBoard, move.to);
      }
      const score = minimax(
        newBoard,
        player,
        3,
        Number.NEGATIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        false,
        player,
      );
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }
  }

  return bestMove;
}

/** Pick best jump continuation from a specific square (for multi-jump chains) */
export function pickAiJumpFrom(
  board: Board,
  index: number,
  player: Player,
): Move | null {
  const jumps = getJumpMoves(board, index);
  if (jumps.length === 0) {
    return null;
  }
  if (jumps.length === 1) {
    return jumps[0];
  }

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestMove: Move = jumps[0];

  for (const jump of jumps) {
    const newBoard = applyMove(board, jump);
    const score = evaluateBoard(newBoard, player);
    if (score > bestScore) {
      bestScore = score;
      bestMove = jump;
    }
  }

  return bestMove;
}
