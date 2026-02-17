'use client'

import { useExperiment } from '@/lib/useExperiment'

/**
 * Returns the resolved code theme. The ExperimentsProvider reads localStorage
 * in useLayoutEffect (before paint), so the value is correct on first visible
 * render — no opacity gating needed.
 */
export function useCodeTheme(): string {
  return useExperiment('code-theme', 'auto')
}
