'use client'

import { useMemo, useState, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { EmptyState } from '../EmptyState'

// ---------------------------------------------------------------------------
// Column layout constants
// ---------------------------------------------------------------------------

const COL_X = [0, 220, 440, 660, 880] as const
const COL_LABELS = ['Facts', 'Derivations', 'Constraints', 'Requirements', 'Resolvers'] as const
const NODE_W = 160
const NODE_H = 36
const ROW_GAP = 50
const START_Y = 50

// ---------------------------------------------------------------------------
// Color palette per column
// ---------------------------------------------------------------------------

const COL_COLORS = [
  { bg: '#0ea5e9', border: '#0284c7', text: '#fff' }, // sky — facts
  { bg: '#8b5cf6', border: '#7c3aed', text: '#fff' }, // violet — derivations
  { bg: '#22c55e', border: '#16a34a', text: '#fff' }, // green — constraints
  { bg: '#f59e0b', border: '#d97706', text: '#fff' }, // amber — requirements
  { bg: '#6366f1', border: '#4f46e5', text: '#fff' }, // indigo — resolvers
] as const

// ---------------------------------------------------------------------------
// Custom node
// ---------------------------------------------------------------------------

function SystemNode({ data }: NodeProps) {
  const { label, colIdx, active } = data as { label: string; colIdx: number; active: boolean }
  const colors = COL_COLORS[colIdx] ?? COL_COLORS[0]

  return (
    <div
      style={{
        width: NODE_W,
        height: NODE_H,
        background: active ? colors.bg : '#3f3f46',
        borderColor: active ? colors.border : '#52525b',
        borderWidth: 2,
        borderStyle: 'solid',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: active ? colors.text : '#a1a1aa',
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontWeight: 500,
        opacity: active ? 1 : 0.6,
        transition: 'all 200ms',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: 'hidden' }} />
      <span style={{
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxWidth: NODE_W - 20,
      }}>
        {label}
      </span>
      <Handle type="source" position={Position.Right} style={{ visibility: 'hidden' }} />
    </div>
  )
}

const nodeTypes: NodeTypes = { system: SystemNode }

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SystemGraphView() {
  const system = useDevToolsSystem()
  const connected = useSelector(system, (s) => s.facts.runtime.connected)
  const facts = useSelector(system, (s) => s.facts.runtime.facts)
  const derivations = useSelector(system, (s) => s.facts.runtime.derivations)
  const constraints = useSelector(system, (s) => s.facts.runtime.constraints)
  const inflight = useSelector(system, (s) => s.facts.runtime.inflight)
  const unmet = useSelector(system, (s) => s.facts.runtime.unmet)
  const resolverStats = useSelector(system, (s) => s.facts.runtime.resolverStats)

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = []
    const edges: Edge[] = []

    // Column header nodes
    for (let i = 0; i < COL_LABELS.length; i++) {
      nodes.push({
        id: `header-${i}`,
        type: 'default',
        position: { x: COL_X[i], y: 0 },
        data: { label: COL_LABELS[i] },
        draggable: false,
        selectable: false,
        style: {
          background: 'transparent',
          border: 'none',
          color: '#71717a',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.05em',
          width: NODE_W,
          textAlign: 'center' as const,
        },
      })
    }

    // Facts
    const factKeys = Object.keys(facts)
    factKeys.forEach((key, i) => {
      nodes.push({
        id: `fact-${key}`,
        type: 'system',
        position: { x: COL_X[0], y: START_Y + i * ROW_GAP },
        data: { label: key, colIdx: 0, active: true },
      })
    })

    // Derivations
    const derivKeys = Object.keys(derivations)
    derivKeys.forEach((key, i) => {
      nodes.push({
        id: `deriv-${key}`,
        type: 'system',
        position: { x: COL_X[1], y: START_Y + i * ROW_GAP },
        data: { label: key, colIdx: 1, active: true },
      })
    })

    // Constraints
    constraints.forEach((c, i) => {
      nodes.push({
        id: `constraint-${c.id}`,
        type: 'system',
        position: { x: COL_X[2], y: START_Y + i * ROW_GAP },
        data: { label: c.id, colIdx: 2, active: c.active },
      })
    })

    // Requirements (inflight + unmet combined)
    const allReqs = [...inflight, ...unmet]
    allReqs.forEach((r, i) => {
      nodes.push({
        id: `req-${r.id}`,
        type: 'system',
        position: { x: COL_X[3], y: START_Y + i * ROW_GAP },
        data: { label: `${r.type}`, colIdx: 3, active: r.status === 'inflight' },
      })

      // Edge: constraint → requirement
      if (r.fromConstraint) {
        edges.push({
          id: `e-${r.fromConstraint}-${r.id}`,
          source: `constraint-${r.fromConstraint}`,
          target: `req-${r.id}`,
          animated: r.status === 'inflight',
          style: { stroke: r.status === 'inflight' ? '#f59e0b' : '#ef4444', strokeWidth: 1.5 },
        })
      }
    })

    // Resolvers
    const resolverKeys = Object.keys(resolverStats)
    resolverKeys.forEach((key, i) => {
      nodes.push({
        id: `resolver-${key}`,
        type: 'system',
        position: { x: COL_X[4], y: START_Y + i * ROW_GAP },
        data: { label: key, colIdx: 4, active: true },
      })
    })

    return { nodes, edges }
  }, [facts, derivations, constraints, inflight, unmet, resolverStats])

  const [nodes, setNodes] = useState(initialNodes)
  const [graphEdges, setEdges] = useState(initialEdges)

  // Re-sync when data changes
  useMemo(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges])

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  )

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  )

  if (!connected) {
    return <EmptyState message="No Directive system connected" />
  }

  const isEmpty = Object.keys(facts).length === 0 && constraints.length === 0

  if (isEmpty) {
    return <EmptyState message="No graph data available" />
  }

  return (
    <div className="h-full min-h-[400px]">
      <ReactFlow
        nodes={nodes}
        edges={graphEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background color="#27272a" gap={16} />
        <Controls
          showInteractive={false}
          style={{ background: '#18181b', borderColor: '#3f3f46', borderRadius: 8 }}
        />
      </ReactFlow>
    </div>
  )
}
