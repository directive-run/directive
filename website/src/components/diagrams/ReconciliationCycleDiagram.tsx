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

// Regular pentagon: flat-top, centered ~(280,185), radius 160
// Vertex centers computed with exact trig, then offset for node top-left (~85w, 25h)
const POSITIONS: [number, number][] = [
  [100, 30],   // fact-mutation: top-left
  [290, 30],   // invalidate: top-right
  [350, 210],  // constraints: mid-right
  [195, 320],  // resolvers: bottom-center
  [40, 210],   // update-facts: mid-left
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

  // Edges: straight lines forming the pentagon, active edge follows the phase
  const edges = useMemo<Edge[]>(() => {
    const pairs: [string, string, Record<string, string>][] = [
      ['fact-mutation', 'invalidate', {}],
      ['invalidate', 'constraints', { sourceHandle: 'bottom', targetHandle: 'top' }],
      ['constraints', 'resolvers', { sourceHandle: 'bottom', targetHandle: 'top' }],
      ['resolvers', 'update-facts', { sourceHandle: 'top-source', targetHandle: 'bottom-target' }],
      ['update-facts', 'fact-mutation', { sourceHandle: 'top-source', targetHandle: 'bottom-target' }],
    ]

    return pairs.map(([source, target, handles], i) =>
      edge(source, target, {
        type: 'animated',
        ...handles,
        data: { straight: true, active: phase >= 0 && i === phase },
      }),
    )
  }, [phase])

  return (
    <>
      <AnimationController isPlaying={isPlaying} onToggle={toggle} hint="Cycles through reconciliation phases" />
      <DiagramWrapper
        height={440}
        nodes={nodes}
        edges={edges}
        nodeTypes={diagramNodeTypes}
        edgeTypes={diagramEdgeTypes}
      />
    </>
  )
})
