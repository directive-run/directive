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
  type BadgeNodeData,
} from '../diagrams'

export const TimeTravelTimelineDiagram = memo(function TimeTravelTimelineDiagram() {
  const nodes = useMemo<Node[]>(() => [
    positionNode<StepNodeData>('snap1', 'step', 0, 20, {
      label: 'Snapshot 1',
      subtitle: 't=0',
      status: 'idle',
      colorScheme: 'slate',
    }),
    positionNode<StepNodeData>('snap2', 'step', 150, 20, {
      label: 'Snapshot 2',
      subtitle: 't=1',
      status: 'idle',
      colorScheme: 'slate',
    }),
    positionNode<StepNodeData>('snap3', 'step', 300, 20, {
      label: 'Current',
      subtitle: 't=2',
      status: 'active',
      colorScheme: 'primary',
    }),
    {
      ...positionNode<StepNodeData>('snap4', 'step', 450, 20, {
        label: 'Snapshot 4',
        subtitle: 't=3',
        status: 'idle',
        colorScheme: 'slate',
      }),
      style: { opacity: 0.5, borderStyle: 'dashed' },
    },
    {
      ...positionNode<StepNodeData>('snap5', 'step', 600, 20, {
        label: 'Snapshot 5',
        subtitle: 't=4',
        status: 'idle',
        colorScheme: 'slate',
      }),
      style: { opacity: 0.5, borderStyle: 'dashed' },
    },

    // Badge below current
    positionNode<BadgeNodeData>('badge', 'badge', 300, 95, {
      text: '\u2190 back / forward \u2192',
      active: true,
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    edge('snap1', 'snap2'),
    edge('snap2', 'snap3'),
    edge('snap3', 'snap4'),
    edge('snap4', 'snap5'),
  ], [])

  return (
    <DiagramWrapper
      height={270}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
