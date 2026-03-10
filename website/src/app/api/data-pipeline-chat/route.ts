/**
 * Data pipeline chat route.
 *
 * Runs input guardrails (with timeline recording), feeds memory,
 * updates scratchpad, then executes runPattern("process") → SSE stream.
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
import { createPromptInjectionGuardrail } from "@directive-run/ai";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";
import { createOpenAIRunner } from "@directive-run/ai/openai";
import {
  getDataPipelineInputGuardrails,
  getDataPipelineOrchestrator,
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
    // M16: Run prompt-injection guardrail on BYOK path
    const injectionGuardrail = createPromptInjectionGuardrail({
      strictMode: false,
    });
    const guardResult = injectionGuardrail(
      { input: message, agentName: "data-pipeline" },
      { agentName: "data-pipeline", input: message, facts: {} },
    );
    const resolved =
      guardResult instanceof Promise ? await guardResult : guardResult;
    if (resolved && typeof resolved === "object" && "passed" in resolved) {
      if (!resolved.passed) {
        return Response.json(
          {
            error:
              "Your message was flagged by our safety filter. Please rephrase your question.",
          },
          { status: 400 },
        );
      }
    }

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
              name: "data-pipeline-assistant",
              model:
                clientProvider === "openai"
                  ? "gpt-4o-mini"
                  : "claude-haiku-4-5-20251001",
              instructions:
                "You are a data analysis assistant. Classify the topic, analyze the data, and produce a structured report. Respond in 3-5 paragraphs with clear headings.",
            },
            message,
          );

          send({ type: "text", text: String(result.output) });
          send({ type: "done" });
        } catch (_err) {
          // M15: Sanitize error messages — never leak raw API errors to client
          send({
            type: "error",
            message:
              "An error occurred processing your request. Please check your API key and try again.",
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

    // M14: Replace CORS wildcard with validated origin
    const origin = request.headers.get("origin");
    const sseHeaders: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    };

    if (origin) {
      sseHeaders["Access-Control-Allow-Origin"] = origin;
    }

    return new Response(stream, { headers: sseHeaders });
  }

  // Server key path — 503 if not configured
  const instance = getDataPipelineOrchestrator();
  if (!instance) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  const { orchestrator, memory } = instance;
  const timeline = orchestrator.timeline;
  const inputGuardrails = getDataPipelineInputGuardrails();

  // -------------------------------------------------------------------------
  // Feed history into memory
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
        { input: message, agentName: "data-pipeline" },
        { agentName: "data-pipeline", input: message, facts: {} },
      );

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
      topic: message.slice(0, 200),
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
          "process",
          message,
        );
        send({ type: "text", text: result });
        send({ type: "done" });

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
