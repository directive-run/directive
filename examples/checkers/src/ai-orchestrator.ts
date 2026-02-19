/**
 * Checkers AI Orchestrator
 *
 * Composes directive AI adapter features via explicit wiring:
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
  createAgentOrchestrator,
  createMultiAgentOrchestrator,
  createStreamingRunner,
  createAgentMemory,
  createSlidingWindowStrategy,
  createSemanticCache,
  createTestEmbedder,
  createMessageBus,
  createOutputSchemaGuardrail,
  createLengthStreamingGuardrail,
  estimateCost,
  parallel,
  CircuitBreakerOpenError,
  type RunResult,
  type AgentLike,
  type NamedGuardrail,
  type InputGuardrailData,
} from "@directive-run/ai";
import {
  createObservability,
  createAgentMetrics,
  createOTLPExporter,
  createCircuitBreaker,
  type CircuitState,
} from "@directive-run/core/plugins";
import type { CacheStats } from "@directive-run/ai";
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
  readonly observability: ReturnType<typeof createObservability> | null;
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
  const moveResult = results[0]?.output as { from: number; to: number; reasoning: string; chat: string } | undefined;
  const analysisResult = results[1]?.output as string | undefined;

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
  let totalTokens = 0;
  const costRatePerMillion = 2.4;

  // --- Features ---

  const memory = createAgentMemory({
    strategy: createSlidingWindowStrategy(),
    strategyConfig: { maxMessages: 30, preserveRecentCount: 6 },
    autoManage: true,
  });

  const circuitBreaker = createCircuitBreaker({
    failureThreshold: 3,
    recoveryTimeMs: 30000,
    name: "checkers-ai",
  });

  const cache = createSemanticCache({
    embedder: createTestEmbedder(),
    similarityThreshold: 0.98,
    maxCacheSize: 200,
    ttlMs: 600_000,
  });

  const obs = createObservability({
    serviceName: "checkers-ai",
    metrics: { enabled: true },
    tracing: { enabled: true, sampleRate: 1.0 },
    alerts: [
      { metric: "agent.errors", threshold: 5, operator: ">", action: "warn" },
      { metric: "agent.latency", threshold: 10000, operator: ">", action: "warn" },
    ],
  });

  const metrics = createAgentMetrics(obs);

  const otlpExporter = createOTLPExporter({
    endpoint: "http://localhost:4318",
    serviceName: "checkers-ai",
    onError: (err) => {
      console.debug(`[OTLP] export failed (collector not running?):`, err.message);
    },
  });

  const otlpInterval = setInterval(() => {
    try {
      const data = obs.export();
      if (data.metrics.length > 0) otlpExporter.exportMetrics(data.metrics);
      if (data.traces.length > 0) otlpExporter.exportTraces(data.traces);
    } catch (err) {
      console.debug("[OTLP] periodic export error:", err);
    }
  }, 15_000);

  const bus = createMessageBus({ maxHistory: 100 });

  // --- Rate limiter as input guardrail ---
  const rateLimitTimestamps: number[] = [];
  let rateLimitStartIdx = 0;
  const MAX_PER_MINUTE = 10;

  const rateLimitGuardrail: NamedGuardrail<InputGuardrailData> = {
    name: "rate-limit",
    fn: () => {
      const now = Date.now();
      const windowStart = now - 60_000;
      while (rateLimitStartIdx < rateLimitTimestamps.length && rateLimitTimestamps[rateLimitStartIdx]! < windowStart) {
        rateLimitStartIdx++;
      }
      if (rateLimitStartIdx > rateLimitTimestamps.length / 2 && rateLimitStartIdx > 100) {
        rateLimitTimestamps.splice(0, rateLimitStartIdx);
        rateLimitStartIdx = 0;
      }
      const active = rateLimitTimestamps.length - rateLimitStartIdx;
      if (active >= MAX_PER_MINUTE) {
        return { passed: false, reason: `Rate limit exceeded (${MAX_PER_MINUTE}/min)` };
      }
      rateLimitTimestamps.push(now);

      return { passed: true };
    },
  };

  const moveSchemaGuardrail = createOutputSchemaGuardrail({
    validate: validateMoveOutput,
    errorPrefix: "Invalid move response",
  });

  // --- Core orchestrator ---
  const orchestrator = createAgentOrchestrator({
    runner: runClaude,
    maxTokenBudget: 50000,
    memory,
    circuitBreaker,
    guardrails: {
      input: [rateLimitGuardrail],
      output: [moveSchemaGuardrail],
    },
  });

  // --- Multi-agent ---
  const agentRegistry = {
    move:     { agent: moveAgent,     description: "Selects the best move", capabilities: ["move"] as string[] },
    chat:     { agent: chatAgent,     description: "Free-form chat",        capabilities: ["chat"] as string[] },
    analysis: { agent: analysisAgent, description: "Strategic analysis",    capabilities: ["analysis"] as string[] },
  };

  const multi = createMultiAgentOrchestrator({
    runner: runClaude,
    agents: agentRegistry,
    patterns: {
      moveWithAnalysis: parallel<MoveWithAnalysis>(
        ["move", "analysis"],
        mergeResults,
        { minSuccess: 1, timeout: 15000 },
      ),
    },
  });

  // --- Streaming runner ---
  const streamingRunner = createStreamingRunner(runClaudeWithCallbacks, {
    streamingGuardrails: [createLengthStreamingGuardrail({ maxTokens: 500 })],
  });

  // --- Helpers ---

  function resolveAgent(agentId: string): AgentLike {
    const reg = agentRegistry[agentId as keyof typeof agentRegistry];
    if (!reg) {
      throw new Error(`[CheckersAI] Agent "${agentId}" not found`);
    }

    return reg.agent;
  }

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

    // Cache check
    try {
      const cached = await cache.lookup(input, "moveWithAnalysis");
      if (cached.hit && cached.entry) {
        obs.incrementCounter("cache.hits");
        try {
          const parsed = JSON.parse(cached.entry.response) as MoveWithAnalysis;
          isThinking = false;

          return {
            from: parsed.move.from,
            to: parsed.move.to,
            reasoning: parsed.move.reasoning,
            chat: parsed.move.chat,
            analysis: parsed.analysis,
            isLocalFallback: false,
            isCached: true,
          };
        } catch {
          // Invalid cache entry — fall through
        }
      }
      obs.incrementCounter("cache.misses");
    } catch {
      // Cache lookup failed — treat as miss
    }

    const span = obs.startSpan("pattern.moveWithAnalysis");
    const startTime = Date.now();

    try {
      const result = await multi.runPattern<MoveWithAnalysis>("moveWithAnalysis", input);
      const latencyMs = Date.now() - startTime;
      const parsed = result.move;

      // Track metrics
      obs.endSpan(span.spanId, "ok");
      metrics.trackRun("moveWithAnalysis", { success: true, latencyMs });

      // Cache store
      try {
        await cache.store(input, JSON.stringify(result), "moveWithAnalysis");
      } catch {
        // Non-fatal
      }

      // Bus publish
      bus.publish({
        type: "INFORM",
        from: "moveWithAnalysis",
        to: "*",
        topic: "moveWithAnalysis.completed",
        content: {},
      } as Parameters<typeof bus.publish>[0]);

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
      const latencyMs = Date.now() - startTime;
      obs.endSpan(span.spanId, "error");
      metrics.trackRun("moveWithAnalysis", { success: false, latencyMs });

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
      const agent = resolveAgent("chat");
      let reply: string;

      if (onToken && streamingRunner) {
        // Streaming: token-by-token delivery
        const { stream, result } = streamingRunner<string>(agent, message);
        for await (const chunk of stream) {
          if (chunk.type === "token" && chunk.data) onToken(chunk.data);
        }
        const finalResult = await result;
        totalTokens += finalResult.totalTokens;
        reply = typeof finalResult.output === "string"
          ? finalResult.output
          : String(finalResult.output);
      } else {
        // Non-streaming: skip output guardrails for chat
        const result = await orchestrator.run<string>(agent, message, {
          outputGuardrails: [],
        });
        totalTokens += result.totalTokens;
        reply = result.output;
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
    memory.clear();
    circuitBreaker.reset();
    cache.clear();
    obs.clear();
    bus.clear();
    multi.reset();
    orchestrator.reset();
    rateLimitTimestamps.length = 0;
    rateLimitStartIdx = 0;
    totalTokens = 0;
    isThinking = false;
  }

  function getState() {
    return {
      isThinking,
      totalTokens,
      estimatedCost: costRatePerMillion > 0 ? estimateCost(totalTokens, costRatePerMillion) : 0,
      circuitState: circuitBreaker.getState(),
      memoryMessageCount: memory.getState()?.messages?.length ?? 0,
      cacheStats: cache.getStats(),
      busMessageCount: bus.getHistory()?.length ?? 0,
    };
  }

  function dispose(): void {
    clearInterval(otlpInterval);
    // Flush OTLP one final time
    try {
      const data = obs.export();
      if (data.metrics.length > 0) otlpExporter.exportMetrics(data.metrics);
      if (data.traces.length > 0) otlpExporter.exportTraces(data.traces);
    } catch {
      // Best-effort flush on dispose
    }
    orchestrator.dispose();
    multi.dispose();
    obs.dispose();
  }

  return {
    requestMove,
    sendChat,
    reset,
    getState,
    dispose,
    get observability() { return obs; },
  };
}
