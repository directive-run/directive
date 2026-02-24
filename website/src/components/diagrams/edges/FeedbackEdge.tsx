'use client'

import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'

interface FeedbackEdgeData {
  label?: string
  sublabel?: string
  active?: boolean
  colorActive?: string
  direction?: 'below' | 'above'
}

export function FeedbackEdge({
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
    colorActive = '#0ea5e9',
    direction = 'below',
  } = (data ?? {}) as FeedbackEdgeData

  const midX = (sourceX + targetX) / 2
  const curveOffset = direction === 'below' ? 60 : -60

  const edgePath = `M ${sourceX} ${sourceY} Q ${sourceX} ${sourceY + curveOffset}, ${midX} ${sourceY + curveOffset} Q ${targetX} ${sourceY + curveOffset}, ${targetX} ${targetY}`

  const labelY = sourceY + curveOffset + (direction === 'below' ? 18 : -18)
  const strokeColor = active ? colorActive : '#94a3b8'

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth: active ? 2.5 : 1.5,
          strokeDasharray: active ? undefined : '4 4',
          transition: 'stroke 0.3s, stroke-width 0.3s',
        }}
      />
      {active && (
        <circle r="3.5" fill={colorActive}>
          <animateMotion dur="1s" repeatCount="1" fill="freeze" path={edgePath} />
        </circle>
      )}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${midX}px,${labelY}px)`,
              pointerEvents: 'none',
            }}
            className="text-center"
          >
            <div className={active ? 'text-xs font-semibold' : 'text-[10px] text-slate-400 dark:text-slate-500'} style={active ? { color: colorActive } : undefined}>
              {label}
            </div>
            {sublabel && (
              <div className="text-[10px] text-slate-400 dark:text-slate-500">{sublabel}</div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
