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

export const ApprovalWorkflowDiagram = memo(function ApprovalWorkflowDiagram() {
  const nodes = useMemo<Node[]>(() => [
    positionNode<StepNodeData>('request', 'step', 20, 80, {
      label: 'Agent Request',
      status: 'idle',
      colorScheme: 'primary',
    }),
    positionNode<StepNodeData>('pending', 'step', 200, 80, {
      label: 'Pending Approval',
      status: 'idle',
      colorScheme: 'amber',
    }),
    positionNode<StepNodeData>('approved', 'step', 420, 30, {
      label: 'Approved',
      status: 'idle',
      colorScheme: 'emerald',
    }),
    positionNode<StepNodeData>('rejected', 'step', 420, 130, {
      label: 'Rejected',
      status: 'idle',
      colorScheme: 'red',
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    edge('request', 'pending', {
      type: 'labeled',
      data: { label: 'requires approval' },
    }),
    edge('pending', 'approved', {
      type: 'labeled',
      data: { label: 'approve' },
    }),
    edge('pending', 'rejected', {
      type: 'labeled',
      data: { label: 'reject' },
    }),
  ], [])

  return (
    <DiagramWrapper
      height={370}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
