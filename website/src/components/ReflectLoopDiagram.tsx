'use client'

import { memo, useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import {
  DiagramWrapper,
  useAnimationLoop,
  diagramNodeTypes,
  diagramEdgeTypes,
  type StepNodeData,
  type BadgeNodeData,
} from './diagrams'

export const ReflectLoopDiagram = memo(function ReflectLoopDiagram() {
  const { phase } = useAnimationLoop({ totalPhases: 6, interval: 1400 })

  const iteration = phase <= 1 ? 1 : phase <= 3 ? 2 : 3
  const producerActive = phase === 0 || phase === 2
  const evaluatorActive = phase === 1 || phase === 3 || phase === 4
  const passActive = phase === 4 || phase === 5
  const acceptActive = phase === 5
  const feedbackActive = phase === 2

  const nodes = useMemo<Node[]>(() => [
    { id: 'badge', type: 'badge', position: { x: 10, y: 0 }, data: { text: `iteration ${iteration}/3`, active: phase >= 0 } satisfies BadgeNodeData },
    { id: 'producer', type: 'step', position: { x: 30, y: 60 }, data: { label: 'Producer', subtitle: '(writer)', status: producerActive ? 'active' : 'idle', colorScheme: 'primary' } satisfies StepNodeData },
    { id: 'evaluator', type: 'step', position: { x: 300, y: 60 }, data: { label: 'Evaluator', subtitle: '(reviewer)', status: evaluatorActive ? 'active' : 'idle', colorScheme: 'violet' } satisfies StepNodeData },
    { id: 'accept', type: 'step', position: { x: 480, y: 130 }, data: { label: 'Accept', status: acceptActive ? 'active' : 'idle', colorScheme: 'emerald' } satisfies StepNodeData },
  ], [phase, iteration, producerActive, evaluatorActive, acceptActive])

  const edges = useMemo<Edge[]>(() => [
    { id: 'producer->evaluator', source: 'producer', target: 'evaluator', type: 'labeled', data: { label: 'output', active: evaluatorActive } },
    {
      id: 'evaluator->producer',
      source: 'evaluator',
      sourceHandle: 'bottom',
      target: 'producer',
      targetHandle: 'bottom',
      type: 'feedback',
      data: { label: 'feedback + revision', sublabel: '(fail)', active: feedbackActive, colorActive: '#f59e0b', direction: 'below' },
    },
    {
      id: 'evaluator->accept',
      source: 'evaluator',
      sourceHandle: 'bottom',
      target: 'accept',
      targetHandle: 'top',
      type: 'labeled',
      data: { label: 'pass \u2014 score \u2265 threshold', active: passActive, colorActive: '#10b981' },
    },
  ], [phase, evaluatorActive, feedbackActive, passActive])

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
