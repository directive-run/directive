/**
 * Checkers AI Orchestrator
 *
 * Composes ALL 12 directive AI adapter features via createAgentStack():
 *
 * 1.  Agent Orchestrator      — Manages Claude API via generic AgentRunner + guardrails
 * 2.  Memory                  — Sliding window (30 messages) with auto-summarization
 * 3.  Output Guardrail        — Validates move JSON schema before accepting
 * 4.  Rate Limiter            — 10 requests/min to prevent runaway API calls
 * 5.  Circuit Breaker         — After 3 failures, falls back to local minimax for 30s
 * 6.  Cost Tracking           — Token count + estimated cost at Haiku rates
 * 7.  Streaming               — Token-by-token chat delivery with length guardrail
 * 8.  Multi-Agent             — Parallel move + analysis agents
 * 9.  Communication Bus       — Agent-to-agent INFORM messages for move/chat events
 * 10. Semantic Cache           — Hash-based position caching (0.98 threshold)
 * 11. Observability            — Metrics, tracing, alerting dashboard
 * 12. OTLP Exporter            — Periodic export to OpenTelemetry collector
 */

import {
  createAgentStack,
  parallel,
  createOutputSchemaGuardrail,
  createLengthStreamingGuardrail,
  CircuitBreakerOpenError,
  type RunResult,
  type CircuitState,
  type CacheStats,
} from "directive/ai";
import type { Board, Player, Move } from "./rules.js";
import { pickAiMove } from "./rules.js";
import {
  runClaude,
  runClaudeWithCallbacks,
  moveAgent,
  chatAgent,
  analysisAgent,
  renderBoardForClaude,
  formatLegalMoves,
} from "./claude-adapter.js";

// ============================================================================
// Types
// ============================================================================

export interface MoveResult {
  from: number;
  to: number;
  reasoning: string;
  chat: string;
  analysis: string | null;
  isLocalFallback: boolean;
  isCached: boolean;
}

export interface MoveWithAnalysis {
  move: { from: number; to: number; reasoning: string; chat: string };
  analysis: string | null;
}

export interface CheckersAI {
  requestMove(
    board: Board,
    player: Player,
    legalMoves: Move[],
    humanMoveDesc?: string
  ): Promise<MoveResult>;
  sendChat(
    message: string,
    onToken?: (token: string) => void
  ): Promise<string | null>;
  reset(): void;
  getState(): {
    isThinking: boolean;
    totalTokens: number;
    estimatedCost: number;
    circuitState: CircuitState;
    memoryMessageCount: number;
    cacheStats: CacheStats;
    busMessageCount: number;
  };
  dispose(): void;
  /** Escape hatch for dashboard rendering */
  readonly observability: ReturnType<typeof createAgentStack>["observability"];
}

// ============================================================================
// Move Schema Validation
// ============================================================================

function validateMoveOutput(value: unknown): { valid: boolean; errors?: string[] } {
  if (typeof value !== "object" || value === null) {
    return { valid: false, errors: ["Expected an object"] };
  }
  const obj = value as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof obj.from !== "number") errors.push("'from' must be a number");
  if (typeof obj.to !== "number") errors.push("'to' must be a number");
  if (typeof obj.reasoning !== "string") errors.push("'reasoning' must be a string");
  if (typeof obj.chat !== "string") errors.push("'chat' must be a string");
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

// ============================================================================
// Merge function for parallel move + analysis
// ============================================================================

function mergeResults(results: RunResult<unknown>[]): MoveWithAnalysis {
  const moveResult = results[0]?.finalOutput as { from: number; to: number; reasoning: string; chat: string } | undefined;
  const analysisResult = results[1]?.finalOutput as string | undefined;
  return {
    move: moveResult ?? { from: -1, to: -1, reasoning: "No result", chat: "Something went wrong" },
    analysis: analysisResult ?? null,
  };
}

// ============================================================================
// Factory
// ============================================================================

export function createCheckersAI(): CheckersAI {
  let isThinking = false;

  const moveSchemaGuardrail = createOutputSchemaGuardrail({
    validate: validateMoveOutput,
    errorPrefix: "Invalid move response",
  });

  // --- One stack wires everything ---
  const stack = createAgentStack({
    run: runClaude,
    streaming: { run: runClaudeWithCallbacks },
    agents: {
      move:     { agent: moveAgent,     description: "Selects the best move", capabilities: ["move"] },
      chat:     { agent: chatAgent,     description: "Free-form chat",        capabilities: ["chat"] },
      analysis: { agent: analysisAgent, description: "Strategic analysis",    capabilities: ["analysis"] },
    },
    memory:            { maxMessages: 30 },
    circuitBreaker:    { failureThreshold: 3, recoveryTimeMs: 30000, name: "checkers-ai" },
    rateLimit:         { maxPerMinute: 10 },
    cache:             { threshold: 0.98, maxSize: 200, ttlMs: 600_000 },
    observability:     { serviceName: "checkers-ai", alerts: [
      { metric: "agent.errors", threshold: 5, operator: ">", action: "warn" },
      { metric: "agent.latency", threshold: 10000, operator: ">", action: "warn" },
    ]},
    otlp:              { endpoint: "http://localhost:4318", onError: (err, type) => {
      console.debug(`[OTLP] ${type} export failed (collector not running?):`, err.message);
    }},
    messageBus:        { maxHistory: 100 },
    maxTokenBudget:    50000,
    costPerMillionTokens: 2.4,
    patterns: {
      moveWithAnalysis: parallel<MoveWithAnalysis>(
        ["move", "analysis"],
        mergeResults,
        { minSuccess: 1, timeout: 15000 },
      ),
    },
    guardrails: {
      output: [moveSchemaGuardrail],
      streaming: [createLengthStreamingGuardrail({ maxTokens: 500 })],
    },
  });

  // --- Helpers ---

  function buildMoveInput(
    board: Board,
    player: Player,
    legalMoves: Move[],
    humanMoveDesc?: string
  ): string {
    const boardStr = renderBoardForClaude(board);
    const movesStr = formatLegalMoves(legalMoves);
    let input = "";
    if (humanMoveDesc) {
      input += `Human's move: ${humanMoveDesc}\n\n`;
    }
    input += `Current board:\n${boardStr}\n\nYour legal moves (you MUST pick one):\n${movesStr}\n\nPick your move.`;
    return input;
  }

  function localFallback(
    board: Board,
    player: Player,
    legalMoves: Move[],
    reason: string
  ): MoveResult {
    const move = pickAiMove(board, player) ?? legalMoves[0];
    return {
      from: move.from,
      to: move.to,
      reasoning: `Local AI: ${reason}`,
      chat: reason,
      analysis: null,
      isLocalFallback: true,
      isCached: false,
    };
  }

  // --- Public API ---

  async function requestMove(
    board: Board,
    player: Player,
    legalMoves: Move[],
    humanMoveDesc?: string
  ): Promise<MoveResult> {
    if (legalMoves.length === 0) {
      return { from: -1, to: -1, reasoning: "No moves", chat: "No moves!", analysis: null, isLocalFallback: true, isCached: false };
    }

    isThinking = true;
    const input = buildMoveInput(board, player, legalMoves, humanMoveDesc);

    try {
      const result = await stack.runPattern<MoveWithAnalysis>("moveWithAnalysis", input);
      const parsed = result.move;

      // Validate the move is legal
      const isLegal = legalMoves.some((m) => m.from === parsed.from && m.to === parsed.to);
      if (!isLegal) {
        console.warn("[CheckersAI] Illegal move returned, falling back", parsed);
        isThinking = false;
        return localFallback(board, player, legalMoves, "Hmm, I tried an illegal move. Let me pick again!");
      }

      isThinking = false;
      return {
        from: parsed.from,
        to: parsed.to,
        reasoning: parsed.reasoning,
        chat: parsed.chat,
        analysis: result.analysis,
        isLocalFallback: false,
        isCached: false,
      };
    } catch (err) {
      isThinking = false;

      if (err instanceof CircuitBreakerOpenError) {
        return localFallback(board, player, legalMoves, "Circuit breaker open — using local AI while I recover.");
      }

      console.error("[CheckersAI] Move error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      return localFallback(board, player, legalMoves, `Error: ${msg}. Using local AI.`);
    }
  }

  async function sendChat(
    message: string,
    onToken?: (token: string) => void
  ): Promise<string | null> {
    try {
      let reply: string;

      if (onToken) {
        // Streaming: token-by-token delivery
        const tokenStream = stack.stream<string>("chat", message);
        for await (const token of tokenStream) {
          if (token) onToken(token);
        }
        const finalResult = await tokenStream.result;
        reply = typeof finalResult.finalOutput === "string"
          ? finalResult.finalOutput
          : String(finalResult.finalOutput);
      } else {
        // Non-streaming: skip output guardrails for chat
        const result = await stack.run<string>("chat", message, {
          guardrails: { output: [] },
        });
        reply = result.finalOutput;
      }

      return reply;
    } catch (err) {
      if (err instanceof CircuitBreakerOpenError) {
        return "I'm having trouble connecting right now. Try again in a bit!";
      }
      console.error("[CheckersAI] Chat error:", err);
      return null;
    }
  }

  function reset(): void {
    stack.reset();
    isThinking = false;
  }

  function getState() {
    const state = stack.getState();
    return {
      isThinking,
      totalTokens: state.totalTokens,
      estimatedCost: state.estimatedCost,
      circuitState: state.circuitState,
      memoryMessageCount: state.memoryMessageCount,
      cacheStats: state.cacheStats,
      busMessageCount: state.busMessageCount,
    };
  }

  function dispose(): void {
    stack.dispose();
  }

  return {
    requestMove,
    sendChat,
    reset,
    getState,
    dispose,
    get observability() { return stack.observability; },
  };
}
