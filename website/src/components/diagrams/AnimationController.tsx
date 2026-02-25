'use client'

import { Pause, Play } from '@phosphor-icons/react'
import clsx from 'clsx'

interface AnimationControllerProps {
  isPlaying: boolean
  onToggle: () => void
  hint?: string
}

export function AnimationController({ isPlaying, onToggle, hint }: AnimationControllerProps) {
  return (
    <div className="mb-4 flex items-center justify-center gap-4">
      <button
        onClick={onToggle}
        className={clsx(
          'flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition',
          isPlaying
            ? 'bg-brand-primary text-white hover:bg-brand-primary-600'
            : 'bg-slate-700 text-slate-300 hover:bg-slate-600',
        )}
      >
        {isPlaying ? (
          <>
            <Pause weight="fill" className="h-4 w-4" />
            Pause
          </>
        ) : (
          <>
            <Play weight="fill" className="h-4 w-4" />
            Play
          </>
        )}
      </button>
      {hint && (
        <span className="text-xs text-slate-400">{hint}</span>
      )}
    </div>
  )
}
