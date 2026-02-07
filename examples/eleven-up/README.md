# Eleven Up

A solitaire card game built with Directive, demonstrating the full constraint-driven architecture.

## Rules

1. **Goal:** Remove all 52 cards from the table
2. **Pairs:** Remove two cards that add up to 11 (Ace = 1, 2-10 = face value)
3. **Face Cards:** Remove Jack + Queen + King as a set of three
4. **Table:** 9 cards are dealt face-up; removed cards are replaced from the deck

## Play

```bash
# Open in browser
open index.html
```

## Directive Concepts Demonstrated

### Facts (State)
```typescript
deck: Card[]           // Cards remaining in deck
table: Card[]          // 9 face-up cards
removed: Card[]        // Cards removed from play
selected: string[]     // Currently selected card IDs
pendingRemoval: boolean // User confirmed removal
gameOver: boolean
won: boolean
```

### Derivations (Computed)
```typescript
canRemoveSelection  // Is current selection valid?
selectionReason     // Explanation for user
hasValidMoves       // Any moves available?
validPairs          // All pairs adding to 11
validFaceCardSets   // All J+Q+K combinations
```

### Events (User Actions)
```typescript
selectCard    // Toggle card selection
clearSelection
confirmRemoval // Trigger constraint evaluation
newGame
```

### Constraints (Rules → Requirements)
| Constraint | When | Produces |
|------------|------|----------|
| `removeValidSelection` | User confirms valid selection | `REMOVE_CARDS` |
| `refillTable` | Table < 9 cards & deck has cards | `REFILL_TABLE` |
| `playerWins` | Table is empty | `END_GAME { won: true }` |
| `playerLoses` | No moves & deck empty | `END_GAME { won: false }` |

### Resolvers (Handle Requirements)
| Resolver | Handles | Action |
|----------|---------|--------|
| `removeCards` | `REMOVE_CARDS` | Move cards to removed pile |
| `refillTable` | `REFILL_TABLE` | Deal cards from deck |
| `endGame` | `END_GAME` | Set gameOver and won flags |

### Effects (Side Effects)
```typescript
logStateChanges  // Console log when cards removed
```

## Architecture Flow

```
User clicks "Remove"
    ↓
Event: confirmRemoval (sets pendingRemoval = true)
    ↓
Constraint: removeValidSelection
    When: pendingRemoval && valid selection
    Produces: REMOVE_CARDS { cardIds }
    ↓
Resolver: removeCards
    Handles: REMOVE_CARDS
    Action: Move cards, clear selection
    ↓
Constraint: refillTable
    When: table < 9 && deck > 0
    Produces: REFILL_TABLE
    ↓
Resolver: refillTable
    Handles: REFILL_TABLE
    Action: Deal cards from deck
    ↓
Constraint: playerWins OR playerLoses
    Produces: END_GAME { won }
    ↓
Resolver: endGame
    Handles: END_GAME
    Action: Set gameOver state
```

## Keyboard Shortcuts

- **Enter** - Remove selected cards
- **Escape** - Clear selection
- **Ctrl+N** - New game

## Strategy Tips

- Complementary pairs: A+10, 2+9, 3+8, 4+7, 5+6
- Face cards must be removed as a complete set (J+Q+K)
- Sometimes waiting for more cards is better than removing immediately
