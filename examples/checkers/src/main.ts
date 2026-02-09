/**
 * Checkers - DOM Rendering
 *
 * Multi-module system setup + subscribe/render pattern.
 * Thin UI layer: reads facts/derivations, builds DOM, wires click handlers.
 *
 * AI mode uses all 12 directive/ai adapter features:
 * orchestrator, memory, guardrails, circuit breaker, cost tracking,
 * streaming, multi-agent, communication bus, semantic cache, observability, OTLP.
 */

import { createSystem } from "directive";
import { checkersGame } from "./game.js";
import { checkersChat } from "./chat.js";
import { createCheckersAI } from "./ai-orchestrator.js";
import { getApiKey, setApiKey } from "./claude-adapter.js";
import type { DashboardData } from "directive/ai";
import { createAISyncer } from "directive/ai";
import type { Board, Player } from "./rules.js";
import { getAllValidMoves, toRowCol } from "./rules.js";

// ============================================================================
// System (multi-module)
// ============================================================================

const system = createSystem({
  modules: { game: checkersGame, chat: checkersChat },
  debug: { timeTravel: true, maxSnapshots: 200 },
});
system.start();

// ============================================================================
// AI
// ============================================================================

const checkersAI = createCheckersAI();

// Sync AI adapter state → directive system (replaces manual getState + dispatch)
const syncAI = createAISyncer(checkersAI, (state) => {
  system.events.chat.updateAIState({
    totalTokens: state.totalTokens,
    estimatedCost: state.estimatedCost,
    circuitState: state.circuitState,
  });
  system.events.chat.updateCacheStats({
    hitRate: state.cacheStats.hitRate,
    entries: state.cacheStats.totalEntries,
  });
});

// ============================================================================
// DOM References
// ============================================================================

const undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;
const redoBtn = document.getElementById("redo-btn") as HTMLButtonElement;
const boardEl = document.getElementById("board")!;
const messageEl = document.getElementById("message")!;
const currentPlayerEl = document.getElementById("current-player")!;
const playerDotEl = document.getElementById("player-dot")!;
const scoreEl = document.getElementById("score")!;
const movesEl = document.getElementById("moves")!;
const capturedRedEl = document.getElementById("captured-red")!;
const capturedBlackEl = document.getElementById("captured-black")!;
const modalEl = document.getElementById("game-over-modal")!;
const modalMessageEl = document.getElementById("modal-message")!;
const mode2pBtn = document.getElementById("mode-2p")!;
const modeComputerBtn = document.getElementById("mode-computer")!;
const modeAiBtn = document.getElementById("mode-ai")!;
const chatPanel = document.getElementById("chat-panel")!;
const chatMessages = document.getElementById("chat-messages")!;
const apiKeySection = document.getElementById("api-key-section")!;
const apiKeyInput = document.getElementById("api-key-input") as HTMLInputElement;
const apiKeySaveBtn = document.getElementById("api-key-save")!;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
const chatSendBtn = document.getElementById("chat-send")!;
const tokenCountEl = document.getElementById("token-count");
const circuitDotEl = document.getElementById("circuit-dot");
const aiInfoEl = document.getElementById("ai-info");
const dashboardPanel = document.getElementById("ai-dashboard")!;
const dashboardToggle = document.getElementById("dashboard-toggle")!;
const dashboardArrow = document.getElementById("dashboard-arrow")!;
const dashboardContent = document.getElementById("dashboard-content")!;

let aiTimeoutId: ReturnType<typeof setTimeout> | null = null;
let dashboardIntervalId: ReturnType<typeof setInterval> | null = null;
let dashboardOpen = false;

// ============================================================================
// Dashboard Renderer (uses checkersAI.obs escape hatch)
// ============================================================================

function renderDashboard(container: HTMLElement): void {
  const obs = checkersAI.observability;
  if (!obs) { container.innerHTML = "<div>Observability not available</div>"; return; }

  const data: DashboardData = obs.getDashboard();
  const health = obs.getHealthStatus();
  const s = data.summary;

  const errorRatePct = (s.errorRate * 100).toFixed(1);
  const avgLatency = s.avgLatency.toFixed(0);
  const cost = s.totalCost.toFixed(4);
  const uptime = Math.floor(data.service.uptime / 1000);

  container.innerHTML = `
    <div class="dashboard-header">
      <span>AI Dashboard</span>
      <span class="health-badge ${health.healthy ? "healthy" : "unhealthy"}">${health.healthy ? "Healthy" : "Degraded"}</span>
    </div>
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value">${s.totalRequests}</div>
        <div class="metric-label">Requests</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${s.totalErrors}</div>
        <div class="metric-label">Errors (${errorRatePct}%)</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${avgLatency}ms</div>
        <div class="metric-label">Avg Latency</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${s.totalTokens}</div>
        <div class="metric-label">Tokens</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">$${cost}</div>
        <div class="metric-label">Cost</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${uptime}s</div>
        <div class="metric-label">Uptime</div>
      </div>
    </div>
    ${data.traces.length > 0 ? `
    <div class="traces-section">
      <div class="traces-title">Recent Traces</div>
      ${data.traces.slice(-5).reverse().map((t) => `
        <div class="trace-item">
          <span class="trace-op">${t.operationName}</span>
          <span class="trace-duration">${t.duration ?? "..."}ms</span>
          <span class="trace-status ${t.status}">${t.status}</span>
        </div>
      `).join("")}
    </div>` : ""}
    ${data.alerts.length > 0 ? `
    <div class="alerts-section">
      <div class="traces-title">Alerts</div>
      ${data.alerts.slice(-3).map((a) => `
        <div class="alert-item">${a.message}</div>
      `).join("")}
    </div>` : ""}
  `;
}

// ============================================================================
// Claude Move Description Helper
// ============================================================================

let lastHumanMoveDesc: string | undefined;

function describeMoveForClaude(from: number, to: number, captured: boolean): string {
  const [fr, fc] = toRowCol(from);
  const [tr, tc] = toRowCol(to);
  const captureStr = captured ? " (captured a piece)" : "";
  return `Moved from (${fr},${fc}) to (${tr},${tc})${captureStr}`;
}

// ============================================================================
// AI Turn Handler
// ============================================================================

let aiTurnPending = false;

async function handleAITurn() {
  const board = system.facts.game.board;
  const currentPlayer = system.facts.game.currentPlayer;
  const gameMode = system.facts.game.gameMode;
  const aiPlayer = system.facts.game.aiPlayer;
  const gameOver = system.facts.game.gameOver;

  if (gameMode !== "ai" || currentPlayer !== aiPlayer || gameOver || aiTurnPending) return;

  aiTurnPending = true;
  system.events.chat.setThinking({ thinking: true });

  const legalMoves = getAllValidMoves(board, aiPlayer);
  const result = await checkersAI.requestMove(board, aiPlayer, legalMoves, lastHumanMoveDesc);
  lastHumanMoveDesc = undefined;

  system.events.chat.setThinking({ thinking: false });

  // Cache hit notification
  if (result.isCached) {
    system.events.chat.addMessage({ message: { sender: "system", text: "Instant response — cached!" } });
  }

  if (result.isLocalFallback) {
    system.events.chat.addMessage({ message: { sender: "system", text: result.chat } });
  } else {
    system.events.chat.addMessage({ message: { sender: "claude", text: result.chat, reasoning: result.reasoning, analysis: result.analysis ?? undefined } });
  }

  // Update analysis display
  if (result.analysis) {
    system.events.chat.setAnalysis({ text: result.analysis });
  }

  if (result.from >= 0 && result.to >= 0) {
    system.events.game.claudeMove({ from: result.from, to: result.to });
  }

  // Sync AI state → directive system
  syncAI();

  aiTurnPending = false;
}

// ============================================================================
// Track Human Moves (for Claude context)
// ============================================================================

let prevPlayer: Player | null = null;
let prevBoard: Board | null = null;

function trackHumanMove() {
  const currentPlayer = system.facts.game.currentPlayer;
  const gameMode = system.facts.game.gameMode;
  const aiPlayer = system.facts.game.aiPlayer;
  const board = system.facts.game.board;

  if (gameMode === "ai" && currentPlayer === aiPlayer && prevPlayer !== aiPlayer && prevBoard) {
    let fromIdx = -1;
    let toIdx = -1;
    let captured = false;

    for (let i = 0; i < 64; i++) {
      const prev = prevBoard[i];
      const curr = board[i];
      if (prev && !curr && prev.player !== aiPlayer) fromIdx = i;
      if (!prevBoard[i] && curr && curr.player !== aiPlayer) toIdx = i;
      if (prev && !curr && prev.player === aiPlayer) captured = true;
    }

    if (fromIdx >= 0 && toIdx >= 0) {
      lastHumanMoveDesc = describeMoveForClaude(fromIdx, toIdx, captured);
    }
  }

  prevPlayer = currentPlayer;
  prevBoard = [...board];
}

// ============================================================================
// Render
// ============================================================================

function render() {
  const board = system.facts.game.board;
  const currentPlayer = system.facts.game.currentPlayer;
  const selectedIndex = system.facts.game.selectedIndex;
  const gameOver = system.facts.game.gameOver;
  const winner = system.facts.game.winner;
  const moveCount = system.facts.game.moveCount;
  const capturedCount = system.facts.game.capturedCount;
  const message = system.facts.game.message;
  const gameMode = system.facts.game.gameMode;
  const aiPlayer = system.facts.game.aiPlayer;

  const highlightSquares = system.derive.game.highlightSquares;
  const selectableSquares = system.derive.game.selectableSquares;
  const score = system.derive.game.score;

  // AI state
  const totalTokens = system.facts.chat.totalTokens;
  const estimatedCost = system.facts.chat.estimatedCost;
  const circuitState = system.facts.chat.circuitState;

  // Undo/redo button state
  const dbg = system.debug;
  if (dbg) {
    undoBtn.disabled = dbg.currentIndex <= 0;
    redoBtn.disabled = dbg.currentIndex >= dbg.snapshots.length - 1;
  }

  // Stats
  currentPlayerEl.textContent = currentPlayer;
  playerDotEl.className = `player-dot ${currentPlayer}`;
  scoreEl.textContent = score;
  movesEl.textContent = String(moveCount);
  capturedRedEl.textContent = String(capturedCount.red);
  capturedBlackEl.textContent = String(capturedCount.black);
  messageEl.textContent = message;

  // Token count display
  if (tokenCountEl) {
    tokenCountEl.textContent = totalTokens > 0
      ? `${totalTokens} ($${estimatedCost.toFixed(4)})`
      : "0";
  }

  // Circuit breaker indicator
  if (circuitDotEl) {
    circuitDotEl.className = `circuit-dot ${circuitState.toLowerCase()}`;
    circuitDotEl.title = `Circuit: ${circuitState}`;
  }

  // Board
  boardEl.innerHTML = "";
  const highlightSet = new Set(highlightSquares);
  const selectableSet = new Set(selectableSquares);

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const index = row * 8 + col;
      const isDark = (row + col) % 2 === 1;
      const piece = board[index];

      const square = document.createElement("div");
      square.className = `square ${isDark ? "dark" : "light"}`;

      if (isDark) {
        if (index === selectedIndex) square.classList.add("selected");
        if (highlightSet.has(index)) square.classList.add("highlight");
        if (selectableSet.has(index) && !gameOver) square.classList.add("selectable");

        square.addEventListener("click", () => {
          system.events.game.clickSquare({ index });
        });
      }

      if (piece) {
        const pieceEl = document.createElement("div");
        pieceEl.className = `piece ${piece.player}${piece.king ? " king" : ""}`;
        square.appendChild(pieceEl);
      }

      boardEl.appendChild(square);
    }
  }

  // Game over modal
  if (gameOver && winner) {
    modalMessageEl.textContent = `${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`;
    modalEl.classList.remove("hidden");
  } else {
    modalEl.classList.add("hidden");
  }

  // Mode toggle button styling
  mode2pBtn.classList.toggle("active", gameMode === "2player");
  modeComputerBtn.classList.toggle("active", gameMode === "computer");
  modeAiBtn.classList.toggle("active", gameMode === "ai");

  // Show/hide chat panel, API key section, AI info, and dashboard
  chatPanel.classList.toggle("hidden", gameMode !== "ai");
  apiKeySection.classList.toggle("hidden", gameMode !== "ai");
  dashboardPanel.classList.toggle("hidden", gameMode !== "ai");
  if (aiInfoEl) aiInfoEl.style.display = gameMode === "ai" ? "" : "none";

  // Dashboard interval
  if (gameMode === "ai" && !dashboardIntervalId) {
    dashboardIntervalId = setInterval(() => {
      if (dashboardOpen) renderDashboard(dashboardContent);
    }, 2000);
  } else if (gameMode !== "ai" && dashboardIntervalId) {
    clearInterval(dashboardIntervalId);
    dashboardIntervalId = null;
  }

  // Computer AI turn scheduling
  if (aiTimeoutId !== null) {
    clearTimeout(aiTimeoutId);
    aiTimeoutId = null;
  }
  if (gameMode === "computer" && currentPlayer === aiPlayer && !gameOver) {
    aiTimeoutId = setTimeout(() => {
      aiTimeoutId = null;
      system.events.game.aiMove();
    }, 400);
  }

  // Claude AI turn
  if (gameMode === "ai" && currentPlayer === aiPlayer && !gameOver && !aiTurnPending) {
    handleAITurn();
  }

  // Render chat
  renderChat();
}

// ============================================================================
// Chat Rendering
// ============================================================================

function renderChat() {
  const messages = system.facts.chat.messages;
  const thinking = system.facts.chat.thinking;
  const isStreaming = system.facts.chat.isStreaming;
  const streamingText = system.facts.chat.streamingText;

  chatMessages.innerHTML = "";

  for (const msg of messages) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${msg.sender}`;

    const text = document.createElement("div");
    text.className = "chat-text";
    text.textContent = msg.text;
    bubble.appendChild(text);

    if (msg.reasoning) {
      const reasoning = document.createElement("div");
      reasoning.className = "chat-reasoning";
      reasoning.textContent = msg.reasoning;
      bubble.appendChild(reasoning);
    }

    if (msg.analysis) {
      const section = document.createElement("div");
      section.className = "analysis-section";

      const toggle = document.createElement("div");
      toggle.className = "analysis-toggle";
      toggle.innerHTML = '<span class="arrow">▶</span> Strategic Analysis';

      const content = document.createElement("div");
      content.className = "analysis-content";
      content.textContent = msg.analysis;

      toggle.addEventListener("click", () => {
        const arrow = toggle.querySelector(".arrow")!;
        const isOpen = content.classList.toggle("open");
        arrow.classList.toggle("open", isOpen);
      });

      section.appendChild(toggle);
      section.appendChild(content);
      bubble.appendChild(section);
    }

    chatMessages.appendChild(bubble);
  }

  // Streaming: show in-progress text with blinking cursor
  if (isStreaming && streamingText) {
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble claude";

    const text = document.createElement("div");
    text.className = "chat-text streaming-cursor";
    text.textContent = streamingText;
    bubble.appendChild(text);

    chatMessages.appendChild(bubble);
  } else if (thinking) {
    const dots = document.createElement("div");
    dots.className = "chat-bubble claude thinking-bubble";
    dots.innerHTML = '<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>';
    chatMessages.appendChild(dots);
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============================================================================
// Subscribe
// ============================================================================

const onUpdate = () => { trackHumanMove(); render(); };
system.subscribeModule("game", onUpdate);
system.subscribeModule("chat", onUpdate);

// ============================================================================
// Controls
// ============================================================================

function resetAll() {
  aiTurnPending = false;
  checkersAI.reset();
  system.events.chat.clearChat();
}

document.getElementById("new-game")!.addEventListener("click", () => {
  resetAll();
  system.events.game.newGame();
});

document.getElementById("modal-new-game")!.addEventListener("click", () => {
  resetAll();
  system.events.game.newGame();
});

mode2pBtn.addEventListener("click", () => {
  resetAll();
  system.events.game.setGameMode({ mode: "2player" });
});

modeComputerBtn.addEventListener("click", () => {
  resetAll();
  system.events.game.setGameMode({ mode: "computer" });
});

modeAiBtn.addEventListener("click", () => {
  resetAll();
  system.events.game.setGameMode({ mode: "ai" });
});

// API key save
apiKeySaveBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (key) {
    setApiKey(key);
    apiKeyInput.value = "";
    system.events.chat.addMessage({ message: { sender: "system", text: "API key saved! Let's play." } });
  }
});

apiKeyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") apiKeySaveBtn.click();
});

// Load saved API key indicator
const savedKey = getApiKey();
if (savedKey) {
  apiKeyInput.placeholder = "Key saved — enter new to replace";
}

// Chat input
function sendChat() {
  const text = chatInput.value.trim();
  if (!text || aiTurnPending) return;
  chatInput.value = "";
  system.events.chat.addMessage({ message: { sender: "user", text } });
  system.events.chat.startStream();

  checkersAI.sendChat(text, (token) => {
    // Streaming: append each token for live display
    system.events.chat.appendStreamToken({ token });
  }).then((reply) => {
    system.events.chat.finishStream({ finalText: reply ?? "" });
    if (reply) {
      system.events.chat.addMessage({ message: { sender: "claude", text: reply } });
    } else {
      system.events.chat.addMessage({ message: { sender: "system", text: "No response — check API key." } });
    }

    // Sync AI state → directive system
    syncAI();
  }).catch((err) => {
    system.events.chat.finishStream({ finalText: "" });
    system.events.chat.addMessage({ message: { sender: "system", text: `Error: ${err instanceof Error ? err.message : "Unknown error"}` } });
  });
}

chatSendBtn.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});

// Dashboard toggle
dashboardToggle.addEventListener("click", () => {
  dashboardOpen = !dashboardOpen;
  dashboardArrow.classList.toggle("open", dashboardOpen);
  dashboardContent.classList.toggle("open", dashboardOpen);
  if (dashboardOpen) renderDashboard(dashboardContent);
});

// Undo/Redo
undoBtn.addEventListener("click", () => {
  aiTurnPending = false;
  system.debug?.goBack();
  messageEl.textContent = "Undone.";
});

redoBtn.addEventListener("click", () => {
  system.debug?.goForward();
  messageEl.textContent = "Redone.";
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "n") {
    e.preventDefault();
    resetAll();
    system.events.game.newGame();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();
    if (e.shiftKey) {
      system.debug?.goForward();
      messageEl.textContent = "Redone.";
    } else {
      aiTurnPending = false;
      system.debug?.goBack();
      messageEl.textContent = "Undone.";
    }
  }
});

// ============================================================================
// Initial render
// ============================================================================

render();
