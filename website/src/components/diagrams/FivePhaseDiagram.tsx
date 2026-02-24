'use client'

import { memo, useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import {
  DiagramWrapper,
  diagramNodeTypes,
  diagramEdgeTypes,
  horizontalRow,
  edge,
  type StepNodeData,
} from '../diagrams'

const PHASES = [
  { id: 'phase1', label: 'Phase 1', subtitle: 'Fact mutation triggers tracking', colorScheme: 'primary' as const },
  { id: 'phase2', label: 'Phase 2', subtitle: 'Derivations invalidated & recomputed', colorScheme: 'violet' as const },
  { id: 'phase3', label: 'Phase 3', subtitle: 'Constraints re-evaluated', colorScheme: 'amber' as const },
  { id: 'phase4', label: 'Phase 4', subtitle: 'Requirements diffed & deduplicated', colorScheme: 'violet' as const },
  { id: 'phase5', label: 'Phase 5', subtitle: 'Resolvers dispatched, effects scheduled', colorScheme: 'emerald' as const },
] as const

export const FivePhaseDiagram = memo(function FivePhaseDiagram() {
  const nodes = useMemo<Node[]>(() =>
    horizontalRow<StepNodeData>(
      PHASES.map((p) => ({
        id: p.id,
        type: 'step',
        data: {
          label: p.label,
          subtitle: p.subtitle,
          status: 'idle',
          colorScheme: p.colorScheme,
        },
      })),
      10,
      40,
      190,
    ),
  [])

  const edges = useMemo<Edge[]>(() => [
    edge('phase1', 'phase2', { type: 'labeled', data: { label: 'invalidate' } }),
    edge('phase2', 'phase3', { type: 'labeled', data: { label: 'evaluate' } }),
    edge('phase3', 'phase4', { type: 'labeled', data: { label: 'diff' } }),
    edge('phase4', 'phase5', { type: 'labeled', data: { label: 'dispatch' } }),
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
