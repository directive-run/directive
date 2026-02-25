'use client'

import { getBezierPath, getStraightPath, type EdgeProps } from '@xyflow/react'

interface AnimatedFlowEdgeData {
  active?: boolean
  straight?: boolean
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
  style = {},
  markerEnd,
}: EdgeProps) {
  const { active = false, straight = false } = (data ?? {}) as AnimatedFlowEdgeData
  const gradientId = `edge-grad-${id}`

  const xEqual = sourceX === targetX
  const yEqual = sourceY === targetY

  const [edgePath] = straight
    ? getStraightPath({ sourceX, sourceY, targetX, targetY })
    : getBezierPath({
        sourceX: xEqual ? sourceX + 0.0001 : sourceX,
        sourceY: yEqual ? sourceY + 0.0001 : sourceY,
        sourcePosition,
        targetX,
        targetY,
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
      <path
        id={id}
        style={{
          ...style,
          stroke: active ? `url(#${gradientId})` : '#334155',
          strokeWidth: active ? 4 : 3.5,
          opacity: active ? 0.8 : 0.5,
          transition: 'stroke 0.3s, stroke-width 0.3s, opacity 0.3s',
        }}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
      />
      {active && (
        <circle r="6" fill="var(--accent)">
          <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}
    </>
  )
}
