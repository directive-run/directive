"use client";

import { useSelector } from "@directive-run/react";
import { useDevToolsSystem } from "../devtools/DevToolsSystemContext";
import type { NormalizedTraceEvent } from "../devtools/types";

const EVENT_COLORS: Record<string, string> = {
  "fact:change": "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  "constraint:hit": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "constraint:miss": "bg-zinc-100 text-zinc-500 dark:bg-zinc-700/50 dark:text-zinc-400",
  "requirement:added": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "requirement:removed": "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-500",
  "resolver:start": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  "resolver:complete": "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400",
  "resolver:error": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "effect:run": "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-400",
  "run:start": "bg-zinc-100 text-zinc-600 dark:bg-zinc-700/50 dark:text-zinc-400",
  "run:settled": "bg-zinc-100 text-zinc-600 dark:bg-zinc-700/50 dark:text-zinc-400",
};

const DEFAULT_COLOR = "bg-zinc-100 text-zinc-600 dark:bg-zinc-700/50 dark:text-zinc-400";

function formatTimestamp(timestamp: number): string {
  const d = new Date(timestamp);

  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0")}`;
}

function formatEventData(data: unknown): string | null {
  if (data == null) {
    return null;
  }
  if (typeof data === "object") {
    try {
      const str = JSON.stringify(data);
      if (str === "{}" || str === "[]") {
        return null;
      }

      return str.length > 80 ? str.slice(0, 77) + "..." : str;
    } catch {
      return null;
    }
  }

  return String(data);
}

export function InspectorActivity() {
  const system = useDevToolsSystem();
  const connected = useSelector(system, (s) => s.facts.runtime.connected);
  const traceEvents = useSelector(
    system,
    (s) => s.facts.runtime.traceEvents,
  ) as NormalizedTraceEvent[];

  if (!connected) {
    return (
      <div className="py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Connecting...
      </div>
    );
  }

  if (traceEvents.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
        No activity yet. Interact with the example above.
      </div>
    );
  }

  // Show last 20, newest first
  const recent = traceEvents.slice(-20).reverse();

  return (
    <div className="space-y-0.5">
      {recent.map((event) => {
        const colorClass = EVENT_COLORS[event.type] ?? DEFAULT_COLOR;
        const dataStr = formatEventData(event.data);

        return (
          <div
            key={event.id}
            className="flex items-start gap-4 rounded px-2 py-1 font-mono text-[11px]"
          >
            <span className="w-16 shrink-0 text-zinc-400 dark:text-zinc-500">
              {formatTimestamp(event.timestamp)}
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-px text-[9px] font-semibold leading-tight ${colorClass}`}
            >
              {event.type}
            </span>
            {dataStr && (
              <span className="min-w-0 truncate text-zinc-500 dark:text-zinc-400">
                {dataStr}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
