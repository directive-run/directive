import { useCallback, useMemo, useState } from "react";
import type { DebugEvent, DebugEventType } from "../lib/types";

export interface TimelineFilters {
  typeFilter: Set<DebugEventType>;
  agentFilter: string | null;
  searchMatchIds: Set<number> | null;
  agents: string[];
  presentTypes: DebugEventType[];
  filteredEvents: DebugEvent[];
  toggleType: (type: DebugEventType) => void;
  setTypeFilter: (filter: Set<DebugEventType>) => void;
  setAgentFilter: (agent: string | null) => void;
  setSearchMatchIds: (ids: Set<number> | null) => void;
}

export function useTimelineFilters(events: DebugEvent[]): TimelineFilters {
  const [typeFilter, setTypeFilter] = useState<Set<DebugEventType>>(new Set());
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [searchMatchIds, setSearchMatchIds] = useState<Set<number> | null>(null);

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

  // Get unique event types present
  const presentTypes = useMemo(() => {
    const set = new Set<DebugEventType>();
    for (const e of events) {
      set.add(e.type);
    }

    return Array.from(set);
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
    if (searchMatchIds) {
      filtered = filtered.filter((e) => searchMatchIds.has(e.id));
    }

    return filtered;
  }, [events, typeFilter, agentFilter, searchMatchIds]);

  // Toggle type filter
  const toggleType = useCallback((type: DebugEventType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }

      return next;
    });
  }, []);

  return {
    typeFilter,
    agentFilter,
    searchMatchIds,
    agents,
    presentTypes,
    filteredEvents,
    toggleType,
    setTypeFilter,
    setAgentFilter,
    setSearchMatchIds,
  };
}
