'use client'

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import type { ColorScheme } from '../types'
import { EDGE_GRADIENTS, ACCENT_COLORS } from '../theme'

const HEX_TO_SCHEME: Record<string, ColorScheme> = {
  '#0ea5e9': 'primary', '#38bdf8': 'primary',
  '#f59e0b': 'amber', '#fbbf24': 'amber',
  '#8b5cf6': 'violet', '#a78bfa': 'violet',
  '#10b981': 'emerald', '#34d399': 'emerald',
  '#ef4444': 'red', '#f87171': 'red',
  '#64748b': 'slate', '#94a3b8': 'slate',
}

interface LabeledEdgeData {
  label?: string
  active?: boolean
  colorScheme?: ColorScheme
  colorActive?: string
  dashed?: boolean
}

export function LabeledEdge({
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
  const {
    label,
    active = false,
    colorActive,
    dashed = false,
  } = (data ?? {}) as LabeledEdgeData
  const colorScheme = (data as LabeledEdgeData)?.colorScheme
    ?? (colorActive ? HEX_TO_SCHEME[colorActive] : undefined)
    ?? 'primary'
  const gradient = EDGE_GRADIENTS[colorScheme]
  const gradientId = `edge-grad-${id}`

  const [edgePath, labelX, labelY] = getBezierPath({
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
          strokeDasharray: dashed ? '6 3' : undefined,
          opacity: active ? 0.8 : 0.5,
          transition: 'stroke 0.3s, stroke-width 0.3s, opacity 0.3s',
        }}
      />
      {active && (
        <circle r="3" fill={ACCENT_COLORS[colorScheme]}>
          <animateMotion dur="0.6s" repeatCount="1" fill="freeze" path={edgePath} />
        </circle>
      )}
      {label && (
        <EdgeLabelRenderer>
          <div
            className="turbo-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'none',
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
