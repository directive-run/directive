'use client'

import { ReactFlow, Background, type ReactFlowProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import clsx from 'clsx'
import { useDiagramTheme } from './hooks/useDiagramTheme'

interface DiagramWrapperProps extends Omit<ReactFlowProps, 'children' | 'height'> {
  height?: number | string
  className?: string
  interactive?: boolean
  children?: React.ReactNode
}

export function DiagramWrapper({
  height = 300,
  className,
  interactive = false,
  children,
  ...flowProps
}: DiagramWrapperProps) {
  const { bgColor, gridColor } = useDiagramTheme()

  return (
    <div
      className={clsx('not-prose my-8 w-full rounded-lg border border-slate-200 dark:border-slate-700', className)}
      style={{ height: typeof height === 'number' ? `${height}px` : height }}
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
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        {...flowProps}
      >
        <Background color={gridColor} gap={20} />
        {children}
      </ReactFlow>
    </div>
  )
}
