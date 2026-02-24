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

const STEPS = [
  { id: 'facts-change', label: 'Facts Change', colorScheme: 'primary' as const },
  { id: 'constraints', label: 'Constraints Evaluate', colorScheme: 'amber' as const },
  { id: 'requirements', label: 'Requirements Emitted', colorScheme: 'violet' as const },
  { id: 'resolvers', label: 'Resolvers Execute', colorScheme: 'emerald' as const },
  { id: 'facts-update', label: 'Facts Update', colorScheme: 'primary' as const },
  { id: 'settled', label: 'Loop Until Settled', colorScheme: 'slate' as const },
] as const

export const ReconciliationFlowDiagram = memo(function ReconciliationFlowDiagram() {
  const nodes = useMemo<Node[]>(() =>
    STEPS.map((step, i) =>
      positionNode<StepNodeData>(step.id, 'step', 30 + i * 40, 10 + i * 50, {
        label: step.label,
        status: 'idle',
        colorScheme: step.colorScheme,
      }),
    ),
  [])

  const edges = useMemo<Edge[]>(() => [
    edge('facts-change', 'constraints', { type: 'labeled', data: { label: 'which rules are unsatisfied?' } }),
    edge('constraints', 'requirements', { type: 'labeled', data: { label: 'what needs to happen?' } }),
    edge('requirements', 'resolvers', { type: 'labeled', data: { label: 'make it happen' } }),
    edge('resolvers', 'facts-update', { type: 'labeled', data: { label: 'mutate state' } }),
    edge('facts-update', 'settled', { type: 'labeled', data: { label: 'repeat until settled' } }),
  ], [])

  return (
    <DiagramWrapper
      height={300}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
