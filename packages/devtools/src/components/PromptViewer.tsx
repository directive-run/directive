import { useState, useCallback } from "react";

interface PromptViewerProps {
  input?: string;
  output?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

type Tab = "input" | "output";

export function PromptViewer({ input, output, inputTokens, outputTokens, totalTokens }: PromptViewerProps) {
  const hasInput = typeof input === "string" && input.length > 0;
  const hasOutput = typeof output === "string" && output.length > 0;
  const [activeTab, setActiveTab] = useState<Tab>(hasInput ? "input" : "output");

  const handleCopy = useCallback(() => {
    const text = activeTab === "input" ? input : output;
    if (text) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }, [activeTab, input, output]);

  if (!hasInput && !hasOutput) {
    return null;
  }

  const content = activeTab === "input" ? input : output;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-zinc-400">Prompt / Completion</h3>
        <button
          onClick={handleCopy}
          className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          aria-label="Copy to clipboard"
          title="Copy"
        >
          Copy
        </button>
      </div>

      {/* Tabs */}
      <div className="mt-2 flex gap-1 border-b border-zinc-800">
        {hasInput && (
          <button
            onClick={() => setActiveTab("input")}
            className={`px-2 py-1 text-[10px] font-medium transition-colors ${
              activeTab === "input"
                ? "border-b-2 border-blue-500 text-blue-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Input
            {inputTokens != null && (
              <span className="ml-1 text-zinc-600">({inputTokens.toLocaleString()} tok)</span>
            )}
          </button>
        )}
        {hasOutput && (
          <button
            onClick={() => setActiveTab("output")}
            className={`px-2 py-1 text-[10px] font-medium transition-colors ${
              activeTab === "output"
                ? "border-b-2 border-emerald-500 text-emerald-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Output
            {outputTokens != null && (
              <span className="ml-1 text-zinc-600">({outputTokens.toLocaleString()} tok)</span>
            )}
          </button>
        )}
      </div>

      {/* Token summary */}
      {totalTokens != null && (
        <div className="mt-1 text-[10px] text-zinc-600">
          Total: {totalTokens.toLocaleString()} tokens
        </div>
      )}

      {/* Content */}
      <div className="mt-2 max-h-64 overflow-auto rounded bg-zinc-800/60 p-2">
        <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-zinc-300">
          {content}
        </pre>
      </div>
    </div>
  );
}
