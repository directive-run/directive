import { useEffect, useMemo } from 'react'
import { createModule, t, type ModuleSchema } from '@directive-run/core'
import { useDirectiveRef, useFact, useEvents } from '@directive-run/react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsePlaybackOptions {
  totalSteps: number
  defaultSpeed?: number // ms per step, default 500
}

export interface UsePlaybackReturn {
  /** Current step index, or null when not in playback mode (showing final state) */
  step: number | null
  isPlaying: boolean
  speed: number
  totalSteps: number
  start: () => void
  pause: () => void
  resume: () => void
  stop: () => void
  stepForward: () => void
  stepBackward: () => void
  setSpeed: (ms: number) => void
}

// ---------------------------------------------------------------------------
// Playback module — Directive-backed state machine
// ---------------------------------------------------------------------------

const playbackSchema = {
  facts: {
    /** Current step index, -1 means "not in playback" (showing final state) */
    step: t.number(),
    isPlaying: t.boolean(),
    /** Milliseconds per step */
    speed: t.number(),
    totalSteps: t.number(),
  },
  events: {
    start: {},
    pause: {},
    resume: {},
    stop: {},
    stepForward: {},
    stepBackward: {},
    setSpeed: { ms: t.number() },
    setTotalSteps: { count: t.number() },
  },
} satisfies ModuleSchema

const playbackModule = createModule('devtools-playback', {
  schema: playbackSchema,

  init: (facts) => {
    facts.step = -1
    facts.isPlaying = false
    facts.speed = 500
    facts.totalSteps = 0
  },

  events: {
    start: (facts) => {
      facts.step = 0
      facts.isPlaying = true
    },
    pause: (facts) => {
      facts.isPlaying = false
    },
    resume: (facts) => {
      facts.isPlaying = true
    },
    stop: (facts) => {
      facts.step = -1
      facts.isPlaying = false
    },
    stepForward: (facts) => {
      facts.isPlaying = false
      if (facts.step < 0) {
        facts.step = 0
      } else if (facts.step < facts.totalSteps - 1) {
        facts.step = facts.step + 1
      }
    },
    stepBackward: (facts) => {
      facts.isPlaying = false
      if (facts.step < 0) {
        facts.step = 0
      } else if (facts.step > 0) {
        facts.step = facts.step - 1
      }
    },
    setSpeed: (facts, { ms }) => {
      facts.speed = ms
    },
    setTotalSteps: (facts, { count }) => {
      facts.totalSteps = count
      // If playback is beyond new bounds, clamp or stop
      if (facts.step >= count) {
        facts.step = -1
        facts.isPlaying = false
      }
    },
  },

  effects: {
    autoAdvance: {
      run: (facts) => {
        if (!facts.isPlaying || facts.step < 0) {
          return
        }

        const timer = setTimeout(() => {
          const next = facts.step + 1
          if (next >= facts.totalSteps) {
            facts.isPlaying = false
            facts.step = facts.totalSteps - 1
          } else {
            facts.step = next
          }
        }, facts.speed)

        return () => clearTimeout(timer)
      },
    },
  },
})

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export function usePlayback(options: UsePlaybackOptions): UsePlaybackReturn {
  const { totalSteps, defaultSpeed = 500 } = options

  // Memoize module to keep stable reference for useDirectiveRef
  const module = useMemo(() => playbackModule, [])

  const system = useDirectiveRef(module, {
    initialFacts: { speed: defaultSpeed, totalSteps },
  })

  // Read reactive state
  const step = useFact(system, 'step')
  const isPlaying = useFact(system, 'isPlaying')
  const speed = useFact(system, 'speed')
  const events = useEvents(system)

  // Sync totalSteps from caller
  useEffect(() => {
    if (system.facts.totalSteps !== totalSteps) {
      events.setTotalSteps({ count: totalSteps })
    }
  }, [totalSteps, events, system])

  // Keyboard shortcuts
  useEffect(() => {
    if (totalSteps <= 1) {
      return
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === ' ') {
        e.preventDefault()
        const currentStep = system.facts.step as number
        const playing = system.facts.isPlaying as boolean
        if (currentStep < 0) {
          events.start()
        } else if (playing) {
          events.pause()
        } else {
          events.resume()
        }
      } else if (e.key === 'ArrowLeft' && (system.facts.step as number) >= 0) {
        e.preventDefault()
        events.stepBackward()
      } else if (e.key === 'ArrowRight' && (system.facts.step as number) >= 0) {
        e.preventDefault()
        events.stepForward()
      } else if (e.key === 'Escape' && (system.facts.step as number) >= 0) {
        e.preventDefault()
        events.stop()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [totalSteps, events, system])

  // Map internal -1 sentinel to null for the public API
  const publicStep = (step ?? -1) < 0 ? null : step!

  return {
    step: publicStep,
    isPlaying: isPlaying ?? false,
    speed: speed ?? defaultSpeed,
    totalSteps,
    // Wrap event methods to prevent React MouseEvent from leaking into dispatch.
    // The events proxy spreads payload into { type, ...payload }, and MouseEvent
    // has its own `type` property ('click') that would override the event name.
    start: () => events.start(),
    pause: () => events.pause(),
    resume: () => events.resume(),
    stop: () => events.stop(),
    stepForward: () => events.stepForward(),
    stepBackward: () => events.stepBackward(),
    setSpeed: (ms: number) => events.setSpeed({ ms }),
  }
}
