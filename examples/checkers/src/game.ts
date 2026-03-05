/**
 * Checkers - Directive Module
 *
 * Constraint-driven checkers game. Pure game logic lives in rules.ts;
 * this file coordinates it through Directive's fact→derivation→constraint→resolver flow.
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import {
  type Board,
  type Move,
  type Player,
  applyMove,
  countPieces,
  createInitialBoard,
  getAllValidMoves,
  getJumpMoves,
  getValidMovesForPiece,
  hasNoValidMoves,
  opponent,
  pickAiJumpFrom,
  pickAiMove,
  playerHasJumps,
  promotePiece,
  shouldKing,
} from "./rules.js";

// ============================================================================
// Schema
// ============================================================================

export const checkersSchema = {
  facts: {
    board: t.object<Board>(),
    currentPlayer: t.object<Player>(),
    selectedIndex: t.object<number | null>(),
    targetIndex: t.object<number | null>(),
    mustContinueFrom: t.object<number | null>(),
    message: t.string(),
    moveCount: t.number(),
    capturedCount: t.object<{ red: number; black: number }>(),
    gameOver: t.boolean(),
    winner: t.object<Player | null>(),
    gameMode: t.object<"2player" | "computer" | "ai">(),
    aiPlayer: t.object<Player>(),
  },
  derivations: {
    validMoves: t.array<Move>(),
    jumpRequired: t.boolean(),
    highlightSquares: t.array<number>(),
    selectableSquares: t.array<number>(),
    redCount: t.number(),
    blackCount: t.number(),
    score: t.string(),
  },
  events: {
    clickSquare: { index: t.number() },
    newGame: {},
    setGameMode: { mode: t.object<"2player" | "computer" | "ai">() },
    aiMove: {},
    claudeMove: { from: t.number(), to: t.number() },
  },
  requirements: {
    EXECUTE_MOVE: {
      from: t.number(),
      to: t.number(),
      captured: t.object<number | null>(),
    },
    KING_PIECE: { index: t.number() },
    END_GAME: { winner: t.object<Player>(), reason: t.string() },
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
      if (facts.selectedIndex === null) {
        return [];
      }

      return getValidMovesForPiece(facts.board, facts.selectedIndex);
    },

    jumpRequired: (facts) => {
      return playerHasJumps(facts.board, facts.currentPlayer);
    },

    highlightSquares: (facts) => {
      if (facts.selectedIndex === null) {
        return [];
      }
      const moves = getValidMovesForPiece(facts.board, facts.selectedIndex);

      return moves.map((m) => m.to);
    },

    selectableSquares: (facts) => {
      if (facts.gameOver) {
        return [];
      }
      if (
        facts.gameMode !== "2player" &&
        facts.currentPlayer === facts.aiPlayer
      ) {
        return [];
      }
      if (facts.mustContinueFrom !== null) {
        return [facts.mustContinueFrom];
      }
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
      if (facts.gameOver) {
        return;
      }
      // Ignore clicks during AI's turn in computer/ai mode
      if (
        facts.gameMode !== "2player" &&
        facts.currentPlayer === facts.aiPlayer
      ) {
        return;
      }

      const board = facts.board;
      const player = facts.currentPlayer;
      const selected = facts.selectedIndex;
      const cont = facts.mustContinueFrom;
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
          facts.message =
            "You must make a jump! Select a piece that can capture.";
          return;
        }
        facts.selectedIndex = index;
        facts.targetIndex = null;
        facts.message = "Selected. Choose a destination.";
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
      if (facts.gameOver) {
        return;
      }
      if (facts.gameMode !== "computer") {
        return;
      }
      if (facts.currentPlayer !== facts.aiPlayer) {
        return;
      }

      const board = facts.board;
      const player = facts.currentPlayer;
      const cont = facts.mustContinueFrom;

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
      if (facts.gameOver) {
        return;
      }
      if (facts.gameMode !== "ai") {
        return;
      }
      if (facts.currentPlayer !== facts.aiPlayer) {
        return;
      }

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
        if (facts.gameOver) {
          return false;
        }
        if (facts.selectedIndex === null || facts.targetIndex === null) {
          return false;
        }
        const moves = getValidMovesForPiece(facts.board, facts.selectedIndex);

        return moves.some((m) => m.to === facts.targetIndex);
      },
      require: (facts) => {
        const sel = facts.selectedIndex!;
        const target = facts.targetIndex!;
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
        if (facts.gameOver) {
          return false;
        }
        // Check the entire board for pieces that should be kinged
        for (let i = 0; i < 64; i++) {
          if (shouldKing(facts.board, i)) {
            return true;
          }
        }

        return false;
      },
      require: (facts) => {
        for (let i = 0; i < 64; i++) {
          if (shouldKing(facts.board, i)) {
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
        if (facts.gameOver) {
          return false;
        }
        // Only check after a turn is fully complete (no pending multi-jump)
        if (facts.mustContinueFrom !== null) {
          return false;
        }

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
      resolve: async (req, context) => {
        const board = context.facts.board;
        const move: Move = {
          from: req.from,
          to: req.to,
          captured: req.captured,
        };

        // Apply the move
        let newBoard = applyMove(board, move);

        // Track captures
        if (req.captured !== null) {
          const capturedPiece = board[req.captured];
          if (capturedPiece) {
            const counts = { ...context.facts.capturedCount };
            counts[capturedPiece.player]++;
            context.facts.capturedCount = counts;
          }
        }

        context.facts.moveCount++;

        // Check kinging
        if (shouldKing(newBoard, req.to)) {
          // Kinging ends the turn (standard American checkers)
          newBoard = promotePiece(newBoard, req.to);
          context.facts.board = newBoard;
          context.facts.selectedIndex = null;
          context.facts.targetIndex = null;
          context.facts.mustContinueFrom = null;
          const next = opponent(context.facts.currentPlayer);
          context.facts.currentPlayer = next;
          context.facts.message = `Kinged! ${next}'s turn.`;
          return;
        }

        // Check for multi-jump continuation
        if (req.captured !== null) {
          const moreJumps = getJumpMoves(newBoard, req.to);
          if (moreJumps.length > 0) {
            context.facts.board = newBoard;
            context.facts.selectedIndex = req.to;
            context.facts.targetIndex = null;
            context.facts.mustContinueFrom = req.to;
            context.facts.message = "Jump again! You must continue capturing.";
            return;
          }
        }

        // Normal turn end: switch players
        context.facts.board = newBoard;
        context.facts.selectedIndex = null;
        context.facts.targetIndex = null;
        context.facts.mustContinueFrom = null;
        const next = opponent(context.facts.currentPlayer);
        context.facts.currentPlayer = next;
        context.facts.message = `${next}'s turn.`;
      },
    },

    kingPiece: {
      requirement: "KING_PIECE",
      resolve: async (req, context) => {
        context.facts.board = promotePiece(context.facts.board, req.index);
      },
    },

    endGame: {
      requirement: "END_GAME",
      resolve: async (req, context) => {
        context.facts.gameOver = true;
        context.facts.winner = req.winner;
        context.facts.selectedIndex = null;
        context.facts.targetIndex = null;
        context.facts.mustContinueFrom = null;
        context.facts.message = req.reason;
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
          console.log(
            `[Checkers] Move ${facts.moveCount} | Red: ${red}, Black: ${black}`,
          );
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
              `Moves: ${facts.moveCount} | Red: ${red}, Black: ${black}`,
          );
        }
      },
    },
  },
});
