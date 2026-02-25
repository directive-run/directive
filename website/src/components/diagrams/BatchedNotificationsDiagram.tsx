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
  type BadgeNodeData,
} from '../diagrams'

export const BatchedNotificationsDiagram = memo(function BatchedNotificationsDiagram() {
  const nodes = useMemo<Node[]>(() => [
    // Left side: unbatched
    positionNode<LayerNodeData>('layer-unbatched', 'layer', 10, 10, {
      label: 'Without Batching',
      active: false,
      colorScheme: 'slate',
      width: 280,
      height: 230,
    }),
    positionNode<StepNodeData>('unbatched-a', 'step', 30, 45, {
      label: 'set A \u2192 notify \u2192 reconcile',
      status: 'idle',
      colorScheme: 'red',
    }),
    positionNode<StepNodeData>('unbatched-b', 'step', 30, 100, {
      label: 'set B \u2192 notify \u2192 reconcile',
      status: 'idle',
      colorScheme: 'red',
    }),
    positionNode<StepNodeData>('unbatched-c', 'step', 30, 155, {
      label: 'set C \u2192 notify \u2192 reconcile',
      status: 'idle',
      colorScheme: 'red',
    }),
    positionNode<BadgeNodeData>('badge-unbatched', 'badge', 80, 210, {
      text: '3 separate cycles',
      active: false,
    }),

    // Right side: batched
    positionNode<LayerNodeData>('layer-batched', 'layer', 330, 10, {
      label: 'With Batching',
      active: true,
      colorScheme: 'emerald',
      width: 280,
      height: 230,
    }),
    positionNode<StepNodeData>('batched-a', 'step', 350, 45, {
      label: 'set A',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('batched-b', 'step', 350, 100, {
      label: 'set B',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('batched-c', 'step', 350, 155, {
      label: 'set C',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('batched-notify', 'step', 500, 100, {
      label: 'batch notify \u2192 reconcile',
      status: 'idle',
      colorScheme: 'emerald',
    }),
    positionNode<BadgeNodeData>('badge-batched', 'badge', 430, 210, {
      text: '1 cycle',
      active: true,
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    // Unbatched: sequential vertical flow
    edge('unbatched-a', 'unbatched-b', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('unbatched-b', 'unbatched-c', { sourceHandle: 'bottom', targetHandle: 'top' }),

    // Batched: all three feed into one notify
    edge('batched-a', 'batched-notify'),
    edge('batched-b', 'batched-notify'),
    edge('batched-c', 'batched-notify'),
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
