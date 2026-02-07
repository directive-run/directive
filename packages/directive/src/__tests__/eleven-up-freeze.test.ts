/**
 * Reproduce the Eleven Up freeze bug.
 *
 * The freeze happens when:
 * 1. User selects two cards that add to 11
 * 2. Constraint fires → REMOVE_CARDS requirement
 * 3. Resolver modifies 5 facts (table, removed, selected, moveCount, lastMessage)
 * 4. React's useSyncExternalStore gets notified, calls getSnapshot
 * 5. getSnapshot reads derivations which access facts → possible infinite loop
 */

import { describe, it, expect, vi } from "vitest";
import { createModule, createSystem, t, type ModuleSchema } from "../index";

// ============================================================================
// Minimal card game module (same pattern as eleven-up)
// ============================================================================

interface Card {
  id: string;
  value: number;
}

function makeCards(values: number[]): Card[] {
  return values.map((v, i) => ({ id: `card-${i}`, value: v }));
}

const gameSchema = {
  facts: {
    deck: t.any<Card[]>(),
    table: t.any<Card[]>(),
    removed: t.any<Card[]>(),
    selected: t.any<string[]>(),
    lastMessage: t.string(),
    moveCount: t.number(),
    gameOver: t.boolean(),
  },
  derivations: {
    deckCount: t.number(),
    removedCount: t.number(),
    selectedCards: t.any<Card[]>(),
    selectionFeedback: t.string(),
    hasValidMoves: t.boolean(),
    totalValidMoves: t.number(),
    progress: t.number(),
  },
  events: {
    selectCard: { cardId: t.string() },
    deselectCard: { cardId: t.string() },
    clearSelection: {},
  },
  requirements: {
    REMOVE_CARDS: { cardIds: t.any<string[]>() },
    REFILL_TABLE: { count: t.number() },
  },
} satisfies ModuleSchema;

function createGameModule(tableCards: Card[], deckCards: Card[]) {
  return createModule("card-game", {
    schema: gameSchema,

    init: (facts) => {
      facts.deck = deckCards;
      facts.table = tableCards;
      facts.removed = [];
      facts.selected = [];
      facts.lastMessage = "Select cards that add to 11";
      facts.moveCount = 0;
      facts.gameOver = false;
    },

    derive: {
      deckCount: (facts) => facts.deck.length,
      removedCount: (facts) => facts.removed.length,
      selectedCards: (facts) =>
        facts.table.filter((c: Card) => facts.selected.includes(c.id)),
      selectionFeedback: (facts) => {
        const selected = facts.table.filter((c: Card) =>
          facts.selected.includes(c.id)
        );
        if (selected.length === 0) return facts.lastMessage;
        if (selected.length === 1) return `${selected[0].value} selected`;
        if (selected.length === 2) {
          const sum = selected[0].value + selected[1].value;
          if (sum === 11) return `${selected[0].value} + ${selected[1].value} = 11! Removing...`;
          return `${selected[0].value} + ${selected[1].value} = ${sum} (need 11)`;
        }
        return "Too many selected";
      },
      hasValidMoves: (facts) => {
        const nums = facts.table.map((c: Card) => c.value);
        for (let i = 0; i < nums.length; i++) {
          for (let j = i + 1; j < nums.length; j++) {
            if (nums[i] + nums[j] === 11) return true;
          }
        }
        return false;
      },
      totalValidMoves: (facts) => {
        let count = 0;
        const nums = facts.table.map((c: Card) => c.value);
        for (let i = 0; i < nums.length; i++) {
          for (let j = i + 1; j < nums.length; j++) {
            if (nums[i] + nums[j] === 11) count++;
          }
        }
        return count;
      },
      progress: (facts) => Math.round((facts.removed.length / 36) * 100),
    },

    events: {
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

    constraints: {
      pairAddsToEleven: {
        priority: 100,
        when: (facts) => {
          if (facts.gameOver) return false;
          const selected = facts.table.filter((c: Card) =>
            facts.selected.includes(c.id)
          );
          if (selected.length !== 2) return false;
          return selected[0].value + selected[1].value === 11;
        },
        require: (facts) => ({
          type: "REMOVE_CARDS",
          cardIds: [...facts.selected],
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
          ctx.facts.moveCount++;
          ctx.facts.lastMessage = `Removed ${cardsToRemove[0].value} + ${cardsToRemove[1].value} = 11!`;
        },
      },
      refillTable: {
        requirement: "REFILL_TABLE",
        resolve: async (req, ctx) => {
          const newCards = ctx.facts.deck.slice(0, req.count);
          ctx.facts.deck = ctx.facts.deck.slice(req.count);
          ctx.facts.table = [...ctx.facts.table, ...newCards];
        },
      },
    },
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("Eleven Up freeze reproduction", () => {
  it("should not freeze when selecting a pair that adds to 11", async () => {
    const table = makeCards([3, 8, 5, 6, 2, 9, 4, 7, 1]);
    const deck = makeCards([3, 4, 5, 6, 7]);

    const game = createGameModule(table, deck);
    const system = createSystem({ module: game });
    system.start();

    // Select first card
    system.events.selectCard({ cardId: "card-0" });
    await new Promise((r) => setTimeout(r, 50));
    expect(system.facts.selected).toEqual(["card-0"]);

    // Select second card — triggers constraint
    system.events.selectCard({ cardId: "card-1" });
    await new Promise((r) => setTimeout(r, 200));

    expect(system.facts.removed).toHaveLength(2);
    expect(system.facts.selected).toHaveLength(0);
    expect(system.facts.moveCount).toBe(1);
    expect(system.facts.table).toHaveLength(9);

    system.stop();
  });

  it("simulates React useSyncExternalStore pattern — fact subscriptions", async () => {
    const table = makeCards([3, 8, 5, 6, 2, 9, 4, 7, 1]);
    const deck = makeCards([3, 4, 5, 6, 7]);

    const game = createGameModule(table, deck);
    const system = createSystem({ module: game });
    system.start();

    // Simulate what React's useFact does: subscribe to store, call getSnapshot on notify
    let snapshotCalls = 0;
    const snapshots: { table: number; selected: number; removed: number }[] = [];

    // useFact("table") — subscribes to store key "table"
    system.facts.$store.subscribe(["table"], () => {
      snapshotCalls++;
      const table = system.facts.table as Card[];
      snapshots.push({
        table: table.length,
        selected: (system.facts.selected as string[]).length,
        removed: (system.facts.removed as Card[]).length,
      });
    });

    // useFact("selected") — subscribes to store key "selected"
    system.facts.$store.subscribe(["selected"], () => {
      snapshotCalls++;
    });

    // useFact("removed") — subscribes to store key "removed"
    system.facts.$store.subscribe(["removed"], () => {
      snapshotCalls++;
    });

    // useDerived("selectionFeedback") — subscribes to derivation
    let derivationCalls = 0;
    system.subscribe(["selectionFeedback"], () => {
      derivationCalls++;
      // This is what getSnapshot does — reads the derivation
      const feedback = system.read("selectionFeedback");
    });

    // useDerived("hasValidMoves")
    system.subscribe(["hasValidMoves"], () => {
      derivationCalls++;
      system.read("hasValidMoves");
    });

    console.log("--- Select card-0 ---");
    system.events.selectCard({ cardId: "card-0" });
    await new Promise((r) => setTimeout(r, 50));

    console.log(`After card-0: snapshotCalls=${snapshotCalls}, derivationCalls=${derivationCalls}`);

    console.log("--- Select card-1 (triggers constraint) ---");
    system.events.selectCard({ cardId: "card-1" });

    // Use a timeout to detect freeze — if this doesn't resolve, we have an infinite loop
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("FREEZE DETECTED: timed out after 2s")), 2000)
    );
    const settle = new Promise((resolve) => setTimeout(resolve, 500));

    await Promise.race([settle, timeout]);

    console.log(`After card-1: snapshotCalls=${snapshotCalls}, derivationCalls=${derivationCalls}`);
    console.log("Snapshots:", snapshots);

    // Should not have excessive calls
    expect(snapshotCalls).toBeLessThan(100);
    expect(derivationCalls).toBeLessThan(100);

    // State should be correct
    expect(system.facts.removed).toHaveLength(2);
    expect(system.facts.table).toHaveLength(9);

    system.stop();
  });

  it("simulates React useSyncExternalStore — derivation getSnapshot reads facts", async () => {
    const table = makeCards([3, 8, 5, 6, 2, 9, 4, 7, 1]);
    const deck = makeCards([3, 4, 5, 6, 7]);

    const game = createGameModule(table, deck);
    const system = createSystem({ module: game });
    system.start();

    // This simulates the EXACT pattern: when store notifies, React synchronously
    // reads ALL hooks' getSnapshot, including derivations that access facts
    let renderCount = 0;
    const allFactKeys = ["deck", "table", "removed", "selected", "lastMessage", "moveCount", "gameOver"];
    const allDerivationKeys = ["deckCount", "removedCount", "selectedCards", "selectionFeedback", "hasValidMoves", "totalValidMoves", "progress"];

    // Subscribe to ALL fact keys (like having 7 useFact hooks)
    for (const key of allFactKeys) {
      system.facts.$store.subscribe([key], () => {
        renderCount++;
        // During React render, ALL getSnapshots are called
        for (const dk of allDerivationKeys) {
          system.read(dk);
        }
      });
    }

    // Subscribe to ALL derivation keys (like having 7 useDerived hooks)
    system.subscribe(allDerivationKeys, () => {
      renderCount++;
      // Derivation getSnapshot reads the derivation value
      for (const dk of allDerivationKeys) {
        system.read(dk);
      }
    });

    console.log("--- Triggering pair removal ---");
    system.events.selectCard({ cardId: "card-0" });
    system.events.selectCard({ cardId: "card-1" });

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("FREEZE DETECTED: timed out after 2s")), 2000)
    );
    const settle = new Promise((resolve) => setTimeout(resolve, 500));

    await Promise.race([settle, timeout]);

    console.log(`Total render count: ${renderCount}`);

    expect(renderCount).toBeLessThan(200);
    expect(system.facts.removed).toHaveLength(2);
    expect(system.facts.table).toHaveLength(9);

    system.stop();
  });
});
