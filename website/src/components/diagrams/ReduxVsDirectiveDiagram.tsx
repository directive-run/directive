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

export const ReduxVsDirectiveDiagram = memo(function ReduxVsDirectiveDiagram() {
  const nodes = useMemo<Node[]>(() => [
    // Redux layer (left)
    positionNode<LayerNodeData>('layer-redux', 'layer', 10, 10, {
      label: 'Redux',
      active: false,
      colorScheme: 'slate',
      width: 240,
      height: 180,
    }),
    positionNode<StepNodeData>('redux-action', 'step', 80, 40, {
      label: 'Action',
      status: 'idle',
      colorScheme: 'slate',
    }),
    positionNode<StepNodeData>('redux-reducer', 'step', 80, 85, {
      label: 'Reducer',
      status: 'idle',
      colorScheme: 'slate',
    }),
    positionNode<StepNodeData>('redux-store', 'step', 80, 130, {
      label: 'Store',
      status: 'idle',
      colorScheme: 'slate',
    }),
    positionNode<StepNodeData>('redux-selector', 'step', 80, 175, {
      label: 'Selector',
      status: 'idle',
      colorScheme: 'slate',
    }),

    // Directive layer (right)
    positionNode<LayerNodeData>('layer-directive', 'layer', 290, 10, {
      label: 'Directive',
      active: true,
      colorScheme: 'primary',
      width: 240,
      height: 180,
    }),
    positionNode<StepNodeData>('dir-fact', 'step', 360, 40, {
      label: 'Fact Change',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('dir-constraint', 'step', 360, 85, {
      label: 'Constraint',
      status: 'idle',
      colorScheme: 'amber',
    }),
    positionNode<StepNodeData>('dir-requirement', 'step', 360, 130, {
      label: 'Requirement',
      status: 'idle',
      colorScheme: 'violet',
    }),
    positionNode<StepNodeData>('dir-resolver', 'step', 360, 175, {
      label: 'Resolver',
      status: 'idle',
      colorScheme: 'emerald',
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    // Redux flow
    edge('redux-action', 'redux-reducer', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('redux-reducer', 'redux-store', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('redux-store', 'redux-selector', { sourceHandle: 'bottom', targetHandle: 'top' }),

    // Directive flow
    edge('dir-fact', 'dir-constraint', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('dir-constraint', 'dir-requirement', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('dir-requirement', 'dir-resolver', { sourceHandle: 'bottom', targetHandle: 'top' }),
  ], [])

  return (
    <DiagramWrapper
      height={260}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
