/**
 * Claude Adapter for Directive AI
 *
 * Bridges directive's generic AgentRunner with the Anthropic Messages API.
 * Provides agent definitions for move selection, chat, and strategic analysis.
 * Includes a streaming-capable runner for token-by-token delivery.
 */

import type {
  RunResult,
  AgentLike,
  Message,
} from "directive/ai";
import { createRunner } from "directive/ai";
import type { Board, Piece, Move } from "./rules.js";
import { toRowCol } from "./rules.js";

// ============================================================================
// API Key Management
// ============================================================================

const STORAGE_KEY = "checkers-claude-api-key";

export function getApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key);
}

// ============================================================================
// Board Rendering Helpers
// ============================================================================

function pieceToChar(piece: Piece | null): string {
  if (!piece) return ".";
  if (piece.player === "red") return piece.king ? "R" : "r";
  return piece.king ? "B" : "b";
}

export function renderBoardForClaude(board: Board): string {
  let result = "    0  1  2  3  4  5  6  7\n";
  for (let row = 0; row < 8; row++) {
    result += `${row}  `;
    for (let col = 0; col < 8; col++) {
      const index = row * 8 + col;
      const ch = pieceToChar(board[index]);
      result += ` ${ch} `;
    }
    result += "\n";
  }
  result += "\nr=Red, R=Red King, b=Black, B=Black King, .=empty";
  return result;
}

export function describeMoveIndex(index: number): string {
  const [row, col] = toRowCol(index);
  return `(row ${row}, col ${col}, index ${index})`;
}

export function formatLegalMoves(moves: Move[]): string {
  return moves
    .map((m) => {
      const from = describeMoveIndex(m.from);
      const to = describeMoveIndex(m.to);
      const capture =
        m.captured !== null
          ? ` capturing piece at index ${m.captured}`
          : "";
      return `  from ${m.from} ${from} → to ${m.to} ${to}${capture}`;
    })
    .join("\n");
}

// ============================================================================
// System Prompts
// ============================================================================

const MOVE_SYSTEM_PROMPT = `You are a friendly, competitive checkers opponent playing as Black. You're chatty, fun, and love the game. You offer light trash talk, genuine compliments on good moves, and strategic commentary.

Rules reminder:
- 8x8 board, pieces on dark squares only
- Red moves up (rows decrease), Black moves down (rows increase)
- Captures are mandatory (forced jump rule)
- Multi-jump chains continue until no more jumps
- Kings move in all four diagonal directions
- A player loses when they have no valid moves

You will receive the board state and a list of your legal moves. You MUST pick one of the listed legal moves.

Respond with ONLY a JSON object (no markdown, no code fences):
{"from": <index>, "to": <index>, "reasoning": "<1-2 sentences of strategic thinking>", "chat": "<casual banter, friendly trash talk, or compliment>"}`;

const CHAT_SYSTEM_PROMPT = `You are a friendly, competitive checkers opponent playing as Black. You're chatty, fun, and love the game. You offer light trash talk, genuine compliments on good moves, and strategic commentary.

The human is chatting with you between moves. Respond naturally and in character — no JSON needed, just plain text.`;

const ANALYSIS_SYSTEM_PROMPT = `You are a checkers strategy analyst. Given a board position and a move that was chosen, provide brief strategic commentary (2-3 sentences max).

Analyze: board control, piece advantage, king potential, traps/threats. Be concise.`;

// ============================================================================
// Agent Definitions
// ============================================================================

export const moveAgent: AgentLike = {
  name: "checkers-move",
  instructions: MOVE_SYSTEM_PROMPT,
  model: "claude-haiku-4-5-20251001",
};

export const chatAgent: AgentLike = {
  name: "checkers-chat",
  instructions: CHAT_SYSTEM_PROMPT,
  model: "claude-haiku-4-5-20251001",
};

export const analysisAgent: AgentLike = {
  name: "checkers-analysis",
  instructions: ANALYSIS_SYSTEM_PROMPT,
  model: "claude-haiku-4-5-20251001",
};

// ============================================================================
// Runner Implementation (Anthropic Messages API via createRunner)
// ============================================================================

function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

/**
 * Generic runner that wraps the Anthropic Messages API via /api/claude proxy.
 * Compatible with directive's agent orchestrator.
 */
export const runClaude = createRunner({
  buildRequest: (agent, _input, messages) => ({
    url: "/api/claude",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": getApiKey() ?? "",
      },
      body: JSON.stringify({
        model: agent.model ?? "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: agent.instructions ?? "",
        messages,
      }),
    },
  }),
  parseResponse: async (res) => {
    const data = await res.json();
    return {
      text: data.content?.[0]?.text ?? "",
      totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    };
  },
  parseOutput: <T>(text: string): T => {
    try {
      return JSON.parse(stripCodeFences(text)) as T;
    } catch {
      return text as unknown as T;
    }
  },
});

// ============================================================================
// Streaming Runner (SSE via Anthropic Messages API)
// ============================================================================

/**
 * Streaming-capable runner with callbacks for token-by-token delivery.
 * Used by createStreamingRunner to produce async iterable streams.
 *
 * Falls back to simulated token emission if SSE parsing fails.
 */
export async function runClaudeWithCallbacks(
  agent: AgentLike,
  input: string,
  callbacks: {
    onToken?: (token: string) => void;
    onMessage?: (message: Message) => void;
    signal?: AbortSignal;
  }
): Promise<RunResult<unknown>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("No API key set");
  }

  const messages: Message[] = [{ role: "user", content: input }];

  const response = await fetch("/api/claude", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      model: agent.model ?? "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: agent.instructions ?? "",
      messages,
      stream: true,
    }),
    signal: callbacks.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  let fullText = "";
  let totalTokens = 0;

  if (contentType.includes("text/event-stream") && response.body) {
    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") continue;

        try {
          const event = JSON.parse(jsonStr);

          if (event.type === "content_block_delta" && event.delta?.text) {
            const token = event.delta.text;
            fullText += token;
            callbacks.onToken?.(token);
          }

          if (event.type === "message_delta" && event.usage) {
            totalTokens = (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0);
          }

          if (event.type === "message_start" && event.message?.usage) {
            totalTokens = event.message.usage.input_tokens ?? 0;
          }
        } catch {
          // Skip unparseable SSE events
        }
      }
    }
  } else {
    // Non-streaming response — simulate token emission
    const data = await response.json();
    fullText = data.content?.[0]?.text ?? "";
    totalTokens = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);

    // Emit tokens in small chunks for UI effect
    const words = fullText.split(/(\s+)/);
    for (const word of words) {
      if (word) callbacks.onToken?.(word);
    }
  }

  const assistantMessage: Message = { role: "assistant", content: fullText };
  callbacks.onMessage?.(assistantMessage);

  // Parse output
  let finalOutput: unknown;
  try {
    const jsonText = fullText
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();
    finalOutput = JSON.parse(jsonText);
  } catch {
    finalOutput = fullText;
  }

  return {
    finalOutput,
    messages: [...messages, assistantMessage],
    toolCalls: [],
    totalTokens,
  };
}
