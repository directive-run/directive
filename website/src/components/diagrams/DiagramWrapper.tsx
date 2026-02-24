'use client'

import { ReactFlow, Background, type ReactFlowProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './turbo-theme.css'
import clsx from 'clsx'
import { useDiagramTheme } from './hooks/useDiagramTheme'
import { EDGE_GRADIENTS } from './theme'

const MARKER_SCHEMES = Object.entries(EDGE_GRADIENTS)

interface DiagramWrapperProps extends Omit<ReactFlowProps, 'children' | 'height'> {
  height?: number | string
  className?: string
  interactive?: boolean
  children?: React.ReactNode
}

export function DiagramWrapper({
  height = 440,
  className,
  interactive = false,
  children,
  ...flowProps
}: DiagramWrapperProps) {
  const { bgColor, gridColor } = useDiagramTheme()

  return (
    <div
      className={clsx(
        'directive-diagram not-prose my-8 w-full rounded-lg border border-slate-700/50 shadow-lg shadow-slate-900/20',
        className,
      )}
      style={{
        height: typeof height === 'number' ? `${height}px` : height,
        background: bgColor,
      }}
    >
      <ReactFlow
        nodesDraggable={interactive}
        nodesConnectable={false}
        elementsSelectable={interactive}
        zoomOnScroll={interactive}
        zoomOnPinch={interactive}
        zoomOnDoubleClick={false}
        panOnDrag={interactive}
        panOnScroll={false}
        preventScrolling={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        {...flowProps}
      >
        <Background color={gridColor} gap={20} />
        <svg style={{ position: 'absolute', width: 0, height: 0 }}>
          <defs>
            {MARKER_SCHEMES.map(([scheme, g]) => (
              <marker
                key={scheme}
                id={`edge-circle-${scheme}`}
                viewBox="-5 -5 10 10"
                refX="0"
                refY="0"
                markerWidth="5"
                markerHeight="5"
              >
                <circle r="3" stroke={g.to} fill={g.to} strokeOpacity="0.75" />
              </marker>
            ))}
          </defs>
        </svg>
        {children}
      </ReactFlow>
    </div>
  )
}
