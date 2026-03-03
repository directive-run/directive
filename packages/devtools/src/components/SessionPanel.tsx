import { useCallback, useRef, useState } from "react";
import { generateStandaloneHTML } from "../lib/html-export";
import type { DebugEvent } from "../lib/types";

const MAX_IMPORT_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

interface SessionPanelProps {
  events: DebugEvent[];
  onImport: (data: string) => void;
  onClear: () => void;
}

export function SessionPanel({ events, onImport, onClear }: SessionPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // E1: Loading state to prevent double-clicks
  const [importing, setImporting] = useState(false);

  const handleExportToFile = useCallback(() => {
    const data = JSON.stringify(
      { version: 1, events, exportedAt: new Date().toISOString() },
      null,
      2,
    );
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `directive-devtools-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [events]);

  const handleExportToHtml = useCallback(() => {
    const html = generateStandaloneHTML(events, {
      title: "Directive DevTools Trace",
    });
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `directive-trace-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [events]);

  const handleImportFromFile = useCallback(() => {
    if (!importing) {
      fileInputRef.current?.click();
    }
  }, [importing]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) {
        return;
      }

      if (file.size > MAX_IMPORT_SIZE_BYTES) {
        e.target.value = "";

        return;
      }

      // D8: Validate file extension and MIME type
      if (!file.name.endsWith(".json") && file.type !== "application/json") {
        e.target.value = "";

        return;
      }

      setImporting(true);
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          onImport(reader.result);
        }
        setImporting(false);
      };
      reader.onerror = () => {
        setImporting(false);
      };
      reader.readAsText(file);
      // Reset input so same file can be re-imported
      e.target.value = "";
    },
    [onImport],
  );

  return (
    <div className="border-t border-zinc-800 px-4 py-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Session
      </h3>

      <div className="space-y-1.5">
        <button
          onClick={handleExportToFile}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          disabled={events.length === 0}
        >
          <span aria-hidden="true">📥</span> Export JSON
        </button>

        <button
          onClick={handleExportToHtml}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          disabled={events.length === 0}
        >
          <span aria-hidden="true">🌐</span> Export as HTML
        </button>

        <button
          onClick={handleImportFromFile}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          disabled={importing}
        >
          <span aria-hidden="true">📤</span>{" "}
          {importing ? "Importing..." : "Import from file"}
        </button>

        <button
          onClick={() => {
            if (window.confirm("Clear all recorded events?")) {
              onClear();
            }
          }}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-red-400 disabled:opacity-50"
          disabled={events.length === 0}
        >
          <span aria-hidden="true">🗑</span> Clear events
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}
