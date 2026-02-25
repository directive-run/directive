'use client'

import { ReactFlow, Background, type ReactFlowProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './turbo-theme.css'
import clsx from 'clsx'
import { useDiagramTheme } from './hooks/useDiagramTheme'
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
        'directive-diagram not-prose my-8 w-full overflow-hidden rounded-lg border border-slate-700/50 shadow-lg shadow-slate-900/20',
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
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        {...flowProps}
      >
        <Background color={gridColor} gap={20} />
        {children}
      </ReactFlow>
    </div>
  )
}
