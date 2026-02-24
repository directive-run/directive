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

const HOOKS = [
  { id: 'onInit', label: 'onInit', colorScheme: 'slate' as const },
  { id: 'onStart', label: 'onStart', colorScheme: 'primary' as const },
  { id: 'onFactChange', label: 'onFactChange', colorScheme: 'primary' as const },
  { id: 'onDerivation', label: 'onDerivation', colorScheme: 'violet' as const },
  { id: 'onReconcile', label: 'onReconcile', colorScheme: 'amber' as const },
  { id: 'onResolve', label: 'onResolve', colorScheme: 'emerald' as const },
  { id: 'onStop', label: 'onStop', colorScheme: 'slate' as const },
] as const

export const PluginLifecycleTimelineDiagram = memo(function PluginLifecycleTimelineDiagram() {
  const nodes = useMemo<Node[]>(() =>
    horizontalRow<StepNodeData>(
      HOOKS.map((h) => ({
        id: h.id,
        type: 'step',
        data: {
          label: h.label,
          status: 'idle',
          colorScheme: h.colorScheme,
        },
      })),
      10,
      30,
      150,
    ),
  [])

  const edges = useMemo<Edge[]>(() => [
    edge('onInit', 'onStart', { type: 'labeled', data: { label: 'setup' } }),
    edge('onStart', 'onFactChange', { type: 'labeled', data: { label: 'running' } }),
    edge('onFactChange', 'onDerivation', { type: 'labeled', data: { label: 'recompute' } }),
    edge('onDerivation', 'onReconcile', { type: 'labeled', data: { label: 'reconcile' } }),
    edge('onReconcile', 'onResolve', { type: 'labeled', data: { label: 'resolve' } }),
    edge('onResolve', 'onStop', { type: 'labeled', data: { label: 'teardown' } }),
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
