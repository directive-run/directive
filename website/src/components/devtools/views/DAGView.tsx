'use client'

import { useMemo, useCallback, useState, useEffect } from 'react'
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
import type { DebugEvent } from '../types'
import { EmptyState } from '../EmptyState'

// ---------------------------------------------------------------------------
// Status colors (matches packages/devtools palette)
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  pending: '#71717a',   // zinc-500
  ready: '#3b82f6',     // blue
  running: '#f59e0b',   // amber
  completed: '#22c55e', // green
  error: '#ef4444',     // red
  skipped: '#a1a1aa',   // zinc-400
  idle: '#71717a',      // zinc-500
}

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  ready: '◎',
  running: '◉',
  completed: '●',
  error: '✕',
  skipped: '⊘',
  idle: '○',
}

// ---------------------------------------------------------------------------
// Custom AgentNode component
// ---------------------------------------------------------------------------

interface AgentNodeData {
  label: string
  status: string
  tokens: number
  runs: number
  [key: string]: unknown
}

function AgentNode({ data, selected }: NodeProps) {
  const { label, status, tokens, runs } = data as AgentNodeData
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.pending

  return (
    <div
      className={`rounded-lg border-2 bg-zinc-900 px-4 py-3 shadow-lg transition-all ${
        selected ? 'ring-2 ring-white/30' : ''
      } ${status === 'running' ? 'motion-safe:animate-pulse' : ''}`}
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-zinc-600" />

      <div className="flex items-center gap-2">
        <span style={{ color }} className="text-lg">{STATUS_ICONS[status] ?? '○'}</span>
        <div>
          <div className="text-sm font-medium text-zinc-100">{label}</div>
          {(tokens > 0 || runs > 0) && (
            <div className="text-[10px] text-zinc-500">
              {tokens > 0 && <>{tokens.toLocaleString()} tokens</>}
              {tokens > 0 && runs > 0 && ' · '}
              {runs > 0 && <>{runs} run{runs !== 1 ? 's' : ''}</>}
            </div>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-zinc-600" />
    </div>
  )
}

const nodeTypes: NodeTypes = { agent: AgentNode }

// ---------------------------------------------------------------------------
// Hardcoded fallback DAG structure for the research pipeline
// ---------------------------------------------------------------------------

const FALLBACK_DAG: Record<string, string[]> = {
  news: [],
  academic: [],
  sentiment: ['news'],
  'fact-checker': ['academic'],
  synthesizer: ['sentiment', 'fact-checker'],
  reviewer: ['synthesizer'],
}

// ---------------------------------------------------------------------------
// DAG state extraction from events
// ---------------------------------------------------------------------------

interface DagNodeState {
  id: string
  status: string
  deps: string[]
  tokens: number
  runs: number
}

function buildDagFromEvents(events: DebugEvent[]): Map<string, DagNodeState> | null {
  const dagEvents = events.filter((e) => e.type === 'dag_node_update')

  if (dagEvents.length === 0) {
    return null
  }

  const nodes = new Map<string, DagNodeState>()

  for (const event of dagEvents) {
    const nodeId = event.nodeId as string
    const status = (event.status as string) ?? 'pending'
    const deps = (event.deps as string[]) ?? []

    const existing = nodes.get(nodeId)
    if (existing) {
      existing.status = status
      if (deps.length > 0) {
        existing.deps = deps
      }
    } else {
      nodes.set(nodeId, { id: nodeId, status, deps, tokens: 0, runs: 0 })
    }
  }

  // Enrich with agent_complete data
  for (const e of events) {
    if (e.type !== 'agent_complete' || !e.agentId) {
      continue
    }
    // Map agent name to DAG node (agent names include hyphens like "news-researcher")
    for (const [nodeId, node] of nodes) {
      if (e.agentId === nodeId || e.agentId?.startsWith(nodeId)) {
        node.tokens += e.totalTokens ?? 0
        node.runs++
      }
    }
  }

  return nodes.size > 0 ? nodes : null
}

function buildFallbackDag(events: DebugEvent[]): Map<string, DagNodeState> {
  const nodes = new Map<string, DagNodeState>()

  // Build from fallback structure
  for (const [id, deps] of Object.entries(FALLBACK_DAG)) {
    nodes.set(id, { id, status: 'pending', deps, tokens: 0, runs: 0 })
  }

  // Enrich status from agent events
  for (const e of events) {
    const agent = e.agentId
    if (!agent) {
      continue
    }

    // Find matching node
    for (const [nodeId, node] of nodes) {
      if (agent === nodeId || agent.startsWith(nodeId)) {
        if (e.type === 'agent_start') {
          node.status = 'running'
        } else if (e.type === 'agent_complete') {
          node.status = 'completed'
          node.tokens += e.totalTokens ?? 0
          node.runs++
        } else if (e.type === 'agent_error') {
          node.status = 'error'
        }
      }
    }
  }

  return nodes
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DAGView({ events }: { events: DebugEvent[] }) {
  const dagData = useMemo(() => {
    const fromEvents = buildDagFromEvents(events)
    if (fromEvents) {
      return fromEvents
    }

    // Fallback: build from known pipeline structure + agent events
    if (events.length > 0) {
      return buildFallbackDag(events)
    }

    return null
  }, [events])

  const [selectedNode, setSelectedNode] = useState<string | null>(null)

  // Build React Flow nodes/edges
  const { initialNodes, initialEdges } = useMemo(() => {
    if (!dagData) {
      return { initialNodes: [], initialEdges: [] }
    }

    const nodeArray = Array.from(dagData.values())

    // Topological layout: assign layers by dependency depth
    const layers = new Map<string, number>()
    function getLayer(id: string, visited = new Set<string>()): number {
      if (layers.has(id)) {
        return layers.get(id)!
      }
      if (visited.has(id)) {
        return 0 // cycle guard
      }
      visited.add(id)
      const node = dagData!.get(id)
      if (!node || node.deps.length === 0) {
        layers.set(id, 0)

        return 0
      }
      const maxParent = Math.max(...node.deps.map((d) => getLayer(d, visited)))
      const layer = maxParent + 1
      layers.set(id, layer)

      return layer
    }
    for (const n of nodeArray) {
      getLayer(n.id)
    }

    // Group by layer for horizontal positioning
    const layerGroups = new Map<number, string[]>()
    for (const n of nodeArray) {
      const layer = layers.get(n.id) ?? 0
      if (!layerGroups.has(layer)) {
        layerGroups.set(layer, [])
      }
      layerGroups.get(layer)!.push(n.id)
    }

    const flowNodes: Node[] = nodeArray.map((n) => {
      const layer = layers.get(n.id) ?? 0
      const group = layerGroups.get(layer)!
      const indexInLayer = group.indexOf(n.id)
      const totalInLayer = group.length
      const xOffset = (indexInLayer - (totalInLayer - 1) / 2) * 250

      return {
        id: n.id,
        type: 'agent',
        position: { x: 400 + xOffset, y: 80 + layer * 150 },
        data: {
          label: n.id,
          status: n.status,
          tokens: n.tokens,
          runs: n.runs,
        },
      }
    })

    const flowEdges: Edge[] = []
    for (const node of nodeArray) {
      for (const dep of node.deps) {
        flowEdges.push({
          id: `${dep}->${node.id}`,
          source: dep,
          target: node.id,
          animated: node.status === 'running',
          style: {
            stroke: STATUS_COLORS[node.status] ?? STATUS_COLORS.pending,
            strokeWidth: 2,
          },
        })
      }
    }

    return { initialNodes: flowNodes, initialEdges: flowEdges }
  }, [dagData])

  const [nodes, setNodes] = useState(initialNodes)
  const [edges, setEdges] = useState(initialEdges)

  useEffect(() => {
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

  if (events.length === 0) {
    return <EmptyState message="No events recorded yet." />
  }

  if (!dagData || dagData.size === 0) {
    return <EmptyState message="No DAG execution detected. Run a research query to see the graph." />
  }

  const selected = selectedNode ? dagData.get(selectedNode) : null

  return (
    <div className="-mx-4 -mb-4 flex" style={{ height: 'calc(100% + 1rem)' }}>
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_e, node) => setSelectedNode(selectedNode === node.id ? null : node.id)}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
          className="bg-zinc-950"
        >
          <Background color="#27272a" gap={20} />
          <Controls className="[&>button]:!border-zinc-700 [&>button]:!bg-zinc-800 [&>button]:!text-zinc-300" />
        </ReactFlow>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-56 shrink-0 overflow-auto border-l border-zinc-700 bg-zinc-900 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-100">{selected.id}</h3>
            <button
              onClick={() => setSelectedNode(null)}
              aria-label="Close detail panel"
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 space-y-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-zinc-500">Status</span>
              <span className="text-zinc-300">{selected.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Tokens</span>
              <span className="text-zinc-300">{selected.tokens.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Runs</span>
              <span className="text-zinc-300">{selected.runs}</span>
            </div>
            {selected.deps.length > 0 && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Deps</span>
                <span className="text-zinc-300">{selected.deps.join(', ')}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
