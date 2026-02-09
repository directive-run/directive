/**
 * Checkers - Directive Module
 *
 * Constraint-driven checkers game. Pure game logic lives in rules.ts;
 * this file coordinates it through Directive's fact→derivation→constraint→resolver flow.
 */

import { createModule, t, type ModuleSchema } from "directive";
import {
  type Board,
  type Player,
  type Move,
  createInitialBoard,
  getAllValidMoves,
  getJumpMoves,
  getValidMovesForPiece,
  playerHasJumps,
  applyMove,
  shouldKing,
  promotePiece,
  countPieces,
  opponent,
  hasNoValidMoves,
  pickAiMove,
  pickAiJumpFrom,
} from "./rules.js";

// ============================================================================
// Schema
// ============================================================================

export const checkersSchema = {
  facts: {
    board: t.any<Board>(),
    currentPlayer: t.any<Player>(),
    selectedIndex: t.any<number | null>(),
    targetIndex: t.any<number | null>(),
    mustContinueFrom: t.any<number | null>(),
    message: t.string(),
    moveCount: t.number(),
    capturedCount: t.any<{ red: number; black: number }>(),
    gameOver: t.boolean(),
    winner: t.any<Player | null>(),
    gameMode: t.any<"2player" | "computer" | "ai">(),
    aiPlayer: t.any<Player>(),
  },
  derivations: {
    validMoves: t.any<Move[]>(),
    jumpRequired: t.boolean(),
    highlightSquares: t.any<number[]>(),
    selectableSquares: t.any<number[]>(),
    redCount: t.number(),
    blackCount: t.number(),
    score: t.string(),
  },
  events: {
    clickSquare: { index: t.number() },
    newGame: {},
    setGameMode: { mode: t.any<"2player" | "computer" | "ai">() },
    aiMove: {},
    claudeMove: { from: t.number(), to: t.number() },
  },
  requirements: {
    EXECUTE_MOVE: {
      from: t.number(),
      to: t.number(),
      captured: t.any<number | null>(),
    },
    KING_PIECE: { index: t.number() },
    END_GAME: { winner: t.any<Player>(), reason: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

export const checkersGame = createModule("checkers", {
  schema: checkersSchema,

  init: (facts) => {
    facts.board = createInitialBoard();
    facts.currentPlayer = "red";
    facts.selectedIndex = null;
    facts.targetIndex = null;
    facts.mustContinueFrom = null;
    facts.message = "Red's turn. Select a piece to move.";
    facts.moveCount = 0;
    facts.capturedCount = { red: 0, black: 0 };
    facts.gameOver = false;
    facts.winner = null;
    facts.gameMode = "2player";
    facts.aiPlayer = "black";
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    validMoves: (facts) => {
      const sel = facts.selectedIndex as number | null;
      if (sel === null) return [];
      return getValidMovesForPiece(facts.board, sel);
    },

    jumpRequired: (facts) => {
      return playerHasJumps(facts.board, facts.currentPlayer);
    },

    highlightSquares: (facts) => {
      const sel = facts.selectedIndex as number | null;
      if (sel === null) return [];
      const moves = getValidMovesForPiece(facts.board, sel);
      return moves.map((m) => m.to);
    },

    selectableSquares: (facts) => {
      if (facts.gameOver) return [];
      if (facts.gameMode !== "2player" && facts.currentPlayer === facts.aiPlayer) return [];
      const cont = facts.mustContinueFrom as number | null;
      if (cont !== null) return [cont];
      const allMoves = getAllValidMoves(facts.board, facts.currentPlayer);
      const fromIndices = new Set(allMoves.map((m) => m.from));
      return [...fromIndices];
    },

    redCount: (facts) => countPieces(facts.board).red,
    blackCount: (facts) => countPieces(facts.board).black,

    score: (facts, derive) => {
      // Touch facts.board for dependency tracking (derive reads alone aren't tracked)
      facts.board;
      return `Red ${derive.redCount} — Black ${derive.blackCount}`;
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    clickSquare: (facts, { index }) => {
      if (facts.gameOver) return;
      // Ignore clicks during AI's turn in computer/ai mode
      if (facts.gameMode !== "2player" && facts.currentPlayer === facts.aiPlayer) return;

      const board = facts.board as Board;
      const player = facts.currentPlayer as Player;
      const selected = facts.selectedIndex as number | null;
      const cont = facts.mustContinueFrom as number | null;
      const piece = board[index];

      // During multi-jump: only accept valid jump targets for the continuing piece
      if (cont !== null) {
        const jumps = getJumpMoves(board, cont);
        const validTarget = jumps.find((m) => m.to === index);
        if (validTarget) {
          facts.selectedIndex = cont;
          facts.targetIndex = index;
        } else if (index !== cont) {
          facts.message = "You must continue jumping with the same piece.";
        }
        return;
      }

      // Clicking own piece → select it
      if (piece && piece.player === player) {
        // Enforce forced capture: if jumps exist globally, only pieces with jumps are selectable
        const hasJumps = playerHasJumps(board, player);
        if (hasJumps && getJumpMoves(board, index).length === 0) {
          facts.message = "You must make a jump! Select a piece that can capture.";
          return;
        }
        facts.selectedIndex = index;
        facts.targetIndex = null;
        facts.message = `Selected. Choose a destination.`;
        return;
      }

      // Piece is selected + clicking a valid move target → set targetIndex
      if (selected !== null) {
        const moves = getValidMovesForPiece(board, selected);
        const move = moves.find((m) => m.to === index);
        if (move) {
          facts.targetIndex = index;
          return;
        }
      }

      // Clicking empty or opponent square with nothing selected
      facts.selectedIndex = null;
      facts.targetIndex = null;
      if (selected !== null) {
        facts.message = "Invalid move. Select one of your pieces.";
      }
    },

    newGame: (facts) => {
      const mode = facts.gameMode;
      facts.board = createInitialBoard();
      facts.currentPlayer = "red";
      facts.selectedIndex = null;
      facts.targetIndex = null;
      facts.mustContinueFrom = null;
      facts.message = "Red's turn. Select a piece to move.";
      facts.moveCount = 0;
      facts.capturedCount = { red: 0, black: 0 };
      facts.gameOver = false;
      facts.winner = null;
      facts.gameMode = mode;
      facts.aiPlayer = "black";
    },

    setGameMode: (facts, { mode }) => {
      facts.board = createInitialBoard();
      facts.currentPlayer = "red";
      facts.selectedIndex = null;
      facts.targetIndex = null;
      facts.mustContinueFrom = null;
      facts.message = "Red's turn. Select a piece to move.";
      facts.moveCount = 0;
      facts.capturedCount = { red: 0, black: 0 };
      facts.gameOver = false;
      facts.winner = null;
      facts.gameMode = mode;
      facts.aiPlayer = "black";
    },

    aiMove: (facts) => {
      if (facts.gameOver) return;
      if (facts.gameMode !== "computer") return;
      if (facts.currentPlayer !== facts.aiPlayer) return;

      const board = facts.board as Board;
      const player = facts.currentPlayer as Player;
      const cont = facts.mustContinueFrom as number | null;

      if (cont !== null) {
        // Multi-jump continuation: pick best jump from the continuing piece
        const jump = pickAiJumpFrom(board, cont, player);
        if (jump) {
          facts.selectedIndex = cont;
          facts.targetIndex = jump.to;
        }
      } else {
        // Normal turn: pick best move
        const move = pickAiMove(board, player);
        if (move) {
          facts.selectedIndex = move.from;
          facts.targetIndex = move.to;
        }
      }
    },

    claudeMove: (facts, { from, to }) => {
      if (facts.gameOver) return;
      if (facts.gameMode !== "ai") return;
      if (facts.currentPlayer !== facts.aiPlayer) return;

      facts.selectedIndex = from;
      facts.targetIndex = to;
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    executeMove: {
      priority: 100,
      when: (facts) => {
        if (facts.gameOver) return false;
        const sel = facts.selectedIndex as number | null;
        const target = facts.targetIndex as number | null;
        if (sel === null || target === null) return false;
        const moves = getValidMovesForPiece(facts.board, sel);
        return moves.some((m) => m.to === target);
      },
      require: (facts) => {
        const sel = facts.selectedIndex as number;
        const target = facts.targetIndex as number;
        const moves = getValidMovesForPiece(facts.board, sel);
        const move = moves.find((m) => m.to === target)!;
        return {
          type: "EXECUTE_MOVE",
          from: move.from,
          to: move.to,
          captured: move.captured,
        };
      },
    },

    kingPiece: {
      priority: 80,
      when: (facts) => {
        if (facts.gameOver) return false;
        // Check the entire board for pieces that should be kinged
        const board = facts.board as Board;
        for (let i = 0; i < 64; i++) {
          if (shouldKing(board, i)) return true;
        }
        return false;
      },
      require: (facts) => {
        const board = facts.board as Board;
        for (let i = 0; i < 64; i++) {
          if (shouldKing(board, i)) {
            return { type: "KING_PIECE", index: i };
          }
        }
        // Shouldn't reach here since `when` already verified
        return { type: "KING_PIECE", index: 0 };
      },
    },

    gameOver: {
      priority: 50,
      when: (facts) => {
        if (facts.gameOver) return false;
        // Only check after a turn is fully complete (no pending multi-jump)
        if (facts.mustContinueFrom !== null) return false;
        return hasNoValidMoves(facts.board, facts.currentPlayer);
      },
      require: (facts) => ({
        type: "END_GAME",
        winner: opponent(facts.currentPlayer),
        reason: `${opponent(facts.currentPlayer)} wins! ${facts.currentPlayer} has no valid moves.`,
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    executeMove: {
      requirement: "EXECUTE_MOVE",
      resolve: async (req, ctx) => {
        const board = ctx.facts.board as Board;
        const move: Move = { from: req.from, to: req.to, captured: req.captured };

        // Apply the move
        let newBoard = applyMove(board, move);

        // Track captures
        if (req.captured !== null) {
          const capturedPiece = board[req.captured];
          if (capturedPiece) {
            const counts = { ...(ctx.facts.capturedCount as { red: number; black: number }) };
            counts[capturedPiece.player]++;
            ctx.facts.capturedCount = counts;
          }
        }

        ctx.facts.moveCount++;

        // Check kinging
        if (shouldKing(newBoard, req.to)) {
          // Kinging ends the turn (standard American checkers)
          newBoard = promotePiece(newBoard, req.to);
          ctx.facts.board = newBoard;
          ctx.facts.selectedIndex = null;
          ctx.facts.targetIndex = null;
          ctx.facts.mustContinueFrom = null;
          const next = opponent(ctx.facts.currentPlayer);
          ctx.facts.currentPlayer = next;
          ctx.facts.message = `Kinged! ${next}'s turn.`;
          return;
        }

        // Check for multi-jump continuation
        if (req.captured !== null) {
          const moreJumps = getJumpMoves(newBoard, req.to);
          if (moreJumps.length > 0) {
            ctx.facts.board = newBoard;
            ctx.facts.selectedIndex = req.to;
            ctx.facts.targetIndex = null;
            ctx.facts.mustContinueFrom = req.to;
            ctx.facts.message = "Jump again! You must continue capturing.";
            return;
          }
        }

        // Normal turn end: switch players
        ctx.facts.board = newBoard;
        ctx.facts.selectedIndex = null;
        ctx.facts.targetIndex = null;
        ctx.facts.mustContinueFrom = null;
        const next = opponent(ctx.facts.currentPlayer);
        ctx.facts.currentPlayer = next;
        ctx.facts.message = `${next}'s turn.`;
      },
    },

    kingPiece: {
      requirement: "KING_PIECE",
      resolve: async (req, ctx) => {
        ctx.facts.board = promotePiece(ctx.facts.board, req.index);
      },
    },

    endGame: {
      requirement: "END_GAME",
      resolve: async (req, ctx) => {
        ctx.facts.gameOver = true;
        ctx.facts.winner = req.winner;
        ctx.facts.selectedIndex = null;
        ctx.facts.targetIndex = null;
        ctx.facts.mustContinueFrom = null;
        ctx.facts.message = req.reason;
      },
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    moveLog: {
      deps: ["moveCount"],
      run: (facts) => {
        if (facts.moveCount > 0) {
          const { red, black } = countPieces(facts.board);
          console.log(`[Checkers] Move ${facts.moveCount} | Red: ${red}, Black: ${black}`);
        }
      },
    },

    gameOverLog: {
      deps: ["gameOver"],
      run: (facts) => {
        if (facts.gameOver) {
          const { red, black } = countPieces(facts.board);
          console.log(
            `[Checkers] Game Over! Winner: ${facts.winner} | ` +
            `Moves: ${facts.moveCount} | Red: ${red}, Black: ${black}`
          );
        }
      },
    },
  },
});
