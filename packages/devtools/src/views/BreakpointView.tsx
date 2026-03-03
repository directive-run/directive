import { BreakpointCard } from "../components/BreakpointCard";
import type { BreakpointState } from "../lib/types";

interface BreakpointViewProps {
  state: BreakpointState;
  onResume: (
    id: string,
    modifications?: { input?: string; skip?: boolean },
  ) => void;
  onCancel: (id: string, reason?: string) => void;
  onRefresh: () => void;
}

export function BreakpointView({
  state,
  onResume,
  onCancel,
  onRefresh,
}: BreakpointViewProps) {
  const hasPending = state.pending.length > 0;

  return (
    <div className="flex h-full flex-col overflow-auto">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-semibold text-zinc-300">Breakpoints</h2>
          {hasPending && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
              {state.pending.length} pending
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onRefresh}
            className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            Refresh
          </button>

          {/* Resume all */}
          {hasPending && (
            <button
              onClick={() => {
                if (
                  window.confirm(
                    `Resume all ${state.pending.length} pending breakpoints?`,
                  )
                ) {
                  state.pending.forEach((bp) => onResume(bp.id));
                }
              }}
              className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500"
            >
              Resume All
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 p-6">
        {/* Pending breakpoints */}
        {hasPending ? (
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Pending ({state.pending.length})
            </h3>
            <div className="space-y-3">
              {state.pending.map((bp) => (
                <BreakpointCard
                  key={bp.id}
                  breakpoint={bp}
                  onResume={onResume}
                  onCancel={onCancel}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-48 items-center justify-center text-zinc-500">
            <div className="text-center">
              <div className="mb-2 text-4xl" aria-hidden="true">
                ⏸
              </div>
              <p>No pending breakpoints</p>
              <p className="mt-1 text-xs">
                Breakpoints pause execution at configured phases
              </p>
            </div>
          </div>
        )}

        {/* History */}
        {(state.resolved.length > 0 || state.cancelled.length > 0) && (
          <div className="mt-8">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              History
            </h3>
            <div className="space-y-1">
              {state.resolved.map((id) => (
                <div
                  key={id}
                  className="flex items-center gap-2 rounded px-3 py-1.5 text-xs text-zinc-500"
                >
                  <span className="text-emerald-400">●</span>
                  <span className="font-mono">{id}</span>
                  <span className="text-zinc-600">Resolved</span>
                </div>
              ))}
              {state.cancelled.map((id) => (
                <div
                  key={id}
                  className="flex items-center gap-2 rounded px-3 py-1.5 text-xs text-zinc-500"
                >
                  <span className="text-red-400">●</span>
                  <span className="font-mono">{id}</span>
                  <span className="text-zinc-600">Cancelled</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
