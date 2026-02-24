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

export const RagPipelineDiagram = memo(function RagPipelineDiagram() {
  const nodes = useMemo<Node[]>(() => [
    // Phase 1 row (top)
    positionNode<StepNodeData>('markdoc', 'step', 10, 20, { label: 'Markdoc Pages', status: 'idle', colorScheme: 'primary' }),
    positionNode<StepNodeData>('parse-ast', 'step', 190, 20, { label: 'Parse AST', status: 'idle', colorScheme: 'primary' }),
    positionNode<StepNodeData>('section-chunks', 'step', 370, 20, { label: 'Section Chunks', status: 'idle', colorScheme: 'primary' }),
    positionNode<StepNodeData>('embed-docs', 'step', 550, 20, { label: 'Embed', status: 'idle', colorScheme: 'primary' }),

    // Phase 2 row (bottom)
    positionNode<StepNodeData>('ts-src', 'step', 10, 150, { label: 'TypeScript Src', status: 'idle', colorScheme: 'violet' }),
    positionNode<StepNodeData>('ts-morph', 'step', 190, 150, { label: 'ts-morph', status: 'idle', colorScheme: 'violet' }),
    positionNode<StepNodeData>('fn-chunks', 'step', 370, 150, { label: 'Function Chunks', status: 'idle', colorScheme: 'violet' }),
    positionNode<StepNodeData>('embed-code', 'step', 550, 150, { label: 'Embed', status: 'idle', colorScheme: 'violet' }),

    // Combined output (center-right)
    positionNode<StepNodeData>('combined', 'step', 730, 85, { label: 'embeddings.json', status: 'idle', colorScheme: 'emerald' }),
  ], [])

  const edges = useMemo<Edge[]>(() => [
    // Phase 1 pipeline
    edge('markdoc', 'parse-ast', { type: 'labeled' }),
    edge('parse-ast', 'section-chunks', { type: 'labeled' }),
    edge('section-chunks', 'embed-docs', { type: 'labeled' }),

    // Phase 2 pipeline
    edge('ts-src', 'ts-morph', { type: 'labeled' }),
    edge('ts-morph', 'fn-chunks', { type: 'labeled' }),
    edge('fn-chunks', 'embed-code', { type: 'labeled' }),

    // Converge to combined output
    edge('embed-docs', 'combined', { type: 'labeled', data: { label: 'merge' } }),
    edge('embed-code', 'combined', { type: 'labeled', data: { label: 'merge' } }),
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
