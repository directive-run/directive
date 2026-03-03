"use client";

import { Pause, Play } from "@phosphor-icons/react";
import clsx from "clsx";

interface DiagramStep {
  id: string;
  label: string;
}

interface DiagramToolbarProps {
  steps: readonly DiagramStep[];
  activeStepId: string | null;
  isPlaying: boolean;
  onToggle: () => void;
}

export function DiagramToolbar({
  steps,
  activeStepId,
  isPlaying,
  onToggle,
}: DiagramToolbarProps) {
  return (
    <div className="-mt-4 flex items-center justify-between">
      <div className="flex flex-wrap gap-2">
        {steps.map((step) => {
          const stepActive = activeStepId === step.id;

          return (
            <div
              key={step.id}
              className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-all ${
                stepActive
                  ? "bg-brand-primary-100 text-brand-primary-700 dark:bg-brand-primary-900 dark:text-brand-primary-300"
                  : "text-slate-400 dark:text-slate-500"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full transition-all ${
                  stepActive
                    ? "bg-brand-primary"
                    : "bg-slate-300 dark:bg-slate-600"
                }`}
              />
              {step.label}
            </div>
          );
        })}
      </div>
      <button
        onClick={onToggle}
        className={clsx(
          "flex shrink-0 cursor-pointer items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition",
          isPlaying
            ? "bg-brand-primary text-white hover:bg-brand-primary-600"
            : "bg-slate-700 text-slate-300 hover:bg-slate-600",
        )}
      >
        {isPlaying ? (
          <>
            <Pause weight="fill" className="h-3.5 w-3.5" />
            Pause
          </>
        ) : (
          <>
            <Play weight="fill" className="h-3.5 w-3.5" />
            Play
          </>
        )}
      </button>
    </div>
  );
}
