'use client'

import { memo, useMemo, useCallback } from 'react'
import type { Node, Edge } from '@xyflow/react'
import {
  DiagramWrapper,
  DiagramToolbar,
  useAnimationLoop,
  diagramNodeTypes,
  diagramEdgeTypes,
  type StepNodeData,
} from './diagrams'

const STEPS = [
  { id: 'define', label: 'Define', subtitle: 'createModule()', colorScheme: 'slate' as const },
  { id: 'init', label: 'Init', subtitle: 'schema + init()', colorScheme: 'primary' as const },
  { id: 'start', label: 'Start', subtitle: 'constraints activate', colorScheme: 'amber' as const },
  { id: 'running', label: 'Running', subtitle: 'reconciliation loop', colorScheme: 'emerald' as const },
  { id: 'stopping', label: 'Stopping', subtitle: 'teardown effects', colorScheme: 'violet' as const },
  { id: 'stopped', label: 'Stopped', subtitle: 'cleanup complete', colorScheme: 'red' as const },
] as const

const ANIMATION_STEPS = [
  'define', 'arrow1',
  'init', 'arrow2',
  'start', 'arrow3',
  'running', 'arrow4',
  'stopping', 'arrow5',
  'stopped',
] as const

const NODE_WIDTH = 300
const ROW_GAP = 300
const COL_GAP = 500

export const ModuleLifecycleDiagram = memo(function ModuleLifecycleDiagram() {
  const { phase, isPlaying, toggle } = useAnimationLoop({
    totalPhases: ANIMATION_STEPS.length,
    interval: 2400,
  })

  const currentStepName = phase >= 0 ? ANIMATION_STEPS[phase] : null

  const isStepActive = useCallback(
    (stepId: string) => currentStepName === stepId,
    [currentStepName],
  )

  const isArrowActive = useCallback(
    (arrowId: string) => currentStepName === arrowId,
    [currentStepName],
  )

  // Layout: 2 columns, 3 rows going down-left, down-right zigzag
  //   Row 0:  Define (left)    →  Init (right)
  //   Row 1:  Start (left)     ←
  //   Row 2:                      Running (right)
  //   Row 3:  Stopped (left)   ←  Stopping (right)
  const nodes = useMemo<Node[]>(() => [
    {
      id: 'define',
      type: 'step',
      position: { x: 0, y: 0 },
      style: { width: NODE_WIDTH },
      data: {
        label: STEPS[0].label,
        subtitle: STEPS[0].subtitle,
        status: isStepActive('define') ? 'active' : 'idle',
        colorScheme: STEPS[0].colorScheme,
      } satisfies StepNodeData,
    },
    {
      id: 'init',
      type: 'step',
      position: { x: COL_GAP, y: 0 },
      style: { width: NODE_WIDTH },
      data: {
        label: STEPS[1].label,
        subtitle: STEPS[1].subtitle,
        status: isStepActive('init') ? 'active' : 'idle',
        colorScheme: STEPS[1].colorScheme,
      } satisfies StepNodeData,
    },
    {
      id: 'start',
      type: 'step',
      position: { x: 0, y: ROW_GAP },
      style: { width: NODE_WIDTH },
      data: {
        label: STEPS[2].label,
        subtitle: STEPS[2].subtitle,
        status: isStepActive('start') ? 'active' : 'idle',
        colorScheme: STEPS[2].colorScheme,
      } satisfies StepNodeData,
    },
    {
      id: 'running',
      type: 'step',
      position: { x: COL_GAP, y: ROW_GAP },
      style: { width: NODE_WIDTH },
      data: {
        label: STEPS[3].label,
        subtitle: STEPS[3].subtitle,
        status: isStepActive('running') ? 'active' : 'idle',
        colorScheme: STEPS[3].colorScheme,
      } satisfies StepNodeData,
    },
    {
      id: 'stopping',
      type: 'step',
      position: { x: COL_GAP, y: ROW_GAP * 2 },
      style: { width: NODE_WIDTH },
      data: {
        label: STEPS[4].label,
        subtitle: STEPS[4].subtitle,
        status: isStepActive('stopping') ? 'active' : 'idle',
        colorScheme: STEPS[4].colorScheme,
      } satisfies StepNodeData,
    },
    {
      id: 'stopped',
      type: 'step',
      position: { x: 0, y: ROW_GAP * 2 },
      style: { width: NODE_WIDTH },
      data: {
        label: STEPS[5].label,
        subtitle: STEPS[5].subtitle,
        status: isStepActive('stopped') ? 'active' : 'idle',
        colorScheme: STEPS[5].colorScheme,
      } satisfies StepNodeData,
    },
  ], [isStepActive])

  const edges = useMemo<Edge[]>(() => [
    {
      // Define → Init (right)
      id: 'define->init',
      source: 'define',
      target: 'init',
      type: 'labeled',
      data: { label: 'create', active: isArrowActive('arrow1') },
    },
    {
      // Init → Start (down-left)
      id: 'init->start',
      source: 'init',
      sourceHandle: 'bottom',
      target: 'start',
      targetHandle: 'top',
      type: 'labeled',
      data: { label: 'initialize', active: isArrowActive('arrow2') },
    },
    {
      // Start → Running (right)
      id: 'start->running',
      source: 'start',
      target: 'running',
      type: 'labeled',
      data: { label: 'activate', active: isArrowActive('arrow3') },
    },
    {
      // Running → Stopping (down)
      id: 'running->stopping',
      source: 'running',
      sourceHandle: 'bottom',
      target: 'stopping',
      targetHandle: 'top',
      type: 'labeled',
      data: { label: 'stop()', active: isArrowActive('arrow4') },
    },
    {
      // Stopping → Stopped (left)
      id: 'stopping->stopped',
      source: 'stopping',
      sourceHandle: 'left-source',
      target: 'stopped',
      targetHandle: 'right-target',
      type: 'labeled',
      data: { label: 'done', active: isArrowActive('arrow5') },
    },
  ], [isArrowActive])

  return (
    <div className="module-lifecycle-diagram">
      <DiagramWrapper
        height={640}
        nodes={nodes}
        edges={edges}
        nodeTypes={diagramNodeTypes}
        edgeTypes={diagramEdgeTypes}
      />

      <DiagramToolbar
        steps={STEPS}
        activeStepId={phase >= 0 ? ANIMATION_STEPS[phase] ?? null : null}
        isPlaying={isPlaying}
        onToggle={toggle}
      />
    </div>
  )
})
