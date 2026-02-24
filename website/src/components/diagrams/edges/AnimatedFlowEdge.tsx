'use client'

import { BaseEdge, getStraightPath, getBezierPath, type EdgeProps } from '@xyflow/react'

interface AnimatedFlowEdgeData {
  active?: boolean
  colorScheme?: string
}

export function AnimatedFlowEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const { active = false } = (data ?? {}) as AnimatedFlowEdgeData

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
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: active ? '#0ea5e9' : '#94a3b8',
          strokeWidth: active ? 2.5 : 1.5,
          transition: 'stroke 0.3s, stroke-width 0.3s',
        }}
      />
      {active && (
        <circle r="4" fill="#0ea5e9">
          <animateMotion dur="1s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}
    </>
  )
}
