'use client'

import { memo, useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import {
  DiagramWrapper,
  useAnimationLoop,
  diagramNodeTypes,
  diagramEdgeTypes,
  type LayerNodeData,
  type StatusNodeData,
  type StepNodeData,
  type CircleNodeData,
  type NodeStatus,
} from './diagrams'

export const ResilienceCascadeDiagram = memo(function ResilienceCascadeDiagram() {
  const { phase } = useAnimationLoop({ totalPhases: 8, interval: 1200 })

  const retryActive = phase >= 0 && phase <= 2
  const fallbackActive = phase >= 3 && phase <= 4
  const circuitActive = phase >= 5

  const attemptStatus = (index: number): NodeStatus => {
    if (phase === index) {
      return 'active'
    }
    if (phase > index) {
      return 'error'
    }

    return 'idle'
  }

  const nodes = useMemo<Node[]>(() => [
    // Layer backgrounds (rendered first, behind other nodes)
    { id: 'retry-layer', type: 'layer', position: { x: 0, y: 0 }, data: { label: 'Retry Layer', active: retryActive, colorScheme: 'primary', width: 560, height: 100 } satisfies LayerNodeData },
    { id: 'fallback-layer', type: 'layer', position: { x: 0, y: 120 }, data: { label: 'Fallback Layer', active: fallbackActive, colorScheme: 'amber', width: 560, height: 90 } satisfies LayerNodeData },
    { id: 'circuit-layer', type: 'layer', position: { x: 0, y: 230 }, data: { label: 'Circuit Breaker', active: circuitActive, colorScheme: 'violet', width: 560, height: 110 } satisfies LayerNodeData },

    // Retry nodes
    { id: 'attempt1', type: 'status', position: { x: 30, y: 40 }, data: { label: 'Attempt 1', status: attemptStatus(0), colorScheme: phase > 0 ? 'red' : 'primary' } satisfies StatusNodeData },
    { id: 'attempt2', type: 'status', position: { x: 210, y: 40 }, data: { label: 'Attempt 2', status: attemptStatus(1), colorScheme: phase > 1 ? 'red' : 'primary' } satisfies StatusNodeData },
    { id: 'attempt3', type: 'status', position: { x: 390, y: 40 }, data: { label: 'Attempt 3', status: attemptStatus(2), colorScheme: phase > 2 ? 'red' : 'primary' } satisfies StatusNodeData },

    // Fallback nodes
    { id: 'primary', type: 'step', position: { x: 80, y: 155 }, data: { label: 'Primary', status: phase === 3 ? 'active' : phase > 3 ? 'error' : 'idle', colorScheme: phase > 3 ? 'red' : 'amber' } satisfies StepNodeData },
    { id: 'backup', type: 'step', position: { x: 340, y: 155 }, data: { label: 'Backup', status: phase === 4 ? 'active' : 'idle', colorScheme: 'emerald' } satisfies StepNodeData },

    // Circuit breaker nodes
    { id: 'closed', type: 'circle', position: { x: 60, y: 280 }, data: { label: 'Closed', status: (phase === 5 || phase === 7) ? 'active' : 'idle', colorScheme: 'emerald' } satisfies CircleNodeData },
    { id: 'open', type: 'circle', position: { x: 220, y: 280 }, data: { label: 'Open', status: (phase === 5 || phase === 6) ? 'active' : 'idle', colorScheme: 'red' } satisfies CircleNodeData },
    { id: 'half-open', type: 'circle', position: { x: 380, y: 280 }, data: { label: 'Half-', sublabel: 'Open', status: (phase === 6 || phase === 7) ? 'active' : 'idle', colorScheme: 'amber' } satisfies CircleNodeData },
  ], [phase, retryActive, fallbackActive, circuitActive])

  const edges = useMemo<Edge[]>(() => [
    // Retry edges
    { id: 'a1->a2', source: 'attempt1', target: 'attempt2', type: 'labeled', data: { label: '1s', active: phase >= 1 } },
    { id: 'a2->a3', source: 'attempt2', target: 'attempt3', type: 'labeled', data: { label: '2s', active: phase >= 2 } },

    // Retry -> Fallback connector
    { id: 'retry->fallback', source: 'attempt2', sourceHandle: 'bottom', target: 'primary', targetHandle: 'top', type: 'labeled', data: { label: 'all retries failed', active: fallbackActive, colorActive: '#ef4444' } },

    // Fallback edges
    { id: 'primary->backup', source: 'primary', target: 'backup', type: 'labeled', data: { label: 'failover', active: phase >= 4, colorActive: '#f59e0b' } },

    // Fallback -> Circuit connector
    { id: 'fallback->circuit', source: 'backup', sourceHandle: 'bottom', target: 'closed', targetHandle: 'top', type: 'labeled', data: { active: circuitActive } },

    // Circuit breaker edges
    { id: 'closed->open', source: 'closed', target: 'open', type: 'labeled', data: { label: '5 fails', active: phase === 5, colorActive: '#ef4444' } },
    { id: 'open->half-open', source: 'open', target: 'half-open', type: 'labeled', data: { label: '30s', active: phase === 6, colorActive: '#f59e0b' } },
    {
      id: 'half-open->closed',
      source: 'half-open',
      sourceHandle: 'top',
      target: 'closed',
      targetHandle: 'top',
      type: 'feedback',
      data: { label: 'success', active: phase === 7, colorActive: '#10b981', direction: 'above' },
    },
  ], [phase, fallbackActive, circuitActive])

  return (
    <DiagramWrapper
      height={550}
      nodes={nodes}
      edges={edges}
      nodeTypes={diagramNodeTypes}
      edgeTypes={diagramEdgeTypes}
    />
  )
})
