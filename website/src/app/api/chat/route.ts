import { getFeatureFlagSystem } from "@/lib/feature-flags/config";
import {
  createPromptInjectionGuardrail,
  createStreamingRunner,
} from "@directive-run/ai";
import { createAnthropicStreamingRunner } from "@directive-run/ai/anthropic";
import { createOpenAIStreamingRunner } from "@directive-run/ai/openai";
/**
 * AI Docs Chatbot API Route
 *
 * Architecture: RAG retrieval → Directive orchestrator + middleware → SSE streaming
 *
 * Server-side operational state (per-IP rate limiting, token usage, error
 * tracking) is managed by a Directive module. The AI adapter handles
 * agent-level safety (guardrails, circuit breaker, per-call rate limits).
 *
 * 1. Directive module tracks per-IP request counts, cumulative metrics
 * 2. Embeds the user query via OpenAI, finds relevant doc chunks (cosine similarity)
 * 3. Passes enriched input (RAG context + conversation history + question) to
 *    a Directive orchestrator with prompt-injection & PII guardrails + middleware
 * 4. Streams tokens back to the client as SSE `data:` frames
 */
import type { NextRequest } from "next/server";
import {
  BASE_INSTRUCTIONS,
  MAX_REQUESTS_PER_WINDOW,
  chatbotSystem,
  getEnricher,
  getOrchestrator,
  getStorage,
  transport,
} from "./orchestrator-singleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  message: string;
  history?: ChatMessage[];
  pageUrl?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 20;
const ENRICH_TIMEOUT_MS = 5_000;
const BYOK_MAX_PER_MINUTE = 30;

const ALLOWED_ORIGINS = new Set([
  "https://directive.run",
  "https://www.directive.run",
]);

// ---------------------------------------------------------------------------
// BYOK Key Validation
// ---------------------------------------------------------------------------

const BYOK_RATE_MAP = new Map<string, number[]>();

function isValidApiKeyFormat(key: string, provider: string): boolean {
  if (provider === "openai") {
    return key.startsWith("sk-");
  }

  return key.startsWith("sk-ant-");
}

function isByokRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  let timestamps = BYOK_RATE_MAP.get(ip);

  if (!timestamps) {
    timestamps = [];
    BYOK_RATE_MAP.set(ip, timestamps);
  }

  // Evict expired entries
  const firstValid = timestamps.findIndex((t) => t >= windowStart);
  if (firstValid > 0) {
    timestamps.splice(0, firstValid);
  } else if (firstValid === -1) {
    timestamps.length = 0;
  }

  if (timestamps.length >= BYOK_MAX_PER_MINUTE) {
    return true;
  }

  timestamps.push(now);

  return false;
}

// ---------------------------------------------------------------------------
// Query-Intent Classification
// ---------------------------------------------------------------------------

type QueryIntent = "api" | "conceptual" | "pattern" | "debug" | "page-context";

const PAGE_CONTEXT_SIGNAL =
  /\b(this\s+page|this\s+doc|current\s+page|what.{0,20}page.{0,20}about|explain.{0,20}page|what.{0,10}reading|page.{0,10}cover|summarize\s+this)\b/i;

const API_SIGNAL_PATTERN =
  /\b(function|parameter|return|signature|api|method|createModule|createSystem|createEngine|t\.\w+|type\s+\w+|interface\s+\w+)\b/i;

const PATTERN_SIGNAL =
  /\b(how\s+(?:to|do|should)|best\s+practice|right\s+way|pattern|recommend|approach|when\s+(?:to|should))\b/i;

const DEBUG_SIGNAL =
  /\b(not\s+working|error|bug|issue|wrong|fail|broken|unexpected|why\s+(?:does|is|doesn't|won't))\b/i;

/**
 * Classify a user query into one of five intent buckets.
 * Regex-based, zero-cost at runtime. Page-context checked first.
 */
function classifyIntent(msg: string): QueryIntent {
  if (PAGE_CONTEXT_SIGNAL.test(msg)) {
    return "page-context";
  }
  if (API_SIGNAL_PATTERN.test(msg) || /`[^`]+`/.test(msg)) {
    return "api";
  }
  if (DEBUG_SIGNAL.test(msg)) {
    return "debug";
  }
  if (PATTERN_SIGNAL.test(msg)) {
    return "pattern";
  }

  return "conceptual";
}

// ---------------------------------------------------------------------------
// Origin Validation
// ---------------------------------------------------------------------------

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.hostname === "localhost";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Page URL Sanitization
// ---------------------------------------------------------------------------

function sanitizePageUrl(url: string | undefined): string | undefined {
  if (!url || typeof url !== "string") return undefined;
  try {
    const parsed = new URL(url, "https://directive.run");
    return parsed.pathname + parsed.hash;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Client IP
// ---------------------------------------------------------------------------

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

// ---------------------------------------------------------------------------
// History Validation
// ---------------------------------------------------------------------------

function validateHistory(history: unknown[]): ChatMessage[] {
  const valid: ChatMessage[] = [];
  let dropped = 0;
  for (const entry of history) {
    if (
      entry != null &&
      typeof entry === "object" &&
      "role" in entry &&
      "content" in entry &&
      ((entry as ChatMessage).role === "user" ||
        (entry as ChatMessage).role === "assistant") &&
      typeof (entry as ChatMessage).content === "string" &&
      (entry as ChatMessage).content.length > 0 &&
      (entry as ChatMessage).content.length <= MAX_MESSAGE_LENGTH
    ) {
      valid.push({
        role: (entry as ChatMessage).role,
        content: (entry as ChatMessage).content,
      });
    } else {
      dropped++;
    }
  }
  if (
    dropped > 0 &&
    typeof process !== "undefined" &&
    process.env?.NODE_ENV === "development"
  ) {
    console.warn(`[chat] Dropped ${dropped} invalid history entries`);
  }

  return valid.slice(-MAX_HISTORY_MESSAGES);
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Feature flag check
  const ffSystem = getFeatureFlagSystem();
  if (!ffSystem || !ffSystem.derive.canUseChat) {
    return new Response(
      JSON.stringify({ error: "Chat is currently disabled." }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  // Origin validation (exact domain matching)
  const origin = request.headers.get("origin");
  if (origin && !isAllowedOrigin(origin)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Track request in Directive module
  const ip = getClientIp(request);

  // -------------------------------------------------------------------------
  // Dual-path: BYOK (skip rate limit) vs server key (rate limited)
  // -------------------------------------------------------------------------

  const clientApiKey = request.headers.get("x-api-key");
  const isByok = Boolean(clientApiKey);

  // Rate limiting only applies to server key usage.
  // Check BEFORE incrementing so guardrail-rejected messages don't consume a credit.
  const entry = chatbotSystem.facts.requestCounts[ip];

  if (!isByok && entry && entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return new Response(
      JSON.stringify({
        error:
          "You've used your 5 free tries this hour. Use your own API key for unlimited access.",
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "X-Hourly-Remaining": "0",
          "X-Hourly-Limit": String(MAX_REQUESTS_PER_WINDOW),
          "Access-Control-Expose-Headers": "X-Hourly-Remaining, X-Hourly-Limit",
        },
      },
    );
  }

  // System health check
  if (!chatbotSystem.derive.isHealthy) {
    return new Response(
      JSON.stringify({
        error: "Service temporarily unavailable. Please try again later.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  // Parse body
  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message: rawMessage, history: rawHistory = [], pageUrl } = body;
  const message =
    typeof rawMessage === "string" ? rawMessage.trim() : rawMessage;

  if (
    !message ||
    typeof message !== "string" ||
    message.length > MAX_MESSAGE_LENGTH
  ) {
    return new Response(
      JSON.stringify({
        error: `Message is required and must be under ${MAX_MESSAGE_LENGTH} characters.`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const instance = getOrchestrator();

  // Validate history entries
  const history = validateHistory(Array.isArray(rawHistory) ? rawHistory : []);

  // Sanitize pageUrl to prevent prompt injection via URL
  const safePath = sanitizePageUrl(pageUrl);

  // Build enriched input via RAG enricher (with timeout to prevent hanging)
  // Over-fetch top 7 chunks, re-rank with intent-aware boosting, slice to top 5
  const enricher = await getEnricher();
  let enrichedInput = message;
  const intent = classifyIntent(message);

  if (enricher) {
    const MAX_PAGE_CHUNKS = 8;

    try {
      let contextParts: string[] = [];

      if (intent === "page-context" && safePath) {
        // Direct URL-based retrieval — skip embedding call entirely
        const storage = getStorage();
        if (storage) {
          const allChunks = await Promise.race([
            storage.getChunks(),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("Storage timeout")),
                ENRICH_TIMEOUT_MS,
              ),
            ),
          ]);
          const pagePath = safePath.split("#")[0];
          const pageChunks = allChunks.filter((chunk) => {
            const url = (chunk.metadata.url as string) ?? "";

            return url.startsWith(pagePath);
          });
          const selected = pageChunks.slice(0, MAX_PAGE_CHUNKS);

          contextParts = selected.map((chunk) => {
            const title = (chunk.metadata.title as string) ?? "";
            const section = (chunk.metadata.section as string) ?? "";
            const url = (chunk.metadata.url as string) ?? "";
            const header =
              title && section && url
                ? `[${title} — ${section}](${url})`
                : title || chunk.id;

            return `${header}\n${chunk.content}`;
          });
        }
      } else {
        // Semantic retrieval path (existing behavior)
        const matches = await Promise.race([
          enricher.retrieve(message, 7),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("RAG retrieval timed out")),
              ENRICH_TIMEOUT_MS,
            ),
          ),
        ]);

        // Re-rank: apply source-type boost based on query intent
        const ranked = matches.map((chunk) => {
          const meta = chunk.metadata as {
            sourceType?: string;
            symbolName?: string;
            url?: string;
          };
          const sourceType = meta.sourceType ?? "guide";

          let boost = 0;
          if (intent === "api" && sourceType === "api-reference") boost += 0.1;
          if (intent === "conceptual" && sourceType === "guide") boost += 0.05;
          if (intent === "pattern" && sourceType === "knowledge") boost += 0.1;
          if (intent === "pattern" && sourceType === "guide") boost += 0.05;
          if (intent === "debug" && sourceType === "knowledge") boost += 0.1;
          if (intent === "debug" && sourceType === "api-reference")
            boost += 0.05;
          if (safePath && meta.url?.startsWith(safePath)) boost += 0.05;

          return { ...chunk, boostedScore: chunk.similarity + boost };
        });

        // Sort by boosted score
        ranked.sort((a, b) => b.boostedScore - a.boostedScore);

        // Diversity cap: max 2 chunks per symbolName
        const symbolCounts = new Map<string, number>();
        const diverse = ranked.filter((chunk) => {
          const sym = (chunk.metadata as { symbolName?: string }).symbolName;
          if (!sym) return true;
          const count = symbolCounts.get(sym) ?? 0;
          if (count >= 2) return false;
          symbolCounts.set(sym, count + 1);

          return true;
        });

        // Take top 5
        const top5 = diverse.slice(0, 5);

        contextParts = top5.map((chunk) => {
          const title = (chunk.metadata.title as string) ?? "";
          const section = (chunk.metadata.section as string) ?? "";
          const url = (chunk.metadata.url as string) ?? "";
          const header =
            title && section && url
              ? `[${title} — ${section}](${url})`
              : title || chunk.id;

          return `${header}\n${chunk.content}`;
        });
      }

      // Assemble enriched input
      const parts: string[] = [];
      if (intent === "page-context" && safePath) {
        parts.push(
          `The user is asking about the page they are currently viewing: ${safePath}. ` +
            `Use the documentation content below to explain what this page covers. ` +
            `Do not include the URL path in your response title — use the page's actual topic name instead.`,
        );
      } else if (safePath) {
        parts.push(`The user is currently viewing: ${safePath}`);
      }
      if (contextParts.length > 0) {
        parts.push(
          `Relevant documentation context:\n\n${contextParts.join("\n\n")}`,
        );
      }
      if (history.length > 0) {
        const historyBlock = history
          .map((m) => `[${m.role}] ${m.content}`)
          .join("\n\n");
        parts.push(`Previous conversation:\n${historyBlock}`);
      }
      parts.push(message);
      enrichedInput = parts.join("\n\n---\n\n");
    } catch {
      // Enrichment failed or timed out — fall back to raw message
    }
  }

  // -------------------------------------------------------------------------
  // Dual-path: BYOK (user key) vs server key
  // -------------------------------------------------------------------------

  const clientProvider = request.headers.get("x-provider") || "anthropic";

  if (isByok) {
    // M3: Validate key format
    if (!isValidApiKeyFormat(clientApiKey!, clientProvider)) {
      return new Response(
        JSON.stringify({ error: "Invalid API key format." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // C1: BYOK per-IP rate limit
    if (isByokRateLimited(ip)) {
      return new Response(
        JSON.stringify({
          error: `Rate limit exceeded (${BYOK_MAX_PER_MINUTE} requests/min). Please slow down.`,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }

    // C1: Run prompt-injection guardrail on BYOK path too
    const injectionGuardrail = createPromptInjectionGuardrail({
      strictMode: false,
    });
    const guardResult = injectionGuardrail(
      { input: enrichedInput, agentName: "directive-docs-qa" },
      { agentName: "directive-docs-qa", input: enrichedInput, facts: {} },
    );
    const resolved =
      guardResult instanceof Promise ? await guardResult : guardResult;
    if (resolved && typeof resolved === "object" && "passed" in resolved) {
      if (!resolved.passed) {
        return new Response(
          JSON.stringify({
            error:
              "Your message was flagged by our safety filter. Please rephrase your question.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    // Track request only after guardrail passes (don't consume credit on rejection)
    chatbotSystem.events.incomingRequest({ ip });

    // User-provided key: create a one-shot streaming runner (no budget/rate-limit tracking)
    const callbackRunner =
      clientProvider === "openai"
        ? createOpenAIStreamingRunner({
            apiKey: clientApiKey!,
            model: "gpt-4o-mini",
          })
        : createAnthropicStreamingRunner({
            apiKey: clientApiKey!,
            model: "claude-haiku-4-5-20251001",
            maxTokens: 2000,
          });

    const streamRunner = createStreamingRunner(callbackRunner);
    const agent = {
      name: "directive-docs-qa",
      model:
        clientProvider === "openai"
          ? "gpt-4o-mini"
          : "claude-haiku-4-5-20251001",
      instructions: BASE_INSTRUCTIONS,
    };

    const { stream, result } = streamRunner(agent, enrichedInput, {
      signal: request.signal,
    });

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
            );
          } catch {
            // Stream closed
          }
        };

        try {
          for await (const chunk of stream) {
            if (chunk.type === "token") {
              send({ type: "text", text: chunk.data });
            }
          }

          await result;
          send({ type: "done" });
        } catch (_err) {
          // M3: Sanitize error messages — never leak raw API errors to client
          send({
            type: "error",
            message:
              "An error occurred while processing your request. Please check your API key and try again.",
          });
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      },
    });

    const sseHeaders: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    };

    if (origin) {
      sseHeaders["Access-Control-Allow-Origin"] = origin;
    }

    return new Response(responseStream, { headers: sseHeaders });
  }

  // Server key path — 503 if not configured
  if (!instance) {
    return new Response(JSON.stringify({ error: "Service unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Run prompt-injection guardrail BEFORE counting the request so blocked
  // messages don't consume the user's hourly allowance.
  const injectionGuardrail = createPromptInjectionGuardrail({
    strictMode: false,
  });
  const guardResult = injectionGuardrail(
    { input: enrichedInput, agentName: "directive-docs-qa" },
    { agentName: "directive-docs-qa", input: enrichedInput, facts: {} },
  );
  const resolved =
    guardResult instanceof Promise ? await guardResult : guardResult;
  if (resolved && typeof resolved === "object" && "passed" in resolved) {
    if (!resolved.passed) {
      return new Response(
        JSON.stringify({
          error:
            "Your message was flagged by our safety filter. Please rephrase your question.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  // Track request only after guardrail passes (don't consume credit on rejection)
  chatbotSystem.events.incomingRequest({ ip });
  const updatedEntry = chatbotSystem.facts.requestCounts[ip];
  const hourlyCount = updatedEntry ? updatedEntry.count : 0;
  const hourlyRemaining = Math.max(0, MAX_REQUESTS_PER_WINDOW - hourlyCount);

  // Stream via SSE transport (propagate request abort signal)
  const sseResponse = transport.toResponse(
    instance.streamable,
    "docs-qa",
    enrichedInput,
    {
      signal: request.signal,
    },
  );

  // Add usage + CORS headers
  sseResponse.headers.set("X-Hourly-Remaining", String(hourlyRemaining));
  sseResponse.headers.set("X-Hourly-Limit", String(MAX_REQUESTS_PER_WINDOW));
  sseResponse.headers.set(
    "Access-Control-Expose-Headers",
    "X-Hourly-Remaining, X-Hourly-Limit",
  );

  if (origin) {
    sseResponse.headers.set("Access-Control-Allow-Origin", origin);
  }

  return sseResponse;
}

// ---------------------------------------------------------------------------
// CORS Preflight (M5)
// ---------------------------------------------------------------------------

export function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key, x-provider",
    "Access-Control-Max-Age": "86400",
  };

  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return new Response(null, { status: 204, headers });
}
