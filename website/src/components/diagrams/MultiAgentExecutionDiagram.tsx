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

export const MultiAgentExecutionDiagram = memo(function MultiAgentExecutionDiagram() {
  const nodes = useMemo<Node[]>(() => [
    // Sequential layer (left)
    positionNode<LayerNodeData>('layer-seq', 'layer', 10, 10, {
      label: 'Sequential',
      active: true,
      colorScheme: 'primary',
      width: 160,
      height: 160,
    }),
    positionNode<StepNodeData>('seq-a', 'step', 45, 40, {
      label: 'A',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('seq-b', 'step', 45, 85, {
      label: 'B',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('seq-c', 'step', 45, 130, {
      label: 'C',
      status: 'idle',
      colorScheme: 'primary',
    }),

    // Parallel layer (middle)
    positionNode<LayerNodeData>('layer-par', 'layer', 200, 10, {
      label: 'Parallel',
      active: true,
      colorScheme: 'emerald',
      width: 160,
      height: 160,
    }),
    positionNode<StepNodeData>('par-a', 'step', 210, 80, {
      label: 'A',
      status: 'idle',
      colorScheme: 'emerald',
    }),
    positionNode<StepNodeData>('par-b', 'step', 265, 80, {
      label: 'B',
      status: 'idle',
      colorScheme: 'emerald',
    }),
    positionNode<StepNodeData>('par-c', 'step', 320, 80, {
      label: 'C',
      status: 'idle',
      colorScheme: 'emerald',
    }),

    // Supervisor layer (right)
    positionNode<LayerNodeData>('layer-sup', 'layer', 390, 10, {
      label: 'Supervisor',
      active: true,
      colorScheme: 'violet',
      width: 160,
      height: 160,
    }),
    positionNode<StepNodeData>('sup-main', 'step', 435, 40, {
      label: 'Supervisor',
      status: 'idle',
      colorScheme: 'violet',
    }),
    positionNode<StepNodeData>('sup-a', 'step', 405, 120, {
      label: 'Worker A',
      status: 'idle',
      colorScheme: 'violet',
    }),
    positionNode<StepNodeData>('sup-b', 'step', 480, 120, {
      label: 'Worker B',
      status: 'idle',
      colorScheme: 'violet',
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    // Sequential: A -> B -> C
    edge('seq-a', 'seq-b', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('seq-b', 'seq-c', { sourceHandle: 'bottom', targetHandle: 'top' }),

    // Supervisor -> Workers
    edge('sup-main', 'sup-a', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('sup-main', 'sup-b', { sourceHandle: 'bottom', targetHandle: 'top' }),
  ], [])

  return (
    <DiagramWrapper
      height={250}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
