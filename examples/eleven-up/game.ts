/**
 * Eleven Up - Card Game Module
 *
 * A solitaire card game demonstrating Directive's constraint-driven architecture.
 *
 * Rules:
 * - Remove pairs of cards that add up to 11 (A=1, 2-10 face value)
 * - Remove sets of three face cards (J, Q, K)
 * - Goal: Clear all cards from the table
 */

import { createModule, t, type ModuleSchema } from "@directive-run/core";

// ============================================================================
// Types
// ============================================================================

export type Suit = "hearts" | "diamonds" | "clubs" | "spades";
export type Rank =
  | "A"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K";

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  value: number;
}

// ============================================================================
// Helpers
// ============================================================================

function createDeck(): Card[] {
  const suits: Suit[] = ["hearts", "diamonds", "clubs", "spades"];
  const ranks: Rank[] = [
    "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K",
  ];

  const cards: Card[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      let value: number;
      if (rank === "A") value = 1;
      else if (rank === "J" || rank === "Q" || rank === "K") value = 0;
      else value = parseInt(rank);

      cards.push({ id: `${rank}-${suit}`, suit, rank, value });
    }
  }
  return cards;
}

function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function isFaceCard(card: Card): boolean {
  return card.rank === "J" || card.rank === "Q" || card.rank === "K";
}

export function getSuitSymbol(suit: Suit): string {
  return { hearts: "♥", diamonds: "♦", clubs: "♣", spades: "♠" }[suit];
}

export function isRedSuit(suit: Suit): boolean {
  return suit === "hearts" || suit === "diamonds";
}

/** Find an auto-combo candidate that involves at least one newly-dealt card */
function findAutoCombo(table: Card[], selected: string[], newCardIds: string[]): string[] | null {
  if (selected.length > 0) return null;
  if (newCardIds.length === 0) return null;

  const newSet = new Set(newCardIds);

  // Check for number pairs that sum to 11 (at least one card must be new)
  const numberCards = table.filter((c) => !isFaceCard(c));
  for (let i = 0; i < numberCards.length; i++) {
    for (let j = i + 1; j < numberCards.length; j++) {
      if (numberCards[i].value + numberCards[j].value === 11) {
        if (newSet.has(numberCards[i].id) || newSet.has(numberCards[j].id)) {
          return [numberCards[i].id, numberCards[j].id];
        }
      }
    }
  }

  // Check for J+Q+K sets (at least one must be new)
  const jacks = table.filter((c) => c.rank === "J");
  const queens = table.filter((c) => c.rank === "Q");
  const kings = table.filter((c) => c.rank === "K");
  if (jacks.length > 0 && queens.length > 0 && kings.length > 0) {
    const trio = [jacks[0].id, queens[0].id, kings[0].id];
    if (trio.some((id) => newSet.has(id))) {
      return trio;
    }
  }

  return null;
}

function countValidMoves(table: Card[]): { pairs: number; faceCardSets: number } {
  let pairs = 0;
  let faceCardSets = 0;

  const numberCards = table.filter((c) => !isFaceCard(c));
  for (let i = 0; i < numberCards.length; i++) {
    for (let j = i + 1; j < numberCards.length; j++) {
      if (numberCards[i].value + numberCards[j].value === 11) pairs++;
    }
  }

  const jacks = table.filter((c) => c.rank === "J").length;
  const queens = table.filter((c) => c.rank === "Q").length;
  const kings = table.filter((c) => c.rank === "K").length;
  faceCardSets = jacks * queens * kings;

  return { pairs, faceCardSets };
}

// ============================================================================
// Schema
// ============================================================================

export const elevenUpSchema = {
  facts: {
    deck: t.any<Card[]>(),
    table: t.any<Card[]>(),
    removed: t.any<Card[]>(),
    selected: t.any<string[]>(),
    lastMessage: t.string(),
    gameOver: t.boolean(),
    won: t.boolean(),
    moveCount: t.number(),
    currentStreak: t.number(),
    maxStreak: t.number(),
    lastMoveTimestamp: t.number(),
    comboCount: t.number(),
    newCardIds: t.any<string[]>(),
  },
  derivations: {
    deckCount: t.number(),
    removedCount: t.number(),
    selectedCards: t.any<Card[]>(),
    selectionFeedback: t.string(),
    hasValidMoves: t.boolean(),
    totalValidMoves: t.number(),
    progress: t.number(),
    isActiveGame: t.boolean(),
    streakInfo: t.any<{ current: number; max: number; isHot: boolean }>(),
    scoreLabel: t.string(),
    comboMessage: t.string(),
  },
  events: {
    newGame: {},
    selectCard: { cardId: t.string() },
    deselectCard: { cardId: t.string() },
    clearSelection: {},
  },
  requirements: {
    REMOVE_CARDS: { cardIds: t.any<string[]>(), reason: t.string() },
    REFILL_TABLE: { count: t.number() },
    END_GAME: { won: t.boolean(), reason: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Module Definition
// ============================================================================

export const elevenUpGame = createModule("eleven-up", {
  schema: elevenUpSchema,

  init: (facts) => {
    const deck = shuffle(createDeck());
    facts.deck = deck.slice(9);
    facts.table = deck.slice(0, 9);
    facts.removed = [];
    facts.selected = [];
    facts.lastMessage = "Select cards that add to 11!";
    facts.gameOver = false;
    facts.won = false;
    facts.moveCount = 0;
    facts.currentStreak = 0;
    facts.maxStreak = 0;
    facts.lastMoveTimestamp = 0;
    facts.comboCount = 0;
    facts.newCardIds = [];
  },

  // ============================================================================
  // Derivations - Computed feedback avoids infinite loops
  // ============================================================================

  derive: {
    deckCount: (facts) => facts.deck.length,
    removedCount: (facts) => facts.removed.length,
    selectedCards: (facts) =>
      facts.table.filter((c: Card) => facts.selected.includes(c.id)),

    // Feedback is computed, not set by constraints (avoids loops)
    selectionFeedback: (facts) => {
      const selected = facts.table.filter((c: Card) =>
        facts.selected.includes(c.id)
      );

      if (selected.length === 0) {
        return facts.lastMessage;
      }

      if (selected.length === 1) {
        const card = selected[0];
        if (isFaceCard(card)) {
          const missing = ["J", "Q", "K"].filter((r) => r !== card.rank);
          return `${card.rank} selected - need ${missing.join(" and ")} for a set`;
        }
        return `${card.value} selected - find a card that adds to 11`;
      }

      if (selected.length === 2) {
        const [a, b] = selected;
        const bothFace = isFaceCard(a) && isFaceCard(b);
        const bothNumber = !isFaceCard(a) && !isFaceCard(b);

        if (bothNumber) {
          const sum = a.value + b.value;
          if (sum === 11) {
            return `${a.value} + ${b.value} = 11! Removing...`;
          }
          return `${a.value} + ${b.value} = ${sum} (need 11)`;
        }

        if (bothFace) {
          const ranks = [a.rank, b.rank];
          const missing = ["J", "Q", "K"].find((r) => !ranks.includes(r as Rank));
          return `Need ${missing} to complete J+Q+K`;
        }

        return "Can't mix face cards with number cards";
      }

      if (selected.length === 3) {
        if (selected.every((c: Card) => isFaceCard(c))) {
          const ranks = selected.map((c: Card) => c.rank).sort();
          if (ranks[0] === "J" && ranks[1] === "K" && ranks[2] === "Q") {
            return "J + Q + K! Removing...";
          }
          return "Need exactly one J, Q, and K";
        }
        return "Too many cards - clear and try again";
      }

      return "Too many cards selected";
    },

    totalValidMoves: (facts) => {
      const { pairs, faceCardSets } = countValidMoves(facts.table);
      return pairs + faceCardSets;
    },

    hasValidMoves: (facts) => {
      const { pairs, faceCardSets } = countValidMoves(facts.table);
      return pairs + faceCardSets > 0;
    },

    progress: (facts) => Math.round((facts.removed.length / 52) * 100),

    // Level 1 composition: depends only on facts
    isActiveGame: (facts) => !facts.gameOver && facts.table.length > 0,

    // Level 2 composition: reads derive.isActiveGame
    streakInfo: (facts, derive) => {
      // Touch facts for dependency tracking
      facts.currentStreak;
      facts.maxStreak;
      return {
        current: facts.currentStreak,
        max: facts.maxStreak,
        isHot: derive.isActiveGame && facts.currentStreak >= 3,
      };
    },

    // Level 3 composition: reads derive.streakInfo
    scoreLabel: (facts, derive) => {
      facts.moveCount;
      facts.removed;
      const streak = derive.streakInfo;
      const removed = facts.removed.length;
      if (streak.isHot) {
        return `${removed}/52 removed | ${streak.current} streak!`;
      }
      if (streak.current > 0) {
        return `${removed}/52 removed | ${streak.current} in a row`;
      }
      return `${removed}/52 removed | ${facts.moveCount} moves`;
    },

    // Level 2 composition: reads derive.streakInfo
    comboMessage: (facts, derive) => {
      facts.comboCount;
      const streak = derive.streakInfo;
      if (facts.comboCount > 0 && streak.isHot) {
        return `Auto-combo x${facts.comboCount} + ${streak.current} streak!`;
      }
      if (facts.comboCount > 0) {
        return `Auto-combo x${facts.comboCount}!`;
      }
      return "";
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    newGame: (facts) => {
      const deck = shuffle(createDeck());
      facts.deck = deck.slice(9);
      facts.table = deck.slice(0, 9);
      facts.removed = [];
      facts.selected = [];
      facts.lastMessage = "New game! Select cards that add to 11.";
      facts.gameOver = false;
      facts.won = false;
      facts.moveCount = 0;
      facts.currentStreak = 0;
      facts.maxStreak = 0;
      facts.lastMoveTimestamp = 0;
      facts.comboCount = 0;
      facts.newCardIds = [];
    },

    selectCard: (facts, { cardId }) => {
      if (!facts.selected.includes(cardId) && !facts.gameOver) {
        facts.selected = [...facts.selected, cardId];
      }
    },

    deselectCard: (facts, { cardId }) => {
      facts.selected = facts.selected.filter((id: string) => id !== cardId);
    },

    clearSelection: (facts) => {
      facts.selected = [];
    },
  },

  // ============================================================================
  // Effects - Fire-and-forget after facts stabilize
  // ============================================================================

  effects: {
    trackMoveTime: {
      deps: ["moveCount"],
      run: (facts) => {
        if (facts.moveCount > 0) {
          facts.lastMoveTimestamp = Date.now();
        }
      },
    },

    streakAnnouncement: {
      // Auto-tracked: reads currentStreak
      run: (facts) => {
        const streak = facts.currentStreak;
        if (streak === 3) console.log("[EFFECT] streak: Hat trick! 3 in a row!");
        else if (streak === 5) console.log("[EFFECT] streak: On fire! 5 in a row!");
        else if (streak === 10) console.log("[EFFECT] streak: Unstoppable! 10 in a row!");
      },
    },

    gameOverSummary: {
      deps: ["gameOver"],
      run: (facts) => {
        if (facts.gameOver) {
          const result = facts.won ? "WON" : "LOST";
          console.log(
            `[EFFECT] Game Over: ${result} | ${facts.moveCount} moves | ` +
            `${facts.removed.length}/52 removed | Best streak: ${facts.maxStreak} | ` +
            `Combos: ${facts.comboCount}`
          );
        }
      },
    },
  },

  // ============================================================================
  // Constraints - Only for actions that change game state
  // ============================================================================

  constraints: {
    // Valid pair: two number cards that add to 11
    pairAddsToEleven: {
      priority: 100,
      when: (facts) => {
        if (facts.gameOver) return false;
        const selected = facts.table.filter((c: Card) =>
          facts.selected.includes(c.id)
        );
        if (selected.length !== 2) return false;
        const [a, b] = selected;
        if (isFaceCard(a) || isFaceCard(b)) return false;
        return a.value + b.value === 11;
      },
      require: (facts) => ({
        type: "REMOVE_CARDS",
        cardIds: [...facts.selected],
        reason: "pair",
      }),
    },

    // Valid face card trio: J + Q + K
    faceCardTrio: {
      priority: 100,
      when: (facts) => {
        if (facts.gameOver) return false;
        const selected = facts.table.filter((c: Card) =>
          facts.selected.includes(c.id)
        );
        if (selected.length !== 3) return false;
        if (!selected.every((c: Card) => isFaceCard(c))) return false;
        const ranks = selected.map((c: Card) => c.rank).sort();
        return ranks[0] === "J" && ranks[1] === "K" && ranks[2] === "Q";
      },
      require: (facts) => ({
        type: "REMOVE_CARDS",
        cardIds: [...facts.selected],
        reason: "faceCards",
      }),
    },

    // Refill table when needed
    refillTable: {
      priority: 50,
      when: (facts) =>
        !facts.gameOver && facts.table.length < 9 && facts.deck.length > 0,
      require: (facts) => ({
        type: "REFILL_TABLE",
        count: Math.min(9 - facts.table.length, facts.deck.length),
      }),
    },

    // Auto-combo: when refill creates a natural pair/JQK, auto-remove it
    // Only fires after at least one user move (prevents eating initial deal)
    autoCombo: {
      priority: 75,
      when: (facts) => {
        if (facts.gameOver) return false;
        if (facts.moveCount === 0) return false;
        if (facts.selected.length > 0) return false;
        if (facts.table.length === 0) return false;
        return findAutoCombo(facts.table, facts.selected, facts.newCardIds) !== null;
      },
      require: (facts) => {
        const combo = findAutoCombo(facts.table, facts.selected, facts.newCardIds)!;
        return {
          type: "REMOVE_CARDS",
          cardIds: combo,
          reason: "autoCombo",
        };
      },
    },

    // Win condition
    playerWins: {
      priority: 200,
      when: (facts) => !facts.gameOver && facts.table.length === 0,
      require: (facts) => ({
        type: "END_GAME",
        won: true,
        reason: `You win! Cleared all cards in ${facts.moveCount} moves!`,
      }),
    },

    // Lose condition
    playerLoses: {
      priority: 190,
      when: (facts) => {
        if (facts.gameOver) return false;
        if (facts.table.length === 0) return false;
        if (facts.deck.length > 0) return false;
        const { pairs, faceCardSets } = countValidMoves(facts.table);
        return pairs + faceCardSets === 0;
      },
      require: (facts) => ({
        type: "END_GAME",
        won: false,
        reason: `Game over! Removed ${facts.removed.length} of 52 cards.`,
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    removeCards: {
      requirement: "REMOVE_CARDS",
      resolve: async (req, ctx) => {
        const cardsToRemove = ctx.facts.table.filter((c: Card) =>
          req.cardIds.includes(c.id)
        );

        ctx.facts.table = ctx.facts.table.filter(
          (c: Card) => !req.cardIds.includes(c.id)
        );
        ctx.facts.removed = [...ctx.facts.removed, ...cardsToRemove];
        ctx.facts.selected = [];

        const isAutoCombo = req.reason === "autoCombo";

        if (isAutoCombo) {
          // Auto-combos are freebies: no moveCount increment
          ctx.facts.comboCount++;
          const isPair = cardsToRemove.length === 2;
          ctx.facts.lastMessage = isPair
            ? `Auto-combo! ${cardsToRemove[0].value} + ${cardsToRemove[1].value} = 11`
            : "Auto-combo! J + Q + K";
        } else {
          // User move: track streak and moveCount, clear newCardIds
          ctx.facts.newCardIds = [];
          ctx.facts.moveCount++;
          ctx.facts.currentStreak++;
          if (ctx.facts.currentStreak > ctx.facts.maxStreak) {
            ctx.facts.maxStreak = ctx.facts.currentStreak;
          }

          ctx.facts.lastMessage =
            req.reason === "pair"
              ? `Removed ${cardsToRemove[0].value} + ${cardsToRemove[1].value} = 11!`
              : "Removed J + Q + K!";
        }
      },
    },

    refillTable: {
      requirement: "REFILL_TABLE",
      resolve: async (req, ctx) => {
        const newCards = ctx.facts.deck.slice(0, req.count);
        ctx.facts.deck = ctx.facts.deck.slice(req.count);
        ctx.facts.table = [...ctx.facts.table, ...newCards];
        ctx.facts.newCardIds = newCards.map((c: Card) => c.id);
      },
    },

    endGame: {
      requirement: "END_GAME",
      resolve: async (req, ctx) => {
        ctx.facts.gameOver = true;
        ctx.facts.won = req.won;
        ctx.facts.lastMessage = req.reason;
      },
    },
  },
});
