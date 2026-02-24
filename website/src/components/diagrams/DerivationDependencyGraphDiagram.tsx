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

export const DerivationDependencyGraphDiagram = memo(function DerivationDependencyGraphDiagram() {
  const nodes = useMemo<Node[]>(() => [
    // Top row: facts
    positionNode<StepNodeData>('user', 'step', 30, 10, {
      label: 'user',
      subtitle: 'fact',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('cart', 'step', 230, 10, {
      label: 'cart',
      subtitle: 'fact',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('promo', 'step', 430, 10, {
      label: 'promo',
      subtitle: 'fact',
      status: 'idle',
      colorScheme: 'primary',
    }),

    // Middle row: first-level derivations
    positionNode<StepNodeData>('itemCount', 'step', 200, 110, {
      label: 'itemCount',
      subtitle: 'derivation',
      status: 'idle',
      colorScheme: 'violet',
    }),
    positionNode<StepNodeData>('isEligible', 'step', 380, 110, {
      label: 'isEligible',
      subtitle: 'derivation',
      status: 'idle',
      colorScheme: 'violet',
    }),

    // Bottom: composed derivation
    positionNode<StepNodeData>('checkoutReady', 'step', 280, 210, {
      label: 'checkoutReady',
      subtitle: 'derivation',
      status: 'idle',
      colorScheme: 'emerald',
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    // Facts -> first-level derivations
    edge('cart', 'itemCount', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('user', 'isEligible', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('promo', 'isEligible', { sourceHandle: 'bottom', targetHandle: 'top' }),

    // First-level -> composed derivation
    edge('itemCount', 'checkoutReady', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('isEligible', 'checkoutReady', { sourceHandle: 'bottom', targetHandle: 'top' }),
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
