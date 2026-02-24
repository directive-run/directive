'use client'

import { BaseEdge, EdgeLabelRenderer, getBezierPath, getStraightPath, type EdgeProps } from '@xyflow/react'

interface LabeledEdgeData {
  label?: string
  active?: boolean
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
  const { label, active = false, colorActive = '#0ea5e9', dashed = false } = (data ?? {}) as LabeledEdgeData

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  const strokeColor = active ? colorActive : '#94a3b8'

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth: active ? 2.5 : 1.5,
          strokeDasharray: dashed ? '6 3' : undefined,
          transition: 'stroke 0.3s, stroke-width 0.3s',
        }}
      />
      {active && (
        <circle r="3.5" fill={colorActive}>
          <animateMotion dur="0.6s" repeatCount="1" fill="freeze" path={edgePath} />
        </circle>
      )}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'none',
            }}
            className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-900/80 dark:text-slate-400"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
