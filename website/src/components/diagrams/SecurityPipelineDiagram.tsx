'use client'

import { memo, useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import {
  DiagramWrapper,
  diagramNodeTypes,
  diagramEdgeTypes,
  verticalColumn,
  edge,
  type StepNodeData,
} from '../diagrams'

const STAGES: { id: string; label: string; subtitle: string; colorScheme: StepNodeData['colorScheme'] }[] = [
  {
    id: 'input',
    label: 'User Input',
    subtitle: 'Raw message from the user',
    colorScheme: 'slate',
  },
  {
    id: 'injection',
    label: 'Prompt Injection Detection',
    subtitle: 'Block attacks before they reach agents',
    colorScheme: 'red',
  },
  {
    id: 'pii-in',
    label: 'PII Detection',
    subtitle: 'Redact sensitive data from input',
    colorScheme: 'amber',
  },
  {
    id: 'agent',
    label: 'Agent Execution',
    subtitle: 'Safe to process after filtering',
    colorScheme: 'emerald',
  },
  {
    id: 'pii-out',
    label: 'Output PII Scan',
    subtitle: 'Catch any data leaks in responses',
    colorScheme: 'amber',
  },
  {
    id: 'audit',
    label: 'Audit Trail',
    subtitle: 'Log every operation for compliance',
    colorScheme: 'violet',
  },
]

export const SecurityPipelineDiagram = memo(function SecurityPipelineDiagram() {
  const nodes = useMemo<Node[]>(() => {
    const columnNodes = STAGES.map((stage) => ({
      id: stage.id,
      type: 'step' as const,
      data: {
        label: stage.label,
        subtitle: stage.subtitle,
        status: 'idle' as const,
        colorScheme: stage.colorScheme,
      } satisfies StepNodeData,
    }))

    return verticalColumn(columnNodes, 120, 10, 55)
  }, [])

  const edges = useMemo<Edge[]>(() => [
    edge('input', 'injection', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('injection', 'pii-in', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('pii-in', 'agent', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('agent', 'pii-out', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('pii-out', 'audit', { sourceHandle: 'bottom', targetHandle: 'top' }),
  ], [])

  return (
    <DiagramWrapper
      height={350}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
