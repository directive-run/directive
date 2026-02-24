'use client'

import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'
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

interface FeedbackEdgeData {
  label?: string
  sublabel?: string
  active?: boolean
  colorScheme?: ColorScheme
  colorActive?: string
  direction?: 'below' | 'above'
}

export function FeedbackEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerEnd,
}: EdgeProps) {
  const {
    label,
    sublabel,
    active = false,
    colorActive,
    direction = 'below',
  } = (data ?? {}) as FeedbackEdgeData
  const colorScheme = (data as FeedbackEdgeData)?.colorScheme
    ?? (colorActive ? HEX_TO_SCHEME[colorActive] : undefined)
    ?? 'primary'
  const gradient = EDGE_GRADIENTS[colorScheme]
  const gradientId = `edge-grad-${id}`

  const midX = (sourceX + targetX) / 2
  const curveOffset = direction === 'below' ? 60 : -60

  const edgePath = `M ${sourceX} ${sourceY} Q ${sourceX} ${sourceY + curveOffset}, ${midX} ${sourceY + curveOffset} Q ${targetX} ${sourceY + curveOffset}, ${targetX} ${targetY}`

  const labelPosY = sourceY + curveOffset + (direction === 'below' ? 18 : -18)

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
          strokeDasharray: active ? undefined : '4 4',
          opacity: active ? 0.8 : 0.5,
          transition: 'stroke 0.3s, stroke-width 0.3s, opacity 0.3s',
        }}
      />
      {active && (
        <circle r="3" fill={ACCENT_COLORS[colorScheme]}>
          <animateMotion dur="1s" repeatCount="1" fill="freeze" path={edgePath} />
        </circle>
      )}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${midX}px,${labelPosY}px)`,
              pointerEvents: 'none',
            }}
            className="text-center"
          >
            <div
              className="turbo-edge-label"
              style={active ? { color: ACCENT_COLORS[colorScheme], fontWeight: 600 } : undefined}
            >
              {label}
            </div>
            {sublabel && (
              <div className="mt-0.5 text-[10px]" style={{ color: '#64748b' }}>{sublabel}</div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
