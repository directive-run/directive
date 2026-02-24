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

export const BatchedResolutionDiagram = memo(function BatchedResolutionDiagram() {
  const nodes = useMemo<Node[]>(() => [
    // Left: Without Batching
    positionNode<LayerNodeData>('layer-unbatched', 'layer', 10, 10, {
      label: 'Without Batching (N+1)',
      active: false,
      colorScheme: 'red',
      width: 220,
      height: 160,
    }),
    positionNode<StepNodeData>('fetch1', 'step', 50, 40, {
      label: 'fetch(1)',
      status: 'idle',
      colorScheme: 'red',
    }),
    positionNode<StepNodeData>('fetch2', 'step', 50, 85, {
      label: 'fetch(2)',
      status: 'idle',
      colorScheme: 'red',
    }),
    positionNode<StepNodeData>('fetch3', 'step', 50, 130, {
      label: 'fetch(3)',
      status: 'idle',
      colorScheme: 'red',
    }),

    // Right: With Batching
    positionNode<LayerNodeData>('layer-batched', 'layer', 290, 10, {
      label: 'With Batching',
      active: true,
      colorScheme: 'emerald',
      width: 220,
      height: 160,
    }),
    positionNode<StepNodeData>('id1', 'step', 305, 40, {
      label: 'id: 1',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('id2', 'step', 305, 85, {
      label: 'id: 2',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('id3', 'step', 305, 130, {
      label: 'id: 3',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('batchFetch', 'step', 420, 85, {
      label: 'fetchBatch([1,2,3])',
      status: 'idle',
      colorScheme: 'emerald',
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    // Unbatched: sequential
    edge('fetch1', 'fetch2', { sourceHandle: 'bottom', targetHandle: 'top', type: 'labeled', data: { label: '3 requests' } }),
    edge('fetch2', 'fetch3', { sourceHandle: 'bottom', targetHandle: 'top' }),

    // Batched: all to one
    edge('id1', 'batchFetch', { sourceHandle: 'right', targetHandle: 'left', type: 'labeled', data: { label: '1 request' } }),
    edge('id2', 'batchFetch', { sourceHandle: 'right', targetHandle: 'left' }),
    edge('id3', 'batchFetch', { sourceHandle: 'right', targetHandle: 'left' }),
  ], [])

  return (
    <DiagramWrapper
      height={370}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
