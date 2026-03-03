/**
 * Pitch deck goal-pattern chat route.
 *
 * Runs input guardrails (with timeline recording), feeds memory,
 * updates scratchpad, then executes runPattern("pitchDeck") → SSE stream.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { forbiddenResponse, isAllowedOrigin } from "@/lib/origin-check";
import {
  checkHourlyRateLimit,
  getClientIp,
  getRateLimitHeaders,
  getResetMinutes,
  isRateLimited,
} from "@/lib/rate-limit";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";
import { createOpenAIRunner } from "@directive-run/ai/openai";
import {
  getPitchDeckInputGuardrails,
  getPitchDeckOrchestrator,
} from "./orchestrator-singleton";

interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 20;

function validateHistory(history: unknown[]): HistoryMessage[] {
  const valid: HistoryMessage[] = [];
  for (const entry of history) {
    if (
      entry != null &&
      typeof entry === "object" &&
      "role" in entry &&
      "content" in entry &&
      ((entry as HistoryMessage).role === "user" ||
        (entry as HistoryMessage).role === "assistant") &&
      typeof (entry as HistoryMessage).content === "string" &&
      (entry as HistoryMessage).content.length > 0 &&
      (entry as HistoryMessage).content.length <= MAX_MESSAGE_LENGTH
    ) {
      valid.push({
        role: (entry as HistoryMessage).role,
        content: (entry as HistoryMessage).content,
      });
    }
  }

  return valid.slice(-MAX_HISTORY_MESSAGES);
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return forbiddenResponse(request);
  }

  const body = await request.json().catch(() => null);
  const message = body?.message;
  if (
    !message ||
    typeof message !== "string" ||
    message.length > MAX_MESSAGE_LENGTH
  ) {
    return Response.json({ error: "Invalid message" }, { status: 400 });
  }

  const history = validateHistory(
    Array.isArray(body?.history) ? body.history : [],
  );

  // -------------------------------------------------------------------------
  // BYOK vs server key rate limiting
  // -------------------------------------------------------------------------

  const clientApiKey = (request.headers as Headers).get?.("x-api-key") ?? null;
  const clientProvider =
    (request.headers as Headers).get?.("x-provider") || "anthropic";
  const isByok = Boolean(clientApiKey);
  const ip = getClientIp(request);
  let hourlyRemaining = 0;
  let hourlyLimit = 5;

  if (!isByok) {
    const rl = checkHourlyRateLimit(ip);
    hourlyRemaining = rl.remaining;
    hourlyLimit = rl.limit;
    if (isRateLimited(ip)) {
      const mins = getResetMinutes(ip);

      return Response.json(
        {
          error: `You've used your 5 free tries this hour. Try again in ${mins} minutes.`,
        },
        {
          status: 429,
          headers: getRateLimitHeaders(hourlyRemaining, hourlyLimit),
        },
      );
    }
  }

  // -------------------------------------------------------------------------
  // Dual-path: BYOK (user key) vs server key
  // -------------------------------------------------------------------------

  if (isByok) {
    // User-provided key: run a simplified single-pass with the user's key
    const runner =
      clientProvider === "openai"
        ? createOpenAIRunner({ apiKey: clientApiKey!, model: "gpt-4o-mini" })
        : createAnthropicRunner({
            apiKey: clientApiKey!,
            model: "claude-haiku-4-5-20251001",
            maxTokens: 2000,
          });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
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
          const result = await runner(
            {
              name: "pitch-evaluator",
              model:
                clientProvider === "openai"
                  ? "gpt-4o-mini"
                  : "claude-haiku-4-5-20251001",
              instructions:
                "You are a startup pitch deck evaluator. Analyze the startup idea and provide: 1) Market analysis (TAM/SAM/SOM, competition), 2) Financial projections (revenue, unit economics), 3) Investor narrative (problem, solution, why now), 4) Overall score 1-10 with justification. Respond in 3-5 paragraphs.",
            },
            message,
          );

          send({ type: "text", text: String(result.output) });
          send({ type: "done" });
        } catch (err) {
          send({
            type: "error",
            message:
              err instanceof Error ? err.message : "Pitch evaluation failed",
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

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Server key path — 503 if not configured
  const instance = getPitchDeckOrchestrator();
  if (!instance) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  const { orchestrator, memory } = instance;
  const timeline = orchestrator.timeline;
  const inputGuardrails = getPitchDeckInputGuardrails();

  // -------------------------------------------------------------------------
  // Feed history into memory (first request with history seeds it)
  // -------------------------------------------------------------------------

  for (const msg of history) {
    if (msg.role === "user" || msg.role === "assistant") {
      memory.addMessage({ role: msg.role, content: msg.content });
    }
  }

  // -------------------------------------------------------------------------
  // Run input guardrails manually (recorded to timeline for DevTools)
  // -------------------------------------------------------------------------

  for (const guardrail of inputGuardrails) {
    const gStart = Date.now();
    try {
      const resultOrPromise = guardrail.fn(
        { input: message, agentName: "pitch-deck-pipeline" },
        { agentName: "pitch-deck-pipeline", input: message, facts: {} },
      );

      // Handle async guardrails (PII/injection can be async)
      const res =
        resultOrPromise &&
        typeof resultOrPromise === "object" &&
        "then" in resultOrPromise
          ? await resultOrPromise
          : resultOrPromise;

      if (res && typeof res === "object" && "passed" in res) {
        if (timeline) {
          timeline.record({
            type: "guardrail_check",
            timestamp: gStart,
            snapshotId: null,
            guardrailName: guardrail.name,
            guardrailType: "input",
            passed: res.passed,
            reason: res.reason,
            durationMs: Date.now() - gStart,
          });
        }

        if (!res.passed) {
          // Blocked — return error SSE event immediately
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "error", message: res.reason || `Blocked by ${guardrail.name}` })}\n\n`,
                ),
              );
              controller.close();
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
              "X-Accel-Buffering": "no",
            },
          });
        }
      }
    } catch {
      // Don't block pipeline on guardrail errors
    }
  }

  // -------------------------------------------------------------------------
  // Update scratchpad
  // -------------------------------------------------------------------------

  if (orchestrator.scratchpad) {
    orchestrator.scratchpad.update({
      idea: message.slice(0, 200),
      sources: [],
      confidence: 0,
    });
  }

  // -------------------------------------------------------------------------
  // Add user message to memory
  // -------------------------------------------------------------------------

  memory.addMessage({ role: "user", content: message });

  // -------------------------------------------------------------------------
  // Run pipeline → stream result as SSE
  // -------------------------------------------------------------------------

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
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
        const result = await orchestrator.runPattern<string>(
          "pitchDeck",
          message,
        );
        send({ type: "text", text: result });
        send({ type: "done" });

        // Add assistant message to memory
        memory.addMessage({ role: "assistant", content: result });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Pipeline failed",
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

  const responseHeaders: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };

  if (!isByok) {
    Object.assign(
      responseHeaders,
      getRateLimitHeaders(hourlyRemaining, hourlyLimit),
    );
  }

  return new Response(stream, { headers: responseHeaders });
}
