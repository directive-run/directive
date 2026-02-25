'use client'

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'

interface LabeledEdgeData {
  label?: string
  active?: boolean
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
    dashed = false,
  } = (data ?? {}) as LabeledEdgeData
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
            <stop offset="0%" stopColor="var(--gradient-a)" />
            <stop offset="100%" stopColor="var(--gradient-b)" />
          </linearGradient>
        </defs>
      )}
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: active ? `url(#${gradientId})` : '#334155',
          strokeWidth: active ? 4 : 3.5,
          strokeDasharray: dashed ? '6 3' : undefined,
          opacity: active ? 0.8 : 0.5,
          transition: 'stroke 0.3s, stroke-width 0.3s, opacity 0.3s',
        }}
      />
      {active && (
        <circle r="6" fill="var(--accent)">
          <animateMotion dur="1.2s" repeatCount="1" fill="freeze" path={edgePath} />
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
