# Examples

> Auto-generated from extracted examples. Do not edit manually.

## checkers

```typescript
// Example: checkers
// Source: examples/checkers/src/ai-orchestrator.ts
// Pure module file — no DOM wiring

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
  type AgentLike,
  CircuitBreakerOpenError,
  type InputGuardrailData,
  type NamedGuardrail,
  type RunResult,
  createAgentMemory,
  createAgentOrchestrator,
  createLengthStreamingGuardrail,
  createMessageBus,
  createMultiAgentOrchestrator,
  createOutputSchemaGuardrail,
  createSemanticCache,
  createSlidingWindowStrategy,
  createStreamingRunner,
  createTestEmbedder,
  estimateCost,
  parallel,
} from "@directive-run/ai";
import type { CacheStats } from "@directive-run/ai";
import {
  type CircuitState,
  createCircuitBreaker,
  createOTLPExporter,
} from "@directive-run/core/plugins";
// createObservability is alpha (not in bundle) — direct source import
import {
  createObservability,
  createAgentMetrics,
} from "../../../packages/core/src/plugins/observability.lab.js";
import {
  analysisAgent,
  chatAgent,
  formatLegalMoves,
  moveAgent,
  renderBoardForClaude,
  runClaude,
  runClaudeWithCallbacks,
} from "./claude-adapter.js";
import type { Board, Move, Player } from "./rules.js";
import { pickAiMove } from "./rules.js";

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
    humanMoveDesc?: string,
  ): Promise<MoveResult>;
  sendChat(
    message: string,
    onToken?: (token: string) => void,
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

function validateMoveOutput(value: unknown): {
  valid: boolean;
  errors?: string[];
} {
  if (typeof value !== "object" || value === null) {
    return { valid: false, errors: ["Expected an object"] };
  }
  const obj = value as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof obj.from !== "number") errors.push("'from' must be a number");
  if (typeof obj.to !== "number") errors.push("'to' must be a number");
  if (typeof obj.reasoning !== "string")
    errors.push("'reasoning' must be a string");
  if (typeof obj.chat !== "string") errors.push("'chat' must be a string");

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

// ============================================================================
// Merge function for parallel move + analysis
// ============================================================================

function mergeResults(results: RunResult<unknown>[]): MoveWithAnalysis {
  const moveResult = results[0]?.output as
    | { from: number; to: number; reasoning: string; chat: string }
    | undefined;
  const analysisResult = results[1]?.output as string | undefined;

  return {
    move: moveResult ?? {
      from: -1,
      to: -1,
      reasoning: "No result",
      chat: "Something went wrong",
    },
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
      {
        metric: "agent.latency",
        threshold: 10000,
        operator: ">",
        action: "warn",
      },
    ],
  });

  const metrics = createAgentMetrics(obs);

  const otlpExporter = createOTLPExporter({
    endpoint: "http://localhost:4318",
    serviceName: "checkers-ai",
    onError: (err) => {
      console.debug(
        "[OTLP] export failed (collector not running?):",
        err.message,
      );
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
      while (
        rateLimitStartIdx < rateLimitTimestamps.length &&
        rateLimitTimestamps[rateLimitStartIdx]! < windowStart
      ) {
        rateLimitStartIdx++;
      }
      if (
        rateLimitStartIdx > rateLimitTimestamps.length / 2 &&
        rateLimitStartIdx > 100
      ) {
        rateLimitTimestamps.splice(0, rateLimitStartIdx);
        rateLimitStartIdx = 0;
      }
      const active = rateLimitTimestamps.length - rateLimitStartIdx;
      if (active >= MAX_PER_MINUTE) {
        return {
          passed: false,
          reason: `Rate limit exceeded (${MAX_PER_MINUTE}/min)`,
        };
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
    move: {
      agent: moveAgent,
      description: "Selects the best move",
      capabilities: ["move"] as string[],
    },
    chat: {
      agent: chatAgent,
      description: "Free-form chat",
      capabilities: ["chat"] as string[],
    },
    analysis: {
      agent: analysisAgent,
      description: "Strategic analysis",
      capabilities: ["analysis"] as string[],
    },
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
    humanMoveDesc?: string,
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
    reason: string,
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
    humanMoveDesc?: string,
  ): Promise<MoveResult> {
    if (legalMoves.length === 0) {
      return {
        from: -1,
        to: -1,
        reasoning: "No moves",
        chat: "No moves!",
        analysis: null,
        isLocalFallback: true,
        isCached: false,
      };
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
      const result = await multi.runPattern<MoveWithAnalysis>(
        "moveWithAnalysis",
        input,
      );
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
      const isLegal = legalMoves.some(
        (m) => m.from === parsed.from && m.to === parsed.to,
      );
      if (!isLegal) {
        console.warn(
          "[CheckersAI] Illegal move returned, falling back",
          parsed,
        );
        isThinking = false;

        return localFallback(
          board,
          player,
          legalMoves,
          "Hmm, I tried an illegal move. Let me pick again!",
        );
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
        return localFallback(
          board,
          player,
          legalMoves,
          "Circuit breaker open — using local AI while I recover.",
        );
      }

      console.error("[CheckersAI] Move error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";

      return localFallback(
        board,
        player,
        legalMoves,
        `Error: ${msg}. Using local AI.`,
      );
    }
  }

  async function sendChat(
    message: string,
    onToken?: (token: string) => void,
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
        reply =
          typeof finalResult.output === "string"
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
      estimatedCost:
        costRatePerMillion > 0
          ? estimateCost(totalTokens, costRatePerMillion)
          : 0,
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
    get observability() {
      return obs;
    },
  };
}
```

## goal-heist

```typescript
// Example: goal-heist
// Source: examples/goal-heist/src/agents.ts
// Pure module file — no DOM wiring

import { createRunner } from "@directive-run/ai";
import type { GoalNode } from "@directive-run/ai";

// ---------------------------------------------------------------------------
// API key management (localStorage)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "goal-heist-api-key";

export function getApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key);
}

// ---------------------------------------------------------------------------
// Agent metadata
// ---------------------------------------------------------------------------

export interface HeistAgent {
  id: string;
  name: string;
  emoji: string;
  title: string;
  produces: string[];
  requires: string[];
  instruction: string;
  mockResponse: Record<string, unknown>;
  mockDelay: number;
}

export const AGENTS: Record<string, HeistAgent> = {
  gigi: {
    id: "gigi",
    name: "Gigi",
    emoji: "\uD83D\uDC84",
    title: "The Grifter",
    produces: ["guard_schedule"],
    requires: [],
    instruction:
      'You are Gigi "The Grifter", a master of social engineering. You sweet-talked the night guard and obtained their patrol schedule. Respond with JSON: { "guard_schedule": "<brief schedule description>" }',
    mockResponse: {
      guard_schedule:
        "Guards rotate every 45min. East wing unpatrolled 2:15-3:00 AM. Shift change at 3 AM — 4min blind spot.",
    },
    mockDelay: 800,
  },
  felix: {
    id: "felix",
    name: "Felix",
    emoji: "\uD83D\uDD8A\uFE0F",
    title: "The Forger",
    produces: ["blueprints"],
    requires: [],
    instruction:
      'You are Felix "The Forger", an expert document forger. You acquired the museum floor plans from the city records archive. Respond with JSON: { "blueprints": "<brief blueprint description>" }',
    mockResponse: {
      blueprints:
        "Floor plan secured. Vault in sub-basement B2, access via service elevator. Air ducts too narrow — main corridor only.",
    },
    mockDelay: 1000,
  },
  vince: {
    id: "vince",
    name: "Vince",
    emoji: "\uD83D\uDE97",
    title: "The Wheelman",
    produces: ["escape_route"],
    requires: [],
    instruction:
      'You are Vince "The Wheelman", the fastest driver in the city. You scouted three escape routes and picked the best one. Respond with JSON: { "escape_route": "<brief route description>" }',
    mockResponse: {
      escape_route:
        "Primary: loading dock → alley → I-90 on-ramp. Backup: north exit → parking garage swap. ETA to safe house: 8 minutes.",
    },
    mockDelay: 600,
  },
  h4x: {
    id: "h4x",
    name: "H4X",
    emoji: "\uD83D\uDCBB",
    title: "The Hacker",
    produces: ["cameras_disabled"],
    requires: ["guard_schedule"],
    instruction:
      'You are H4X "The Hacker". Using the guard schedule, you found the perfect window to loop the security cameras. Respond with JSON: { "cameras_disabled": "<brief description>" }',
    mockResponse: {
      cameras_disabled:
        "Cameras on loop from 2:15 AM. Feed shows empty corridors on repeat. Motion sensors in east wing bypassed.",
    },
    mockDelay: 1200,
  },
  luca: {
    id: "luca",
    name: "Luca",
    emoji: "\uD83D\uDD13",
    title: "The Locksmith",
    produces: ["vault_cracked"],
    requires: ["cameras_disabled", "blueprints"],
    instruction:
      'You are Luca "The Locksmith". With cameras down and blueprints in hand, you cracked the vault. Respond with JSON: { "vault_cracked": "<brief description>" }',
    mockResponse: {
      vault_cracked:
        "Vault open. Biometric bypass took 90 seconds. Package secured. No alarms triggered.",
    },
    mockDelay: 1500,
  },
  ollie: {
    id: "ollie",
    name: "Ollie",
    emoji: "\uD83D\uDC41\uFE0F",
    title: "The Lookout",
    produces: ["all_clear"],
    requires: ["vault_cracked", "escape_route"],
    instruction:
      'You are Ollie "The Lookout". The vault is cracked and the escape route is ready. Confirm all clear for extraction. Respond with JSON: { "all_clear": "<brief confirmation>" }',
    mockResponse: {
      all_clear:
        "All clear. No police activity within 2 miles. Team converging on loading dock. Go go go.",
    },
    mockDelay: 700,
  },
};

// Ordered list for rendering
export const AGENT_ORDER = ["gigi", "felix", "vince", "h4x", "luca", "ollie"];

// ---------------------------------------------------------------------------
// Satisfaction weights
// ---------------------------------------------------------------------------

export const WEIGHTS: Record<string, number> = {
  guard_schedule: 0.1,
  blueprints: 0.1,
  escape_route: 0.05,
  cameras_disabled: 0.2,
  vault_cracked: 0.35,
  all_clear: 0.2,
};

export function computeSatisfaction(facts: Record<string, unknown>): number {
  let score = 0;

  for (const [key, weight] of Object.entries(WEIGHTS)) {
    if (facts[key] != null) {
      score += weight;
    }
  }

  return Math.min(score, 1);
}

// ---------------------------------------------------------------------------
// Goal nodes (used by runGoal)
// ---------------------------------------------------------------------------

export function buildGoalNodes(): Record<string, GoalNode> {
  const nodes: Record<string, GoalNode> = {};

  for (const agent of Object.values(AGENTS)) {
    nodes[agent.id] = {
      agent: agent.id,
      produces: agent.produces,
      requires: agent.requires.length > 0 ? agent.requires : undefined,
      buildInput: (facts) => {
        const relevantFacts: Record<string, unknown> = {};

        for (const key of agent.requires) {
          if (facts[key] != null) {
            relevantFacts[key] = facts[key];
          }
        }

        return JSON.stringify(relevantFacts);
      },
      extractOutput: (result) => {
        try {
          const parsed =
            typeof result.output === "string"
              ? JSON.parse(result.output)
              : result.output;
          const extracted: Record<string, unknown> = {};

          for (const key of agent.produces) {
            if (parsed[key] != null) {
              extracted[key] = parsed[key];
            }
          }

          return extracted;
        } catch {
          return {};
        }
      },
    };
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Runner factory (real Claude or mock)
// ---------------------------------------------------------------------------

export function createHeistRunner(apiKey: string | null) {
  if (apiKey) {
    return createRunner({
      buildRequest: (agent, input) => ({
        url: "/api/claude",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 256,
            system: agent.instructions ?? "",
            messages: [{ role: "user", content: input }],
          }),
        },
      }),
      parseResponse: async (res) => {
        const data = await res.json();
        const text = data.content?.[0]?.text ?? "";
        const inputTokens = data.usage?.input_tokens ?? 0;
        const outputTokens = data.usage?.output_tokens ?? 0;

        return {
          text,
          totalTokens: inputTokens + outputTokens,
        };
      },
      parseOutput: (text) => {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      },
    });
  }

  // Mock runner — configurable delays, supports failure injection
  return createMockRunner();
}

// ---------------------------------------------------------------------------
// Mock runner with failure injection
// ---------------------------------------------------------------------------

let failHacker = false;
let failForger = false;
let hackerFailCount = 0;

export function setFailHacker(v: boolean): void {
  failHacker = v;
  hackerFailCount = 0;
}

export function setFailForger(v: boolean): void {
  failForger = v;
}

function createMockRunner() {
  return createRunner({
    buildRequest: (agent, input) => ({
      url: "mock://local",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: agent.name, input }),
      },
    }),
    parseResponse: async (res) => {
      const data = await res.json();
      const text = data.content?.[0]?.text ?? "";
      const tokens = data.usage?.total_tokens ?? 0;

      return { text, totalTokens: tokens };
    },
    parseOutput: (text) => {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
    // Mock fetch — adds delay, failure injection, returns Anthropic-shaped response
    fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const agentName = (body.agent as string)?.toLowerCase() ?? "";

      const agentDef = Object.values(AGENTS).find(
        (a) => a.name.toLowerCase() === agentName,
      );
      const delay = agentDef?.mockDelay ?? 800;

      await new Promise((resolve) => setTimeout(resolve, delay));

      // Failure injection
      if (agentName === "h4x" && failHacker) {
        hackerFailCount++;

        if (hackerFailCount <= 3) {
          return new Response(
            JSON.stringify({ error: "Firewall upgraded! Intrusion detected." }),
            { status: 500 },
          );
        }
      }

      if (agentName === "felix" && failForger) {
        return new Response(
          JSON.stringify({ error: "Felix arrested at the archive!" }),
          { status: 500 },
        );
      }

      const mockResp = agentDef?.mockResponse ?? {};
      const tokens = Math.floor(Math.random() * 40) + 20;

      const responseBody = {
        content: [{ text: JSON.stringify(mockResp) }],
        usage: { total_tokens: tokens },
      };

      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
}
```

## fraud-analysis

```typescript
// Example: fraud-analysis
// Source: examples/fraud-analysis/src/fraud-analysis.ts
// Pure module file — no DOM wiring

/**
 * Fraud Case Analysis — Directive Module
 *
 * Multi-stage fraud detection pipeline showcasing every major Directive feature:
 * - 6 constraints with priority + `after` ordering (including competing constraints)
 * - 6 resolvers with retry policies and custom dedup keys
 * - 3 effects with explicit deps
 * - 9 derivations with composition
 * - Local PII detection + checkpoint store
 * - DevTools panel with time-travel debugging
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import { InMemoryCheckpointStore } from "./checkpoint.js";
import { detectPII, redactPII } from "./pii.js";

import {
  type CheckpointEntry,
  type Disposition,
  type FlagEvent,
  type FraudCase,
  type PipelineStage,
  type Severity,
  type TimelineEntry,
  getMockEnrichment,
} from "./mock-data.js";

// ============================================================================
// Timeline (external mutable array, same pattern as ai-checkpoint)
// ============================================================================

export const timeline: TimelineEntry[] = [];

export function addTimeline(
  type: TimelineEntry["type"],
  message: string,
): void {
  timeline.push({
    time: new Date().toLocaleTimeString(),
    type,
    message,
  });
}

// ============================================================================
// Checkpoint Store
// ============================================================================

export const checkpointStore = new InMemoryCheckpointStore();

// ============================================================================
// Analysis Helpers
// ============================================================================

interface AnalysisResult {
  riskScore: number;
  severity: Severity;
  disposition: Disposition;
  analysisNotes: string;
}

/** Deterministic risk scoring formula */
function analyzeWithFormula(fraudCase: FraudCase): AnalysisResult {
  const avgSignalRisk =
    fraudCase.signals.length > 0
      ? fraudCase.signals.reduce((sum, s) => sum + s.risk, 0) /
        fraudCase.signals.length
      : 50;

  const totalAmount = fraudCase.events.reduce((sum, e) => sum + e.amount, 0);
  const amountFactor = Math.min(totalAmount / 10000, 1) * 30;
  const eventFactor = Math.min(fraudCase.events.length / 10, 1) * 20;
  const piiFactor = fraudCase.events.some((e) => e.piiFound) ? 15 : 0;

  const riskScore = Math.min(
    100,
    Math.round(avgSignalRisk * 0.5 + amountFactor + eventFactor + piiFactor),
  );

  let severity: Severity = "low";
  if (riskScore >= 80) {
    severity = "critical";
  } else if (riskScore >= 60) {
    severity = "high";
  } else if (riskScore >= 40) {
    severity = "medium";
  }

  let disposition: Disposition = "pending";
  let notes = `Risk: ${riskScore}/100. Signals: ${fraudCase.signals.map((s) => s.source).join(", ")}.`;

  if (riskScore <= 30) {
    disposition = "cleared";
    notes += " Auto-cleared: low risk.";
  } else if (riskScore <= 50) {
    disposition = "flagged";
    notes += " Flagged for monitoring.";
  }

  return { riskScore, severity, disposition, analysisNotes: notes };
}

// ============================================================================
// Schema
// ============================================================================

export const fraudSchema = {
  facts: {
    stage: t.string<PipelineStage>(),
    flagEvents: t.array<FlagEvent>(),
    cases: t.array<FraudCase>(),
    isRunning: t.boolean(),
    totalEventsProcessed: t.number(),
    totalPiiDetections: t.number(),
    analysisBudget: t.number(),
    maxAnalysisBudget: t.number(),
    riskThreshold: t.number(),
    lastError: t.string(),
    checkpoints: t.array<CheckpointEntry>(),
    selectedScenario: t.string(),
  },
  derivations: {
    ungroupedCount: t.number(),
    caseCount: t.number(),
    criticalCaseCount: t.number(),
    pendingAnalysisCount: t.number(),
    needsHumanReview: t.boolean(),
    budgetExhausted: t.boolean(),
    completionPercentage: t.number(),
    averageRiskScore: t.number(),
    dispositionSummary: t.object<Record<string, number>>(),
  },
  events: {
    ingestEvents: { events: t.array<FlagEvent>() },
    setRiskThreshold: { value: t.number() },
    setBudget: { value: t.number() },
    selectScenario: { key: t.string() },
    reset: {},
  },
  requirements: {
    NORMALIZE_EVENTS: {},
    GROUP_EVENTS: {},
    ENRICH_CASE: { caseId: t.string() },
    ANALYZE_CASE: { caseId: t.string() },
    HUMAN_REVIEW: { caseId: t.string() },
    ESCALATE: { caseId: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

export const fraudAnalysisModule = createModule("fraud", {
  schema: fraudSchema,

  init: (facts) => {
    facts.stage = "idle";
    facts.flagEvents = [];
    facts.cases = [];
    facts.isRunning = false;
    facts.totalEventsProcessed = 0;
    facts.totalPiiDetections = 0;
    facts.analysisBudget = 300;
    facts.maxAnalysisBudget = 300;
    facts.riskThreshold = 70;
    facts.lastError = "";
    facts.checkpoints = [];
    facts.selectedScenario = "card-skimming";
  },

  // ============================================================================
  // Derivations (9)
  // ============================================================================

  derive: {
    ungroupedCount: (facts) => {
      return facts.flagEvents.filter((e) => !e.grouped).length;
    },

    caseCount: (facts) => {
      return facts.cases.length;
    },

    criticalCaseCount: (facts) => {
      return facts.cases.filter((c) => c.severity === "critical").length;
    },

    pendingAnalysisCount: (facts) => {
      return facts.cases.filter((c) => c.enriched && !c.analyzed).length;
    },

    needsHumanReview: (facts) => {
      return facts.cases.some(
        (c) => c.riskScore > facts.riskThreshold && c.disposition === "pending",
      );
    },

    budgetExhausted: (facts) => {
      return facts.analysisBudget <= 0;
    },

    completionPercentage: (facts) => {
      const stages: PipelineStage[] = [
        "idle",
        "ingesting",
        "normalizing",
        "grouping",
        "enriching",
        "analyzing",
        "complete",
      ];
      const idx = stages.indexOf(facts.stage);
      if (idx < 0) {
        return 0;
      }

      return Math.round((idx / (stages.length - 1)) * 100);
    },

    averageRiskScore: (facts) => {
      if (facts.cases.length === 0) {
        return 0;
      }

      const sum = facts.cases.reduce((acc, c) => acc + c.riskScore, 0);

      return Math.round(sum / facts.cases.length);
    },

    // Composition: derives from cases (same source as caseCount)
    dispositionSummary: (facts) => {
      const summary: Record<string, number> = {};
      for (const c of facts.cases) {
        summary[c.disposition] = (summary[c.disposition] || 0) + 1;
      }

      return summary;
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    ingestEvents: (facts, { events }) => {
      facts.flagEvents = [...facts.flagEvents, ...events];
      facts.totalEventsProcessed = facts.totalEventsProcessed + events.length;
      facts.stage = "ingesting";
      facts.isRunning = true;
      facts.lastError = "";
    },

    setRiskThreshold: (facts, { value }) => {
      facts.riskThreshold = Math.max(50, Math.min(90, value));
    },

    setBudget: (facts, { value }) => {
      facts.analysisBudget = Math.max(0, Math.min(500, value));
      facts.maxAnalysisBudget = Math.max(facts.maxAnalysisBudget, value);
    },

    selectScenario: (facts, { key }) => {
      facts.selectedScenario = key;
    },

    reset: (facts) => {
      facts.stage = "idle";
      facts.flagEvents = [];
      facts.cases = [];
      facts.isRunning = false;
      facts.totalEventsProcessed = 0;
      facts.totalPiiDetections = 0;
      facts.lastError = "";
      facts.checkpoints = [];
      timeline.length = 0;
    },
  },

  // ============================================================================
  // Constraints (6 with priority + after ordering)
  // ============================================================================

  constraints: {
    normalizeNeeded: {
      priority: 100,
      when: (facts) => {
        return facts.stage === "ingesting" && facts.flagEvents.length > 0;
      },
      require: { type: "NORMALIZE_EVENTS" },
    },

    groupingNeeded: {
      priority: 90,
      after: ["normalizeNeeded"],
      when: (facts) => {
        return facts.flagEvents.some((e) => !e.grouped);
      },
      require: { type: "GROUP_EVENTS" },
    },

    enrichmentNeeded: {
      priority: 80,
      after: ["groupingNeeded"],
      when: (facts) => {
        return facts.cases.some((c) => !c.enriched && c.signals.length < 3);
      },
      require: (facts) => {
        const target = facts.cases.find(
          (c) => !c.enriched && c.signals.length < 3,
        );

        return { type: "ENRICH_CASE", caseId: target?.id ?? "" };
      },
    },

    analysisNeeded: {
      priority: 70,
      after: ["enrichmentNeeded"],
      when: (facts) => {
        return (
          facts.analysisBudget > 0 &&
          facts.cases.some((c) => c.enriched && !c.analyzed)
        );
      },
      require: (facts) => {
        const target = facts.cases.find((c) => c.enriched && !c.analyzed);

        return { type: "ANALYZE_CASE", caseId: target?.id ?? "" };
      },
    },

    humanReviewNeeded: {
      priority: 65,
      after: ["analysisNeeded"],
      when: (facts) => {
        return facts.cases.some(
          (c) =>
            c.analyzed &&
            c.riskScore > facts.riskThreshold &&
            c.disposition === "pending",
        );
      },
      require: (facts) => {
        const target = facts.cases.find(
          (c) =>
            c.analyzed &&
            c.riskScore > facts.riskThreshold &&
            c.disposition === "pending",
        );

        return { type: "HUMAN_REVIEW", caseId: target?.id ?? "" };
      },
    },

    budgetEscalation: {
      priority: 60,
      when: (facts) => {
        return (
          facts.analysisBudget <= 0 &&
          facts.cases.some(
            (c) => c.enriched && !c.analyzed && c.disposition === "pending",
          )
        );
      },
      require: (facts) => {
        const target = facts.cases.find(
          (c) => c.enriched && !c.analyzed && c.disposition === "pending",
        );

        return { type: "ESCALATE", caseId: target?.id ?? "" };
      },
    },
  },

  // ============================================================================
  // Resolvers (6)
  // ============================================================================

  resolvers: {
    normalizeEvents: {
      requirement: "NORMALIZE_EVENTS",
      resolve: async (_req, context) => {
        addTimeline("stage", "normalizing events");

        const events = [...context.facts.flagEvents];
        let piiCount = 0;

        for (let i = 0; i < events.length; i++) {
          const event = events[i];

          // Run PII detection on merchant + memo fields
          const merchantResult = await detectPII(event.merchant, {
            types: ["credit_card", "bank_account", "ssn"],
          });
          const memoResult = await detectPII(event.memo, {
            types: ["credit_card", "bank_account", "ssn"],
          });

          const hasPii = merchantResult.detected || memoResult.detected;
          if (hasPii) {
            piiCount++;
          }

          events[i] = {
            ...event,
            piiFound: hasPii,
            redactedMerchant: merchantResult.detected
              ? redactPII(event.merchant, merchantResult.items, "typed")
              : event.merchant,
            redactedMemo: memoResult.detected
              ? redactPII(event.memo, memoResult.items, "typed")
              : event.memo,
          };
        }

        // Simulate processing delay (before fact mutations to avoid
        // mid-resolver reconcile canceling this resolver)
        await delay(300);

        // All fact mutations at the end — no more awaits after this
        context.facts.stage = "normalizing";
        context.facts.flagEvents = events;
        context.facts.totalPiiDetections =
          context.facts.totalPiiDetections + piiCount;
      },
    },

    groupEvents: {
      requirement: "GROUP_EVENTS",
      resolve: async (_req, context) => {
        addTimeline("stage", "grouping events into cases");

        const events = [...context.facts.flagEvents];
        const existingCases = [...context.facts.cases];

        // Group by accountId
        const groups = new Map<string, FlagEvent[]>();
        for (const event of events) {
          if (event.grouped) {
            continue;
          }

          const existing = groups.get(event.accountId) ?? [];
          existing.push(event);
          groups.set(event.accountId, existing);
        }

        // Create cases from groups
        let caseNum = existingCases.length;
        for (const [accountId, groupEvents] of groups) {
          caseNum++;
          const newCase: FraudCase = {
            id: `case-${String(caseNum).padStart(3, "0")}`,
            accountId,
            events: groupEvents,
            signals: [],
            enriched: false,
            analyzed: false,
            riskScore: 0,
            severity: "low",
            disposition: "pending",
          };
          existingCases.push(newCase);
        }

        // Mark all events as grouped
        const markedEvents = events.map((e) => ({ ...e, grouped: true }));

        await delay(200);

        // All fact mutations at the end — no more awaits after this
        context.facts.stage = "grouping";
        context.facts.flagEvents = markedEvents;
        context.facts.cases = existingCases;
      },
    },

    enrichCase: {
      requirement: "ENRICH_CASE",
      key: (req) => `enrich-${req.caseId}`,
      retry: { attempts: 2, backoff: "exponential" },
      resolve: async (req, context) => {
        addTimeline("stage", `enriching ${req.caseId}`);

        const cases = [...context.facts.cases];
        const idx = cases.findIndex((c) => c.id === req.caseId);
        if (idx < 0) {
          return;
        }

        const signals = getMockEnrichment(cases[idx].accountId);

        // Simulate API call
        await delay(400);

        // All fact mutations at the end — no more awaits after this
        cases[idx] = {
          ...cases[idx],
          signals,
          enriched: true,
        };
        context.facts.stage = "enriching";
        context.facts.cases = cases;
      },
    },

    analyzeCase: {
      requirement: "ANALYZE_CASE",
      key: (req) => `analyze-${req.caseId}`,
      retry: { attempts: 1, backoff: "none" },
      resolve: async (req, context) => {
        addTimeline("stage", `analyzing ${req.caseId}`);

        const cases = [...context.facts.cases];
        const idx = cases.findIndex((c) => c.id === req.caseId);
        if (idx < 0) {
          return;
        }

        const fraudCase = cases[idx];

        // Consume budget
        const cost = 25 + Math.floor(fraudCase.events.length * 5);

        // Deterministic analysis
        await delay(500);
        const result = analyzeWithFormula(fraudCase);
        if (
          result.disposition === "pending" &&
          result.riskScore <= context.facts.riskThreshold
        ) {
          result.disposition = "flagged";
          result.analysisNotes +=
            " Auto-flagged: below human review threshold.";
        }

        // All fact mutations at the end — no more awaits after this
        cases[idx] = { ...fraudCase, ...result, analyzed: true };
        context.facts.stage = "analyzing";
        context.facts.analysisBudget = Math.max(
          0,
          context.facts.analysisBudget - cost,
        );
        context.facts.cases = cases;
      },
    },

    humanReview: {
      requirement: "HUMAN_REVIEW",
      resolve: async (req, context) => {
        addTimeline("info", `${req.caseId} sent to human review`);

        const cases = [...context.facts.cases];
        const idx = cases.findIndex((c) => c.id === req.caseId);
        if (idx < 0) {
          return;
        }

        await delay(100);

        cases[idx] = {
          ...cases[idx],
          disposition: "human_review",
          dispositionReason: "Risk score exceeds threshold",
        };
        context.facts.cases = cases;
      },
    },

    escalate: {
      requirement: "ESCALATE",
      resolve: async (req, context) => {
        addTimeline("info", `${req.caseId} escalated (budget exhausted)`);

        const cases = [...context.facts.cases];
        const idx = cases.findIndex((c) => c.id === req.caseId);
        if (idx < 0) {
          return;
        }

        await delay(100);

        cases[idx] = {
          ...cases[idx],
          disposition: "escalated",
          dispositionReason: "Analysis budget exhausted",
        };
        context.facts.cases = cases;
      },
    },
  },

  // ============================================================================
  // Effects (3)
  // ============================================================================

  effects: {
    logStageChange: {
      deps: ["stage"],
      run: (facts, prev) => {
        if (prev && prev.stage !== facts.stage) {
          addTimeline("stage", `${prev.stage} → ${facts.stage}`);
        }
      },
    },

    logPiiDetection: {
      deps: ["totalPiiDetections"],
      run: (facts, prev) => {
        if (prev && facts.totalPiiDetections !== prev.totalPiiDetections) {
          addTimeline(
            "pii",
            `PII guardrail fired (${facts.totalPiiDetections} total detections)`,
          );
        }
      },
    },

    logBudgetWarning: {
      deps: ["analysisBudget"],
      run: (facts, prev) => {
        if (prev && prev.analysisBudget > 0 && facts.analysisBudget <= 0) {
          addTimeline("budget", "analysis budget exhausted");
        }
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  module: fraudAnalysisModule,
  plugins: [devtoolsPlugin({ name: "fraud-analysis", panel: true })],
  history: { maxSnapshots: 50 },
  trace: { maxRuns: 100 },
});

// ============================================================================
// Helpers
// ============================================================================

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```
