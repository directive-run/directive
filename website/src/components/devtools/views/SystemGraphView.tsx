'use client'

import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
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
import { graphDraw, type Stroke } from './graph-draw-module'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { EmptyState } from '../EmptyState'
import type {
  RuntimeConstraintInfo,
  RuntimeRequirementInfo,
  RuntimeResolverStats,
} from '../modules/devtools-runtime'
import type { RunChangelogEntry } from '@directive-run/core'

// ---------------------------------------------------------------------------
// Status colors & icons (matches GraphView palette)
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  completed: '#22c55e', // green
  running: '#f59e0b',   // amber
  error: '#ef4444',     // red
  pending: '#60a5fa',   // blue-400
  idle: '#71717a',      // zinc-500
}

const STATUS_ICONS: Record<string, string> = {
  completed: '●',
  running: '◉',
  error: '✕',
  pending: '◎',
  idle: '○',
}

// Node type colors — distinct color per pipeline stage
const TYPE_COLORS: Record<string, string> = {
  fact: '#38bdf8',        // sky-400
  derivation: '#a78bfa',  // violet-400
  constraint: '#f59e0b',  // amber-500
  requirement: '#60a5fa', // blue-400
  resolver: '#34d399',    // emerald-400
  effect: '#f472b6',      // pink-400
}

// ---------------------------------------------------------------------------
// Pipeline node types & status mapping
// ---------------------------------------------------------------------------

type PipelineNodeType = 'fact' | 'derivation' | 'constraint' | 'requirement' | 'resolver' | 'effect'

interface PipelineNodeData {
  label: string
  nodeType: PipelineNodeType
  status: string
  subtitle: string
  detail: Record<string, unknown>
  [key: string]: unknown
}

// Animation stage order — maps directly to PipelineNodeType
const STAGE_ORDER: PipelineNodeType[] = ['fact', 'derivation', 'constraint', 'requirement', 'resolver', 'effect']

// ---------------------------------------------------------------------------
// Value preview helper
// ---------------------------------------------------------------------------

function previewValue(v: unknown): string {
  if (v === null || v === undefined) {
    return String(v)
  }
  if (typeof v === 'string') {
    return v.length > 24 ? `"${v.slice(0, 21)}..."` : `"${v}"`
  }
  if (typeof v === 'number' || typeof v === 'boolean') {
    return String(v)
  }
  if (Array.isArray(v)) {
    return `Array(${v.length})`
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v)

    return keys.length <= 3 ? `{${keys.join(', ')}}` : `{${keys.slice(0, 3).join(', ')}, ...}`
  }

  return String(v)
}

// ---------------------------------------------------------------------------
// PipelineNode component
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<PipelineNodeType, string> = {
  fact: 'Fact',
  derivation: 'Derivation',
  constraint: 'Constraint',
  requirement: 'Requirement',
  resolver: 'Resolver',
  effect: 'Effect',
}

function PipelineNode({ data, selected }: NodeProps) {
  const { label, nodeType, status, subtitle } = data as PipelineNodeData
  const typeColor = TYPE_COLORS[nodeType] ?? '#71717a'
  const statusColor = STATUS_COLORS[status] ?? STATUS_COLORS.idle

  return (
    <div
      className={`cursor-pointer rounded-lg border-2 bg-zinc-900 px-4 py-3 shadow-lg transition-all ${
        selected ? 'ring-2 ring-white/30' : ''
      } ${status === 'running' ? 'motion-safe:animate-pulse' : ''}`}
      style={{ borderColor: typeColor }}
    >
      <Handle type="target" position={Position.Top} className="!h-0 !w-0 !border-0 !bg-transparent" />

      <div className="flex items-center gap-2">
        <span style={{ color: statusColor }} className="text-lg">{STATUS_ICONS[status] ?? '○'}</span>
        <div>
          <div className="text-sm font-medium text-zinc-100">{label}</div>
          <div className="text-[10px]" style={{ color: typeColor, opacity: 0.7 }}>
            {TYPE_LABELS[nodeType]}
            {subtitle && <> · <span className="text-zinc-500">{subtitle}</span></>}
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!h-0 !w-0 !border-0 !bg-transparent" />
    </div>
  )
}

const nodeTypes: NodeTypes = { pipeline: PipelineNode }

// ---------------------------------------------------------------------------
// Pipeline graph data types
// ---------------------------------------------------------------------------

interface PipelineGraphNode {
  id: string
  label: string
  nodeType: PipelineNodeType
  status: string
  subtitle: string
  deps: string[]
  detail: Record<string, unknown>
}

interface PipelineGraphEdge {
  source: string
  target: string
  dashed?: boolean
  label?: string
}

// ---------------------------------------------------------------------------
// Build pipeline graph from runtime data (live / cumulative view)
// ---------------------------------------------------------------------------

interface PipelineGraphResult {
  nodes: Map<string, PipelineGraphNode>
  edges: PipelineGraphEdge[]
  totalFacts: number
  totalDerivations: number
  shownFacts: number
  shownDerivations: number
  totalConstraints: number
  shownConstraints: number
  totalResolvers: number
  shownResolvers: number
}

function buildPipelineGraph(
  facts: Record<string, unknown>,
  derivations: Record<string, unknown>,
  constraints: RuntimeConstraintInfo[],
  inflight: RuntimeRequirementInfo[],
  unmet: RuntimeRequirementInfo[],
  resolverStats: Record<string, RuntimeResolverStats>,
): PipelineGraphResult {
  const nodes = new Map<string, PipelineGraphNode>()
  const edges: PipelineGraphEdge[] = []
  const factKeys = Object.keys(facts)
  const derivKeys = Object.keys(derivations)
  const allReqs = [...inflight, ...unmet]
  const resolverEntries = Object.entries(resolverStats)

  const shownConstraints = constraints.filter(c => c.active || c.hitCount > 0)
  const shownResolverEntries = resolverEntries.filter(([, s]) => s.count > 0 || s.errors > 0)

  const connectedDerivKeys = new Set<string>()

  for (const c of shownConstraints) {
    const status = c.active ? 'completed' : 'idle'
    const subtitleParts: string[] = []
    if (c.priority !== undefined) {
      subtitleParts.push(`p${c.priority}`)
    }
    if (c.hitCount > 0) {
      subtitleParts.push(`×${c.hitCount}`)
    }

    const deps: string[] = []
    const cName = c.id.toLowerCase()
    for (const dKey of derivKeys) {
      if (cName.includes(dKey.toLowerCase()) || dKey.toLowerCase().includes(cName)) {
        deps.push(`deriv-${dKey}`)
        connectedDerivKeys.add(dKey)
      }
    }

    nodes.set(`constraint-${c.id}`, {
      id: `constraint-${c.id}`,
      label: c.id,
      nodeType: 'constraint',
      status,
      subtitle: subtitleParts.join(' · '),
      deps,
      detail: {
        id: c.id,
        active: c.active,
        priority: c.priority,
        hitCount: c.hitCount,
        lastActiveAt: c.lastActiveAt,
      },
    })
  }

  for (const r of allReqs) {
    const status = r.status === 'inflight' ? 'running' : 'pending'
    const subtitleParts: string[] = [r.status]
    if (r.fromConstraint) {
      subtitleParts.push(`from ${r.fromConstraint}`)
    }

    const deps: string[] = []
    if (r.fromConstraint) {
      deps.push(`constraint-${r.fromConstraint}`)
    }

    nodes.set(`req-${r.id}`, {
      id: `req-${r.id}`,
      label: r.type,
      nodeType: 'requirement',
      status,
      subtitle: subtitleParts.join(' · '),
      deps,
      detail: {
        type: r.type,
        status: r.status,
        fromConstraint: r.fromConstraint,
      },
    })

    if (r.fromConstraint) {
      edges.push({
        source: `constraint-${r.fromConstraint}`,
        target: `req-${r.id}`,
      })
    }
  }

  const shownResolverKeys = shownResolverEntries.map(([k]) => k)
  for (const [key, stats] of shownResolverEntries) {
    const status = stats.errors > 0 && stats.count === 0 ? 'error' : 'completed'
    const subtitleParts: string[] = []
    if (stats.count > 0) {
      subtitleParts.push(`${stats.count} runs`)
      const avgMs = stats.totalMs / stats.count
      subtitleParts.push(`avg ${avgMs.toFixed(1)}ms`)
    }

    const deps: string[] = []
    const normalizedKey = key.toLowerCase().replace(/[_-]/g, '')
    for (const r of allReqs) {
      const reqType = r.type.toLowerCase().replace(/[_-]/g, '')
      if (normalizedKey === reqType || normalizedKey.includes(reqType) || reqType.includes(normalizedKey)) {
        deps.push(`req-${r.id}`)
        break
      }
    }

    nodes.set(`resolver-${key}`, {
      id: `resolver-${key}`,
      label: key,
      nodeType: 'resolver',
      status,
      subtitle: subtitleParts.join(' · '),
      deps,
      detail: {
        name: key,
        runs: stats.count,
        totalMs: stats.totalMs,
        avgMs: stats.count > 0 ? stats.totalMs / stats.count : 0,
        errors: stats.errors,
      },
    })
  }

  const connectedFactKeys = new Set<string>()

  for (const dKey of connectedDerivKeys) {
    nodes.set(`deriv-${dKey}`, {
      id: `deriv-${dKey}`,
      label: dKey,
      nodeType: 'derivation',
      status: 'completed',
      subtitle: previewValue(derivations[dKey]),
      deps: factKeys.includes(dKey) ? [`fact-${dKey}`] : [],
      detail: { key: dKey, value: derivations[dKey] },
    })

    if (factKeys.includes(dKey)) {
      connectedFactKeys.add(dKey)
    }
  }

  for (const fKey of connectedFactKeys) {
    nodes.set(`fact-${fKey}`, {
      id: `fact-${fKey}`,
      label: fKey,
      nodeType: 'fact',
      status: 'completed',
      subtitle: previewValue(facts[fKey]),
      deps: [],
      detail: { key: fKey, value: facts[fKey], type: typeof facts[fKey] },
    })
  }

  // Heuristic edges: requirement → resolver
  for (const r of allReqs) {
    const reqType = r.type.toLowerCase().replace(/[_-]/g, '')
    for (const resolverKey of shownResolverKeys) {
      const normalizedKey = resolverKey.toLowerCase().replace(/[_-]/g, '')
      if (normalizedKey === reqType || normalizedKey.includes(reqType) || reqType.includes(normalizedKey)) {
        edges.push({
          source: `req-${r.id}`,
          target: `resolver-${resolverKey}`,
          dashed: true,
        })
        break
      }
    }
  }

  // Heuristic edges: derivation → constraint
  for (const c of shownConstraints) {
    const cName = c.id.toLowerCase()
    for (const dKey of connectedDerivKeys) {
      if (cName.includes(dKey.toLowerCase()) || dKey.toLowerCase().includes(cName)) {
        edges.push({
          source: `deriv-${dKey}`,
          target: `constraint-${c.id}`,
          dashed: true,
        })
      }
    }
  }

  return {
    nodes,
    edges,
    totalFacts: factKeys.length,
    totalDerivations: derivKeys.length,
    shownFacts: connectedFactKeys.size,
    shownDerivations: connectedDerivKeys.size,
    totalConstraints: constraints.length,
    shownConstraints: shownConstraints.length,
    totalResolvers: resolverEntries.length,
    shownResolvers: shownResolverEntries.length,
  }
}

// ---------------------------------------------------------------------------
// Build pipeline graph from a single RunChangelogEntry
// Uses real dependency edges (E12) instead of heuristic name matching
// ---------------------------------------------------------------------------

function buildRunGraph(run: RunChangelogEntry): PipelineGraphResult {
  const nodes = new Map<string, PipelineGraphNode>()
  const edges: PipelineGraphEdge[] = []

  // Fact nodes — only keys from this run's factChanges
  for (const fc of run.factChanges) {
    nodes.set(`fact-${fc.key}`, {
      id: `fact-${fc.key}`,
      label: fc.key,
      nodeType: 'fact',
      status: 'completed',
      subtitle: `${previewValue(fc.oldValue)} → ${previewValue(fc.newValue)}`,
      deps: [],
      detail: { key: fc.key, oldValue: fc.oldValue, newValue: fc.newValue },
    })
  }

  // Derivation nodes — use real deps from E12, show old → new values
  for (const d of run.derivationsRecomputed) {
    const dId = typeof d === 'string' ? d : d.id
    const realDeps = typeof d === 'string' ? [] : d.deps
    const oldValue = typeof d === 'string' ? undefined : d.oldValue
    const newValue = typeof d === 'string' ? undefined : d.newValue

    // Link to fact nodes that exist in this run; fallback to all facts if deps empty
    let factDeps = realDeps
      .filter(dep => nodes.has(`fact-${dep}`))
      .map(dep => `fact-${dep}`)

    if (factDeps.length === 0 && run.factChanges.length > 0) {
      factDeps = run.factChanges.map(fc => `fact-${fc.key}`)
    }

    // Build subtitle with old → new values like facts
    let subtitle = 'recomputed'
    if (oldValue !== undefined || newValue !== undefined) {
      subtitle = `${previewValue(oldValue)} → ${previewValue(newValue)}`
    }

    nodes.set(`deriv-${dId}`, {
      id: `deriv-${dId}`,
      label: dId,
      nodeType: 'derivation',
      status: 'completed',
      subtitle,
      deps: factDeps,
      detail: { key: dId, deps: realDeps, oldValue, newValue },
    })

    for (const dep of factDeps) {
      edges.push({ source: dep, target: `deriv-${dId}`, dashed: true })
    }
  }

  // Constraint nodes — use real deps from E12
  for (const c of run.constraintsHit) {
    const realDeps = c.deps ?? []
    // Link to derivations or facts that exist
    const constraintDeps: string[] = []
    for (const dep of realDeps) {
      if (nodes.has(`deriv-${dep}`)) {
        constraintDeps.push(`deriv-${dep}`)
      } else if (nodes.has(`fact-${dep}`)) {
        constraintDeps.push(`fact-${dep}`)
      }
    }

    nodes.set(`constraint-${c.id}`, {
      id: `constraint-${c.id}`,
      label: c.id,
      nodeType: 'constraint',
      status: 'completed',
      subtitle: `p${c.priority}`,
      deps: constraintDeps,
      detail: { id: c.id, priority: c.priority, deps: realDeps },
    })

    for (const dep of constraintDeps) {
      edges.push({ source: dep, target: `constraint-${c.id}`, dashed: true })
    }
  }

  // Requirement nodes — derive status from resolver outcome
  const resolvedReqIds = new Set(run.resolversCompleted.map(r => r.requirementId))
  const erroredReqIds = new Set(run.resolversErrored.map(r => r.requirementId))

  for (const req of run.requirementsAdded) {
    let reqStatus: string = 'pending'
    if (resolvedReqIds.has(req.id)) {
      reqStatus = 'completed'
    } else if (erroredReqIds.has(req.id)) {
      reqStatus = 'error'
    } else if (run.resolversStarted.some(rs => rs.requirementId === req.id)) {
      reqStatus = 'running'
    }

    nodes.set(`req-${req.id}`, {
      id: `req-${req.id}`,
      label: req.type,
      nodeType: 'requirement',
      status: reqStatus,
      subtitle: `from ${req.fromConstraint}`,
      deps: [`constraint-${req.fromConstraint}`],
      detail: { type: req.type, status: reqStatus, fromConstraint: req.fromConstraint },
    })

    edges.push({
      source: `constraint-${req.fromConstraint}`,
      target: `req-${req.id}`,
    })
  }

  // Resolver nodes — unique key per requirement (M9)
  const completedMap = new Map(
    run.resolversCompleted.map(r => [r.requirementId, r]),
  )
  const erroredMap = new Map(
    run.resolversErrored.map(r => [r.requirementId, r]),
  )

  for (const rs of run.resolversStarted) {
    const completed = completedMap.get(rs.requirementId)
    const errored = erroredMap.get(rs.requirementId)

    let status: string
    let subtitle: string
    if (completed) {
      status = 'completed'
      subtitle = `${completed.duration.toFixed(0)}ms`
    } else if (errored) {
      status = 'error'
      subtitle = errored.error.slice(0, 40)
    } else {
      status = 'running'
      subtitle = 'in progress'
    }

    // Use resolver::requirementId as key to avoid collisions (M9)
    const nodeKey = `resolver-${rs.resolver}::${rs.requirementId}`
    nodes.set(nodeKey, {
      id: nodeKey,
      label: rs.resolver,
      nodeType: 'resolver',
      status,
      subtitle,
      deps: [`req-${rs.requirementId}`],
      detail: {
        name: rs.resolver,
        requirementId: rs.requirementId,
        ...(completed ? { duration: completed.duration } : {}),
        ...(errored ? { error: errored.error } : {}),
      },
    })

    edges.push({
      source: `req-${rs.requirementId}`,
      target: nodeKey,
      dashed: true,
    })
  }

  // Effect nodes — fan out to ALL fact changes (M2), use real triggeredBy deps
  for (const e of run.effectsRun) {
    const effectId = typeof e === 'string' ? e : e.id
    const triggeredBy = typeof e === 'string' ? [] : e.triggeredBy
    const hasError = run.effectErrors.some(err => err.id === effectId)

    // Use real triggeredBy deps, falling back to all fact changes
    const effectDeps = triggeredBy.length > 0
      ? triggeredBy.filter(dep => nodes.has(`fact-${dep}`)).map(dep => `fact-${dep}`)
      : run.factChanges.map(fc => `fact-${fc.key}`)

    nodes.set(`effect-${effectId}`, {
      id: `effect-${effectId}`,
      label: effectId,
      nodeType: 'effect',
      status: hasError ? 'error' : 'completed',
      subtitle: hasError ? 'error' : 'ran',
      deps: effectDeps,
      detail: {
        id: effectId,
        triggeredBy,
        error: run.effectErrors.find(err => err.id === effectId)?.error,
      },
    })

    // Fan out edges to all triggering facts (M2)
    for (const dep of effectDeps) {
      edges.push({
        source: dep,
        target: `effect-${effectId}`,
        dashed: true,
      })
    }
  }

  return {
    nodes,
    edges,
    totalFacts: run.factChanges.length,
    totalDerivations: run.derivationsRecomputed.length,
    shownFacts: run.factChanges.length,
    shownDerivations: run.derivationsRecomputed.length,
    totalConstraints: run.constraintsHit.length,
    shownConstraints: run.constraintsHit.length,
    totalResolvers: run.resolversStarted.length,
    shownResolvers: run.resolversStarted.length,
  }
}

// ---------------------------------------------------------------------------
// Layout: topological layer assignment + barycenter heuristic
// ---------------------------------------------------------------------------

function layoutPipeline(
  nodes: Map<string, PipelineGraphNode>,
  edges: PipelineGraphEdge[],
): { flowNodes: Node[]; flowEdges: Edge[] } {
  const nodeArray = Array.from(nodes.values())

  // Identify orphan nodes — not involved in any edge
  const connectedIds = new Set<string>()
  for (const edge of edges) {
    connectedIds.add(edge.source)
    connectedIds.add(edge.target)
  }

  const connectedNodes = nodeArray.filter(n => connectedIds.has(n.id))
  const orphanNodes = nodeArray.filter(n => !connectedIds.has(n.id))

  // --- Layout connected nodes ---
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
  for (const n of connectedNodes) {
    getLayer(n.id)
  }

  const layerGroups = new Map<number, string[]>()
  for (const n of connectedNodes) {
    const layer = layers.get(n.id) ?? 0
    if (!layerGroups.has(layer)) {
      layerGroups.set(layer, [])
    }
    layerGroups.get(layer)!.push(n.id)
  }

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

  // Compute rightmost x of connected nodes to position orphans
  let maxConnectedX = 400
  const flowNodes: Node[] = connectedNodes.map((n) => {
    const layer = layers.get(n.id) ?? 0
    const group = layerGroups.get(layer)!
    const indexInLayer = group.indexOf(n.id)
    const totalInLayer = group.length
    const xOffset = (indexInLayer - (totalInLayer - 1) / 2) * 250
    const x = 400 + xOffset
    if (x + 200 > maxConnectedX) {
      maxConnectedX = x + 200
    }

    return {
      id: n.id,
      type: 'pipeline',
      position: { x, y: 80 + layer * 150 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        label: n.label,
        nodeType: n.nodeType,
        status: n.status,
        subtitle: n.subtitle,
        detail: n.detail,
      },
    }
  })

  // Stack orphan nodes vertically on the right, sorted by type then name
  if (orphanNodes.length > 0) {
    const typeOrder: Record<string, number> = { fact: 0, derivation: 1, constraint: 2, requirement: 3, resolver: 4, effect: 5 }
    orphanNodes.sort((a, b) => {
      const ta = typeOrder[a.nodeType] ?? 99
      const tb = typeOrder[b.nodeType] ?? 99
      if (ta !== tb) {
        return ta - tb
      }

      return a.label.localeCompare(b.label)
    })

    const orphanX = maxConnectedX + 60
    for (let i = 0; i < orphanNodes.length; i++) {
      const n = orphanNodes[i]
      flowNodes.push({
        id: n.id,
        type: 'pipeline',
        position: { x: orphanX, y: 80 + i * 100 },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        data: {
          label: n.label,
          nodeType: n.nodeType,
          status: n.status,
          subtitle: n.subtitle,
          detail: n.detail,
        },
      })
    }
  }

  const flowEdges: Edge[] = edges.map((edge, i) => {
    const targetNode = nodes.get(edge.target)
    const isRunning = targetNode?.status === 'running'
    const edgeColor = TYPE_COLORS[targetNode?.nodeType ?? ''] ?? '#71717a'

    return {
      id: `${edge.source}->${edge.target}-${i}`,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      animated: isRunning,
      label: edge.label,
      style: {
        stroke: edgeColor,
        strokeWidth: 2,
        opacity: 0.6,
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
// AutoFit — re-fits viewport when node count changes
// ---------------------------------------------------------------------------

function AutoFit({ nodeCount }: { nodeCount: number }) {
  const { fitView } = useReactFlow()
  const prevCount = useRef(nodeCount)

  useEffect(() => {
    if (nodeCount !== prevCount.current) {
      prevCount.current = nodeCount
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

function DetailRow({ label, value, expandable }: { label: string; value: string | number | unknown; expandable?: boolean }) {
  const [expanded, setExpanded] = useState(false)

  if (expandable && value !== null && typeof value === 'object') {
    const preview = Array.isArray(value) ? `Array(${value.length})` : `Object`

    return (
      <div>
        <div className="flex justify-between">
          <span className="text-zinc-500">{label}</span>
          <button
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
            className="cursor-pointer text-zinc-400 hover:text-zinc-200"
          >
            {expanded ? '▼' : '▶'} {preview}
          </button>
        </div>
        {expanded && (
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-300">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </div>
    )
  }

  return (
    <div className="flex justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className="max-w-[140px] truncate text-zinc-300" title={String(value)}>{String(value)}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Run summary badge text
// ---------------------------------------------------------------------------

function runSummaryText(run: RunChangelogEntry): string {
  const parts: string[] = []
  if (run.factChanges.length > 0) {
    parts.push(`${run.factChanges.length} fact${run.factChanges.length !== 1 ? 's' : ''}`)
  }
  if (run.derivationsRecomputed.length > 0) {
    parts.push(`${run.derivationsRecomputed.length} derivation${run.derivationsRecomputed.length !== 1 ? 's' : ''}`)
  }
  if (run.constraintsHit.length > 0) {
    parts.push(`${run.constraintsHit.length} constraint${run.constraintsHit.length !== 1 ? 's' : ''}`)
  }
  if (run.requirementsAdded.length > 0) {
    parts.push(`${run.requirementsAdded.length} requirement${run.requirementsAdded.length !== 1 ? 's' : ''}`)
  }
  if (run.resolversStarted.length > 0) {
    parts.push(`${run.resolversStarted.length} resolver${run.resolversStarted.length !== 1 ? 's' : ''}`)
  }
  if (run.effectsRun.length > 0) {
    parts.push(`${run.effectsRun.length} effect${run.effectsRun.length !== 1 ? 's' : ''}`)
  }

  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// Run History Export/Import types (Part 7)
// ---------------------------------------------------------------------------

interface RunHistoryExport {
  version: 1
  systemName: string
  exportedAt: string
  runs: RunChangelogEntry[]
}

// ---------------------------------------------------------------------------
// Freehand drawing utilities (shared with GraphView)
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

    if (livePathRef.current) {
      livePathRef.current.setAttribute('d', '')
    }
  }, [events, strokeColor, strokeSize])

  return (
    <>
      {/* Drawing toolbar */}
      <Panel position="top-left" className="!m-2 !z-30">
        <div className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
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

          {drawMode && (
            <>
              <div className="mx-1 h-4 w-px bg-zinc-700" />

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

              <button
                onClick={() => events.undoStroke()}
                disabled={!canUndo}
                className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
                title="Undo last stroke"
              >
                Undo
              </button>

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
  const runHistory = useSelector(system, (s) => s.facts.runtime.runHistory) as RunChangelogEntry[]
  const systemName = useSelector(system, (s) => s.facts.runtime.systemName) as string
  const runHistoryEnabled = useSelector(system, (s) => s.facts.runtime.runHistoryEnabled)

  // Run pager: null = live (cumulative), number = specific run ID (M7)
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)

  // Imported run history (Part 7)
  const [importedRuns, setImportedRuns] = useState<RunChangelogEntry[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Animation state (Part 9)
  const [animationStep, setAnimationStep] = useState<number | null>(null)
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeRunHistory = importedRuns ?? runHistory

  // Compute derived state from run ID (M7)
  const isLive = selectedRunId === null
  const currentRunEntry = selectedRunId !== null
    ? activeRunHistory.find(r => r.id === selectedRunId) ?? null
    : null
  const selectedRunIndex = currentRunEntry
    ? activeRunHistory.indexOf(currentRunEntry)
    : -1

  // Reset selection if the run disappears (evicted or disconnected)
  useEffect(() => {
    if (selectedRunId !== null && !activeRunHistory.find(r => r.id === selectedRunId)) {
      setSelectedRunId(null)
    }
  }, [selectedRunId, activeRunHistory])

  // Keyboard navigation (M1)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (isLive && activeRunHistory.length > 0) {
          setSelectedRunId(activeRunHistory[activeRunHistory.length - 1].id)
        } else if (selectedRunIndex > 0) {
          setSelectedRunId(activeRunHistory[selectedRunIndex - 1].id)
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (!isLive && selectedRunIndex < activeRunHistory.length - 1) {
          setSelectedRunId(activeRunHistory[selectedRunIndex + 1].id)
        } else if (!isLive) {
          setSelectedRunId(null)
        }
      } else if (e.key === 'Escape' && !isLive) {
        e.preventDefault()
        setSelectedRunId(null)
      }
    }
    window.addEventListener('keydown', handler)

    return () => window.removeEventListener('keydown', handler)
  }, [isLive, selectedRunIndex, activeRunHistory])

  // Animation logic (Part 9)
  const startAnimation = useCallback(() => {
    setAnimationStep(0)
  }, [])

  const stopAnimation = useCallback(() => {
    if (animationTimerRef.current) {
      clearTimeout(animationTimerRef.current)
      animationTimerRef.current = null
    }
    setAnimationStep(null)
  }, [])

  useEffect(() => {
    if (animationStep === null) {
      return
    }

    if (animationStep >= STAGE_ORDER.length) {
      animationTimerRef.current = setTimeout(() => {
        setAnimationStep(null)
      }, 500)

      return () => {
        if (animationTimerRef.current) {
          clearTimeout(animationTimerRef.current)
        }
      }
    }

    animationTimerRef.current = setTimeout(() => {
      setAnimationStep(prev => (prev !== null ? prev + 1 : null))
    }, 500)

    return () => {
      if (animationTimerRef.current) {
        clearTimeout(animationTimerRef.current)
      }
    }
  }, [animationStep])

  // Export handler (Part 7)
  const handleExport = useCallback(() => {
    const exportData: RunHistoryExport = {
      version: 1,
      systemName: systemName || 'unknown',
      exportedAt: new Date().toISOString(),
      runs: activeRunHistory,
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${systemName || 'directive'}-runs.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [activeRunHistory, systemName])

  // Import handler (Part 7)
  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as RunHistoryExport
        if (data.version === 1 && Array.isArray(data.runs)) {
          setImportedRuns(data.runs)
          setSelectedRunId(null)
        }
      } catch {
        // Invalid file — ignore
      }
    }
    reader.readAsText(file)
    // Reset the input so the same file can be re-imported
    e.target.value = ''
  }, [])

  // Build graph from either a specific run or the live cumulative data
  const graphData = useMemo(() => {
    if (currentRunEntry) {
      return buildRunGraph(currentRunEntry)
    }

    return buildPipelineGraph(facts, derivations, constraints, inflight, unmet, resolverStats)
  }, [currentRunEntry, facts, derivations, constraints, inflight, unmet, resolverStats])

  const { initialNodes, initialEdges } = useMemo(() => {
    if (graphData.nodes.size === 0) {
      return { initialNodes: [] as Node[], initialEdges: [] as Edge[] }
    }

    const { flowNodes, flowEdges } = layoutPipeline(graphData.nodes, graphData.edges)

    // Apply animation styling (Part 9) — opacity only to avoid position shifts
    if (animationStep !== null) {
      for (const node of flowNodes) {
        const nodeType = (node.data as PipelineNodeData).nodeType
        const stageIdx = STAGE_ORDER.indexOf(nodeType)
        const isActive = stageIdx <= animationStep
        node.style = {
          opacity: isActive ? 1 : 0.1,
          transition: 'opacity 0.4s ease',
        }
      }

      for (const edge of flowEdges) {
        const targetNode = graphData.nodes.get(edge.target)
        if (targetNode) {
          const stageIdx = STAGE_ORDER.indexOf(targetNode.nodeType)
          const isActive = stageIdx <= animationStep
          edge.style = {
            ...edge.style,
            opacity: isActive ? 1 : 0.05,
            transition: 'opacity 0.4s ease',
          }
        }
      }
    }

    return { initialNodes: flowNodes, initialEdges: flowEdges }
  }, [graphData, animationStep])

  const [nodes, setNodes] = useState(initialNodes)
  const [graphEdges, setEdges] = useState(initialEdges)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)

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

  if (!connected) {
    return <EmptyState message="No Directive system connected" />
  }

  const isEmpty = Object.keys(facts).length === 0 && constraints.length === 0

  if (isEmpty) {
    return <EmptyState message="No graph data available" />
  }

  // If we have runHistory entries and we're in live mode, check for no activity
  const hasRunHistory = activeRunHistory.length > 0

  const selected = selectedNode ? graphData.nodes.get(selectedNode) : null
  const hiddenFacts = graphData.totalFacts - graphData.shownFacts
  const hiddenDerivations = graphData.totalDerivations - graphData.shownDerivations
  const hiddenConstraints = graphData.totalConstraints - graphData.shownConstraints
  const hiddenResolvers = graphData.totalResolvers - graphData.shownResolvers
  const hasHiddenNodes = isLive && (hiddenFacts > 0 || hiddenDerivations > 0 || hiddenConstraints > 0 || hiddenResolvers > 0)

  // Show empty state if no runs yet and no active pipeline (live mode with no constraints hit)
  if (isLive && !hasRunHistory) {
    if (!runHistoryEnabled) {
      // Don't fall through to "No runs yet" — the real issue is runHistory isn't enabled
    } else {
      const noActivityYet = graphData.totalConstraints > 0 && graphData.shownConstraints === 0 && inflight.length === 0 && unmet.length === 0
      if (noActivityYet) {
        return <EmptyState message="No runs yet. Interact with the system to see the pipeline." />
      }
    }
  }

  return (
    <div className="-mx-4 -mt-4 -mb-4 flex" style={{ height: 'calc(100% + 2rem)' }}>
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={graphEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_e, node) => setSelectedNode(selectedNode === node.id ? null : node.id)}
          nodesConnectable={false}
          nodesDraggable={false}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          className="bg-zinc-950"
        >
          <Background color="#27272a" gap={20} />
          <Controls className="[&>button]:!border-zinc-700 [&>button]:!bg-zinc-800 [&>button]:!text-zinc-300" />
          <AutoFit nodeCount={nodes.length} />
          <DrawingOverlay />

          {/* Run history enable message */}
          {!runHistoryEnabled && (
            <Panel position="top-right" className="!m-2">
              <div className="rounded border border-dashed border-zinc-200 px-3 py-2 text-center font-mono text-[10px] text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
                Enable <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">runHistory: true</code> in debug config for run history timeline
              </div>
            </Panel>
          )}

          {/* Run pager (M1: a11y) */}
          {runHistoryEnabled && (hasRunHistory || !isLive) && (
            <Panel position="top-right" className="!m-2">
              <nav aria-label="Run history navigation">
                <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
                  <button
                    aria-label="Previous run"
                    onClick={() => {
                      if (isLive && activeRunHistory.length > 0) {
                        setSelectedRunId(activeRunHistory[activeRunHistory.length - 1].id)
                      } else if (selectedRunIndex > 0) {
                        setSelectedRunId(activeRunHistory[selectedRunIndex - 1].id)
                      }
                    }}
                    disabled={!isLive && selectedRunIndex === 0}
                    className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Prev
                  </button>
                  <span className="px-1 text-[10px] font-medium text-zinc-300">
                    {isLive ? (
                      <>
                        Live
                        <span className="ml-1 text-emerald-400">●</span>
                      </>
                    ) : (
                      <>
                        Run {selectedRunIndex + 1} / {activeRunHistory.length}
                        {currentRunEntry?.status === 'pending' && (
                          <span className="ml-1 text-amber-400">◉</span>
                        )}
                        {currentRunEntry?.anomalies && currentRunEntry.anomalies.length > 0 && (
                          <span className="ml-1 text-red-400" title={currentRunEntry.anomalies.join(', ')}>!</span>
                        )}
                      </>
                    )}
                  </span>
                  <button
                    aria-label="Next run"
                    onClick={() => {
                      if (!isLive && selectedRunIndex < activeRunHistory.length - 1) {
                        setSelectedRunId(activeRunHistory[selectedRunIndex + 1].id)
                      } else {
                        setSelectedRunId(null)
                      }
                    }}
                    disabled={isLive}
                    className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Next
                  </button>
                  {!isLive && (
                    <button
                      aria-label="Return to live view"
                      onClick={() => setSelectedRunId(null)}
                      className="rounded px-1.5 py-0.5 text-[10px] text-emerald-400 transition-colors hover:bg-zinc-800"
                    >
                      Live
                    </button>
                  )}
                  {/* Animation play button (Part 9) */}
                  {currentRunEntry && (
                    animationStep !== null ? (
                      <button
                        aria-label="Stop animation"
                        onClick={stopAnimation}
                        className="rounded px-1.5 py-0.5 text-[10px] text-amber-400 transition-colors hover:bg-zinc-800"
                      >
                        Stop
                      </button>
                    ) : (
                      <button
                        aria-label="Play causal animation"
                        onClick={startAnimation}
                        className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                      >
                        Play
                      </button>
                    )
                  )}
                  {/* Export/Import buttons (Part 7) */}
                  <span className="mx-0.5 h-3 w-px bg-zinc-700" />
                  <button
                    aria-label="Export run history"
                    onClick={handleExport}
                    disabled={activeRunHistory.length === 0}
                    className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
                    title="Export run history as JSON"
                  >
                    Export
                  </button>
                  <button
                    aria-label="Import run history"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                    title="Import run history from JSON"
                  >
                    Import
                  </button>
                  {importedRuns && (
                    <button
                      aria-label="Clear imported data"
                      onClick={() => {
                        setImportedRuns(null)
                        setSelectedRunId(null)
                      }}
                      className="rounded px-1.5 py-0.5 text-[10px] text-red-400 transition-colors hover:bg-zinc-800"
                    >
                      Clear
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={handleImport}
                  />
                </div>
              </nav>
            </Panel>
          )}

          {/* Run summary badge with causal chain (Part 6) */}
          {currentRunEntry && (
            <Panel position="bottom-right" className="!m-2">
              <div className="max-w-md rounded-lg border border-zinc-700 bg-zinc-900/95 px-2.5 py-1.5 font-mono text-[10px] text-zinc-400 shadow-lg backdrop-blur-sm">
                <div>
                  Run {currentRunEntry.id}
                  {currentRunEntry.status === 'pending' && <span className="ml-1 text-amber-400">(pending)</span>}
                  {currentRunEntry.anomalies && currentRunEntry.anomalies.length > 0 && (
                    <span className="ml-1 text-red-400">(anomaly)</span>
                  )}
                  {' — '}
                  {runSummaryText(currentRunEntry)}
                </div>
                {currentRunEntry.causalChain && (
                  <div className="mt-1 truncate text-[9px] text-zinc-500" title={currentRunEntry.causalChain}>
                    {currentRunEntry.causalChain}
                  </div>
                )}
                {currentRunEntry.anomalies && currentRunEntry.anomalies.length > 0 && (
                  <div className="mt-1 text-[9px] text-red-400">
                    {currentRunEntry.anomalies.map((a, i) => (
                      <div key={i}>{a}</div>
                    ))}
                  </div>
                )}
              </div>
            </Panel>
          )}

          {/* Imported data badge */}
          {importedRuns && (
            <Panel position="top-left" className="!m-2">
              <div className="rounded-lg border border-amber-700/50 bg-amber-900/30 px-2.5 py-1.5 text-[10px] text-amber-300 shadow-lg backdrop-blur-sm">
                Viewing imported data ({importedRuns.length} runs)
              </div>
            </Panel>
          )}

          {/* Hidden nodes badge — bottom-left to avoid overlap with run summary */}
          {hasHiddenNodes && isLive && (
            <Panel position="bottom-left" className="!m-2">
              <div className="rounded-lg border border-zinc-700 bg-zinc-900/95 px-2.5 py-1.5 font-mono text-[10px] text-zinc-400 shadow-lg backdrop-blur-sm">
                {graphData.totalFacts} facts · {graphData.totalDerivations} derivations
                {hiddenConstraints > 0 && <> · {hiddenConstraints} constraints hidden</>}
                {hiddenResolvers > 0 && <> · {hiddenResolvers} resolvers hidden</>}
                <span className="ml-1 text-zinc-600">(showing active pipeline)</span>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-64 shrink-0 overflow-auto border-l border-zinc-700 bg-zinc-900 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-100">{selected.label}</h3>
            <button
              onClick={() => setSelectedNode(null)}
              aria-label="Close detail panel"
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            >
              ✕
            </button>
          </div>

          <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            {TYPE_LABELS[selected.nodeType]}
          </div>

          <div className="mt-3 space-y-2 text-[11px]">
            {/* Status with color dot */}
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Status</span>
              <div className="flex items-center gap-1.5">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: STATUS_COLORS[selected.status] ?? STATUS_COLORS.idle }}
                />
                <span className="text-zinc-300">{selected.status}</span>
              </div>
            </div>

            {/* Fact detail */}
            {selected.nodeType === 'fact' && (
              <>
                <DetailRow label="Key" value={String(selected.detail.key)} />
                {selected.detail.type !== undefined && (
                  <DetailRow label="Type" value={String(selected.detail.type)} />
                )}
                {selected.detail.oldValue !== undefined && (
                  <DetailRow label="Old Value" value={selected.detail.oldValue} expandable />
                )}
                {selected.detail.newValue !== undefined && (
                  <DetailRow label="New Value" value={selected.detail.newValue} expandable />
                )}
                {selected.detail.value !== undefined && (
                  <div className="mt-2 border-t border-zinc-700 pt-2">
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">Value</div>
                    <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded bg-zinc-800 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-300">
                      {JSON.stringify(selected.detail.value, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            )}

            {/* Derivation detail */}
            {selected.nodeType === 'derivation' && (
              <>
                <DetailRow label="Key" value={String(selected.detail.key)} />
                {selected.detail.oldValue !== undefined && (
                  <DetailRow label="Old Value" value={selected.detail.oldValue} expandable />
                )}
                {selected.detail.newValue !== undefined && (
                  <DetailRow label="New Value" value={selected.detail.newValue} expandable />
                )}
                {selected.detail.deps && Array.isArray(selected.detail.deps) && (selected.detail.deps as string[]).length > 0 && (
                  <DetailRow label="Deps" value={(selected.detail.deps as string[]).join(', ')} />
                )}
                {selected.detail.value !== undefined && (
                  <div className="mt-2 border-t border-zinc-700 pt-2">
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">Value</div>
                    <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded bg-zinc-800 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-300">
                      {JSON.stringify(selected.detail.value, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            )}

            {/* Constraint detail */}
            {selected.nodeType === 'constraint' && (
              <>
                <DetailRow label="ID" value={String(selected.detail.id)} />
                {selected.detail.active !== undefined && (
                  <DetailRow label="Active" value={selected.detail.active ? 'Yes' : 'No'} />
                )}
                {selected.detail.priority !== undefined && (
                  <DetailRow label="Priority" value={Number(selected.detail.priority)} />
                )}
                {selected.detail.hitCount !== undefined && (
                  <DetailRow label="Hit Count" value={Number(selected.detail.hitCount)} />
                )}
                {selected.detail.lastActiveAt && (
                  <DetailRow label="Last Active" value={new Date(selected.detail.lastActiveAt as number).toLocaleTimeString()} />
                )}
              </>
            )}

            {/* Requirement detail */}
            {selected.nodeType === 'requirement' && (
              <>
                <DetailRow label="Type" value={String(selected.detail.type)} />
                {selected.detail.status !== undefined && (
                  <DetailRow label="Status" value={String(selected.detail.status)} />
                )}
                {selected.detail.fromConstraint && (
                  <DetailRow label="From Constraint" value={String(selected.detail.fromConstraint)} />
                )}
              </>
            )}

            {/* Resolver detail */}
            {selected.nodeType === 'resolver' && (
              <>
                <DetailRow label="Name" value={String(selected.detail.name)} />
                {selected.detail.runs !== undefined && (
                  <DetailRow label="Runs" value={Number(selected.detail.runs)} />
                )}
                {Number(selected.detail.runs) > 0 && (
                  <>
                    <DetailRow label="Total Time" value={`${Number(selected.detail.totalMs).toFixed(0)}ms`} />
                    <DetailRow label="Avg Time" value={`${Number(selected.detail.avgMs).toFixed(1)}ms`} />
                  </>
                )}
                {selected.detail.duration !== undefined && (
                  <DetailRow label="Duration" value={`${Number(selected.detail.duration).toFixed(0)}ms`} />
                )}
                {Number(selected.detail.errors) > 0 && (
                  <DetailRow label="Errors" value={Number(selected.detail.errors)} />
                )}
                {selected.detail.error && (
                  <div className="mt-2 border-t border-zinc-700 pt-2">
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">Error</div>
                    <pre className="max-h-[100px] overflow-auto whitespace-pre-wrap rounded bg-zinc-800 px-2 py-1.5 text-[11px] leading-relaxed text-red-300">
                      {String(selected.detail.error)}
                    </pre>
                  </div>
                )}
              </>
            )}

            {/* Effect detail */}
            {selected.nodeType === 'effect' && (
              <>
                <DetailRow label="ID" value={String(selected.detail.id)} />
                {selected.detail.error && (
                  <div className="mt-2 border-t border-zinc-700 pt-2">
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">Error</div>
                    <pre className="max-h-[100px] overflow-auto whitespace-pre-wrap rounded bg-zinc-800 px-2 py-1.5 text-[11px] leading-relaxed text-red-300">
                      {String(selected.detail.error)}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
