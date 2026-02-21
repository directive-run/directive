import { useEffect } from "react";
import type { ReplayControls as ReplayControlsType, ReplaySpeed } from "../hooks/use-replay";

interface ReplayControlsProps {
  replay: ReplayControlsType;
  totalEvents: number;
}

const SPEEDS: ReplaySpeed[] = [1, 2, 5, 10];

export function ReplayControls({ replay, totalEvents }: ReplayControlsProps) {
  const { state, play, pause, stepBack, stepForward, goToStart, goToEnd, exit } = replay;

  // E3: Global keyboard shortcuts for replay
  // C3: Destructure stable callbacks to avoid listener re-attachment on every render
  useEffect(() => {
    if (!state.active) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      switch (e.key) {
        case " ":
          e.preventDefault();
          if (state.playing) {
            pause();
          } else {
            play();
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          stepBack();
          break;
        case "ArrowRight":
          e.preventDefault();
          stepForward();
          break;
        case "Home":
          e.preventDefault();
          goToStart();
          break;
        case "End":
          e.preventDefault();
          goToEnd();
          break;
        case "Escape":
          exit();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.active, state.playing, play, pause, stepBack, stepForward, goToStart, goToEnd, exit]);

  if (!state.active) {
    return (
      <button
        onClick={replay.enter}
        disabled={totalEvents === 0}
        className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
        title={totalEvents === 0 ? "No events to replay" : "Enter replay mode"}
        aria-label={totalEvents === 0 ? "Replay (no events available)" : "Enter replay mode"}
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
        aria-label="Go to start (Home)"
        title="Go to start (Home)"
      >
        ⏮
      </button>
      <button
        onClick={replay.stepBack}
        className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        aria-label="Step back (Left arrow)"
        title="Step back (←)"
      >
        ⏪
      </button>

      {state.playing ? (
        <button
          onClick={replay.pause}
          className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          aria-label="Pause (Space)"
          title="Pause (Space)"
        >
          ⏸
        </button>
      ) : (
        <button
          onClick={replay.play}
          className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          aria-label="Play (Space)"
          title="Play (Space)"
        >
          ▶
        </button>
      )}

      <button
        onClick={replay.stepForward}
        className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        aria-label="Step forward (Right arrow)"
        title="Step forward (→)"
      >
        ⏩
      </button>
      <button
        onClick={replay.goToEnd}
        className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        aria-label="Go to end (End)"
        title="Go to end (End)"
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
        aria-label="Exit replay (Esc)"
        title="Exit replay (Esc)"
      >
        ✕
      </button>
    </div>
  );
}
