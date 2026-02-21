import { useMemo, useState } from "react";

interface ScratchpadPanelProps {
  data: Record<string, unknown>;
}

export function ScratchpadPanel({ data }: ScratchpadPanelProps) {
  const [search, setSearch] = useState("");

  const entries = useMemo(() => {
    const all = Object.entries(data);
    if (!search) {
      return all;
    }

    const lower = search.toLowerCase();

    return all.filter(([key]) => key.toLowerCase().includes(lower));
  }, [data, search]);

  if (Object.keys(data).length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <div className="text-center">
          <div className="mb-2 text-2xl" aria-hidden="true">📋</div>
          <p className="text-sm">No scratchpad data</p>
          <p className="mt-1 text-xs">Scratchpad entries appear when agents write to shared state</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter keys..."
        aria-label="Filter scratchpad keys"
        className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500"
      />

      {/* KV table */}
      <div className="space-y-1">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className="flex items-start gap-3 rounded border border-zinc-800 bg-zinc-900 px-3 py-2"
          >
            <span className="shrink-0 font-mono text-xs font-medium text-blue-400">
              {key}
            </span>
            <span className="min-w-0 break-all font-mono text-xs text-zinc-300">
              {typeof value === "string"
                ? value.length > 300 ? `${value.slice(0, 300)}...` : value
                : JSON.stringify(value, null, 2)?.slice(0, 500) ?? "null"}
            </span>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-zinc-600">
        {entries.length} / {Object.keys(data).length} entries
      </div>
    </div>
  );
}
