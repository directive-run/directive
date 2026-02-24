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
  { id: 'define', label: 'Define', subtitle: 'createModule()', colorScheme: 'slate' as const },
  { id: 'init', label: 'Init', subtitle: 'init(facts) runs', colorScheme: 'primary' as const },
  { id: 'start', label: 'Start', subtitle: 'system.start()', colorScheme: 'primary' as const },
  { id: 'running', label: 'Running', subtitle: 'constraints active', colorScheme: 'emerald' as const },
  { id: 'stopping', label: 'Stopping', subtitle: 'cleanup', colorScheme: 'amber' as const },
  { id: 'stopped', label: 'Stopped', subtitle: '', colorScheme: 'slate' as const },
] as const

export const ModuleLifecycleDiagram = memo(function ModuleLifecycleDiagram() {
  const nodes = useMemo<Node[]>(() =>
    horizontalRow<StepNodeData>(
      PHASES.map((p) => ({
        id: p.id,
        type: 'step',
        data: {
          label: p.label,
          subtitle: p.subtitle || undefined,
          status: 'idle',
          colorScheme: p.colorScheme,
        },
      })),
      10,
      30,
      150,
    ),
  [])

  const edges = useMemo<Edge[]>(() => [
    edge('define', 'init', { type: 'labeled', data: { label: 'create' } }),
    edge('init', 'start', { type: 'labeled', data: { label: 'initialize' } }),
    edge('start', 'running', { type: 'labeled', data: { label: 'activate' } }),
    edge('running', 'stopping', { type: 'labeled', data: { label: 'stop()' } }),
    edge('stopping', 'stopped', { type: 'labeled', data: { label: 'done' } }),
  ], [])

  return (
    <DiagramWrapper
      height={150}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
