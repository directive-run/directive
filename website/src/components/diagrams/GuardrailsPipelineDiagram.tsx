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

const STAGES: { id: string; label: string; colorScheme: StepNodeData['colorScheme'] }[] = [
  { id: 'raw', label: 'Raw Input', colorScheme: 'slate' },
  { id: 'injection', label: 'Injection Check', colorScheme: 'red' },
  { id: 'pii', label: 'PII Redaction', colorScheme: 'amber' },
  { id: 'agent', label: 'Agent Execution', colorScheme: 'primary' },
  { id: 'output', label: 'Output Validation', colorScheme: 'emerald' },
]

const EDGE_LABELS = ['validate', 'redact', 'execute', 'validate']

export const GuardrailsPipelineDiagram = memo(function GuardrailsPipelineDiagram() {
  const nodes = useMemo(() => {
    const rowNodes = STAGES.map((stage) => ({
      id: stage.id,
      type: 'step' as const,
      data: {
        label: stage.label,
        status: 'idle' as const,
        colorScheme: stage.colorScheme,
      } satisfies StepNodeData,
    }))

    return horizontalRow(rowNodes, 10, 30, 150)
  }, [])

  const edges = useMemo<Edge[]>(() =>
    STAGES.slice(0, -1).map((stage, i) =>
      edge(stage.id, STAGES[i + 1].id, {
        type: 'labeled',
        data: { label: EDGE_LABELS[i] },
      }),
    ),
  [])

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
