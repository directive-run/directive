import { useState } from "react";
import type { DebugEvent } from "../lib/types";
import { EVENT_COLORS, getEventCategory } from "../lib/colors";
import { PromptViewer } from "./PromptViewer";

interface EventDetailProps {
  event: DebugEvent;
  onClose: () => void;
  onForkFromSnapshot?: (eventId: number) => void;
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);

  return date.toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 3 });
}

/** Extract all meaningful properties from an event */
function getEventProperties(event: DebugEvent): [string, unknown][] {
  const skip = new Set(["id", "type", "timestamp", "snapshotId", "agentId", "input", "output"]);
  const entries: [string, unknown][] = [];

  for (const [key, value] of Object.entries(event)) {
    if (!skip.has(key) && value !== undefined && value !== null) {
      entries.push([key, value]);
    }
  }

  return entries;
}

const MAX_RENDER_DEPTH = 5;

function PropertyValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (typeof value === "boolean") {
    return (
      <span className={value ? "text-emerald-400" : "text-red-400"}>
        {String(value)}
      </span>
    );
  }

  if (typeof value === "number") {
    return <span className="text-blue-400">{value.toLocaleString()}</span>;
  }

  if (typeof value === "string") {
    return (
      <span className="text-amber-300 break-all">
        {value.length > 200 ? `${value.slice(0, 200)}...` : value}
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_RENDER_DEPTH) {
      return <span className="text-zinc-500">[...{value.length} items]</span>;
    }

    return (
      <span className="text-zinc-400">
        [{value.map((v, i) => (
          <span key={i}>
            {i > 0 && ", "}
            <PropertyValue value={v} depth={depth + 1} />
          </span>
        ))}]
      </span>
    );
  }

  if (typeof value === "object" && value !== null && depth >= MAX_RENDER_DEPTH) {
    return <span className="text-zinc-500">{"{...}"}</span>;
  }

  return <span className="text-zinc-400">{JSON.stringify(value)}</span>;
}

export function EventDetail({ event, onClose, onForkFromSnapshot }: EventDetailProps) {
  const properties = getEventProperties(event);
  const color = EVENT_COLORS[event.type];
  const category = getEventCategory(event.type);
  const [showForkConfirm, setShowForkConfirm] = useState(false);

  // Check for prompt/completion data (from verbose timeline mode)
  const hasPromptData = typeof event.input === "string" || typeof event.output === "string";
  const canFork = onForkFromSnapshot && event.snapshotId != null;

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: color }}
            />
            <span className="text-sm font-semibold text-zinc-100">
              {event.type.replace(/_/g, " ")}
            </span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {category} &middot; ID #{event.id}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >
          ✕
        </button>
      </div>

      {/* Metadata */}
      <div className="mt-4 space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-zinc-500">Time</span>
          <span className="text-zinc-300 font-mono">{formatTimestamp(event.timestamp)}</span>
        </div>

        {event.agentId && (
          <div className="flex justify-between">
            <span className="text-zinc-500">Agent</span>
            <span className="text-zinc-300 font-mono">{event.agentId}</span>
          </div>
        )}

        {event.snapshotId != null && (
          <div className="flex justify-between">
            <span className="text-zinc-500">Snapshot</span>
            <span className="text-zinc-300 font-mono">#{event.snapshotId}</span>
          </div>
        )}
      </div>

      {/* Properties */}
      {properties.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-medium text-zinc-400">Properties</h3>
          <div className="space-y-1.5">
            {properties.map(([key, value]) => (
              <div key={key} className="text-xs">
                <span className="text-zinc-500">{key}: </span>
                <PropertyValue value={value} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prompt/Completion viewer (verbose timeline data) */}
      {hasPromptData && (
        <PromptViewer
          input={event.input as string | undefined}
          output={event.output as string | undefined}
          totalTokens={typeof event.totalTokens === "number" ? event.totalTokens : undefined}
        />
      )}

      {/* Fork from snapshot button */}
      {canFork && (
        <div className="mt-4">
          {showForkConfirm ? (
            <div className="rounded border border-amber-500/30 bg-amber-950/20 p-3">
              <p className="text-xs text-amber-300">
                Fork timeline from snapshot #{event.snapshotId}? This will truncate the timeline to this point.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => {
                    onForkFromSnapshot!(event.id);
                    setShowForkConfirm(false);
                  }}
                  className="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-500"
                >
                  Confirm Fork
                </button>
                <button
                  onClick={() => setShowForkConfirm(false)}
                  className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowForkConfirm(true)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-amber-500/40 hover:bg-zinc-700"
            >
              Fork from here
            </button>
          )}
        </div>
      )}
    </div>
  );
}
