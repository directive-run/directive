'use client'

import { useMemo, useCallback, useState, useEffect, useRef } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  Panel,
  useReactFlow,
  useViewport,
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
import getStroke from 'perfect-freehand'
import { useDirectiveRef, useSelector, useEvents } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import type { DebugEvent } from '../types'
import { EmptyState } from '../EmptyState'
import { getDefaultPricing, formatCost } from '../constants'
import { graphDraw, type Stroke } from './graph-draw-module'
import { usePlayback } from './usePlayback'
import { PlaybackControls } from './PlaybackControls'

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
// Enriched node state
// ---------------------------------------------------------------------------

interface GraphNodeState {
  id: string
  label: string
  status: string
  deps: string[]
  tokens: number
  inputTokens: number
  outputTokens: number
  runs: number
  durationMs: number
  lastDurationMs: number
  modelId: string | null
  lastError: string | null
  retries: number
  isVirtual: boolean
  isTask: boolean
  lastInput: string | null
  lastOutput: string | null
  instructions: string | null
  /** Task progress percent (0-100) */
  progress: number | null
  /** Task description for tooltip */
  description: string | null
}

interface GraphEdgeState {
  source: string
  target: string
  label?: string
  dashed?: boolean
}

type PatternType = 'dag' | 'parallel' | 'sequential' | 'supervisor' | 'race' | 'reflect' | 'debate' | 'goal'

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
      className={`cursor-pointer rounded-lg border-2 bg-zinc-900 px-4 py-3 shadow-lg transition-all ${
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

// ---------------------------------------------------------------------------
// Virtual node component (Input/Output/Merge)
// ---------------------------------------------------------------------------

function VirtualNode({ data, selected }: NodeProps) {
  const { label } = data as { label: string; [key: string]: unknown }

  return (
    <div
      className={`cursor-pointer rounded-full border-2 border-dashed border-zinc-600 bg-zinc-900/80 px-3 py-1.5 text-center shadow transition-all ${
        selected ? 'ring-2 ring-white/30' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-zinc-600" />
      <div className="text-xs font-medium text-zinc-400">{label}</div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-zinc-600" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Task node component (imperative code — violet, dashed border, gear icon)
// ---------------------------------------------------------------------------

interface TaskNodeData {
  label: string
  status: string
  runs: number
  progress: number | null
  description: string | null
  [key: string]: unknown
}

function TaskNode({ data, selected }: NodeProps) {
  const { label, status, runs, progress, description } = data as TaskNodeData
  const color = status === 'running' ? '#8b5cf6' : STATUS_COLORS[status] ?? '#8b5cf6'

  return (
    <div
      className={`cursor-pointer rounded-lg border-2 border-dashed bg-zinc-900 px-4 py-3 shadow-lg transition-all ${
        selected ? 'ring-2 ring-white/30' : ''
      } ${status === 'running' ? 'motion-safe:animate-pulse' : ''}`}
      style={{ borderColor: color }}
      title={description ?? undefined}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-zinc-600" />

      <div className="flex items-center gap-2">
        <span style={{ color }} className="text-lg">&#9881;</span>
        <div>
          <div className="text-sm font-medium text-zinc-100">{label}</div>
          {runs > 0 && (
            <div className="text-[10px] text-zinc-500">
              {runs} run{runs !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      </div>

      {progress !== null && progress >= 0 && (
        <div
          className="mt-1.5 h-1 w-full rounded-full bg-zinc-700"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label} progress`}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: progress >= 100 ? '#22c55e' : color }}
          />
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-zinc-600" />
    </div>
  )
}

const nodeTypes: NodeTypes = { agent: AgentNode, virtual: VirtualNode, task: TaskNode }

// No hardcoded fallback — graph is built entirely from live events

// ---------------------------------------------------------------------------
// Helper: create an empty GraphNodeState
// ---------------------------------------------------------------------------

function emptyNode(id: string, opts?: { label?: string; isVirtual?: boolean; isTask?: boolean; deps?: string[] }): GraphNodeState {
  return {
    id,
    label: opts?.label ?? id,
    status: 'pending',
    deps: opts?.deps ?? [],
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    runs: 0,
    durationMs: 0,
    lastDurationMs: 0,
    modelId: null,
    lastError: null,
    retries: 0,
    isVirtual: opts?.isVirtual ?? false,
    isTask: opts?.isTask ?? false,
    lastInput: null,
    lastOutput: null,
    instructions: null,
    progress: null,
    description: null,
  }
}

// ---------------------------------------------------------------------------
// Enrich nodes from agent events
// ---------------------------------------------------------------------------

function enrichFromAgentEvents(
  nodes: Map<string, GraphNodeState>,
  events: DebugEvent[],
): void {
  for (const e of events) {
    // Task events may use taskId instead of agentId
    const agent = e.agentId ?? (e as Record<string, unknown>).taskId as string | undefined
    if (!agent) {
      continue
    }

    // Find matching node (exact or prefix match)
    let matched: GraphNodeState | undefined
    for (const [nodeId, node] of nodes) {
      if (node.isVirtual) {
        continue
      }
      if (agent === nodeId || agent.startsWith(nodeId)) {
        matched = node
        break
      }
    }
    if (!matched) {
      continue
    }

    if (e.type === 'agent_start') {
      matched.status = 'running'
      if (typeof e.input === 'string') {
        matched.lastInput = e.input
      }
      if (typeof e.instructions === 'string') {
        matched.instructions = e.instructions
      }
    } else if (e.type === 'agent_complete') {
      matched.status = 'completed'
      matched.tokens += e.totalTokens ?? 0
      matched.inputTokens += e.inputTokens ?? 0
      matched.outputTokens += e.outputTokens ?? 0
      matched.lastDurationMs = e.durationMs ?? 0
      matched.durationMs += e.durationMs ?? 0
      matched.runs++
      if (e.modelId) {
        matched.modelId = e.modelId
      }
      if (typeof e.output === 'string') {
        matched.lastOutput = e.output
      }
    } else if (e.type === 'agent_error') {
      matched.status = 'error'
      matched.lastError = (e.errorMessage as string) ?? 'Unknown error'
    } else if (e.type === 'agent_retry') {
      matched.retries++
    } else if (e.type === 'task_start') {
      matched.status = 'running'
      matched.isTask = true
      if (typeof e.description === 'string') {
        matched.description = e.description
      }
      if (typeof e.label === 'string') {
        matched.label = e.label
      }
    } else if (e.type === 'task_complete') {
      matched.status = 'completed'
      matched.isTask = true
      matched.lastDurationMs = (e as Record<string, unknown>).durationMs as number ?? 0
      matched.durationMs += matched.lastDurationMs
      matched.runs++
    } else if (e.type === 'task_error') {
      matched.status = 'error'
      matched.isTask = true
      matched.lastError = (e as Record<string, unknown>).error as string ?? 'Unknown error'
    } else if (e.type === 'task_progress') {
      matched.isTask = true
      matched.progress = (e as Record<string, unknown>).percent as number ?? null
    }
  }
}

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

function detectPattern(events: DebugEvent[]): PatternType | null {
  for (const e of events) {
    if (e.type === 'pattern_start' && e.patternType) {
      return e.patternType as PatternType
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Pattern-specific builders
// ---------------------------------------------------------------------------

function buildDagGraph(events: DebugEvent[]): { nodes: Map<string, GraphNodeState>; edges: GraphEdgeState[] } {
  const dagEvents = events.filter((e) => e.type === 'dag_node_update')

  const nodes = new Map<string, GraphNodeState>()

  if (dagEvents.length > 0) {
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
        nodes.set(nodeId, emptyNode(nodeId, { deps }))
        nodes.get(nodeId)!.status = status
      }
    }
  } else {
    // No dag_node_update events — build flat nodes from agent events
    const agentIds = extractAgentIds(events)
    for (const id of agentIds) {
      nodes.set(id, emptyNode(id))
    }
  }

  enrichFromAgentEvents(nodes, events)

  const edges: GraphEdgeState[] = []
  for (const node of nodes.values()) {
    for (const dep of node.deps) {
      edges.push({ source: dep, target: node.id })
    }
  }

  return { nodes, edges }
}

function buildParallelGraph(events: DebugEvent[]): { nodes: Map<string, GraphNodeState>; edges: GraphEdgeState[] } {
  const nodes = new Map<string, GraphNodeState>()
  const agentIds = extractAgentIds(events)

  nodes.set('__input', emptyNode('__input', { label: 'Input', isVirtual: true }))
  for (const id of agentIds) {
    nodes.set(id, emptyNode(id, { deps: ['__input'] }))
  }
  nodes.set('__merge', emptyNode('__merge', { label: 'Merge', isVirtual: true, deps: agentIds }))

  enrichFromAgentEvents(nodes, events)
  // Virtual nodes complete when pattern completes
  markVirtualStatus(nodes, events)

  const edges: GraphEdgeState[] = []
  for (const id of agentIds) {
    edges.push({ source: '__input', target: id })
    edges.push({ source: id, target: '__merge' })
  }

  return { nodes, edges }
}

function buildSequentialGraph(events: DebugEvent[]): { nodes: Map<string, GraphNodeState>; edges: GraphEdgeState[] } {
  const nodes = new Map<string, GraphNodeState>()
  const agentIds = extractAgentIdsOrdered(events)

  let prevId: string | null = null
  for (const id of agentIds) {
    const deps = prevId ? [prevId] : []
    nodes.set(id, emptyNode(id, { deps }))
    prevId = id
  }

  enrichFromAgentEvents(nodes, events)

  const edges: GraphEdgeState[] = []
  const ids = Array.from(nodes.keys())
  for (let i = 1; i < ids.length; i++) {
    edges.push({ source: ids[i - 1], target: ids[i], label: 'next' })
  }

  return { nodes, edges }
}

function buildSupervisorGraph(events: DebugEvent[]): { nodes: Map<string, GraphNodeState>; edges: GraphEdgeState[] } {
  const nodes = new Map<string, GraphNodeState>()
  const agentIds = extractAgentIds(events)

  // First agent is typically the supervisor
  const supervisorId = agentIds[0] ?? 'supervisor'
  const workerIds = agentIds.slice(1)

  nodes.set(supervisorId, emptyNode(supervisorId))
  for (const id of workerIds) {
    nodes.set(id, emptyNode(id))
  }

  enrichFromAgentEvents(nodes, events)

  const edges: GraphEdgeState[] = []
  for (const id of workerIds) {
    edges.push({ source: supervisorId, target: id, label: 'delegate' })
    edges.push({ source: id, target: supervisorId, label: 'result' })
  }

  return { nodes, edges }
}

function buildRaceGraph(events: DebugEvent[]): { nodes: Map<string, GraphNodeState>; edges: GraphEdgeState[] } {
  const nodes = new Map<string, GraphNodeState>()
  const agentIds = extractAgentIds(events)

  nodes.set('__input', emptyNode('__input', { label: 'Input', isVirtual: true }))
  for (const id of agentIds) {
    nodes.set(id, emptyNode(id, { deps: ['__input'] }))
  }
  nodes.set('__output', emptyNode('__output', { label: 'Output', isVirtual: true, deps: agentIds }))

  enrichFromAgentEvents(nodes, events)
  markVirtualStatus(nodes, events)

  const edges: GraphEdgeState[] = []
  for (const id of agentIds) {
    edges.push({ source: '__input', target: id })
    edges.push({ source: id, target: '__output', dashed: true })
  }

  return { nodes, edges }
}

function buildReflectGraph(events: DebugEvent[]): { nodes: Map<string, GraphNodeState>; edges: GraphEdgeState[] } {
  const nodes = new Map<string, GraphNodeState>()
  const agentIds = extractAgentIds(events)

  const producerId = agentIds[0] ?? 'producer'
  const evaluatorId = agentIds[1] ?? 'evaluator'

  nodes.set(producerId, emptyNode(producerId))
  nodes.set(evaluatorId, emptyNode(evaluatorId, { deps: [producerId] }))
  nodes.set('__output', emptyNode('__output', { label: 'Output', isVirtual: true, deps: [evaluatorId] }))

  enrichFromAgentEvents(nodes, events)
  markVirtualStatus(nodes, events)

  const edges: GraphEdgeState[] = [
    { source: producerId, target: evaluatorId },
    { source: evaluatorId, target: producerId, label: 'feedback' },
    { source: evaluatorId, target: '__output', label: 'pass' },
  ]

  return { nodes, edges }
}

function buildDebateGraph(events: DebugEvent[]): { nodes: Map<string, GraphNodeState>; edges: GraphEdgeState[] } {
  const nodes = new Map<string, GraphNodeState>()
  const agentIds = extractAgentIds(events)

  // Last agent is typically the judge/evaluator
  const judgeId = agentIds[agentIds.length - 1] ?? 'judge'
  const debaterIds = agentIds.slice(0, -1)

  for (const id of debaterIds) {
    nodes.set(id, emptyNode(id))
  }
  nodes.set(judgeId, emptyNode(judgeId, { deps: debaterIds }))
  nodes.set('__output', emptyNode('__output', { label: 'Output', isVirtual: true, deps: [judgeId] }))

  enrichFromAgentEvents(nodes, events)
  markVirtualStatus(nodes, events)

  const edges: GraphEdgeState[] = []
  for (const id of debaterIds) {
    edges.push({ source: id, target: judgeId })
    edges.push({ source: judgeId, target: id, label: 'next round' })
  }
  edges.push({ source: judgeId, target: '__output' })

  return { nodes, edges }
}

function buildGoalGraph(events: DebugEvent[]): { nodes: Map<string, GraphNodeState>; edges: GraphEdgeState[] } {
  // Goal pattern: derive edges from goal_step events if available, otherwise treat like DAG
  const goalSteps = events.filter((e) => e.type === 'goal_step')

  if (goalSteps.length > 0) {
    const nodes = new Map<string, GraphNodeState>()
    const edgeSet = new Set<string>()
    const edges: GraphEdgeState[] = []

    for (const step of goalSteps) {
      const nodeId = (step.nodeId ?? step.agentId) as string
      if (!nodeId) {
        continue
      }
      if (!nodes.has(nodeId)) {
        const deps = (step.deps as string[]) ?? []
        nodes.set(nodeId, emptyNode(nodeId, { deps }))
      }
    }

    enrichFromAgentEvents(nodes, events)

    for (const node of nodes.values()) {
      for (const dep of node.deps) {
        const key = `${dep}->${node.id}`
        if (!edgeSet.has(key)) {
          edges.push({ source: dep, target: node.id })
          edgeSet.add(key)
        }
      }
    }

    return { nodes, edges }
  }

  // Fallback to DAG-style building
  return buildDagGraph(events)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractAgentIds(events: DebugEvent[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const e of events) {
    const id = e.agentId ?? (e.type === 'task_start' ? (e as Record<string, unknown>).taskId as string : null)
    if ((e.type === 'agent_start' || e.type === 'task_start') && id && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }

  return ids
}

function extractAgentIdsOrdered(events: DebugEvent[]): string[] {
  // Ordered by first agent_start/task_start timestamp
  const starts: Array<{ id: string; ts: number }> = []
  const seen = new Set<string>()
  for (const e of events) {
    const id = e.agentId ?? (e.type === 'task_start' ? (e as Record<string, unknown>).taskId as string : null)
    if ((e.type === 'agent_start' || e.type === 'task_start') && id && !seen.has(id)) {
      seen.add(id)
      starts.push({ id, ts: e.timestamp })
    }
  }
  starts.sort((a, b) => a.ts - b.ts)

  return starts.map((s) => s.id)
}

function markVirtualStatus(nodes: Map<string, GraphNodeState>, events: DebugEvent[]): void {
  const hasPatternComplete = events.some((e) => e.type === 'pattern_complete')
  const hasPatternStart = events.some((e) => e.type === 'pattern_start')

  for (const node of nodes.values()) {
    if (!node.isVirtual) {
      continue
    }
    if (hasPatternComplete) {
      node.status = 'completed'
    } else if (hasPatternStart) {
      node.status = 'running'
    }
  }
}

// ---------------------------------------------------------------------------
// Main graph builder — dispatches to pattern-specific builders
// ---------------------------------------------------------------------------

function buildGraphFromEvents(events: DebugEvent[]): {
  nodes: Map<string, GraphNodeState>
  edges: GraphEdgeState[]
  patternType: PatternType | null
} | null {
  const patternType = detectPattern(events)

  // If no pattern detected, infer from available events
  if (!patternType) {
    const hasDagEvents = events.some((e) => e.type === 'dag_node_update')
    const hasAgentEvents = events.some((e) => e.type === 'agent_start')

    if (!hasDagEvents && !hasAgentEvents) {
      return null
    }

    if (hasDagEvents) {
      // DAG events present — build DAG graph with dependency edges
      const { nodes, edges } = buildDagGraph(events)

      return { nodes, edges, patternType: 'dag' }
    }

    // Only agent events, no DAG structure — show flat agent nodes
    const agentIds = extractAgentIds(events)
    if (agentIds.length <= 1) {
      // Single agent — graph isn't useful, show empty state
      return null
    }

    // Multiple agents without pattern — show as parallel
    const { nodes, edges } = buildParallelGraph(events)

    return { nodes, edges, patternType: 'parallel' }
  }

  const builders: Record<PatternType, (events: DebugEvent[]) => { nodes: Map<string, GraphNodeState>; edges: GraphEdgeState[] }> = {
    dag: buildDagGraph,
    parallel: buildParallelGraph,
    sequential: buildSequentialGraph,
    supervisor: buildSupervisorGraph,
    race: buildRaceGraph,
    reflect: buildReflectGraph,
    debate: buildDebateGraph,
    goal: buildGoalGraph,
  }

  const builder = builders[patternType]
  if (!builder) {
    return null
  }

  const { nodes, edges } = builder(events)

  return { nodes, edges, patternType }
}

// ---------------------------------------------------------------------------
// Playback step clustering
// ---------------------------------------------------------------------------

interface PlaybackStep {
  events: DebugEvent[]
  timestamp: number
  label: string
}

function clusterEventsByTimestamp(events: DebugEvent[], thresholdMs = 50): PlaybackStep[] {
  // Only cluster status-changing events
  const statusEvents = events.filter(
    (e) =>
      e.type === 'agent_start' ||
      e.type === 'agent_complete' ||
      e.type === 'agent_error' ||
      e.type === 'task_start' ||
      e.type === 'task_complete' ||
      e.type === 'task_error' ||
      e.type === 'dag_node_update' ||
      e.type === 'pattern_start' ||
      e.type === 'pattern_complete',
  )

  if (statusEvents.length === 0) {
    return []
  }

  const steps: PlaybackStep[] = []
  let currentCluster: DebugEvent[] = [statusEvents[0]]
  let clusterStart = statusEvents[0].timestamp

  for (let i = 1; i < statusEvents.length; i++) {
    const e = statusEvents[i]
    if (e.timestamp - clusterStart <= thresholdMs) {
      currentCluster.push(e)
    } else {
      steps.push(buildStep(currentCluster))
      currentCluster = [e]
      clusterStart = e.timestamp
    }
  }
  steps.push(buildStep(currentCluster))

  return steps
}

function buildStep(events: DebugEvent[]): PlaybackStep {
  const parts: string[] = []
  for (const e of events) {
    const id = e.agentId ?? (e as Record<string, unknown>).taskId as string ?? (e as Record<string, unknown>).nodeId as string
    if (!id) {
      continue
    }
    const action =
      e.type === 'agent_start' || e.type === 'task_start' || e.type === 'pattern_start'
        ? 'started'
        : e.type === 'agent_complete' || e.type === 'task_complete' || e.type === 'pattern_complete'
          ? 'completed'
          : e.type === 'agent_error' || e.type === 'task_error'
            ? 'error'
            : e.type === 'dag_node_update'
              ? ((e as Record<string, unknown>).status as string ?? 'updated')
              : 'updated'
    parts.push(`${id} ${action}`)
  }

  return {
    events,
    timestamp: events[0].timestamp,
    label: parts.join(', ') || 'step',
  }
}

// ---------------------------------------------------------------------------
// Build graph with partial event application (for playback)
// ---------------------------------------------------------------------------

function buildGraphUpToStep(
  allEvents: DebugEvent[],
  steps: PlaybackStep[],
  currentStep: number,
): { nodes: Map<string, GraphNodeState>; edges: GraphEdgeState[]; patternType: PatternType | null } | null {
  // Build full topology from ALL events (stable layout)
  const full = buildGraphFromEvents(allEvents)
  if (!full) {
    return null
  }

  // Reset all node statuses to pending and zero telemetry
  for (const node of full.nodes.values()) {
    if (!node.isVirtual) {
      node.status = 'pending'
    }
    node.tokens = 0
    node.inputTokens = 0
    node.outputTokens = 0
    node.runs = 0
    node.durationMs = 0
    node.lastDurationMs = 0
    node.modelId = null
    node.lastError = null
    node.retries = 0
    node.lastInput = null
    node.lastOutput = null
    node.progress = null
  }

  // Reset virtual nodes too
  for (const node of full.nodes.values()) {
    if (node.isVirtual) {
      node.status = 'pending'
    }
  }

  // Collect events from steps 0..currentStep
  const partialEvents: DebugEvent[] = []
  for (let i = 0; i <= currentStep && i < steps.length; i++) {
    partialEvents.push(...steps[i].events)
  }

  // Re-enrich with partial events
  enrichFromAgentEvents(full.nodes, partialEvents)
  markVirtualStatus(full.nodes, partialEvents)

  // Replay dag_node_update events from partial set (DAG patterns set status directly)
  for (const e of partialEvents) {
    if (e.type === 'dag_node_update') {
      const nodeId = e.nodeId as string
      const status = (e.status as string) ?? 'pending'
      const node = full.nodes.get(nodeId)
      if (node) {
        node.status = status
      }
    }
  }

  return full
}

// ---------------------------------------------------------------------------
// Layout: topological layer assignment + barycenter heuristic
// ---------------------------------------------------------------------------

function layoutGraph(
  nodes: Map<string, GraphNodeState>,
  edges: GraphEdgeState[],
): { flowNodes: Node[]; flowEdges: Edge[] } {
  const nodeArray = Array.from(nodes.values())

  // Topological layout: assign layers by dependency depth
  const layers = new Map<string, number>()
  function getLayer(id: string, visited = new Set<string>()): number {
    if (layers.has(id)) {
      return layers.get(id)!
    }
    if (visited.has(id)) {
      return 0
    }
    visited.add(id)
    const node = nodes.get(id)
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

  // Barycenter heuristic
  const nodePositionIndex = new Map<string, number>()
  const maxLayer = Math.max(...Array.from(layers.values()), 0)
  for (let l = 0; l <= maxLayer; l++) {
    const group = layerGroups.get(l)
    if (!group) {
      continue
    }

    if (l === 0) {
      group.forEach((id, i) => nodePositionIndex.set(id, i))
    } else {
      group.sort((a, b) => {
        const aDeps = nodes.get(a)?.deps ?? []
        const bDeps = nodes.get(b)?.deps ?? []
        const aAvg = aDeps.length > 0
          ? aDeps.reduce((s, d) => s + (nodePositionIndex.get(d) ?? 0), 0) / aDeps.length
          : 0
        const bAvg = bDeps.length > 0
          ? bDeps.reduce((s, d) => s + (nodePositionIndex.get(d) ?? 0), 0) / bDeps.length
          : 0

        return aAvg - bAvg
      })
      group.forEach((id, i) => nodePositionIndex.set(id, i))
    }
  }

  const flowNodes: Node[] = nodeArray.map((n) => {
    const layer = layers.get(n.id) ?? 0
    const group = layerGroups.get(layer)!
    const indexInLayer = group.indexOf(n.id)
    const totalInLayer = group.length
    const xOffset = (indexInLayer - (totalInLayer - 1) / 2) * 250

    return {
      id: n.id,
      type: n.isTask ? 'task' : n.isVirtual ? 'virtual' : 'agent',
      position: { x: 400 + xOffset, y: 80 + layer * 150 },
      data: {
        label: n.label,
        status: n.status,
        tokens: n.tokens,
        runs: n.runs,
        progress: n.progress,
        description: n.description,
      },
    }
  })

  const flowEdges: Edge[] = edges.map((edge) => {
    const targetNode = nodes.get(edge.target)
    const isRunning = targetNode?.status === 'running'

    return {
      id: `${edge.source}->${edge.target}${edge.label ? `-${edge.label}` : ''}`,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      animated: isRunning,
      label: edge.label,
      style: {
        stroke: STATUS_COLORS[targetNode?.status ?? 'pending'] ?? STATUS_COLORS.pending,
        strokeWidth: 2,
        ...(edge.dashed ? { strokeDasharray: '5 5' } : {}),
      },
      labelStyle: edge.label ? { fill: '#a1a1aa', fontSize: 10 } : undefined,
      labelBgStyle: edge.label ? { fill: '#18181b', fillOpacity: 0.8 } : undefined,
      labelBgPadding: edge.label ? [4, 2] as [number, number] : undefined,
    }
  })

  return { flowNodes, flowEdges }
}

// ---------------------------------------------------------------------------
// AutoFit — smoothly re-fits viewport when node count changes
// ---------------------------------------------------------------------------

function AutoFit({ nodeCount }: { nodeCount: number }) {
  const { fitView } = useReactFlow()
  const prevCount = useRef(nodeCount)

  useEffect(() => {
    if (nodeCount !== prevCount.current) {
      prevCount.current = nodeCount
      // Small delay to let ReactFlow layout the new nodes first
      const timer = setTimeout(() => {
        fitView({ duration: 400, padding: 0.15 })
      }, 50)

      return () => clearTimeout(timer)
    }
  }, [nodeCount, fitView])

  return null
}

// ---------------------------------------------------------------------------
// Detail panel row
// ---------------------------------------------------------------------------

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-300">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Freehand drawing utilities
// ---------------------------------------------------------------------------

const DRAW_COLORS = [
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Red', value: '#ef4444' },
  { label: 'Emerald', value: '#22c55e' },
  { label: 'Sky', value: '#3b82f6' },
  { label: 'Zinc', value: '#e4e4e7' },
]

const DRAW_SIZES = [
  { label: 'S', value: 2 },
  { label: 'M', value: 4 },
  { label: 'L', value: 8 },
]

/** Convert perfect-freehand outline points to an SVG path `d` attribute */
function getSvgPathFromStroke(points: number[][]): string {
  if (points.length === 0) {
    return ''
  }

  const d = points.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)

      return acc
    },
    ['M', ...points[0], 'Q'],
  )

  d.push('Z')

  return d.join(' ')
}

function getStrokeOptions(size: number) {
  return {
    size,
    smoothing: 0.5,
    thinning: 0.5,
    streamline: 0.5,
  }
}

// ---------------------------------------------------------------------------
// Drawing overlay (rendered inside ReactFlow to access viewport hooks)
// ---------------------------------------------------------------------------

function DrawingOverlay() {
  const system = useDirectiveRef(graphDraw)
  const drawMode = useSelector(system, (s) => s.drawMode, false)
  const strokes = useSelector(system, (s) => s.strokes, [] as Stroke[])
  const strokeColor = useSelector(system, (s) => s.strokeColor, '#f59e0b')
  const strokeSize = useSelector(system, (s) => s.strokeSize, 4)
  const canUndo = useSelector(system, (s) => s.canUndo, false)
  const hasStrokes = useSelector(system, (s) => s.hasStrokes, false)
  const events = useEvents(system)

  const currentStrokeRef = useRef<number[][] | null>(null)
  const livePathRef = useRef<SVGPathElement>(null)
  const { screenToFlowPosition } = useReactFlow()
  const viewport = useViewport()

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drawMode) {
        return
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      currentStrokeRef.current = [[pos.x, pos.y]]

      // Clear live path for fresh stroke
      if (livePathRef.current) {
        livePathRef.current.setAttribute('d', '')
      }
    },
    [drawMode, screenToFlowPosition],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!currentStrokeRef.current) {
        return
      }
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      currentStrokeRef.current.push([pos.x, pos.y])

      // Imperative DOM update for 60fps performance
      if (livePathRef.current) {
        const outline = getStroke(currentStrokeRef.current, getStrokeOptions(strokeSize))
        livePathRef.current.setAttribute('d', getSvgPathFromStroke(outline))
      }
    },
    [screenToFlowPosition, strokeSize],
  )

  const handlePointerUp = useCallback(() => {
    if (!currentStrokeRef.current || currentStrokeRef.current.length < 2) {
      currentStrokeRef.current = null

      return
    }

    events.addStroke({
      stroke: {
        points: currentStrokeRef.current,
        color: strokeColor,
        size: strokeSize,
      },
    })
    currentStrokeRef.current = null

    // Clear live path after committing
    if (livePathRef.current) {
      livePathRef.current.setAttribute('d', '')
    }
  }, [events, strokeColor, strokeSize])

  return (
    <>
      {/* Drawing toolbar — z-30 to stay above the draw overlay (z-20) */}
      <Panel position="top-left" className="!m-2 !z-30">
        <div className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
          {/* Draw toggle */}
          <button
            onClick={() => events.toggleDraw()}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              drawMode
                ? 'bg-amber-500/20 text-amber-400'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
            title={drawMode ? 'Exit draw mode' : 'Enter draw mode'}
          >
            Draw
          </button>

          {/* Color/size/undo/clear only visible in draw mode */}
          {drawMode && (
            <>
              <div className="mx-1 h-4 w-px bg-zinc-700" />

              {/* Color swatches */}
              {DRAW_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => events.setColor({ color: c.value })}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                    strokeColor === c.value
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                  }`}
                >
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: c.value }}
                  />
                  {c.label}
                </button>
              ))}

              <div className="mx-1 h-4 w-px bg-zinc-700" />

              {/* Size buttons */}
              {DRAW_SIZES.map((s) => (
                <button
                  key={s.label}
                  onClick={() => events.setSize({ size: s.value })}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                    strokeSize === s.value
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                  }`}
                  title={`Size ${s.label}`}
                >
                  {s.label}
                </button>
              ))}

              <div className="mx-1 h-4 w-px bg-zinc-700" />

              {/* Undo */}
              <button
                onClick={() => events.undoStroke()}
                disabled={!canUndo}
                className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
                title="Undo last stroke"
              >
                Undo
              </button>

              {/* Clear */}
              <button
                onClick={() => events.clearStrokes()}
                disabled={!hasStrokes}
                className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
                title="Clear all strokes"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </Panel>

      {/* SVG overlay for committed + in-progress strokes */}
      <svg className="pointer-events-none absolute inset-0 z-10" style={{ overflow: 'visible' }}>
        <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}>
          {strokes.map((stroke, i) => (
            <path
              key={i}
              d={getSvgPathFromStroke(
                getStroke(stroke.points, getStrokeOptions(stroke.size)),
              )}
              fill={stroke.color}
              opacity={0.7}
            />
          ))}
          {/* Live in-progress stroke */}
          <path ref={livePathRef} fill={strokeColor} opacity={0.7} />
        </g>
      </svg>

      {/* Transparent pointer capture overlay (only active in draw mode) */}
      {drawMode && (
        <div
          className="absolute inset-0 z-20 cursor-crosshair"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Run splitting — split events into separate runs by pattern_start boundaries
// ---------------------------------------------------------------------------

function splitIntoRuns(events: DebugEvent[]): DebugEvent[][] {
  const runs: DebugEvent[][] = []
  let current: DebugEvent[] = []
  let seenStart = false

  for (const e of events) {
    if (e.type === 'pattern_start') {
      // Only split when we've already seen a pattern_start before.
      // Pre-start events fold into the first run.
      if (seenStart && current.length > 0) {
        runs.push(current)
        current = []
      }
      seenStart = true
    }
    current.push(e)
  }

  if (current.length > 0) {
    runs.push(current)
  }

  return runs
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GraphView() {
  const system = useDevToolsSystem()
  const events = useSelector(system, (s) => s.facts.connection.events)
  const runs = useMemo(() => splitIntoRuns(events), [events])
  const [selectedRun, setSelectedRun] = useState<number | null>(null)
  const prevRunCountRef = useRef(runs.length)

  // Auto-advance to latest run when a new run starts
  useEffect(() => {
    if (runs.length > prevRunCountRef.current) {
      setSelectedRun(runs.length - 1)
    }
    prevRunCountRef.current = runs.length
  }, [runs.length])

  // Active run index: default to latest
  const activeRunIndex = selectedRun ?? runs.length - 1
  const activeEvents = runs[activeRunIndex] ?? []

  // ---- Playback ----
  const playbackSteps = useMemo(() => clusterEventsByTimestamp(activeEvents), [activeEvents])
  const playback = usePlayback({ totalSteps: playbackSteps.length })

  // Reset playback when switching runs
  useEffect(() => { playback.stop() }, [activeRunIndex])

  const graphData = useMemo(() => {
    if (activeEvents.length === 0) {
      return null
    }
    if (playback.step !== null && playbackSteps.length > 0) {
      return buildGraphUpToStep(activeEvents, playbackSteps, playback.step)
    }

    return buildGraphFromEvents(activeEvents)
  }, [activeEvents, playback.step, playbackSteps])

  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [panelExpanded, setPanelExpanded] = useState(false)

  const { initialNodes, initialEdges } = useMemo(() => {
    if (!graphData) {
      return { initialNodes: [] as Node[], initialEdges: [] as Edge[] }
    }

    const { flowNodes, flowEdges } = layoutGraph(graphData.nodes, graphData.edges)

    return { initialNodes: flowNodes, initialEdges: flowEdges }
  }, [graphData])

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

  const hasGraph = graphData && graphData.nodes.size > 0
  const selected = hasGraph && selectedNode ? graphData.nodes.get(selectedNode) : null

  // Combined run pager + playback controls
  const showPlayback = hasGraph && playback.totalSteps > 1
  const controlPanel = (runs.length > 1 || showPlayback) && (
    <div className="flex w-80 flex-col gap-1 rounded-lg border border-zinc-700 bg-zinc-900/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
      {/* Row 1: Run pager */}
      {runs.length > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          <button
            onClick={() => { playback.stop(); setSelectedRun(Math.max(0, activeRunIndex - 1)) }}
            disabled={activeRunIndex === 0}
            className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Prev
          </button>
          <span className="px-1 text-[10px] font-medium text-zinc-300">
            Run {activeRunIndex + 1} / {runs.length}
          </span>
          <button
            onClick={() => { playback.stop(); setSelectedRun(Math.min(runs.length - 1, activeRunIndex + 1)) }}
            disabled={activeRunIndex === runs.length - 1}
            className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}

      {/* Row 2+3: Playback controls + step label (only when graph is renderable) */}
      {showPlayback && (
        <PlaybackControls
          playback={playback}
          stepLabel={playback.step !== null && playbackSteps[playback.step] ? playbackSteps[playback.step].label : null}
        />
      )}
    </div>
  )

  if (events.length === 0) {
    return <EmptyState message="No events recorded yet." />
  }

  if (!hasGraph) {
    return (
      <div className="-mx-4 -mt-4 -mb-4 flex flex-col" style={{ height: 'calc(100% + 2rem)' }}>
        {controlPanel && <div className="flex justify-end p-2">{controlPanel}</div>}
        <div className="flex flex-1 items-center justify-center">
          <EmptyState message="No execution graph detected. Select a different run or run a query." />
        </div>
      </div>
    )
  }

  return (
    <div className="-mx-4 -mt-4 -mb-4 flex" style={{ height: 'calc(100% + 2rem)' }}>
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_e, node) => setSelectedNode(selectedNode === node.id ? null : node.id)}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          className="bg-zinc-950"
        >
          <Background color="#27272a" gap={20} />
          <Controls className="[&>button]:!border-zinc-700 [&>button]:!bg-zinc-800 [&>button]:!text-zinc-300" />
          <AutoFit nodeCount={nodes.length} />
          <DrawingOverlay />

          {/* Run pager */}
          {controlPanel && <Panel position="top-right" className="!m-2">{controlPanel}</Panel>}
        </ReactFlow>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className={`${panelExpanded ? 'w-1/2' : 'w-64'} shrink-0 overflow-auto border-l border-zinc-700 bg-zinc-900 p-3 transition-[width] duration-200`}>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-100">{selected.label}</h3>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPanelExpanded(!panelExpanded)}
                aria-label={panelExpanded ? 'Collapse detail panel' : 'Expand detail panel'}
                className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              >
                {panelExpanded ? '⇥' : '⇤'}
              </button>
              <button
                onClick={() => setSelectedNode(null)}
                aria-label="Close detail panel"
                className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-2 text-[11px]">
            {/* Status with color dot */}
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Status</span>
              <div className="flex items-center gap-1.5">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: STATUS_COLORS[selected.status] ?? STATUS_COLORS.pending }}
                />
                <span className="text-zinc-300">{selected.status}</span>
              </div>
            </div>

            {/* Virtual nodes only show status */}
            {!selected.isVirtual && (
              <>
                {selected.isTask && (
                  <DetailRow label="Type" value="Task" />
                )}
                {selected.isTask && selected.description && (
                  <div className="flex justify-between gap-2">
                    <span className="shrink-0 text-zinc-500">Description</span>
                    <span className="min-w-0 truncate text-zinc-300" title={selected.description}>
                      {selected.description}
                    </span>
                  </div>
                )}
                {selected.isTask && selected.progress !== null && selected.progress >= 0 && (
                  <DetailRow label="Progress" value={`${Math.round(selected.progress)}%`} />
                )}
                {selected.runs > 0 && selected.durationMs > 0 && (
                  <DetailRow
                    label="Avg Duration"
                    value={`${Math.round(selected.durationMs / selected.runs)}ms`}
                  />
                )}
                {selected.lastDurationMs > 0 && (
                  <DetailRow label="Last Duration" value={`${selected.lastDurationMs}ms`} />
                )}
                {!selected.isTask && selected.tokens > 0 && (
                  <DetailRow label="Total Tokens" value={selected.tokens.toLocaleString()} />
                )}
                {!selected.isTask && (selected.inputTokens > 0 || selected.outputTokens > 0) && (
                  <DetailRow
                    label="Input / Output"
                    value={`${selected.inputTokens.toLocaleString()} / ${selected.outputTokens.toLocaleString()}`}
                  />
                )}
                {!selected.isTask && selected.tokens > 0 && (
                  <DetailRow
                    label="Est. Cost"
                    value={(() => {
                      const pricing = getDefaultPricing(selected.modelId)
                      const cost =
                        (selected.inputTokens * pricing.input + selected.outputTokens * pricing.output) / 1_000_000

                      return formatCost(cost)
                    })()}
                  />
                )}
                {!selected.isTask && selected.modelId && (
                  <DetailRow label="Model" value={selected.modelId} />
                )}
                <DetailRow label="Runs" value={selected.runs} />
                {selected.deps.length > 0 && (
                  <DetailRow label="Dependencies" value={selected.deps.join(', ')} />
                )}
                {selected.lastError && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Last Error</span>
                    <span className="min-w-0 truncate text-red-400" title={selected.lastError}>
                      {selected.lastError}
                    </span>
                  </div>
                )}
                {selected.retries > 0 && (
                  <DetailRow label="Retries" value={selected.retries} />
                )}
              </>
            )}
          </div>

          {/* Agent instructions */}
          {selected.instructions && (
            <div className="mt-3 border-t border-zinc-700 pt-3">
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Instructions
              </div>
              <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded bg-zinc-800 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-300">
                {selected.instructions}
              </pre>
            </div>
          )}

          {/* Agent input */}
          {selected.lastInput && (
            <div className="mt-3 border-t border-zinc-700 pt-3">
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Input
              </div>
              <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded bg-zinc-800 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-300">
                {selected.lastInput}
              </pre>
            </div>
          )}

          {/* Agent output */}
          {selected.lastOutput && (
            <div className="mt-3 border-t border-zinc-700 pt-3">
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Output
              </div>
              <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded bg-zinc-800 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-300">
                {selected.lastOutput}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
