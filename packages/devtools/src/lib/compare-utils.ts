import { isAgentComplete, type DebugEvent, type DebugEventType } from "./types";

export interface AgentStats {
  agentId: string;
  eventCount: number;
  totalTokens: number;
  totalDurationMs: number;
  errorCount: number;
}

export interface EventTypeBreakdown {
  type: DebugEventType;
  countA: number;
  countB: number;
}

export function extractAgentStats(events: DebugEvent[]): AgentStats[] {
  const map = new Map<string, AgentStats>();

  for (const e of events) {
    if (!e.agentId) {
      continue;
    }

    let stats = map.get(e.agentId);
    if (!stats) {
      stats = { agentId: e.agentId, eventCount: 0, totalTokens: 0, totalDurationMs: 0, errorCount: 0 };
      map.set(e.agentId, stats);
    }

    stats.eventCount++;

    if (isAgentComplete(e)) {
      if (typeof e.totalTokens === "number") {
        stats.totalTokens += e.totalTokens;
      }
      if (typeof e.durationMs === "number") {
        stats.totalDurationMs += e.durationMs;
      }
    }

    if (e.type === "agent_error" || e.type === "resolver_error") {
      stats.errorCount++;
    }
  }

  return Array.from(map.values()).sort((a, b) => a.agentId.localeCompare(b.agentId));
}

export function computeEventTypeBreakdown(eventsA: DebugEvent[], eventsB: DebugEvent[]): EventTypeBreakdown[] {
  const countsA = new Map<DebugEventType, number>();
  const countsB = new Map<DebugEventType, number>();

  for (const e of eventsA) {
    countsA.set(e.type, (countsA.get(e.type) ?? 0) + 1);
  }
  for (const e of eventsB) {
    countsB.set(e.type, (countsB.get(e.type) ?? 0) + 1);
  }

  const allTypes = new Set([...countsA.keys(), ...countsB.keys()]);
  const result: EventTypeBreakdown[] = [];

  for (const type of allTypes) {
    result.push({
      type,
      countA: countsA.get(type) ?? 0,
      countB: countsB.get(type) ?? 0,
    });
  }

  return result.sort((a, b) => (b.countA + b.countB) - (a.countA + a.countB));
}
