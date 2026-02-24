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

export const DerivationCompositionDiagram = memo(function DerivationCompositionDiagram() {
  const nodes = useMemo<Node[]>(() => [
    // Top row: facts
    positionNode<StepNodeData>('items', 'step', 30, 10, {
      label: 'items',
      subtitle: 'fact',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('tax', 'step', 230, 10, {
      label: 'tax',
      subtitle: 'fact',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('shipping', 'step', 430, 10, {
      label: 'shipping',
      subtitle: 'fact',
      status: 'idle',
      colorScheme: 'primary',
    }),

    // Middle row: first-level derivations
    positionNode<StepNodeData>('subtotal', 'step', 30, 110, {
      label: 'subtotal',
      subtitle: 'derivation',
      status: 'idle',
      colorScheme: 'violet',
    }),
    positionNode<StepNodeData>('fees', 'step', 330, 110, {
      label: 'fees',
      subtitle: 'derivation',
      status: 'idle',
      colorScheme: 'violet',
    }),

    // Bottom: composed derivation
    positionNode<StepNodeData>('total', 'step', 180, 210, {
      label: 'total',
      subtitle: 'composed derivation',
      status: 'idle',
      colorScheme: 'emerald',
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    // Facts -> first-level derivations
    edge('items', 'subtotal', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('tax', 'fees', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('shipping', 'fees', { sourceHandle: 'bottom', targetHandle: 'top' }),

    // First-level -> composed
    edge('subtotal', 'total', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('fees', 'total', { sourceHandle: 'bottom', targetHandle: 'top' }),
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
