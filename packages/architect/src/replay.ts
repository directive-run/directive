/**
 * Architect Replay — record system events and replay with AI architect
 * to see what actions would have been proposed.
 */

import type { System } from "@directive-run/core";
import type { AgentRunner } from "@directive-run/ai";
import type {
  ArchitectAction,
  ReplayRecording,
  ReplayEvent,
  ReplayOptions,
  ReplayResult,
} from "./types.js";

// ============================================================================
// Replay Recorder
// ============================================================================

export interface ReplayRecorder {
  /** Start recording system events. */
  start(): void;
  /** Stop recording and return the recording. */
  stop(): ReplayRecording;
  /** Check if currently recording. */
  isRecording(): boolean;
  /** Get current event count. */
  eventCount(): number;
}

/**
 * Create a recorder that captures system events for replay.
 */
export function createReplayRecorder(system: System): ReplayRecorder {
  const events: ReplayEvent[] = [];
  const unsubscribers: Array<() => void> = [];
  let recording = false;
  let startedAt = 0;
  let initialState: Record<string, unknown> = {};

  function start(): void {
    if (recording) {
      return;
    }

    recording = true;
    startedAt = Date.now();
    initialState = JSON.parse(JSON.stringify(system.facts ?? {}));
    events.length = 0;

    const sys = system as unknown as Record<string, unknown>;

    // Record fact snapshots on changes
    if (typeof sys.subscribe === "function") {
      const unsub = (sys.subscribe as (cb: () => void) => () => void)(() => {
        if (!recording) {
          return;
        }

        const facts = JSON.parse(JSON.stringify(system.facts ?? {}));

        events.push({
          offsetMs: Date.now() - startedAt,
          type: "fact-snapshot",
          facts,
          unmetRequirements: getUnmetRequirements(system),
        });
      });

      unsubscribers.push(unsub);
    }

    // Record settlement changes
    if (typeof sys.onSettledChange === "function") {
      const unsub = (sys.onSettledChange as (cb: (settled: boolean) => void) => () => void)(
        (settled: boolean) => {
          if (!recording) {
            return;
          }

          events.push({
            offsetMs: Date.now() - startedAt,
            type: "settlement-change",
            facts: JSON.parse(JSON.stringify(system.facts ?? {})),
            unmetRequirements: getUnmetRequirements(system),
            data: { settled },
          });
        },
      );

      unsubscribers.push(unsub);
    }
  }

  function stop(): ReplayRecording {
    recording = false;

    for (const unsub of unsubscribers) {
      unsub();
    }

    unsubscribers.length = 0;

    return {
      events: [...events],
      initialState,
      durationMs: Date.now() - startedAt,
      startedAt,
    };
  }

  return {
    start,
    stop,
    isRecording: () => recording,
    eventCount: () => events.length,
  };
}

// ============================================================================
// Replay with Architect
// ============================================================================

/**
 * Replay a recording through an AI architect to see what actions
 * would have been proposed at each event.
 */
export async function replayWithArchitect(
  recording: ReplayRecording,
  runner: AgentRunner,
  options?: ReplayOptions,
): Promise<ReplayResult> {
  const maxEvents = options?.maxEvents ?? recording.events.length;
  const eventsToProcess = recording.events.slice(0, maxEvents);
  const maxTokens = options?.budget?.maxTokens ?? Infinity;

  const withArchitect: Array<{
    event: ReplayEvent;
    proposedActions: ArchitectAction[];
  }> = [];

  let triggeredEvents = 0;
  let totalActions = 0;
  let tokensUsed = 0;

  for (const event of eventsToProcess) {
    // Item 16: break if budget exceeded
    if (tokensUsed >= maxTokens) {
      break;
    }
    // Only analyze events that would typically trigger the architect
    if (event.type !== "settlement-change" && event.unmetRequirements.length === 0) {
      continue;
    }

    triggeredEvents++;

    const prompt = [
      "## Replay Analysis",
      "",
      `Event type: ${event.type}`,
      `Offset: ${event.offsetMs}ms from start`,
      "",
      "### Facts at this point",
      JSON.stringify(event.facts, null, 2),
      "",
      "### Unmet Requirements",
      event.unmetRequirements.length > 0
        ? event.unmetRequirements.join(", ")
        : "None",
      "",
      "### Instructions",
      "What constraints or resolvers would you create to address this state?",
      "Respond with tool calls for create_constraint or create_resolver.",
    ].join("\n");

    try {
      const result = await runner(
        {
          name: "directive-replay",
          instructions: "You analyze historical system states and suggest improvements.",
        },
        prompt,
      );

      // Item 16: track cumulative tokens
      tokensUsed += result.totalTokens ?? 0;

      // Parse proposed actions from tool calls
      const actions: ArchitectAction[] = (result.toolCalls ?? []).map(
        (tc, i) => {
          let args: Record<string, unknown>;
          try {
            args = typeof tc.arguments === "string"
              ? JSON.parse(tc.arguments)
              : (tc.arguments as Record<string, unknown>);
          } catch {
            args = {};
          }

          return {
            id: `replay-action-${triggeredEvents}-${i}`,
            tool: tc.name,
            arguments: args,
            reasoning: {
              trigger: "replay",
              observation: `Replay event at ${event.offsetMs}ms`,
              justification: "",
              expectedOutcome: "",
              raw: typeof result.output === "string" ? result.output : "",
            },
            confidence: 0.8,
            risk: "low" as const,
            requiresApproval: false,
            approvalStatus: "auto-approved" as const,
            timestamp: event.offsetMs,
          };
        },
      );

      totalActions += actions.length;

      withArchitect.push({
        event,
        proposedActions: actions,
      });
    } catch {
      // Skip events that fail
      withArchitect.push({
        event,
        proposedActions: [],
      });
    }
  }

  return {
    original: [...recording.events],
    withArchitect,
    comparison: {
      totalEvents: recording.events.length,
      triggeredEvents,
      totalActions,
      tokensUsed,
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function getUnmetRequirements(system: System): string[] {
  try {
    const inspection = system.inspect() as unknown as Record<string, unknown>;
    const pending = inspection.pendingRequirements as Array<Record<string, unknown>> | undefined;

    if (Array.isArray(pending)) {
      return pending.map((r) => String(r.type ?? r.id ?? "unknown"));
    }

    return [];
  } catch {
    return [];
  }
}
