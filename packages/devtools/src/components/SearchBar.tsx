import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DebugEvent } from "../lib/types";

interface SearchBarProps {
  events: DebugEvent[];
  onResults: (matchingIds: Set<number> | null) => void;
}

/** Build a flat lowercase string from all string/number properties of an event. */
function buildSearchString(event: DebugEvent): string {
  const parts: string[] = [];

  for (const key of Object.keys(event)) {
    const value = event[key];
    if (typeof value === "string") {
      parts.push(value);
    } else if (typeof value === "number") {
      parts.push(String(value));
    }
  }

  return parts.join(" ").toLowerCase();
}

export function SearchBar({ events, onResults }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [isInvalidRegex, setIsInvalidRegex] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pre-build flat search strings keyed by event index
  const searchIndex = useMemo(() => {
    return events.map((event) => ({
      id: event.id,
      text: buildSearchString(event),
    }));
  }, [events]);

  const executeSearch = useCallback(
    (term: string) => {
      if (!term.trim()) {
        setMatchCount(null);
        setIsInvalidRegex(false);
        onResults(null);

        return;
      }

      // M4: Limit regex length to prevent ReDoS
      if (term.length > 200) {
        setIsInvalidRegex(true);
        setMatchCount(null);
        onResults(new Set());

        return;
      }

      let regex: RegExp;
      try {
        regex = new RegExp(term, "i");
      } catch {
        setIsInvalidRegex(true);
        setMatchCount(null);
        onResults(new Set());

        return;
      }

      setIsInvalidRegex(false);
      const matches = new Set<number>();

      for (const entry of searchIndex) {
        if (regex.test(entry.text)) {
          matches.add(entry.id);
        }
      }

      setMatchCount(matches.size);
      onResults(matches);
    },
    [searchIndex, onResults],
  );

  // Debounce search by 150ms
  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      executeSearch(query);
    }, 150);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, [query, executeSearch]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  const handleClear = useCallback(() => {
    setQuery("");
    setMatchCount(null);
    setIsInvalidRegex(false);
    onResults(null);
    inputRef.current?.focus();
  }, [onResults]);

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          placeholder="Search events (regex)..."
          aria-label="Search events by regex"
          spellCheck={false}
          className={`w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none ring-1 ${
            isInvalidRegex
              ? "ring-red-500/60"
              : "ring-zinc-700 focus:ring-zinc-500"
          }`}
        />

        {query && (
          <button
            onClick={handleClear}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-xs text-zinc-500 hover:text-zinc-300"
            aria-label="Clear search"
          >
            &times;
          </button>
        )}
      </div>

      <span className="shrink-0 text-xs" aria-live="polite">
        {matchCount !== null && !isInvalidRegex && (
          <span className="text-zinc-500">
            {matchCount} match{matchCount !== 1 ? "es" : ""}
          </span>
        )}
        {isInvalidRegex && (
          <span className="text-red-400">
            invalid regex
          </span>
        )}
      </span>
    </div>
  );
}
