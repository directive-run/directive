'use client'

import { memo, useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import {
  DiagramWrapper,
  useAnimationLoop,
  diagramNodeTypes,
  diagramEdgeTypes,
  type StepNodeData,
  type NodeStatus,
} from './diagrams'

const ANIMATION_PHASES: readonly (readonly string[])[] = [
  ['researcher', 'factChecker'],
  ['writer'],
  ['editor'],
  ['seo'],
]

export const DagFlowDiagram = memo(function DagFlowDiagram() {
  const { phase } = useAnimationLoop({
    totalPhases: ANIMATION_PHASES.length + 1,
    interval: 1200,
  })

  const getStatus = (step: string): NodeStatus => {
    if (phase < 0 || phase >= ANIMATION_PHASES.length) {
      return 'idle'
    }
    if (ANIMATION_PHASES[phase].includes(step)) {
      return 'active'
    }
    for (let i = 0; i < Math.min(phase, ANIMATION_PHASES.length); i++) {
      if (ANIMATION_PHASES[i].includes(step)) {
        return 'past'
      }
    }

    return 'idle'
  }

  const nodes = useMemo<Node[]>(() => [
    { id: 'researcher', type: 'step', position: { x: 40, y: 40 }, data: { label: 'researcher', status: getStatus('researcher'), colorScheme: 'primary' } satisfies StepNodeData },
    { id: 'factChecker', type: 'step', position: { x: 300, y: 40 }, data: { label: 'factChecker', status: getStatus('factChecker'), colorScheme: 'primary' } satisfies StepNodeData },
    { id: 'writer', type: 'step', position: { x: 170, y: 140 }, data: { label: 'writer', status: getStatus('writer'), colorScheme: 'violet' } satisfies StepNodeData },
    { id: 'editor', type: 'step', position: { x: 170, y: 240 }, data: { label: 'editor', status: getStatus('editor'), colorScheme: 'emerald' } satisfies StepNodeData },
    { id: 'seo', type: 'step', position: { x: 400, y: 240 }, data: { label: 'seo', subtitle: 'when: input.includes(\'[SEO]\')', status: getStatus('seo'), colorScheme: 'amber' } satisfies StepNodeData },
  ], [phase])

  const isEdgeActive = (target: string) => getStatus(target) !== 'idle'

  const edges = useMemo<Edge[]>(() => [
    { id: 'researcher->writer', source: 'researcher', sourceHandle: 'bottom', target: 'writer', targetHandle: 'top', type: 'labeled', data: { active: isEdgeActive('writer') } },
    { id: 'factChecker->writer', source: 'factChecker', sourceHandle: 'bottom', target: 'writer', targetHandle: 'top', type: 'labeled', data: { active: isEdgeActive('writer') } },
    { id: 'writer->editor', source: 'writer', sourceHandle: 'bottom', target: 'editor', targetHandle: 'top', type: 'labeled', data: { active: isEdgeActive('editor') } },
    { id: 'editor->seo', source: 'editor', target: 'seo', type: 'labeled', data: { active: isEdgeActive('seo'), dashed: true } },
  ], [phase])

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
