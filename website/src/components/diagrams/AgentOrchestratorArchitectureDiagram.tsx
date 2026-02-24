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

export const AgentOrchestratorArchitectureDiagram = memo(function AgentOrchestratorArchitectureDiagram() {
  const nodes = useMemo<Node[]>(() => [
    // Top: User Input
    positionNode<StepNodeData>('input', 'step', 230, 10, {
      label: 'User Input',
      status: 'idle',
      colorScheme: 'slate',
    }),

    // Row 2: Input Guardrails, Approval Gate, Budget Check
    positionNode<StepNodeData>('input-guardrails', 'step', 50, 90, {
      label: 'Input Guardrails',
      status: 'idle',
      colorScheme: 'red',
    }),
    positionNode<StepNodeData>('approval', 'step', 230, 90, {
      label: 'Approval Gate',
      status: 'idle',
      colorScheme: 'amber',
    }),
    positionNode<StepNodeData>('budget', 'step', 410, 90, {
      label: 'Budget Check',
      status: 'idle',
      colorScheme: 'amber',
    }),

    // Row 3: Agent Runner
    positionNode<StepNodeData>('runner', 'step', 230, 170, {
      label: 'Agent Runner',
      subtitle: 'streaming LLM execution',
      status: 'idle',
      colorScheme: 'primary',
    }),

    // Row 4: Output Guardrails, Memory Store
    positionNode<StepNodeData>('output-guardrails', 'step', 130, 260, {
      label: 'Output Guardrails',
      status: 'idle',
      colorScheme: 'red',
    }),
    positionNode<StepNodeData>('memory', 'step', 340, 260, {
      label: 'Memory Store',
      status: 'idle',
      colorScheme: 'violet',
    }),

    // Bottom: Response
    positionNode<StepNodeData>('response', 'step', 230, 340, {
      label: 'Response',
      status: 'idle',
      colorScheme: 'emerald',
    }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    // Top -> Row 2
    edge('input', 'input-guardrails', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('input', 'approval', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('input', 'budget', { sourceHandle: 'bottom', targetHandle: 'top' }),

    // Row 2 -> Row 3
    edge('input-guardrails', 'runner', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('approval', 'runner', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('budget', 'runner', { sourceHandle: 'bottom', targetHandle: 'top' }),

    // Row 3 -> Row 4
    edge('runner', 'output-guardrails', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('runner', 'memory', { sourceHandle: 'bottom', targetHandle: 'top' }),

    // Row 4 -> Bottom
    edge('output-guardrails', 'response', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('memory', 'response', { sourceHandle: 'bottom', targetHandle: 'top' }),
  ], [])

  return (
    <DiagramWrapper
      height={380}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
