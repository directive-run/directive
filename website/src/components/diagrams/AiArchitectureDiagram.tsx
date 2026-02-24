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

const LAYERS: { id: string; label: string; subtitle: string; colorScheme: StepNodeData['colorScheme'] }[] = [
  {
    id: 'framework',
    label: 'Your Agent Framework',
    subtitle: 'OpenAI, Anthropic, LangChain, etc.',
    colorScheme: 'slate',
  },
  {
    id: 'adapter',
    label: 'Directive AI Adapter',
    subtitle: 'Guardrails, constraints, state',
    colorScheme: 'primary',
  },
  {
    id: 'app',
    label: 'Your Application',
    subtitle: 'UI, business logic, storage',
    colorScheme: 'emerald',
  },
]

export const AiArchitectureDiagram = memo(function AiArchitectureDiagram() {
  const nodes = useMemo<Node[]>(() => {
    const columnNodes = LAYERS.map((layer) => ({
      id: layer.id,
      type: 'step' as const,
      data: {
        label: layer.label,
        subtitle: layer.subtitle,
        status: 'idle' as const,
        colorScheme: layer.colorScheme,
      } satisfies StepNodeData,
    }))

    return verticalColumn(columnNodes, 120, 10, 60)
  }, [])

  const edges = useMemo<Edge[]>(() => [
    // Downward edges
    edge('framework', 'adapter', { sourceHandle: 'bottom', targetHandle: 'top' }),
    edge('adapter', 'app', { sourceHandle: 'bottom', targetHandle: 'top' }),
    // Upward edges (bidirectional)
    edge('adapter', 'framework', { sourceHandle: 'top', targetHandle: 'bottom' }),
    edge('app', 'adapter', { sourceHandle: 'top', targetHandle: 'bottom' }),
  ], [])

  return (
    <DiagramWrapper
      height={200}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
