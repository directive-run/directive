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
    id: 'client',
    label: 'Client (AIChatWidget)',
    subtitle: 'POST /api/chat',
    colorScheme: 'slate',
  },
  {
    id: 'server',
    label: 'Server (API Route)',
    subtitle: 'Origin check, rate limit, daily cap, health gate, validation',
    colorScheme: 'primary',
  },
  {
    id: 'rag',
    label: 'RAG Enricher',
    subtitle: 'Classify intent, embed query, cosine similarity, re-rank, top 5',
    colorScheme: 'emerald',
  },
  {
    id: 'orchestrator',
    label: 'Agent Orchestrator + Middleware',
    subtitle: 'Guardrails (injection, PII), cost budget, retry, fallback, circuit breaker, streaming LLM',
    colorScheme: 'amber',
  },
  {
    id: 'transport',
    label: 'SSE Transport',
    subtitle: 'Token to data frame, truncation, done/error event',
    colorScheme: 'violet',
  },
  {
    id: 'hooks',
    label: 'Post-Response Hooks',
    subtitle: 'onAgentComplete, onAgentError',
    colorScheme: 'slate',
  },
]

export const RequestLifecycleDiagram = memo(function RequestLifecycleDiagram() {
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

    return verticalColumn(columnNodes, 100, 20, 80)
  }, [])

  const edges = useMemo<Edge[]>(() => [
    edge('client', 'server', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('server', 'rag', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('rag', 'orchestrator', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('orchestrator', 'transport', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('transport', 'hooks', { sourceHandle: 'bottom', targetHandle: 'top' }),
  ], [])

  return (
    <DiagramWrapper
      height={700}
      interactive
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
