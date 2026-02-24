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

export const ConstraintOrderingDagDiagram = memo(function ConstraintOrderingDagDiagram() {
  const nodes = useMemo<Node[]>(() => [
    // Top row
    positionNode<StepNodeData>('loadUser', 'step', 80, 10, {
      label: 'loadUser',
      subtitle: 'p:100',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('checkAuth', 'step', 350, 10, {
      label: 'checkAuth',
      subtitle: 'p:90',
      status: 'idle',
      colorScheme: 'primary',
    }),

    // Middle row
    positionNode<StepNodeData>('validateCart', 'step', 80, 110, {
      label: 'validateCart',
      subtitle: 'p:50',
      status: 'idle',
      colorScheme: 'amber',
    }),
    positionNode<StepNodeData>('applyPromo', 'step', 350, 110, {
      label: 'applyPromo',
      subtitle: 'p:40, after: validateCart',
      status: 'idle',
      colorScheme: 'amber',
    }),

    // Bottom row
    positionNode<StepNodeData>('checkout', 'step', 210, 210, {
      label: 'checkout',
      subtitle: 'p:10, after: applyPromo',
      status: 'idle',
      colorScheme: 'emerald',
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    edge('loadUser', 'validateCart', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('checkAuth', 'validateCart', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('validateCart', 'applyPromo'),
    edge('applyPromo', 'checkout', { sourceHandle: 'bottom', targetHandle: 'top' }),
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
