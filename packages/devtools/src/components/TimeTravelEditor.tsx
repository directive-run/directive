import { useCallback, useState } from "react";
import type { DevToolsSnapshot } from "../lib/types";

interface TimeTravelEditorProps {
  snapshot: DevToolsSnapshot | null;
  onFork: (snapshot: DevToolsSnapshot) => void;
  onClose: () => void;
}

export function TimeTravelEditor({ snapshot, onFork, onClose }: TimeTravelEditorProps) {
  const [jsonText, setJsonText] = useState(() =>
    snapshot ? JSON.stringify(snapshot, null, 2) : "{}",
  );
  const [error, setError] = useState<string | null>(null);

  const handleFork = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText);
      if (typeof parsed !== "object" || parsed === null || typeof parsed.timestamp !== "number") {
        setError("Invalid snapshot: must be an object with a numeric 'timestamp' field");

        return;
      }
      setError(null);
      onFork(parsed as DevToolsSnapshot);
    } catch (e) {
      setError(e instanceof SyntaxError ? `Invalid JSON: ${e.message}` : "Failed to parse JSON");
    }
  }, [jsonText, onFork]);

  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500 text-sm">
        No snapshot selected
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-200">Edit State & Fork</h3>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          aria-label="Close editor"
        >
          ✕
        </button>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden p-4">
        <label htmlFor="snapshot-editor" className="mb-2 block text-xs text-zinc-500">
          Snapshot state (JSON)
        </label>
        <textarea
          id="snapshot-editor"
          value={jsonText}
          onChange={(e) => {
            setJsonText(e.target.value);
            setError(null);
          }}
          className="h-full w-full resize-none rounded border border-zinc-700 bg-zinc-800 p-3 font-mono text-xs text-zinc-200 outline-none focus:border-blue-500"
          spellCheck={false}
        />
      </div>

      {/* Footer */}
      <div className="border-t border-zinc-800 px-4 py-3">
        {error && (
          <div className="mb-2 rounded border border-red-800/50 bg-red-950/20 px-3 py-1.5 text-xs text-red-400">
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleFork}
            className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
          >
            Fork with changes
          </button>
          <button
            onClick={onClose}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
