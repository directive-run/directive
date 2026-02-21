import { useMemo, useState } from "react";

interface DerivedPanelProps {
  data: Record<string, unknown>;
}

export function DerivedPanel({ data }: DerivedPanelProps) {
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
          <div className="mb-2 text-2xl" aria-hidden="true">🔗</div>
          <p className="text-sm">No derived values</p>
          <p className="mt-1 text-xs">Derived values appear when cross-agent derivations are configured</p>
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
        placeholder="Filter derivations..."
        aria-label="Filter derived values"
        className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500"
      />

      {/* Derivation cards */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {entries.map(([id, value]) => (
          <div
            key={id}
            className="rounded border border-zinc-800 bg-zinc-900 p-3"
          >
            <div className="mb-1 font-mono text-xs font-medium text-purple-400">
              {id}
            </div>
            <div className="text-[10px] text-zinc-500">
              {typeof value}
            </div>
            <div className="mt-1 max-h-20 overflow-auto break-all font-mono text-xs text-zinc-300">
              {typeof value === "string"
                ? value.length > 200 ? `${value.slice(0, 200)}...` : value
                : JSON.stringify(value, null, 2)?.slice(0, 300) ?? "null"}
            </div>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-zinc-600">
        {entries.length} / {Object.keys(data).length} derivations
      </div>
    </div>
  );
}
