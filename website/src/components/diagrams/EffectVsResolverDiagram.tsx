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
  type LayerNodeData,
} from '../diagrams'

export const EffectVsResolverDiagram = memo(function EffectVsResolverDiagram() {
  const nodes = useMemo<Node[]>(() => [
    // Effects layer (left)
    positionNode<LayerNodeData>('layer-effects', 'layer', 10, 10, {
      label: 'Effects',
      active: true,
      colorScheme: 'amber',
      width: 220,
      height: 120,
    }),
    positionNode<StepNodeData>('eff-trigger', 'step', 30, 40, {
      label: 'Fact Change',
      subtitle: 'logging, analytics',
      status: 'idle',
      colorScheme: 'amber',
    }),
    positionNode<StepNodeData>('eff-action', 'step', 170, 40, {
      label: 'Fire & Forget',
      status: 'idle',
      colorScheme: 'amber',
    }),

    // Resolvers layer (right)
    positionNode<LayerNodeData>('layer-resolvers', 'layer', 270, 10, {
      label: 'Resolvers',
      active: true,
      colorScheme: 'emerald',
      width: 220,
      height: 120,
    }),
    positionNode<StepNodeData>('res-trigger', 'step', 290, 40, {
      label: 'Requirement',
      subtitle: 'API calls, state updates',
      status: 'idle',
      colorScheme: 'emerald',
    }),
    positionNode<StepNodeData>('res-action', 'step', 430, 40, {
      label: 'Async Fulfill',
      status: 'idle',
      colorScheme: 'emerald',
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    edge('eff-trigger', 'eff-action'),
    edge('res-trigger', 'res-action'),
  ], [])

  return (
    <DiagramWrapper
      height={200}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
