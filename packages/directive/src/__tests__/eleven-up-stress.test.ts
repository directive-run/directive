/**
 * Eleven Up stress tests for new features:
 * - Derivation composition (3-level chains)
 * - Effects system (auto-tracked + explicit deps)
 * - Auto-combo constraint chains (resolver→constraint→resolver loops)
 * - Streak tracking
 * - React useSyncExternalStore simulation with deep derivation chains
 */

import { describe, it, expect, vi } from "vitest";
import { createModule, createSystem, t, type ModuleSchema } from "../index";

// ============================================================================
// Test game module with ALL new features
// ============================================================================

interface Card {
  id: string;
  value: number;
  rank: string;
}

function makeCard(id: string, value: number, rank?: string): Card {
  return { id, value, rank: rank ?? String(value) };
}

/** Build a deterministic game module for testing */
function createTestGame(tableCards: Card[], deckCards: Card[]) {
  const schema = {
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
      isActiveGame: t.boolean(),
      streakInfo: t.any<{ current: number; max: number; isHot: boolean }>(),
      scoreLabel: t.string(),
      comboMessage: t.string(),
      hasValidMoves: t.boolean(),
    },
    events: {
      selectCard: { cardId: t.string() },
      newGame: {},
    },
    requirements: {
      REMOVE_CARDS: { cardIds: t.any<string[]>(), reason: t.string() },
      REFILL_TABLE: { count: t.number() },
      END_GAME: { won: t.boolean(), reason: t.string() },
    },
  } satisfies ModuleSchema;

  function findAutoCombo(table: Card[], selected: string[], newCardIds: string[]): string[] | null {
    if (selected.length > 0 || newCardIds.length === 0) return null;
    const newSet = new Set(newCardIds);
    for (let i = 0; i < table.length; i++) {
      for (let j = i + 1; j < table.length; j++) {
        if (table[i].value + table[j].value === 11) {
          if (newSet.has(table[i].id) || newSet.has(table[j].id)) {
            return [table[i].id, table[j].id];
          }
        }
      }
    }
    return null;
  }

  return createModule("stress-test", {
    schema,
    init: (facts) => {
      facts.deck = deckCards;
      facts.table = tableCards;
      facts.removed = [];
      facts.selected = [];
      facts.lastMessage = "Go!";
      facts.gameOver = false;
      facts.won = false;
      facts.moveCount = 0;
      facts.currentStreak = 0;
      facts.maxStreak = 0;
      facts.lastMoveTimestamp = 0;
      facts.comboCount = 0;
      facts.newCardIds = [];
    },

    derive: {
      deckCount: (facts) => facts.deck.length,
      removedCount: (facts) => facts.removed.length,

      // Level 1
      isActiveGame: (facts) => !facts.gameOver && facts.table.length > 0,

      // Level 2 — reads derive.isActiveGame
      streakInfo: (facts, derive) => {
        facts.currentStreak;
        facts.maxStreak;
        return {
          current: facts.currentStreak,
          max: facts.maxStreak,
          isHot: derive.isActiveGame && facts.currentStreak >= 3,
        };
      },

      // Level 3 — reads derive.streakInfo
      scoreLabel: (facts, derive) => {
        facts.moveCount;
        facts.removed;
        const streak = derive.streakInfo;
        const removed = facts.removed.length;
        if (streak.isHot) return `${removed} removed | ${streak.current} streak!`;
        if (streak.current > 0) return `${removed} removed | ${streak.current} in a row`;
        return `${removed} removed | ${facts.moveCount} moves`;
      },

      // Level 2 — reads derive.streakInfo
      comboMessage: (facts, derive) => {
        facts.comboCount;
        const streak = derive.streakInfo;
        if (facts.comboCount > 0 && streak.isHot) {
          return `combo x${facts.comboCount} + ${streak.current} streak!`;
        }
        if (facts.comboCount > 0) return `combo x${facts.comboCount}`;
        return "";
      },

      hasValidMoves: (facts) => {
        for (let i = 0; i < facts.table.length; i++) {
          for (let j = i + 1; j < facts.table.length; j++) {
            if ((facts.table[i] as Card).value + (facts.table[j] as Card).value === 11) return true;
          }
        }
        return false;
      },
    },

    effects: {
      trackMoveTime: {
        deps: ["moveCount"],
        run: (facts) => {
          if (facts.moveCount > 0) facts.lastMoveTimestamp = Date.now();
        },
      },
      streakAnnouncement: {
        run: (facts) => {
          // Auto-tracked: reads currentStreak
          if (facts.currentStreak === 3) console.log("[EFFECT] Hat trick!");
        },
      },
      gameOverSummary: {
        deps: ["gameOver"],
        run: (facts) => {
          if (facts.gameOver) console.log(`[EFFECT] Game over: ${facts.won}`);
        },
      },
    },

    events: {
      selectCard: (facts, { cardId }) => {
        if (!facts.selected.includes(cardId) && !facts.gameOver) {
          facts.selected = [...facts.selected, cardId];
        }
      },
      newGame: (facts) => {
        facts.deck = deckCards;
        facts.table = tableCards;
        facts.removed = [];
        facts.selected = [];
        facts.lastMessage = "Go!";
        facts.gameOver = false;
        facts.won = false;
        facts.moveCount = 0;
        facts.currentStreak = 0;
        facts.maxStreak = 0;
        facts.comboCount = 0;
        facts.newCardIds = [];
      },
    },

    constraints: {
      pairAddsToEleven: {
        priority: 100,
        when: (facts) => {
          if (facts.gameOver) return false;
          const sel = facts.table.filter((c: Card) => facts.selected.includes(c.id));
          if (sel.length !== 2) return false;
          return sel[0].value + sel[1].value === 11;
        },
        require: (facts) => ({
          type: "REMOVE_CARDS",
          cardIds: [...facts.selected],
          reason: "pair",
        }),
      },
      refillTable: {
        priority: 50,
        when: (facts) =>
          !facts.gameOver && facts.table.length < 9 && facts.deck.length > 0,
        require: (facts) => ({
          type: "REFILL_TABLE",
          count: Math.min(9 - facts.table.length, facts.deck.length),
        }),
      },
      autoCombo: {
        priority: 75,
        when: (facts) => {
          if (facts.gameOver || facts.moveCount === 0) return false;
          if (facts.selected.length > 0 || facts.table.length === 0) return false;
          return findAutoCombo(facts.table, facts.selected, facts.newCardIds) !== null;
        },
        require: (facts) => {
          const combo = findAutoCombo(facts.table, facts.selected, facts.newCardIds)!;
          return { type: "REMOVE_CARDS", cardIds: combo, reason: "autoCombo" };
        },
      },
      playerWins: {
        priority: 200,
        when: (facts) => !facts.gameOver && facts.table.length === 0,
        require: (facts) => ({
          type: "END_GAME", won: true, reason: "You win!",
        }),
      },
      playerLoses: {
        priority: 190,
        when: (facts) => {
          if (facts.gameOver || facts.table.length === 0 || facts.deck.length > 0) return false;
          for (let i = 0; i < facts.table.length; i++) {
            for (let j = i + 1; j < facts.table.length; j++) {
              if ((facts.table[i] as Card).value + (facts.table[j] as Card).value === 11) return false;
            }
          }
          return true;
        },
        require: () => ({
          type: "END_GAME", won: false, reason: "No moves left",
        }),
      },
    },

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

          if (req.reason === "autoCombo") {
            ctx.facts.comboCount++;
          } else {
            ctx.facts.newCardIds = [];
            ctx.facts.moveCount++;
            ctx.facts.currentStreak++;
            if (ctx.facts.currentStreak > ctx.facts.maxStreak) {
              ctx.facts.maxStreak = ctx.facts.currentStreak;
            }
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
}

// ============================================================================
// Tests
// ============================================================================

describe("Eleven Up stress tests", () => {

  it("derivation composition: 3-level chain updates correctly", async () => {
    // Table: [3,8] are a pair, deck has cards to refill
    const table = [
      makeCard("a", 3), makeCard("b", 8), makeCard("c", 5),
      makeCard("d", 6), makeCard("e", 2), makeCard("f", 9),
      makeCard("g", 4), makeCard("h", 7), makeCard("i", 1),
    ];
    // Deck values must NOT create auto-combo pairs with remaining table cards.
    // After removing a(3)+b(8), table has values [5,6,2,9,4,7,1].
    // Value 1 is safe: 1+10=11 and there's no 10 on table.
    const deck = [makeCard("j", 1), makeCard("k", 1)];

    const game = createTestGame(table, deck);
    const system = createSystem({ module: game });
    system.start();

    // Before any moves
    expect(system.derive.isActiveGame).toBe(true);
    expect(system.derive.streakInfo).toEqual({ current: 0, max: 0, isHot: false });
    expect(system.derive.scoreLabel).toBe("0 removed | 0 moves");
    expect(system.derive.comboMessage).toBe("");

    // Play move 1
    system.events.selectCard({ cardId: "a" });
    system.events.selectCard({ cardId: "b" });
    await new Promise(r => setTimeout(r, 300));

    expect(system.facts.currentStreak).toBe(1);
    expect(system.derive.streakInfo).toEqual({ current: 1, max: 1, isHot: false });
    expect(system.derive.scoreLabel).toBe("2 removed | 1 in a row");

    system.stop();
  });

  it("streak reaches 3 and triggers isHot in derivation chain", async () => {
    // Set up 3 easy pairs: [3,8], [5,6], [2,9] with neutral fillers and no auto-combo candidates in deck
    const table = [
      makeCard("a", 3), makeCard("b", 8), makeCard("c", 5),
      makeCard("d", 6), makeCard("e", 2), makeCard("f", 9),
      makeCard("g", 4), makeCard("h", 7), makeCard("i", 1),
    ];
    // Deck cards that DON'T form pairs with each other (all same value)
    const deck = [
      makeCard("j", 1), makeCard("k", 1), makeCard("l", 1),
      makeCard("m", 1), makeCard("n", 1), makeCard("o", 1),
    ];

    const game = createTestGame(table, deck);
    const system = createSystem({ module: game });
    system.start();

    // Move 1: 3+8
    system.events.selectCard({ cardId: "a" });
    system.events.selectCard({ cardId: "b" });
    await new Promise(r => setTimeout(r, 300));
    expect(system.facts.currentStreak).toBe(1);

    // Move 2: 5+6
    system.events.selectCard({ cardId: "c" });
    system.events.selectCard({ cardId: "d" });
    await new Promise(r => setTimeout(r, 300));
    expect(system.facts.currentStreak).toBe(2);

    // Move 3: 2+9 → streak hits 3 → isHot!
    system.events.selectCard({ cardId: "e" });
    system.events.selectCard({ cardId: "f" });
    await new Promise(r => setTimeout(r, 300));

    expect(system.facts.currentStreak).toBe(3);
    expect(system.facts.maxStreak).toBe(3);
    expect(system.derive.streakInfo.isHot).toBe(true);
    expect(system.derive.scoreLabel).toContain("streak!");
    expect(system.derive.comboMessage).toBe(""); // no combos

    system.stop();
  });

  it("auto-combo chain: refill creates pair that triggers cascade", async () => {
    // Table: [3,8] is a user pair. Deck starts with [5,6] which will auto-combo after refill
    const table = [
      makeCard("a", 3), makeCard("b", 8), makeCard("c", 4),
      makeCard("d", 4), makeCard("e", 4), makeCard("f", 4),
      makeCard("g", 4), makeCard("h", 4), makeCard("i", 4),
    ];
    // After removing a+b, refill with [x,y] = [5,6] → auto-combo
    // Then refill with [z,w] which don't form pairs → stop
    const deck = [
      makeCard("x", 5), makeCard("y", 6),  // these will auto-combo
      makeCard("z", 1), makeCard("w", 1),   // neutral refill after combo
    ];

    const game = createTestGame(table, deck);
    const system = createSystem({ module: game });
    system.start();

    // User removes 3+8
    system.events.selectCard({ cardId: "a" });
    system.events.selectCard({ cardId: "b" });
    await new Promise(r => setTimeout(r, 500));

    // Should have: 1 user move + 1 auto-combo = 4 cards removed
    expect(system.facts.moveCount).toBe(1);
    expect(system.facts.comboCount).toBe(1);
    expect(system.facts.removed).toHaveLength(4);
    expect(system.derive.comboMessage).toBe("combo x1");

    system.stop();
  });

  it("deep auto-combo chain (3 cascades) with no freeze", async () => {
    // Each refill introduces a pair that auto-combos
    const table = [
      makeCard("a", 3), makeCard("b", 8), makeCard("c", 4),
      makeCard("d", 4), makeCard("e", 4), makeCard("f", 4),
      makeCard("g", 4), makeCard("h", 4), makeCard("i", 4),
    ];
    const deck = [
      makeCard("r1", 5), makeCard("r2", 6),  // combo 1
      makeCard("r3", 2), makeCard("r4", 9),  // combo 2
      makeCard("r5", 1), makeCard("r6", 10), // combo 3
      makeCard("r7", 1), makeCard("r8", 1),  // neutral (stop chain)
    ];

    const game = createTestGame(table, deck);
    const system = createSystem({ module: game });
    system.start();

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("FREEZE: timed out after 3s")), 3000)
    );

    system.events.selectCard({ cardId: "a" });
    system.events.selectCard({ cardId: "b" });

    const settle = new Promise(resolve => setTimeout(resolve, 1000));
    await Promise.race([settle, timeout]);

    expect(system.facts.moveCount).toBe(1);
    expect(system.facts.comboCount).toBe(3);
    expect(system.facts.removed).toHaveLength(8); // 2 user + 6 auto-combo
    expect(system.derive.comboMessage).toBe("combo x3");

    system.stop();
  });

  it("React subscriber pattern with derivation composition — no infinite loop", async () => {
    const table = [
      makeCard("a", 3), makeCard("b", 8), makeCard("c", 5),
      makeCard("d", 6), makeCard("e", 4), makeCard("f", 4),
      makeCard("g", 4), makeCard("h", 4), makeCard("i", 4),
    ];
    const deck = [makeCard("j", 1), makeCard("k", 1)];

    const game = createTestGame(table, deck);
    const system = createSystem({ module: game });
    system.start();

    let renderCount = 0;
    const allFactKeys = [
      "deck", "table", "removed", "selected", "lastMessage",
      "moveCount", "gameOver", "currentStreak", "maxStreak", "comboCount", "newCardIds",
    ];
    const allDerivationKeys = [
      "deckCount", "removedCount", "isActiveGame",
      "streakInfo", "scoreLabel", "comboMessage", "hasValidMoves",
    ];

    // Simulate React: subscribe to ALL facts, on notify read ALL derivations
    for (const key of allFactKeys) {
      system.facts.$store.subscribe([key], () => {
        renderCount++;
        for (const dk of allDerivationKeys) {
          system.read(dk);
        }
      });
    }

    // Subscribe to derivations too
    system.subscribe(allDerivationKeys, () => {
      renderCount++;
      for (const dk of allDerivationKeys) {
        system.read(dk);
      }
    });

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("FREEZE: infinite loop detected")), 3000)
    );

    system.events.selectCard({ cardId: "a" });
    system.events.selectCard({ cardId: "b" });

    const settle = new Promise(resolve => setTimeout(resolve, 500));
    await Promise.race([settle, timeout]);

    expect(renderCount).toBeLessThan(500);
    expect(system.facts.removed).toHaveLength(2);
    expect(system.facts.currentStreak).toBe(1);
    // Verify L3 derivation is correct
    expect(system.derive.scoreLabel).toBe("2 removed | 1 in a row");

    system.stop();
  });

  it("React subscriber pattern during deep auto-combo chain — no infinite loop", async () => {
    const table = [
      makeCard("a", 3), makeCard("b", 8), makeCard("c", 4),
      makeCard("d", 4), makeCard("e", 4), makeCard("f", 4),
      makeCard("g", 4), makeCard("h", 4), makeCard("i", 4),
    ];
    const deck = [
      makeCard("r1", 5), makeCard("r2", 6),
      makeCard("r3", 2), makeCard("r4", 9),
      makeCard("r5", 1), makeCard("r6", 1),
    ];

    const game = createTestGame(table, deck);
    const system = createSystem({ module: game });
    system.start();

    let renderCount = 0;
    const allDerivationKeys = [
      "deckCount", "removedCount", "isActiveGame",
      "streakInfo", "scoreLabel", "comboMessage", "hasValidMoves",
    ];

    // Heavy subscriber: reads all derivations on every fact change
    for (const key of ["table", "removed", "selected", "moveCount", "comboCount", "newCardIds"]) {
      system.facts.$store.subscribe([key], () => {
        renderCount++;
        for (const dk of allDerivationKeys) {
          system.read(dk);
        }
      });
    }

    system.subscribe(allDerivationKeys, () => {
      renderCount++;
      for (const dk of allDerivationKeys) {
        system.read(dk);
      }
    });

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("FREEZE during auto-combo chain")), 3000)
    );

    system.events.selectCard({ cardId: "a" });
    system.events.selectCard({ cardId: "b" });

    const settle = new Promise(resolve => setTimeout(resolve, 1000));
    await Promise.race([settle, timeout]);

    expect(renderCount).toBeLessThan(1000);
    expect(system.facts.comboCount).toBe(2); // 2 auto-combos from deck pairs
    expect(system.facts.removed).toHaveLength(6);

    system.stop();
  });

  it("game over triggers END_GAME constraint and effect", async () => {
    // Table: one pair, empty deck → after removing, no moves left → game over
    const table = [
      makeCard("a", 3), makeCard("b", 8),
      makeCard("c", 4), makeCard("d", 4),
      makeCard("e", 4), makeCard("f", 4),
      makeCard("g", 4), makeCard("h", 4),
      makeCard("i", 4),
    ];
    const deck: Card[] = []; // empty deck

    const game = createTestGame(table, deck);
    const system = createSystem({ module: game });
    system.start();

    system.events.selectCard({ cardId: "a" });
    system.events.selectCard({ cardId: "b" });
    await new Promise(r => setTimeout(r, 500));

    // Table should be down to 7 cards, no valid pairs, no deck → game over
    expect(system.facts.gameOver).toBe(true);
    expect(system.facts.won).toBe(false);
    expect(system.facts.lastMessage).toBe("No moves left");

    system.stop();
  });

  it("win condition: remove all cards", async () => {
    // Only 2 cards on table, they form a pair, empty deck → win!
    const table = [makeCard("a", 3), makeCard("b", 8)];
    const deck: Card[] = [];

    const game = createTestGame(table, deck);
    const system = createSystem({ module: game });
    system.start();

    system.events.selectCard({ cardId: "a" });
    system.events.selectCard({ cardId: "b" });
    await new Promise(r => setTimeout(r, 500));

    expect(system.facts.gameOver).toBe(true);
    expect(system.facts.won).toBe(true);
    expect(system.derive.isActiveGame).toBe(false);
    expect(system.derive.streakInfo.isHot).toBe(false); // game over → not active

    system.stop();
  });

  it("rapid events during reconciliation don't corrupt state", async () => {
    const table = [
      makeCard("a", 3), makeCard("b", 8), makeCard("c", 5),
      makeCard("d", 6), makeCard("e", 2), makeCard("f", 9),
      makeCard("g", 4), makeCard("h", 7), makeCard("i", 1),
    ];
    const deck = [
      makeCard("j", 1), makeCard("k", 1), makeCard("l", 1),
      makeCard("m", 1), makeCard("n", 1), makeCard("o", 1),
    ];

    const game = createTestGame(table, deck);
    const system = createSystem({ module: game });
    system.start();

    // When 4 selectCard events fire synchronously, selected becomes ["a","b","c","d"]
    // before the constraint evaluates. The pairAddsToEleven constraint requires exactly
    // 2 selected cards, so it won't fire with 4. This tests that the engine handles
    // over-selection gracefully without crashing.
    system.events.selectCard({ cardId: "a" }); // 3
    system.events.selectCard({ cardId: "b" }); // 8
    system.events.selectCard({ cardId: "c" }); // 5
    system.events.selectCard({ cardId: "d" }); // 6

    await new Promise(r => setTimeout(r, 500));

    // No constraint fires because 4 cards are selected (need exactly 2).
    // Key assertion: NO crash, NO freeze, state is consistent.
    expect(system.facts.selected).toHaveLength(4);
    expect(system.facts.removed).toHaveLength(0);
    expect(system.facts.table).toHaveLength(9);

    // Now test sequential pairs: wait between moves so constraint can fire
    system.events.newGame();
    await new Promise(r => setTimeout(r, 100));

    system.events.selectCard({ cardId: "a" });
    system.events.selectCard({ cardId: "b" }); // 3+8=11, constraint fires
    await new Promise(r => setTimeout(r, 300));

    expect(system.facts.removed.length).toBeGreaterThanOrEqual(2);
    expect(system.facts.currentStreak).toBeGreaterThanOrEqual(1);

    system.stop();
  });

  it("effects fire: trackMoveTime updates lastMoveTimestamp", async () => {
    const table = [
      makeCard("a", 3), makeCard("b", 8), makeCard("c", 4),
      makeCard("d", 4), makeCard("e", 4), makeCard("f", 4),
      makeCard("g", 4), makeCard("h", 4), makeCard("i", 4),
    ];
    const deck = [makeCard("j", 1), makeCard("k", 1)];

    const game = createTestGame(table, deck);
    const system = createSystem({ module: game });
    system.start();

    expect(system.facts.lastMoveTimestamp).toBe(0);

    const before = Date.now();
    system.events.selectCard({ cardId: "a" });
    system.events.selectCard({ cardId: "b" });
    await new Promise(r => setTimeout(r, 300));
    const after = Date.now();

    // Effect should have set timestamp
    expect(system.facts.lastMoveTimestamp).toBeGreaterThanOrEqual(before);
    expect(system.facts.lastMoveTimestamp).toBeLessThanOrEqual(after);

    system.stop();
  });

  it("newGame event resets all state including streaks and combos", async () => {
    const table = [
      makeCard("a", 3), makeCard("b", 8), makeCard("c", 4),
      makeCard("d", 4), makeCard("e", 4), makeCard("f", 4),
      makeCard("g", 4), makeCard("h", 4), makeCard("i", 4),
    ];
    const deck = [
      makeCard("r1", 5), makeCard("r2", 6),
      makeCard("r3", 1), makeCard("r4", 1),
    ];

    const game = createTestGame(table, deck);
    const system = createSystem({ module: game });
    system.start();

    // Play a move that triggers auto-combo
    system.events.selectCard({ cardId: "a" });
    system.events.selectCard({ cardId: "b" });
    await new Promise(r => setTimeout(r, 500));

    expect(system.facts.moveCount).toBeGreaterThan(0);
    expect(system.facts.currentStreak).toBeGreaterThan(0);

    // Reset
    system.events.newGame();
    await new Promise(r => setTimeout(r, 300));

    expect(system.facts.moveCount).toBe(0);
    expect(system.facts.currentStreak).toBe(0);
    expect(system.facts.maxStreak).toBe(0);
    expect(system.facts.comboCount).toBe(0);
    expect(system.facts.newCardIds).toEqual([]);
    expect(system.facts.removed).toEqual([]);
    expect(system.derive.scoreLabel).toBe("0 removed | 0 moves");
    expect(system.derive.comboMessage).toBe("");

    system.stop();
  });

  it("cascading auto-combos exhaust entire deck without freeze", async () => {
    // Set up a table + deck where every refill creates a new auto-combo pair.
    // This creates a DEEP resolver→constraint→resolver chain.
    // Table: 9 cards with one pair (3+8=11), rest are 1s (safe from auto-combo).
    // Deck: alternating values that pair with remaining table cards after each cascade.
    const table = [
      makeCard("t0", 3), makeCard("t1", 8), // user pair
      makeCard("t2", 1), makeCard("t3", 1), makeCard("t4", 1),
      makeCard("t5", 1), makeCard("t6", 1), makeCard("t7", 1), makeCard("t8", 1),
    ];
    // After user removes t0+t1, table has 7 cards (all 1s), refill needs 2.
    // Deck pairs: each refill deals a pair that sums to 11 → auto-combo → refill again.
    const deck = [
      makeCard("d0", 4), makeCard("d1", 7),  // 4+7=11, auto-combo 1
      makeCard("d2", 5), makeCard("d3", 6),  // 5+6=11, auto-combo 2
      makeCard("d4", 2), makeCard("d5", 9),  // 2+9=11, auto-combo 3
      makeCard("d6", 3), makeCard("d7", 8),  // 3+8=11, auto-combo 4
      makeCard("d8", 4), makeCard("d9", 7),  // 4+7=11, auto-combo 5
    ];

    const game = createTestGame(table, deck);
    const system = createSystem({ module: game });
    system.start();

    // Trigger user move
    system.events.selectCard({ cardId: "t0" });
    system.events.selectCard({ cardId: "t1" });

    // Wait for deep chain to resolve (should NOT freeze)
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("FREEZE: deep cascade timed out")), 5000)
    );
    const settle = new Promise(r => setTimeout(r, 2000));
    await Promise.race([settle, timeout]);

    // User removed 2 + auto-combos should have eaten all 10 deck cards (5 pairs)
    // Total removed: 2 (user) + 10 (5 auto-combo pairs) = 12
    expect(system.facts.removed.length).toBe(12);
    expect(system.facts.comboCount).toBe(5);
    expect(system.facts.moveCount).toBe(1); // only user move counts
    expect(system.facts.currentStreak).toBe(1);
    expect(system.facts.deck).toHaveLength(0);

    system.stop();
  });

  it("subscriber unsubscribe during notification doesn't crash", async () => {
    const table = [
      makeCard("a", 3), makeCard("b", 8), makeCard("c", 1),
      makeCard("d", 1), makeCard("e", 1), makeCard("f", 1),
      makeCard("g", 1), makeCard("h", 1), makeCard("i", 1),
    ];
    const deck = [makeCard("j", 1), makeCard("k", 1)];

    const game = createTestGame(table, deck);
    const system = createSystem({ module: game });
    system.start();

    // Force derivation computation to establish dependency tracking
    system.read("scoreLabel");
    system.read("streakInfo");
    system.read("comboMessage");

    // Subscribe then immediately unsubscribe inside the callback
    let called = 0;
    const unsub = system.subscribe(["scoreLabel", "streakInfo", "comboMessage"], () => {
      called++;
      // Unsubscribe after first notification — should not crash
      unsub();
    });

    system.events.selectCard({ cardId: "a" });
    system.events.selectCard({ cardId: "b" });
    await new Promise(r => setTimeout(r, 300));

    // Should not crash, and subscriber should have been called at least once
    expect(called).toBeGreaterThanOrEqual(1);
    expect(system.facts.removed).toHaveLength(2);

    system.stop();
  });

  it("multiple concurrent subscribers reading all derivations don't cause infinite loop", async () => {
    const table = [
      makeCard("a", 3), makeCard("b", 8), makeCard("c", 5),
      makeCard("d", 6), makeCard("e", 2), makeCard("f", 9),
      makeCard("g", 4), makeCard("h", 7), makeCard("i", 1),
    ];
    // Deck creates one auto-combo (4+7=11) then safe cards
    const deck = [
      makeCard("j", 4), makeCard("k", 7),  // auto-combo
      makeCard("l", 1), makeCard("m", 1),   // safe
    ];

    const game = createTestGame(table, deck);
    const system = createSystem({ module: game });
    system.start();

    const allDerivations = ["deckCount", "removedCount", "isActiveGame", "streakInfo", "scoreLabel", "comboMessage", "hasValidMoves"];
    let totalCallbacks = 0;

    // 10 subscribers all reading all derivations (simulates 10 React components)
    const unsubs: (() => void)[] = [];
    for (let i = 0; i < 10; i++) {
      const unsub = system.subscribe(allDerivations, () => {
        totalCallbacks++;
        for (const d of allDerivations) {
          system.read(d);
        }
      });
      unsubs.push(unsub);
    }

    // Also subscribe to all facts (like 7 useFact hooks per component × 10 components)
    const factKeys = ["deck", "table", "removed", "selected", "lastMessage", "moveCount", "gameOver", "currentStreak", "maxStreak", "comboCount", "newCardIds"];
    for (let i = 0; i < 10; i++) {
      for (const key of factKeys) {
        system.facts.$store.subscribe([key], () => {
          totalCallbacks++;
          // Read all derivations on every fact change (like React re-render)
          for (const d of allDerivations) {
            system.read(d);
          }
        });
      }
    }

    // Trigger move + auto-combo chain
    system.events.selectCard({ cardId: "a" }); // 3
    system.events.selectCard({ cardId: "b" }); // 8 → remove → refill [4,7] → auto-combo

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("FREEZE: 10 subscribers timed out")), 3000)
    );
    const settle = new Promise(r => setTimeout(r, 1000));
    await Promise.race([settle, timeout]);

    // 2 (user) + 4 (2 auto-combos: g(4)+k(7)=11, then j(4)+h(7)=11) = 6 removed
    // Both auto-combos fire because newCardIds=["j","k"] persists between auto-combos,
    // and autoCombo (priority 75) runs before refillTable (priority 50).
    expect(system.facts.removed.length).toBe(6);
    expect(system.facts.comboCount).toBe(2);
    // Callbacks should be bounded (not millions)
    expect(totalCallbacks).toBeLessThan(5000);

    unsubs.forEach(u => u());
    system.stop();
  });

  it("interleaved selectCard and newGame events don't corrupt state", async () => {
    const table = [
      makeCard("a", 3), makeCard("b", 8), makeCard("c", 1),
      makeCard("d", 1), makeCard("e", 1), makeCard("f", 1),
      makeCard("g", 1), makeCard("h", 1), makeCard("i", 1),
    ];
    const deck = [makeCard("j", 1), makeCard("k", 1)];

    const game = createTestGame(table, deck);
    const system = createSystem({ module: game });
    system.start();

    // Select one card then immediately reset
    system.events.selectCard({ cardId: "a" });
    system.events.newGame();
    await new Promise(r => setTimeout(r, 300));

    // State should be clean reset
    expect(system.facts.selected).toEqual([]);
    expect(system.facts.removed).toEqual([]);
    expect(system.facts.moveCount).toBe(0);
    expect(system.facts.table).toHaveLength(9);

    // Select both cards then immediately reset before constraint fires
    system.events.selectCard({ cardId: "a" });
    system.events.selectCard({ cardId: "b" }); // would trigger constraint
    system.events.newGame(); // but reset comes first
    await new Promise(r => setTimeout(r, 300));

    // The newGame fires after both selects, resetting everything.
    // The constraint may or may not have fired before newGame.
    // Key: state must be consistent (either fully reset, or reset happened after removal).
    expect(system.facts.table).toHaveLength(9);
    expect(system.facts.selected).toEqual([]);

    system.stop();
  });
});
