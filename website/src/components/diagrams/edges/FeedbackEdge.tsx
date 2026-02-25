'use client'

import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'

interface FeedbackEdgeData {
  label?: string
  sublabel?: string
  active?: boolean
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
    direction = 'below',
  } = (data ?? {}) as FeedbackEdgeData
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
          strokeDasharray: active ? undefined : '4 4',
          opacity: active ? 0.8 : 0.5,
          transition: 'stroke 0.3s, stroke-width 0.3s, opacity 0.3s',
        }}
      />
      {active && (
        <circle r="6" fill="var(--accent)">
          <animateMotion dur="2s" repeatCount="1" fill="freeze" path={edgePath} />
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
              style={active ? { color: 'var(--accent)', fontWeight: 600 } : undefined}
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
