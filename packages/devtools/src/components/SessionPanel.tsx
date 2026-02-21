import { useCallback, useRef, useState } from "react";
import type { DebugEvent } from "../lib/types";
import { generateStandaloneHTML } from "../lib/html-export";

const MAX_IMPORT_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

interface SessionPanelProps {
  events: DebugEvent[];
  onImport: (data: string) => void;
  onClear: () => void;
  onSaveRun?: (events: DebugEvent[], name?: string) => void;
  onImportRun?: (json: string) => void;
  /** E6: Auto-save controls */
  autoSaveEnabled?: boolean;
  onToggleAutoSave?: () => void;
}

export function SessionPanel({ events, onImport, onClear, onSaveRun, onImportRun, autoSaveEnabled, onToggleAutoSave }: SessionPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const runFileInputRef = useRef<HTMLInputElement>(null);
  // E1: Loading states to prevent double-clicks
  const [importing, setImporting] = useState(false);
  const [importingRun, setImportingRun] = useState(false);

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

  const handleExportToHtml = useCallback(() => {
    const html = generateStandaloneHTML(events, { title: "Directive DevTools Trace" });
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

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    if (file.size > MAX_IMPORT_SIZE_BYTES) {
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
  }, [onImport]);

  const handleSaveRun = useCallback(() => {
    if (onSaveRun && events.length > 0) {
      onSaveRun(events);
    }
  }, [onSaveRun, events]);

  const handleImportRun = useCallback(() => {
    if (!importingRun) {
      runFileInputRef.current?.click();
    }
  }, [importingRun]);

  const handleRunFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    if (file.size > MAX_IMPORT_SIZE_BYTES) {
      e.target.value = "";

      return;
    }

    setImportingRun(true);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string" && onImportRun) {
        onImportRun(reader.result);
      }
      setImportingRun(false);
    };
    reader.onerror = () => {
      setImportingRun(false);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [onImportRun]);

  return (
    <div className="border-t border-zinc-800 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Session
        </h3>
        {/* E6: Auto-save toggle */}
        {onToggleAutoSave && (
          <button
            onClick={onToggleAutoSave}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              autoSaveEnabled
                ? "bg-emerald-500/20 text-emerald-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            title={autoSaveEnabled ? "Auto-save enabled" : "Auto-save disabled"}
          >
            {autoSaveEnabled ? "Auto ✓" : "Auto"}
          </button>
        )}
      </div>

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
          <span aria-hidden="true">📤</span> {importing ? "Importing..." : "Import from file"}
        </button>

        {onSaveRun && (
          <button
            onClick={handleSaveRun}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            disabled={events.length === 0}
          >
            <span aria-hidden="true">💾</span> Save Run
          </button>
        )}

        {onImportRun && (
          <button
            onClick={handleImportRun}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            disabled={importingRun}
          >
            <span aria-hidden="true">📂</span> {importingRun ? "Importing..." : "Import Run"}
          </button>
        )}

        <button
          onClick={() => { if (window.confirm("Clear all recorded events?")) { onClear(); } }}
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
      <input
        ref={runFileInputRef}
        type="file"
        accept=".json"
        onChange={handleRunFileChange}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}
