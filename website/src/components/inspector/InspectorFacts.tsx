"use client";

import { useSelector } from "@directive-run/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDevToolsSystem } from "../devtools/DevToolsSystemContext";
import { formatValue, copyToClipboard } from "../devtools/views/KeyValueListView";

export function InspectorFacts() {
  const system = useDevToolsSystem();
  const connected = useSelector(system, (s) => s.facts.runtime.connected);
  const facts = useSelector(system, (s) => s.facts.runtime.facts);
  const factCount = useSelector(system, (s) => s.derive.runtime.factCount);

  const [changedKeys, setChangedKeys] = useState<Set<string>>(new Set());
  const prevSerializedRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const prevSerialized = prevSerializedRef.current;
    const changed = new Set<string>();
    const nextSerialized: Record<string, string> = {};

    for (const [key, value] of Object.entries(facts)) {
      const serialized =
        typeof value === "object" ? JSON.stringify(value) : String(value);
      nextSerialized[key] = serialized;

      if (
        prevSerialized[key] !== undefined &&
        prevSerialized[key] !== serialized
      ) {
        changed.add(key);
      }
    }

    prevSerializedRef.current = nextSerialized;

    if (changed.size > 0) {
      setChangedKeys(changed);
      const timer = setTimeout(() => setChangedKeys(new Set()), 800);

      return () => clearTimeout(timer);
    }
  }, [facts]);

  if (!connected || factCount === 0) {
    return (
      <div className="py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
        {connected ? "No facts in system" : "Connecting..."}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {Object.entries(facts).map(([key, value]) => {
        const isChanged = changedKeys.has(key);

        return (
          <FactRow
            key={key}
            factKey={key}
            value={value}
            isChanged={isChanged}
          />
        );
      })}
    </div>
  );
}

function FactRow({
  factKey,
  value,
  isChanged,
}: {
  factKey: string;
  value: unknown;
  isChanged: boolean;
}) {
  const isObject = value !== null && typeof value === "object";
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    copyToClipboard(factKey, value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [factKey, value]);

  return (
    <div
      className={`group flex items-start gap-2 rounded px-2 py-1 font-mono text-[11px] transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        isChanged ? "animate-[devtools-flash_0.8s_ease-out]" : ""
      }`}
    >
      <span className="w-32 shrink-0 truncate text-sky-600 dark:text-sky-400" title={factKey}>
        {factKey}
      </span>
      <div className="min-w-0 flex-1">
        {isObject ? (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              className="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              {expanded ? "▼" : "▶"}{" "}
              {Array.isArray(value)
                ? `Array(${(value as unknown[]).length})`
                : "Object"}
            </button>
            {expanded && (
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-[10px] leading-relaxed text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
                {JSON.stringify(value, null, 2)}
              </pre>
            )}
          </>
        ) : (
          <span
            className={
              typeof value === "boolean"
                ? value
                  ? "text-emerald-500"
                  : "text-red-500"
                : typeof value === "number"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-zinc-700 dark:text-zinc-300"
            }
          >
            {formatValue(value)}
          </span>
        )}
      </div>
      <button
        onClick={handleCopy}
        aria-label={copied ? `Copied ${factKey}` : `Copy ${factKey}`}
        className="shrink-0 cursor-pointer rounded p-0.5 text-zinc-300 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400"
      >
        {copied ? (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 text-emerald-500">
            <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
            <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z" />
            <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z" />
          </svg>
        )}
      </button>
    </div>
  );
}
