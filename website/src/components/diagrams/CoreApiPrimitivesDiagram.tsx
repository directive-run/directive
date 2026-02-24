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

export const CoreApiPrimitivesDiagram = memo(function CoreApiPrimitivesDiagram() {
  const nodes = useMemo<Node[]>(() => [
    // Left column: Events
    positionNode<StepNodeData>('events', 'step', 20, 100, {
      label: 'Events',
      subtitle: 'Dispatch actions',
      status: 'idle',
      colorScheme: 'slate',
    }),

    // Center: Facts (hub)
    positionNode<StepNodeData>('facts', 'step', 200, 100, {
      label: 'Facts',
      subtitle: 'Mutable state',
      status: 'idle',
      colorScheme: 'primary',
    }),

    // Top branch: Derivations
    positionNode<StepNodeData>('derivations', 'step', 420, 10, {
      label: 'Derivations',
      subtitle: 'Computed values',
      status: 'idle',
      colorScheme: 'violet',
    }),

    // Middle branch: Constraints -> Requirements -> Resolvers
    positionNode<StepNodeData>('constraints', 'step', 420, 100, {
      label: 'Constraints',
      subtitle: 'Evaluate rules',
      status: 'idle',
      colorScheme: 'amber',
    }),
    positionNode<StepNodeData>('requirements', 'step', 620, 100, {
      label: 'Requirements',
      subtitle: 'What is needed',
      status: 'idle',
      colorScheme: 'violet',
    }),
    positionNode<StepNodeData>('resolvers', 'step', 820, 100, {
      label: 'Resolvers',
      subtitle: 'Fulfill needs',
      status: 'idle',
      colorScheme: 'emerald',
    }),

    // Bottom branch: Effects
    positionNode<StepNodeData>('effects', 'step', 420, 190, {
      label: 'Effects',
      subtitle: 'Side-effects',
      status: 'idle',
      colorScheme: 'amber',
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    // Events -> Facts
    edge('events', 'facts'),

    // Facts -> Derivations (top branch)
    edge('facts', 'derivations', { sourceHandle: 'bottom', targetHandle: 'top' }),

    // Facts -> Constraints (middle branch)
    edge('facts', 'constraints'),

    // Constraints -> Requirements -> Resolvers
    edge('constraints', 'requirements'),
    edge('requirements', 'resolvers'),

    // Facts -> Effects (bottom branch)
    edge('facts', 'effects', { sourceHandle: 'bottom', targetHandle: 'top' }),
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
