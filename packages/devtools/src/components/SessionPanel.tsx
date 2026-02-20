import { useCallback, useRef } from "react";
import type { DebugEvent } from "../lib/types";

interface SessionPanelProps {
  events: DebugEvent[];
  onImport: (data: string) => void;
  onClear: () => void;
}

export function SessionPanel({ events, onImport, onClear }: SessionPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportToFile = useCallback(() => {
    const data = JSON.stringify({ version: 1, events, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `directive-devtools-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [events]);

  const handleImportFromFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onImport(reader.result);
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-imported
    e.target.value = "";
  }, [onImport]);

  return (
    <div className="border-t border-zinc-800 px-4 py-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Session
      </h3>

      <div className="space-y-1.5">
        <button
          onClick={handleExportToFile}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          disabled={events.length === 0}
        >
          <span>📥</span> Export to file
        </button>

        <button
          onClick={handleImportFromFile}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <span>📤</span> Import from file
        </button>

        <button
          onClick={onClear}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
          disabled={events.length === 0}
        >
          <span>🗑</span> Clear events
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
