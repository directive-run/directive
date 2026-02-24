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

export const MultiModuleArchitectureDiagram = memo(function MultiModuleArchitectureDiagram() {
  const nodes = useMemo<Node[]>(() => [
    // Background layer
    positionNode<LayerNodeData>('system-layer', 'layer', 20, 10, {
      label: 'createSystem',
      active: true,
      colorScheme: 'primary',
      width: 500,
      height: 120,
    }),

    // Module nodes inside the layer
    positionNode<StepNodeData>('auth', 'step', 50, 40, {
      label: 'auth',
      subtitle: 'module',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('cart', 'step', 210, 40, {
      label: 'cart',
      subtitle: 'module',
      status: 'idle',
      colorScheme: 'amber',
    }),
    positionNode<StepNodeData>('ui', 'step', 370, 40, {
      label: 'ui',
      subtitle: 'module',
      status: 'idle',
      colorScheme: 'violet',
    }),

    // Namespaced access node below the layer
    positionNode<StepNodeData>('namespaced', 'step', 160, 170, {
      label: 'Namespaced Access',
      subtitle: 'system.facts.auth.token',
      status: 'idle',
      colorScheme: 'emerald',
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    edge('auth', 'namespaced', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('cart', 'namespaced', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('ui', 'namespaced', { sourceHandle: 'bottom', targetHandle: 'top' }),
  ], [])

  return (
    <DiagramWrapper
      height={420}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
