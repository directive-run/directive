import type { ReplayControls as ReplayControlsType, ReplaySpeed } from "../hooks/use-replay";

interface ReplayControlsProps {
  replay: ReplayControlsType;
  totalEvents: number;
}

const SPEEDS: ReplaySpeed[] = [1, 2, 5, 10];

export function ReplayControls({ replay, totalEvents }: ReplayControlsProps) {
  const { state } = replay;

  if (!state.active) {
    return (
      <button
        onClick={replay.enter}
        disabled={totalEvents === 0}
        className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
      >
        Replay
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 rounded border border-blue-500/30 bg-blue-950/30 px-2 py-1">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-blue-400">Replay</span>

      {/* Transport controls */}
      <button
        onClick={replay.goToStart}
        className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        aria-label="Go to start"
        title="Go to start"
      >
        ⏮
      </button>
      <button
        onClick={replay.stepBack}
        className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        aria-label="Step back"
        title="Step back"
      >
        ⏪
      </button>

      {state.playing ? (
        <button
          onClick={replay.pause}
          className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          aria-label="Pause"
          title="Pause"
        >
          ⏸
        </button>
      ) : (
        <button
          onClick={replay.play}
          className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          aria-label="Play"
          title="Play"
        >
          ▶
        </button>
      )}

      <button
        onClick={replay.stepForward}
        className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        aria-label="Step forward"
        title="Step forward"
      >
        ⏩
      </button>
      <button
        onClick={replay.goToEnd}
        className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        aria-label="Go to end"
        title="Go to end"
      >
        ⏭
      </button>

      {/* Cursor slider */}
      <input
        type="range"
        min={0}
        max={Math.max(totalEvents - 1, 0)}
        value={state.cursorIndex}
        onChange={(e) => replay.seekTo(Number(e.target.value))}
        className="mx-1 w-24 accent-blue-500"
        aria-label="Replay position"
      />

      <span className="text-[10px] tabular-nums text-zinc-500">
        {state.cursorIndex + 1}/{totalEvents}
      </span>

      {/* Speed selector */}
      <select
        value={state.speed}
        onChange={(e) => replay.setSpeed(Number(e.target.value) as ReplaySpeed)}
        className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-300"
        aria-label="Replay speed"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>{s}x</option>
        ))}
      </select>

      {/* Exit */}
      <button
        onClick={replay.exit}
        className="ml-1 rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-zinc-700 hover:text-red-300"
        aria-label="Exit replay"
        title="Exit replay mode"
      >
        ✕
      </button>
    </div>
  );
}
