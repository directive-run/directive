'use client'

import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import type { ColorScheme } from '../types'
import { EDGE_GRADIENTS, ACCENT_COLORS } from '../theme'

interface AnimatedFlowEdgeData {
  active?: boolean
  colorScheme?: ColorScheme
}

export function AnimatedFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const { active = false, colorScheme = 'primary' } = (data ?? {}) as AnimatedFlowEdgeData
  const gradient = EDGE_GRADIENTS[colorScheme]
  const gradientId = `edge-grad-${id}`

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  return (
    <>
      {active && (
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={sourceX}
            y1={sourceY}
            x2={targetX}
            y2={targetY}
          >
            <stop offset="0%" stopColor={gradient.from} />
            <stop offset="100%" stopColor={gradient.to} />
          </linearGradient>
        </defs>
      )}
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        markerStart={active ? `url(#edge-circle-${colorScheme})` : undefined}
        style={{
          stroke: active ? `url(#${gradientId})` : '#334155',
          strokeWidth: active ? 2 : 1.5,
          opacity: active ? 0.8 : 0.5,
          transition: 'stroke 0.3s, stroke-width 0.3s, opacity 0.3s',
        }}
      />
      {active && (
        <circle r="3.5" fill={ACCENT_COLORS[colorScheme]}>
          <animateMotion dur="1s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}
    </>
  )
}
