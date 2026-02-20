import { useMemo, useState } from "react";
import type { DebugEvent, DebugEventType } from "../lib/types";
import { EVENT_COLORS } from "../lib/colors";
import { EventDetail } from "../components/EventDetail";
import { TimelineBar } from "../components/TimelineBar";

interface TimelineViewProps {
  events: DebugEvent[];
}

const EVENT_TYPE_LABELS: Partial<Record<DebugEventType, string>> = {
  agent_start: "Start",
  agent_complete: "Complete",
  agent_error: "Error",
  agent_retry: "Retry",
  guardrail_check: "Guardrail",
  constraint_evaluate: "Constraint",
  resolver_start: "Resolver Start",
  resolver_complete: "Resolver Done",
  resolver_error: "Resolver Error",
  approval_request: "Approval Req",
  approval_response: "Approval Res",
  handoff_start: "Handoff",
  handoff_complete: "Handoff Done",
  pattern_start: "Pattern",
  pattern_complete: "Pattern Done",
  dag_node_update: "DAG Node",
  breakpoint_hit: "Breakpoint",
  breakpoint_resumed: "Resumed",
  derivation_update: "Derivation",
  scratchpad_update: "Scratchpad",
  reflection_iteration: "Reflection",
  race_start: "Race",
  race_winner: "Winner",
  race_cancelled: "Cancelled",
};

export function TimelineView({ events }: TimelineViewProps) {
  const [selectedEvent, setSelectedEvent] = useState<DebugEvent | null>(null);
  const [typeFilter, setTypeFilter] = useState<Set<DebugEventType>>(new Set());
  const [agentFilter, setAgentFilter] = useState<string | null>(null);

  // Compute unique agents
  const agents = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) {
      if (e.agentId) {
        set.add(e.agentId);
      }
    }

    return Array.from(set).sort();
  }, [events]);

  // Compute time range
  const timeRange = useMemo(() => {
    if (events.length === 0) {
      return { start: 0, end: 1, duration: 1 };
    }

    const start = events[0]!.timestamp;
    const end = events[events.length - 1]!.timestamp;
    const duration = Math.max(end - start, 1);

    return { start, end, duration };
  }, [events]);

  // Filter events
  const filteredEvents = useMemo(() => {
    let filtered = events;
    if (typeFilter.size > 0) {
      filtered = filtered.filter((e) => typeFilter.has(e.type));
    }
    if (agentFilter) {
      filtered = filtered.filter((e) => e.agentId === agentFilter);
    }

    return filtered;
  }, [events, typeFilter, agentFilter]);

  // Group events by agent for lane display
  const lanes = useMemo(() => {
    const laneMap = new Map<string, DebugEvent[]>();
    // "global" lane for events without agentId
    laneMap.set("__global__", []);

    for (const agent of agents) {
      laneMap.set(agent, []);
    }

    for (const event of filteredEvents) {
      const lane = event.agentId ?? "__global__";
      if (!laneMap.has(lane)) {
        laneMap.set(lane, []);
      }
      laneMap.get(lane)!.push(event);
    }

    // Remove empty lanes
    for (const [key, value] of laneMap) {
      if (value.length === 0) {
        laneMap.delete(key);
      }
    }

    return laneMap;
  }, [filteredEvents, agents]);

  // Toggle type filter
  const toggleType = (type: DebugEventType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }

      return next;
    });
  };

  // Get unique event types present
  const presentTypes = useMemo(() => {
    const set = new Set<DebugEventType>();
    for (const e of events) {
      set.add(e.type);
    }

    return Array.from(set);
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <div className="text-center">
          <div className="mb-2 text-4xl">📊</div>
          <p>No events recorded yet</p>
          <p className="mt-1 text-xs">Run an agent to see timeline events</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        {/* Agent filter */}
        <select
          value={agentFilter ?? ""}
          onChange={(e) => setAgentFilter(e.target.value || null)}
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        {/* Type filter chips */}
        <div className="flex flex-wrap gap-1">
          {presentTypes.map((type) => (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                typeFilter.size === 0 || typeFilter.has(type)
                  ? "opacity-100"
                  : "opacity-30"
              }`}
              style={{
                backgroundColor: `${EVENT_COLORS[type]}20`,
                color: EVENT_COLORS[type],
                border: `1px solid ${EVENT_COLORS[type]}40`,
              }}
            >
              {EVENT_TYPE_LABELS[type] ?? type}
            </button>
          ))}
        </div>

        {/* Event count */}
        <span className="ml-auto text-xs text-zinc-500">
          {filteredEvents.length}/{events.length} events
        </span>
      </div>

      {/* Timeline content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Lanes */}
        <div className="flex-1 overflow-auto">
          <div className="min-w-[600px]">
            {Array.from(lanes).map(([laneId, laneEvents]) => (
              <div key={laneId} className="flex border-b border-zinc-800/50">
                {/* Lane label */}
                <div className="sticky left-0 z-10 flex w-32 shrink-0 items-center border-r border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-400">
                  {laneId === "__global__" ? "Global" : laneId}
                </div>

                {/* Event bars */}
                <div className="relative min-h-[36px] flex-1 px-1 py-1">
                  {laneEvents.map((event) => (
                    <TimelineBar
                      key={event.id}
                      event={event}
                      timeRange={timeRange}
                      isSelected={selectedEvent?.id === event.id}
                      onClick={() => setSelectedEvent(
                        selectedEvent?.id === event.id ? null : event,
                      )}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail panel */}
        {selectedEvent && (
          <div className="w-80 shrink-0 overflow-auto border-l border-zinc-800 bg-zinc-900">
            <EventDetail
              event={selectedEvent}
              onClose={() => setSelectedEvent(null)}
            />
          </div>
        )}
      </div>

      {/* Time axis */}
      <div className="flex border-t border-zinc-800 bg-zinc-900 px-4 py-1">
        <div className="w-32 shrink-0" />
        <div className="flex flex-1 justify-between text-[10px] text-zinc-600">
          <span>0ms</span>
          <span>{Math.round(timeRange.duration / 4)}ms</span>
          <span>{Math.round(timeRange.duration / 2)}ms</span>
          <span>{Math.round(timeRange.duration * 3 / 4)}ms</span>
          <span>{Math.round(timeRange.duration)}ms</span>
        </div>
      </div>
    </div>
  );
}
