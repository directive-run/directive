import { useTheme } from 'next-themes'
import { useMemo } from 'react'
import type { ColorScheme } from '../types'
import { getEdgeColor, getEdgeColorDark } from '../theme'

export function useDiagramTheme() {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  return useMemo(() => ({
    isDark,
    bgColor: isDark ? '#0f172a' : '#ffffff',
    gridColor: isDark ? '#1e293b' : '#f1f5f9',
    getEdgeStroke: (scheme: ColorScheme, active: boolean) =>
      isDark ? getEdgeColorDark(scheme, active) : getEdgeColor(scheme, active),
  }), [isDark])
}
