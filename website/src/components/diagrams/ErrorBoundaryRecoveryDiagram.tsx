'use client'

import { memo, useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import {
  DiagramWrapper,
  diagramNodeTypes,
  diagramEdgeTypes,
  positionNode,
  edge,
  type StepNodeData,
} from '../diagrams'

export const ErrorBoundaryRecoveryDiagram = memo(function ErrorBoundaryRecoveryDiagram() {
  const nodes = useMemo<Node[]>(() => [
    // Top: error trigger
    positionNode<StepNodeData>('error', 'step', 220, 10, {
      label: 'Error Occurs',
      status: 'idle',
      colorScheme: 'red',
    }),

    // Middle row: strategies
    positionNode<StepNodeData>('retry', 'step', 30, 110, {
      label: 'retry',
      subtitle: 'strategy',
      status: 'idle',
      colorScheme: 'amber',
    }),
    positionNode<StepNodeData>('skip', 'step', 220, 110, {
      label: 'skip',
      subtitle: 'strategy',
      status: 'idle',
      colorScheme: 'amber',
    }),
    positionNode<StepNodeData>('escalate', 'step', 410, 110, {
      label: 'escalate',
      subtitle: 'strategy',
      status: 'idle',
      colorScheme: 'amber',
    }),

    // Bottom row: outcomes
    positionNode<StepNodeData>('re-execute', 'step', 30, 210, {
      label: 'Re-execute',
      status: 'idle',
      colorScheme: 'emerald',
    }),
    positionNode<StepNodeData>('mark-skipped', 'step', 220, 210, {
      label: 'Mark Skipped',
      status: 'idle',
      colorScheme: 'slate',
    }),
    positionNode<StepNodeData>('system-error', 'step', 410, 210, {
      label: 'System Error',
      status: 'idle',
      colorScheme: 'red',
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    // Error -> strategies
    edge('error', 'retry', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('error', 'skip', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('error', 'escalate', { sourceHandle: 'bottom', targetHandle: 'top' }),

    // Strategies -> outcomes
    edge('retry', 're-execute', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('skip', 'mark-skipped', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('escalate', 'system-error', { sourceHandle: 'bottom', targetHandle: 'top' }),
  ], [])

  return (
    <DiagramWrapper
      height={440}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
