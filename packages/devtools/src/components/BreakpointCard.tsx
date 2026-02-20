import { useState } from "react";
import type { BreakpointRequest } from "../lib/types";

interface BreakpointCardProps {
  breakpoint: BreakpointRequest;
  onResume: (id: string, modifications?: { input?: string; skip?: boolean }) => void;
  onCancel: (id: string, reason?: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  pre_input_guardrails: "Before Input Guardrails",
  pre_agent_run: "Before Agent Run",
  pre_output_guardrails: "Before Output Guardrails",
  post_run: "After Run",
  pre_handoff: "Before Handoff",
  pre_pattern_step: "Before Pattern Step",
};

export function BreakpointCard({ breakpoint, onResume, onCancel }: BreakpointCardProps) {
  const [showEditor, setShowEditor] = useState(false);
  const [modifiedInput, setModifiedInput] = useState(breakpoint.input);
  const [cancelReason, setCancelReason] = useState("");
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const waitTime = Math.round((Date.now() - breakpoint.requestedAt) / 1000);

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-amber-400 text-lg">⏸</span>
            <span className="text-sm font-medium text-zinc-100">
              {breakpoint.label ?? TYPE_LABELS[breakpoint.type] ?? breakpoint.type}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
            <span>Agent: <span className="text-zinc-300">{breakpoint.agentId}</span></span>
            <span>Phase: <span className="text-zinc-300">{breakpoint.type}</span></span>
            <span>Waiting: <span className="text-amber-400">{waitTime}s</span></span>
          </div>
        </div>
        <span className="text-[10px] text-zinc-600 font-mono">{breakpoint.id}</span>
      </div>

      {/* Input preview */}
      <div className="mt-3 rounded bg-zinc-900 p-2 text-xs">
        <div className="text-[10px] text-zinc-500 mb-1">Input</div>
        <div className="text-zinc-300 font-mono text-[11px] max-h-20 overflow-auto whitespace-pre-wrap break-all">
          {breakpoint.input.length > 500 ? `${breakpoint.input.slice(0, 500)}...` : breakpoint.input}
        </div>
      </div>

      {/* Input editor */}
      {showEditor && (
        <div className="mt-3">
          <label className="text-[10px] text-zinc-500">Modify Input</label>
          <textarea
            value={modifiedInput}
            onChange={(e) => setModifiedInput(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 p-2 text-xs text-zinc-200 font-mono outline-none focus:border-blue-500"
            rows={4}
          />
        </div>
      )}

      {/* Cancel dialog */}
      {showCancelDialog && (
        <div className="mt-3">
          <label className="text-[10px] text-zinc-500">Cancel Reason (optional)</label>
          <input
            type="text"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-red-500"
            placeholder="Reason for cancelling..."
          />
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => {
            const mods = showEditor && modifiedInput !== breakpoint.input
              ? { input: modifiedInput }
              : undefined;
            onResume(breakpoint.id, mods);
          }}
          className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
        >
          Resume
        </button>

        <button
          onClick={() => {
            onResume(breakpoint.id, { skip: true });
          }}
          className="rounded bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-600"
        >
          Skip
        </button>

        {showCancelDialog ? (
          <button
            onClick={() => {
              onCancel(breakpoint.id, cancelReason || undefined);
              setShowCancelDialog(false);
            }}
            className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
          >
            Confirm Cancel
          </button>
        ) : (
          <button
            onClick={() => setShowCancelDialog(true)}
            className="rounded border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
          >
            Cancel
          </button>
        )}

        <button
          onClick={() => setShowEditor(!showEditor)}
          className="ml-auto rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
        >
          {showEditor ? "Hide Editor" : "Edit Input"}
        </button>
      </div>
    </div>
  );
}
