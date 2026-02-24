'use client'

import { memo, useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import {
  DiagramWrapper,
  diagramNodeTypes,
  diagramEdgeTypes,
  useAnimationLoop,
  positionNode,
  edge,
  type StatusNodeData,
} from '../diagrams'

export const ResolverRetryTimelineDiagram = memo(function ResolverRetryTimelineDiagram() {
  const { phase } = useAnimationLoop({ totalPhases: 6, interval: 1000 })

  const nodes = useMemo<Node[]>(() => [
    positionNode<StatusNodeData>('attempt1', 'status', 0, 30, {
      label: 'Attempt 1',
      status: phase >= 0 ? (phase === 0 ? 'active' : 'error') : 'idle',
      icon: phase > 0 ? '\u2715' : undefined,
      colorScheme: 'primary',
    }),
    positionNode<StatusNodeData>('wait1', 'status', 120, 30, {
      label: 'Wait 1s',
      status: phase >= 1 ? (phase === 1 ? 'active' : 'past') : 'idle',
      colorScheme: 'slate',
    }),
    positionNode<StatusNodeData>('attempt2', 'status', 220, 30, {
      label: 'Attempt 2',
      status: phase >= 2 ? (phase === 2 ? 'active' : 'error') : 'idle',
      icon: phase > 2 ? '\u2715' : undefined,
      colorScheme: 'primary',
    }),
    positionNode<StatusNodeData>('wait2', 'status', 350, 30, {
      label: 'Wait 2s',
      status: phase >= 3 ? (phase === 3 ? 'active' : 'past') : 'idle',
      colorScheme: 'slate',
    }),
    positionNode<StatusNodeData>('attempt3', 'status', 470, 30, {
      label: 'Attempt 3',
      status: phase >= 4 ? (phase === 4 ? 'active' : 'success') : 'idle',
      icon: phase >= 5 ? '\u2714' : undefined,
      colorScheme: 'primary',
    }),
    positionNode<StatusNodeData>('success', 'status', 600, 30, {
      label: 'Success',
      status: phase >= 5 ? 'success' : 'idle',
      icon: phase >= 5 ? '\u2714' : undefined,
      colorScheme: 'emerald',
    }),
  ], [phase])

  const edges = useMemo<Edge[]>(() => [
    edge('attempt1', 'wait1'),
    edge('wait1', 'attempt2'),
    edge('attempt2', 'wait2'),
    edge('wait2', 'attempt3'),
    edge('attempt3', 'success'),
  ], [])

  return (
    <DiagramWrapper
      height={220}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
