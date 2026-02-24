'use client'

import { memo, useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import {
  DiagramWrapper,
  AnimationController,
  diagramNodeTypes,
  diagramEdgeTypes,
  positionNode,
  edge,
  useAnimationLoop,
  type CircleNodeData,
  type NodeStatus,
} from '../diagrams'

const STATES = [
  { id: 'reconciling', label: 'Reconciling', colorScheme: 'amber' as const },
  { id: 'pending', label: 'Pending', colorScheme: 'violet' as const },
  { id: 'settled', label: 'Settled', colorScheme: 'emerald' as const },
] as const

// Phase 0: Reconciling active (processing)
// Phase 1: Reconciling -> Pending (requirements resolved)
// Phase 2: Pending -> Reconciling (new facts changed)
// Phase 3: Pending -> Settled (no pending requirements)
const PHASE_ACTIVE: Record<number, string> = {
  0: 'reconciling',
  1: 'pending',
  2: 'reconciling',
  3: 'settled',
}

function getStatus(id: string, phase: number): NodeStatus {
  if (phase < 0) {
    return 'idle'
  }

  return PHASE_ACTIVE[phase] === id ? 'active' : 'idle'
}

export const SettlementStateMachineDiagram = memo(function SettlementStateMachineDiagram() {
  const { phase, isPlaying, toggle } = useAnimationLoop({ totalPhases: 4, interval: 1500 })

  const nodes = useMemo<Node[]>(() => [
    positionNode<CircleNodeData>('reconciling', 'circle', 20, 80, {
      label: STATES[0].label,
      status: getStatus('reconciling', phase),
      colorScheme: STATES[0].colorScheme,
    }),
    positionNode<CircleNodeData>('pending', 'circle', 200, 80, {
      label: STATES[1].label,
      status: getStatus('pending', phase),
      colorScheme: STATES[1].colorScheme,
    }),
    positionNode<CircleNodeData>('settled', 'circle', 380, 80, {
      label: STATES[2].label,
      status: getStatus('settled', phase),
      colorScheme: STATES[2].colorScheme,
    }),
  ], [phase])

  const edges = useMemo<Edge[]>(() => [
    edge('reconciling', 'pending', { type: 'labeled', data: { label: 'requirements resolved' } }),
    edge('pending', 'reconciling', { type: 'labeled', data: { label: 'new facts changed' }, sourceHandle: 'top', targetHandle: 'top' }),
    edge('pending', 'settled', { type: 'labeled', data: { label: 'no pending requirements' } }),
    edge('settled', 'reconciling', { type: 'labeled', data: { label: 'fact mutation' }, sourceHandle: 'bottom', targetHandle: 'bottom' }),
  ], [])

  return (
    <>
      <AnimationController isPlaying={isPlaying} onToggle={toggle} hint="Cycles through settlement states" />
      <DiagramWrapper
        height={370}
        nodes={nodes}
        edges={edges}
        nodeTypes={diagramNodeTypes}
        edgeTypes={diagramEdgeTypes}
      />
    </>
  )
})
