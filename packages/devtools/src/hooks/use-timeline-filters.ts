import { useCallback, useMemo, useState } from "react";
import type { DebugEvent, DebugEventType } from "../lib/types";

export type FilterMode = "and" | "or";

export interface TimelineFilters {
  typeFilter: Set<DebugEventType>;
  agentFilter: string | null;
  searchMatchIds: Set<number> | null;
  filterMode: FilterMode;
  agents: string[];
  presentTypes: DebugEventType[];
  filteredEvents: DebugEvent[];
  toggleType: (type: DebugEventType) => void;
  setTypeFilter: (filter: Set<DebugEventType>) => void;
  setAgentFilter: (agent: string | null) => void;
  setSearchMatchIds: (ids: Set<number> | null) => void;
  setFilterMode: (mode: FilterMode) => void;
  /** D11: Reset all filters to defaults */
  resetFilters: () => void;
}

export function useTimelineFilters(events: DebugEvent[]): TimelineFilters {
  const [typeFilter, setTypeFilter] = useState<Set<DebugEventType>>(new Set());
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [searchMatchIds, setSearchMatchIds] = useState<Set<number> | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>("and");

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

  // Filter events (E10: supports AND/OR composite modes)
  const filteredEvents = useMemo(() => {
    const hasTypeFilter = typeFilter.size > 0;
    const hasAgentFilter = agentFilter != null;
    const hasSearchFilter = searchMatchIds != null;

    // No active filters — return all
    if (!hasTypeFilter && !hasAgentFilter && !hasSearchFilter) {
      return events;
    }

    if (filterMode === "or") {
      return events.filter((e) => {
        const passes: boolean[] = [];
        if (hasTypeFilter) {
          passes.push(typeFilter.has(e.type));
        }
        if (hasAgentFilter) {
          passes.push(e.agentId === agentFilter);
        }
        if (hasSearchFilter) {
          passes.push(searchMatchIds.has(e.id));
        }

        return passes.some(Boolean);
      });
    }

    // AND mode (default — original behavior)
    let filtered = events;
    if (hasTypeFilter) {
      filtered = filtered.filter((e) => typeFilter.has(e.type));
    }
    if (hasAgentFilter) {
      filtered = filtered.filter((e) => e.agentId === agentFilter);
    }
    if (hasSearchFilter) {
      filtered = filtered.filter((e) => searchMatchIds.has(e.id));
    }

    return filtered;
  }, [events, typeFilter, agentFilter, searchMatchIds, filterMode]);

  // D11: Reset all filters to defaults
  const resetFilters = useCallback(() => {
    setTypeFilter(new Set());
    setAgentFilter(null);
    setSearchMatchIds(null);
    setFilterMode("and");
  }, []);

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
    filterMode,
    agents,
    presentTypes,
    filteredEvents,
    toggleType,
    setTypeFilter,
    setAgentFilter,
    setSearchMatchIds,
    setFilterMode,
    resetFilters,
  };
}
