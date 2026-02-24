import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnimationConfig } from '../types'

export function useAnimationLoop(config: AnimationConfig) {
  const { totalPhases, interval, autoStart = true, startDelay = 500 } = config
  const [phase, setPhase] = useState(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Auto-start after delay
  useEffect(() => {
    if (!autoStart) {
      return
    }

    const timer = setTimeout(() => {
      setPhase(0)
      setIsPlaying(true)
    }, startDelay)

    return () => clearTimeout(timer)
  }, [autoStart, startDelay])

  // Cycle phases
  useEffect(() => {
    if (!isPlaying || phase < 0) {
      return
    }

    intervalRef.current = setInterval(() => {
      setPhase((prev) => (prev + 1) % totalPhases)
    }, interval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isPlaying, phase >= 0, totalPhases, interval])

  const play = useCallback(() => {
    if (phase < 0) {
      setPhase(0)
    }
    setIsPlaying(true)
  }, [phase])

  const pause = useCallback(() => {
    setIsPlaying(false)
  }, [])

  const toggle = useCallback(() => {
    if (isPlaying) {
      pause()
    } else {
      play()
    }
  }, [isPlaying, play, pause])

  const reset = useCallback(() => {
    setPhase(0)
    setIsPlaying(true)
  }, [])

  return { phase, isPlaying, play, pause, toggle, reset }
}
