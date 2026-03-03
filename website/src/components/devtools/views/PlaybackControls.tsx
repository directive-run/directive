import type { UsePlaybackReturn } from "./usePlayback";

const SPEED_OPTIONS = [
  { label: "0.5x", value: 1000 },
  { label: "1x", value: 500 },
  { label: "2x", value: 250 },
];

interface PlaybackControlsProps {
  playback: UsePlaybackReturn;
  /** Optional label for the current step (e.g. event description or stage name) */
  stepLabel?: string | null;
}

export function PlaybackControls({
  playback,
  stepLabel,
}: PlaybackControlsProps) {
  const {
    step,
    isPlaying,
    speed,
    totalSteps,
    start,
    pause,
    resume,
    stop,
    stepForward,
    stepBackward,
    setSpeed,
  } = playback;

  if (totalSteps <= 1) {
    return null;
  }

  return (
    <>
      {/* Playback controls row */}
      <div className="flex items-center justify-center gap-1">
        <button
          onClick={stepBackward}
          disabled={step === null || step <= 0}
          className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
          title="Step backward (←)"
        >
          &#9664;
        </button>

        {step === null ? (
          <button
            onClick={start}
            className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-400 transition-colors hover:bg-amber-500/30"
            title="Play (Space)"
          >
            Play
          </button>
        ) : isPlaying ? (
          <button
            onClick={pause}
            className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-400 transition-colors hover:bg-amber-500/30"
            title="Pause (Space)"
          >
            Pause
          </button>
        ) : (
          <button
            onClick={resume}
            className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-400 transition-colors hover:bg-amber-500/30"
            title="Resume (Space)"
          >
            Resume
          </button>
        )}

        <button
          onClick={stepForward}
          disabled={step === null || step >= totalSteps - 1}
          className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
          title="Step forward (→)"
        >
          &#9654;
        </button>

        {step !== null && (
          <>
            <span className="px-1 text-[10px] font-medium text-zinc-300">
              {step + 1} / {totalSteps}
            </span>

            <button
              onClick={stop}
              className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              title="Stop (Esc)"
            >
              Stop
            </button>

            <div className="mx-0.5 h-3 w-px bg-zinc-700" />

            {SPEED_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => setSpeed(opt.value)}
                className={`rounded px-1 py-0.5 text-[10px] font-medium transition-colors ${
                  speed === opt.value
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Step label row */}
      {step !== null && stepLabel && (
        <div
          className="truncate text-center text-[10px] text-zinc-500"
          title={stepLabel}
        >
          {stepLabel}
        </div>
      )}
    </>
  );
}
