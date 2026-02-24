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

export const ConstraintCompositionDiagram = memo(function ConstraintCompositionDiagram() {
  const nodes = useMemo<Node[]>(() => [
    // Top row: independent constraints
    positionNode<StepNodeData>('loadConfig', 'step', 60, 10, {
      label: 'loadConfig',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('authenticate', 'step', 330, 10, {
      label: 'authenticate',
      status: 'idle',
      colorScheme: 'primary',
    }),

    // Middle: depends on both
    positionNode<StepNodeData>('validateInput', 'step', 130, 110, {
      label: 'validateInput',
      subtitle: 'after: loadConfig, authenticate',
      status: 'idle',
      colorScheme: 'amber',
    }),

    // Bottom: depends on middle
    positionNode<StepNodeData>('processRequest', 'step', 150, 210, {
      label: 'processRequest',
      subtitle: 'after: validateInput',
      status: 'idle',
      colorScheme: 'emerald',
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    edge('loadConfig', 'validateInput', { sourceHandle: 'bottom', targetHandle: 'top', type: 'labeled', data: { label: 'after' } }),
    edge('authenticate', 'validateInput', { sourceHandle: 'bottom', targetHandle: 'top', type: 'labeled', data: { label: 'after' } }),
    edge('validateInput', 'processRequest', { sourceHandle: 'bottom', targetHandle: 'top', type: 'labeled', data: { label: 'after' } }),
  ], [])

  return (
    <DiagramWrapper
      height={280}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
