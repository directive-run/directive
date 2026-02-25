/**
 * Eleven Up - React Component
 *
 * A solitaire card game using Directive for state management.
 */

import { useCallback } from "react";
import type React from "react";
import { createSystem } from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import {
  useFact,
  useDerived,
} from "@directive-run/react";
import {
  elevenUpGame,
  type Card,
  getSuitSymbol,
  isRedSuit,
} from "./game";

// ============================================================================
// Styles
// ============================================================================

const styles = {
  container: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #1a472a 0%, #0d2818 100%)",
    padding: "2rem",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "#fff",
  } as React.CSSProperties,

  header: {
    textAlign: "center" as const,
    marginBottom: "2rem",
  },

  title: {
    fontSize: "2.5rem",
    marginBottom: "0.5rem",
    textShadow: "2px 2px 4px rgba(0,0,0,0.3)",
  },

  subtitle: {
    color: "#8fbc8f",
    fontSize: "1rem",
  },

  stats: {
    display: "flex",
    justifyContent: "center",
    gap: "2rem",
    marginBottom: "1.5rem",
  },

  stat: {
    background: "rgba(0,0,0,0.3)",
    padding: "0.75rem 1.5rem",
    borderRadius: "8px",
    textAlign: "center" as const,
  },

  statLabel: {
    fontSize: "0.75rem",
    color: "#8fbc8f",
    marginBottom: "0.25rem",
  },

  statValue: {
    fontSize: "1.5rem",
    fontWeight: "bold" as const,
  },

  table: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "1rem",
    maxWidth: "400px",
    margin: "0 auto 2rem",
  },

  cardSlot: {
    aspectRatio: "2.5/3.5",
    background: "rgba(0,0,0,0.2)",
    borderRadius: "8px",
    border: "2px dashed rgba(255,255,255,0.2)",
  },

  card: {
    aspectRatio: "2.5/3.5",
    background: "#fff",
    borderRadius: "8px",
    display: "flex",
    flexDirection: "column" as const,
    justifyContent: "space-between",
    padding: "8px",
    cursor: "pointer",
    transition: "all 0.2s ease",
    boxShadow: "0 4px 8px rgba(0,0,0,0.3)",
    position: "relative" as const,
  },

  cardSelected: {
    transform: "translateY(-8px)",
    boxShadow: "0 8px 16px rgba(0,0,0,0.4), 0 0 0 3px #ffd700",
  },

  cardRed: {
    color: "#c41e3a",
  },

  cardBlack: {
    color: "#1a1a1a",
  },

  cardCorner: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    fontSize: "1rem",
    fontWeight: "bold" as const,
    lineHeight: 1.1,
  },

  cardCenter: {
    position: "absolute" as const,
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    fontSize: "2.5rem",
  },

  controls: {
    display: "flex",
    justifyContent: "center",
    gap: "1rem",
    marginBottom: "1rem",
  },

  button: {
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.3)",
    color: "#fff",
    padding: "0.75rem 1.5rem",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "1rem",
    transition: "all 0.2s",
  },

  buttonPrimary: {
    background: "#4CAF50",
    borderColor: "#4CAF50",
  },

  buttonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },

  hint: {
    textAlign: "center" as const,
    padding: "1rem",
    background: "rgba(0,0,0,0.2)",
    borderRadius: "8px",
    maxWidth: "400px",
    margin: "0 auto 1rem",
  },

  hintValid: {
    background: "rgba(76, 175, 80, 0.3)",
    borderColor: "#4CAF50",
  },

  gameOver: {
    position: "fixed" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.8)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },

  gameOverContent: {
    background: "#1a472a",
    padding: "3rem",
    borderRadius: "16px",
    textAlign: "center" as const,
    maxWidth: "400px",
  },

  gameOverTitle: {
    fontSize: "3rem",
    marginBottom: "1rem",
  },

  rules: {
    background: "rgba(0,0,0,0.2)",
    padding: "1rem",
    borderRadius: "8px",
    maxWidth: "400px",
    margin: "2rem auto 0",
    fontSize: "0.875rem",
    color: "#8fbc8f",
  },
};

// ============================================================================
// Card Component
// ============================================================================

interface CardProps {
  card: Card;
  selected: boolean;
  onSelect: () => void;
}

function CardComponent({ card, selected, onSelect }: CardProps) {
  const isRed = isRedSuit(card.suit);
  const symbol = getSuitSymbol(card.suit);

  return (
    <div
      style={{
        ...styles.card,
        ...(isRed ? styles.cardRed : styles.cardBlack),
        ...(selected ? styles.cardSelected : {}),
      }}
      onClick={onSelect}
    >
      <div style={styles.cardCorner}>
        <span>{card.rank}</span>
        <span>{symbol}</span>
      </div>
      <div style={styles.cardCenter}>{symbol}</div>
      <div
        style={{ ...styles.cardCorner, transform: "rotate(180deg)" }}
      >
        <span>{card.rank}</span>
        <span>{symbol}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Main App
// ============================================================================

// Create the system
const system = createSystem({ module: elevenUpGame, plugins: [devtoolsPlugin({ name: "eleven-up" })] });
system.start();

/**
 * App — uses system-first hooks directly, no Provider needed
 */
export function App() {
  // Facts (reactive state)
  const deck = useFact(system, "deck") ?? [];
  const table = useFact(system, "table") ?? [];
  const selected = useFact(system, "selected") ?? [];
  const gameOver = useFact(system, "gameOver") ?? false;
  const won = useFact(system, "won") ?? false;

  // Derivations (computed values)
  const deckCount = useDerived(system, "deckCount");
  const removedCount = useDerived(system, "removedCount");
  const selectionFeedback = useDerived(system, "selectionFeedback");
  const hasValidMoves = useDerived(system, "hasValidMoves");
  const progress = useDerived(system, "progress");
  const scoreLabel = useDerived(system, "scoreLabel");
  const comboMessage = useDerived(system, "comboMessage");
  const streakInfo = useDerived(system, "streakInfo");

  // Use system.events directly for single-module systems
  const handleCardClick = useCallback(
    (cardId: string) => {
      if (selected.includes(cardId)) {
        system.events.deselectCard({ cardId });
      } else {
        system.events.selectCard({ cardId });
      }
    },
    [selected]
  );

  const handleNewGame = useCallback(() => {
    system.events.newGame();
  }, []);

  const handleClearSelection = useCallback(() => {
    system.events.clearSelection();
  }, []);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Eleven Up</h1>
        <p style={styles.subtitle}>
          Select cards that add to 11, or J+Q+K sets - they auto-remove!
        </p>
      </header>

      {/* Score label */}
      {scoreLabel && (
        <div style={{
          textAlign: "center" as const,
          fontSize: "1.1rem",
          marginBottom: "0.75rem",
          color: streakInfo?.isHot ? "#ffd700" : "#8fbc8f",
          fontWeight: streakInfo?.isHot ? "bold" as const : "normal" as const,
        }}>
          {scoreLabel}
        </div>
      )}

      {/* Combo message */}
      {comboMessage && (
        <div style={{
          textAlign: "center" as const,
          fontSize: "0.9rem",
          marginBottom: "0.75rem",
          color: "#ff9800",
          fontWeight: "bold" as const,
        }}>
          {comboMessage}
        </div>
      )}

      {/* Stats */}
      <div style={styles.stats}>
        <div style={styles.stat}>
          <div style={styles.statLabel}>Deck</div>
          <div style={styles.statValue}>{deckCount}</div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statLabel}>Removed</div>
          <div style={styles.statValue}>{removedCount}</div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statLabel}>Streak</div>
          <div style={{
            ...styles.statValue,
            color: streakInfo?.isHot ? "#ffd700" : "#fff",
          }}>
            {streakInfo?.current ?? 0}
          </div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statLabel}>Progress</div>
          <div style={styles.statValue}>{progress}%</div>
        </div>
      </div>

      {/* Feedback message */}
      {selectionFeedback && (
        <div style={styles.hint}>{selectionFeedback}</div>
      )}

      {/* Table */}
      <div style={styles.table}>
        {table.map((card) => (
          <CardComponent
            key={card.id}
            card={card}
            selected={selected.includes(card.id)}
            onSelect={() => handleCardClick(card.id)}
          />
        ))}
        {/* Empty slots */}
        {Array.from({ length: 9 - table.length }).map((_, i) => (
          <div key={`empty-${i}`} style={styles.cardSlot} />
        ))}
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <button
          style={{
            ...styles.button,
            ...(selected.length === 0 ? styles.buttonDisabled : {}),
          }}
          onClick={handleClearSelection}
          disabled={selected.length === 0}
        >
          Clear Selection
        </button>
        <button style={styles.button} onClick={handleNewGame}>
          New Game
        </button>
      </div>

      {/* No moves warning */}
      {!hasValidMoves && !gameOver && (
        <div style={{ ...styles.hint, background: "rgba(244, 67, 54, 0.3)" }}>
          No valid moves available!
          {deck.length === 0 ? " Game Over!" : ""}
        </div>
      )}

      {/* Rules */}
      <div style={styles.rules}>
        <strong>How to Play:</strong>
        <ul style={{ margin: "0.5rem 0 0 1rem", padding: 0 }}>
          <li>Click cards to select them</li>
          <li>Pairs that add to 11 are auto-removed (A=1, 2-10 face value)</li>
          <li>Face card sets (J+Q+K) are auto-removed</li>
          <li>Auto-combos trigger when refill creates valid matches</li>
          <li>Build streaks with consecutive moves!</li>
        </ul>
      </div>

      {/* Game Over Modal */}
      {gameOver && (
        <div style={styles.gameOver}>
          <div style={styles.gameOverContent}>
            <div style={styles.gameOverTitle}>
              {won ? "You Win!" : "Game Over"}
            </div>
            <p>
              {won
                ? "Congratulations! You cleared all the cards!"
                : `You removed ${removedCount} of 52 cards.`}
            </p>
            <p style={{ fontSize: "0.9rem", color: "#8fbc8f" }}>
              Best streak: {streakInfo?.max ?? 0}
              {(streakInfo?.max ?? 0) >= 5 ? " - Amazing!" : ""}
            </p>
            <button
              style={{
                ...styles.button,
                ...styles.buttonPrimary,
                marginTop: "1rem",
              }}
              onClick={handleNewGame}
            >
              Play Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
