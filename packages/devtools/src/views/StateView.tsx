import { useCallback, useEffect, useRef, useState } from "react";
import { ScratchpadPanel } from "../components/ScratchpadPanel";
import { DerivedPanel } from "../components/DerivedPanel";

interface StateViewProps {
  scratchpadState: Record<string, unknown>;
  derivedState: Record<string, unknown>;
  onRequestScratchpad: () => void;
  onRequestDerived: () => void;
}

type SubTab = "scratchpad" | "derived";

export function StateView({ scratchpadState, derivedState, onRequestScratchpad, onRequestDerived }: StateViewProps) {
  const [subTab, setSubTab] = useState<SubTab>("scratchpad");
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up refresh timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    if (subTab === "scratchpad") {
      onRequestScratchpad();
    } else {
      onRequestDerived();
    }
    // Clear loading indicator after a short delay (server doesn't ack refreshes)
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      setRefreshing(false);
    }, 600);
  }, [subTab, onRequestScratchpad, onRequestDerived]);

  return (
    <div className="flex h-full flex-col">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-4 border-b border-zinc-800 px-6 py-2" role="tablist" aria-label="State view tabs">
        <button
          role="tab"
          id="tab-scratchpad"
          aria-selected={subTab === "scratchpad"}
          aria-controls="panel-scratchpad"
          onClick={() => setSubTab("scratchpad")}
          className={`text-xs font-medium transition-colors ${
            subTab === "scratchpad"
              ? "border-b-2 border-fuchsia-500 pb-1 text-fuchsia-400"
              : "pb-1 text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Scratchpad
          {Object.keys(scratchpadState).length > 0 && (
            <span className="ml-1.5 rounded-full bg-fuchsia-500/20 px-1.5 text-[10px] text-fuchsia-400">
              {Object.keys(scratchpadState).length}
            </span>
          )}
        </button>
        <button
          role="tab"
          id="tab-derived"
          aria-selected={subTab === "derived"}
          aria-controls="panel-derived"
          onClick={() => setSubTab("derived")}
          className={`text-xs font-medium transition-colors ${
            subTab === "derived"
              ? "border-b-2 border-purple-500 pb-1 text-purple-400"
              : "pb-1 text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Derived
          {Object.keys(derivedState).length > 0 && (
            <span className="ml-1.5 rounded-full bg-purple-500/20 px-1.5 text-[10px] text-purple-400">
              {Object.keys(derivedState).length}
            </span>
          )}
        </button>

        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="ml-auto rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 disabled:opacity-50"
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div role="tabpanel" id="panel-scratchpad" aria-labelledby="tab-scratchpad" hidden={subTab !== "scratchpad"}>
          {subTab === "scratchpad" && <ScratchpadPanel data={scratchpadState} />}
        </div>
        <div role="tabpanel" id="panel-derived" aria-labelledby="tab-derived" hidden={subTab !== "derived"}>
          {subTab === "derived" && <DerivedPanel data={derivedState} />}
        </div>
      </div>
    </div>
  );
}
