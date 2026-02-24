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

const STEPS = [
  { id: 'question', label: 'User Question', subtitle: 'Natural language input', colorScheme: 'slate' as const },
  { id: 'rag', label: 'RAG Enrichment', subtitle: 'Embed query, find relevant doc chunks', colorScheme: 'primary' as const },
  { id: 'orchestrator', label: 'Agent Orchestrator', subtitle: 'Guardrails, circuit breaker, streaming runner', colorScheme: 'amber' as const },
  { id: 'sse', label: 'SSE Transport', subtitle: 'Tokens to Server-Sent Events frames', colorScheme: 'violet' as const },
  { id: 'browser', label: 'Browser Widget', subtitle: 'Parse SSE, render markdown', colorScheme: 'emerald' as const },
] as const

export const MessagePipelineDiagram = memo(function MessagePipelineDiagram() {
  const nodes = useMemo<Node[]>(() =>
    verticalColumn<StepNodeData>(
      STEPS.map((s) => ({
        id: s.id,
        type: 'step',
        data: {
          label: s.label,
          subtitle: s.subtitle,
          status: 'idle',
          colorScheme: s.colorScheme,
        },
      })),
      120,
      10,
      65,
    ),
  [])

  const edges = useMemo<Edge[]>(() => [
    edge('question', 'rag', { type: 'labeled', data: { label: 'embed query' } }),
    edge('rag', 'orchestrator', { type: 'labeled', data: { label: 'enriched context' } }),
    edge('orchestrator', 'sse', { type: 'labeled', data: { label: 'stream tokens' } }),
    edge('sse', 'browser', { type: 'labeled', data: { label: 'SSE frames' } }),
  ], [])

  return (
    <DiagramWrapper
      height={500}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
