'use client'

import { memo, useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import {
  DiagramWrapper,
  AnimationController,
  diagramNodeTypes,
  diagramEdgeTypes,
  positionNode,
  edge,
  useAnimationLoop,
  type StepNodeData,
  type NodeStatus,
} from '../diagrams'

const CYCLE_STEPS = [
  { id: 'fact-mutation', label: 'Fact Mutation', colorScheme: 'primary' as const },
  { id: 'invalidate', label: 'Invalidate Derivations', colorScheme: 'violet' as const },
  { id: 'constraints', label: 'Evaluate Constraints', colorScheme: 'amber' as const },
  { id: 'resolvers', label: 'Dispatch Resolvers', colorScheme: 'emerald' as const },
  { id: 'update-facts', label: 'Update Facts', colorScheme: 'primary' as const },
] as const

// Pentagonal layout: roughly circular arrangement
const POSITIONS: [number, number][] = [
  [80, 10],   // top-left
  [320, 10],  // top-right
  [400, 130], // right
  [250, 230], // bottom-right
  [20, 130],  // bottom-left
]

function getStatus(index: number, phase: number): NodeStatus {
  if (phase < 0) {
    return 'idle'
  }
  if (index === phase) {
    return 'active'
  }
  // Nodes that have already been visited this cycle
  if (index < phase) {
    return 'past'
  }

  return 'idle'
}

export const ReconciliationCycleDiagram = memo(function ReconciliationCycleDiagram() {
  const { phase, isPlaying, toggle } = useAnimationLoop({ totalPhases: 5, interval: 1000 })

  const nodes = useMemo<Node[]>(() =>
    CYCLE_STEPS.map((step, i) =>
      positionNode<StepNodeData>(step.id, 'step', POSITIONS[i][0], POSITIONS[i][1], {
        label: step.label,
        status: getStatus(i, phase),
        colorScheme: step.colorScheme,
      }),
    ),
  [phase])

  const edges = useMemo<Edge[]>(() => [
    edge('fact-mutation', 'invalidate', { type: 'animated' }),
    edge('invalidate', 'constraints', { type: 'animated', sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('constraints', 'resolvers', { type: 'animated', sourceHandle: 'bottom', targetHandle: 'right' }),
    edge('resolvers', 'update-facts', { type: 'animated' }),
    edge('update-facts', 'fact-mutation', { type: 'animated', sourceHandle: 'top', targetHandle: 'bottom' }),
  ], [])

  return (
    <>
      <AnimationController isPlaying={isPlaying} onToggle={toggle} hint="Cycles through reconciliation phases" />
      <DiagramWrapper
        height={300}
        nodes={nodes}
        edges={edges}
        nodeTypes={diagramNodeTypes}
        edgeTypes={diagramEdgeTypes}
      />
    </>
  )
})
