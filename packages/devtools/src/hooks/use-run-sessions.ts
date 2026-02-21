import { useCallback, useEffect, useRef, useState } from "react";
import { VALID_EVENT_TYPES, type DebugEvent } from "../lib/types";

const STORAGE_KEY = "directive-devtools-runs";
const AUTOSAVE_KEY = "directive-devtools-autosave";
const MAX_RUNS = 5;
const MAX_AUTO_SAVES = 3;
const AUTO_SAVE_DEBOUNCE_MS = 5000;
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export interface SavedRun {
  id: string;
  name: string;
  savedAt: string;
  events: DebugEvent[];
  isAutoSave?: boolean;
  metadata: {
    eventCount: number;
    totalTokens: number;
    durationMs: number;
    agentCount: number;
  };
}

export interface RunSessionsState {
  runs: SavedRun[];
  /** Error from last localStorage persist attempt, or null */
  saveError: string | null;
  /** E6: Auto-save toggle */
  autoSaveEnabled: boolean;
  toggleAutoSave: () => void;
  autoSave: (events: DebugEvent[]) => void;
  saveRun: (events: DebugEvent[], name?: string) => void;
  deleteRun: (id: string) => void;
  exportRun: (id: string) => void;
  importRun: (json: string) => void;
}

function computeMetadata(events: DebugEvent[]): SavedRun["metadata"] {
  let totalTokens = 0;
  const agents = new Set<string>();

  for (const e of events) {
    if (e.agentId) {
      agents.add(e.agentId);
    }
    if (typeof e.totalTokens === "number") {
      totalTokens += e.totalTokens;
    }
  }

  const first = events[0]?.timestamp ?? 0;
  const last = events[events.length - 1]?.timestamp ?? 0;

  return {
    eventCount: events.length,
    totalTokens,
    durationMs: last - first,
    agentCount: agents.size,
  };
}

/** Validate that a value has the shape of a SavedRun */
function isValidSavedRun(value: unknown): value is SavedRun {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.savedAt === "string" &&
    Array.isArray(obj.events) &&
    typeof obj.metadata === "object" && obj.metadata !== null &&
    typeof (obj.metadata as Record<string, unknown>).eventCount === "number" &&
    typeof (obj.metadata as Record<string, unknown>).totalTokens === "number" &&
    typeof (obj.metadata as Record<string, unknown>).durationMs === "number" &&
    typeof (obj.metadata as Record<string, unknown>).agentCount === "number"
  );
}

function loadRuns(): SavedRun[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(isValidSavedRun);
    }

    return [];
  } catch {
    return [];
  }
}

/** Returns error message if save failed, null on success */
function persistRuns(runs: SavedRun[]): string | null {
  try {
    const json = JSON.stringify(runs);
    if (json.length > MAX_SIZE_BYTES) {
      // Evict oldest runs until under limit
      const trimmed = [...runs];
      while (trimmed.length > 1 && JSON.stringify(trimmed).length > MAX_SIZE_BYTES) {
        trimmed.shift();
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));

      return null;
    }
    localStorage.setItem(STORAGE_KEY, json);

    return null;
  } catch (err) {
    return `Failed to save runs: ${err instanceof Error ? err.message : "storage full"}`;
  }
}

function loadAutoSavePreference(): boolean {
  try {
    return localStorage.getItem(AUTOSAVE_KEY) === "true";
  } catch {
    return false;
  }
}

export function useRunSessions(): RunSessionsState {
  const [runs, setRuns] = useState<SavedRun[]>(loadRuns);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(loadAutoSavePreference);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist on change
  useEffect(() => {
    const err = persistRuns(runs);
    setSaveError(err);
  }, [runs]);

  // Cleanup auto-save timer
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  const toggleAutoSave = useCallback(() => {
    setAutoSaveEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTOSAVE_KEY, String(next));
      } catch {
        // D7: Surface localStorage errors instead of swallowing
        setSaveError("Failed to save auto-save preference");
      }

      return next;
    });
  }, []);

  // E6: Debounced auto-save
  const autoSave = useCallback((events: DebugEvent[]) => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      if (events.length === 0) {
        return;
      }

      setRuns((prev) => {
        const autoSaveRun: SavedRun = {
          id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: `Auto-save ${new Date().toLocaleTimeString()}`,
          savedAt: new Date().toISOString(),
          events,
          isAutoSave: true,
          metadata: computeMetadata(events),
        };

        let next = [...prev, autoSaveRun];

        // Cap auto-saves at MAX_AUTO_SAVES — evict oldest auto-save
        const autoSaves = next.filter((r) => r.isAutoSave);
        while (autoSaves.length > MAX_AUTO_SAVES) {
          const oldest = autoSaves.shift()!;
          next = next.filter((r) => r.id !== oldest.id);
        }

        // Cap total runs at MAX_RUNS — evict oldest auto-save first, then oldest manual
        while (next.length > MAX_RUNS) {
          const autoIdx = next.findIndex((r) => r.isAutoSave);
          if (autoIdx !== -1) {
            next.splice(autoIdx, 1);
          } else {
            next.shift();
          }
        }

        return next;
      });
    }, AUTO_SAVE_DEBOUNCE_MS);
  }, []);

  const saveRun = useCallback((events: DebugEvent[], name?: string) => {
    if (events.length === 0) {
      return;
    }

    const run: SavedRun = {
      id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: name ?? `Run ${new Date().toLocaleString()}`,
      savedAt: new Date().toISOString(),
      events,
      metadata: computeMetadata(events),
    };

    setRuns((prev) => {
      const next = [...prev, run];
      // Cap at MAX_RUNS
      if (next.length > MAX_RUNS) {
        return next.slice(-MAX_RUNS);
      }

      return next;
    });
  }, []);

  const deleteRun = useCallback((id: string) => {
    setRuns((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const exportRun = useCallback((id: string) => {
    const run = runs.find((r) => r.id === id);
    if (!run) {
      return;
    }

    const data = JSON.stringify({ version: 1, run }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `directive-run-${run.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [runs]);

  const importRun = useCallback((json: string) => {
    try {
      const parsed = JSON.parse(json);
      if (parsed?.run?.events && Array.isArray(parsed.run.events)) {
        // M1/H6: Validate imported events including event type
        const validEvents = parsed.run.events.filter(
          (e: unknown) =>
            typeof e === "object" && e !== null &&
            typeof (e as Record<string, unknown>).id === "number" &&
            typeof (e as Record<string, unknown>).type === "string" &&
            VALID_EVENT_TYPES.has((e as Record<string, unknown>).type as string) &&
            typeof (e as Record<string, unknown>).timestamp === "number",
        );

        if (validEvents.length === 0) {
          return;
        }

        const run: SavedRun = {
          id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: typeof parsed.run.name === "string" ? parsed.run.name : `Imported Run ${new Date().toLocaleString()}`,
          savedAt: new Date().toISOString(),
          events: validEvents,
          metadata: computeMetadata(validEvents),
        };
        setRuns((prev) => {
          const next = [...prev, run];

          return next.length > MAX_RUNS ? next.slice(-MAX_RUNS) : next;
        });
      }
    } catch {
      // Invalid JSON — ignore
    }
  }, []);

  return { runs, saveError, autoSaveEnabled, toggleAutoSave, autoSave, saveRun, deleteRun, exportRun, importRun };
}
