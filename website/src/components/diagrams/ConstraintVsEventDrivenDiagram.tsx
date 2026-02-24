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
  type BadgeNodeData,
} from '../diagrams'

export const ConstraintVsEventDrivenDiagram = memo(function ConstraintVsEventDrivenDiagram() {
  const nodes = useMemo<Node[]>(() => [
    // Event-Driven layer (left)
    positionNode<LayerNodeData>('layer-event', 'layer', 10, 10, {
      label: 'Event-Driven',
      active: false,
      colorScheme: 'slate',
      width: 250,
      height: 150,
    }),
    positionNode<StepNodeData>('event-event', 'step', 25, 45, {
      label: 'Event',
      status: 'idle',
      colorScheme: 'slate',
    }),
    positionNode<StepNodeData>('event-handler', 'step', 110, 45, {
      label: 'Handler',
      status: 'idle',
      colorScheme: 'slate',
    }),
    positionNode<StepNodeData>('event-state', 'step', 195, 45, {
      label: 'State Update',
      status: 'idle',
      colorScheme: 'slate',
    }),
    positionNode<BadgeNodeData>('badge-event', 'badge', 80, 120, {
      text: 'manual wiring',
      active: false,
    }),

    // Constraint-Driven layer (right)
    positionNode<LayerNodeData>('layer-constraint', 'layer', 300, 10, {
      label: 'Constraint-Driven',
      active: true,
      colorScheme: 'primary',
      width: 250,
      height: 150,
    }),
    positionNode<StepNodeData>('cd-state', 'step', 315, 45, {
      label: 'State Change',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('cd-constraint', 'step', 400, 45, {
      label: 'Constraint',
      status: 'idle',
      colorScheme: 'amber',
    }),
    positionNode<StepNodeData>('cd-resolution', 'step', 485, 45, {
      label: 'Auto Resolution',
      status: 'idle',
      colorScheme: 'emerald',
    }),
    positionNode<BadgeNodeData>('badge-constraint', 'badge', 380, 120, {
      text: 'declarative',
      active: true,
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    // Event-Driven flow
    edge('event-event', 'event-handler'),
    edge('event-handler', 'event-state'),

    // Constraint-Driven flow
    edge('cd-state', 'cd-constraint'),
    edge('cd-constraint', 'cd-resolution'),
  ], [])

  return (
    <DiagramWrapper
      height={340}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
