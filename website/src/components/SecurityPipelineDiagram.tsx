'use client'

import { memo, useMemo, useCallback } from 'react'
import type { Node, Edge } from '@xyflow/react'
import {
  UserCircle,
  ShieldWarning,
  Fingerprint,
  Robot,
  MagnifyingGlass,
  ClipboardText,
} from '@phosphor-icons/react'
import {
  DiagramWrapper,
  DiagramToolbar,
  useAnimationLoop,
  diagramNodeTypes,
  diagramEdgeTypes,
  type StepNodeData,
} from './diagrams'

const STEPS = [
  { id: 'input', label: 'User Input', colorScheme: 'primary' as const },
  { id: 'injection', label: 'Injection Detection', colorScheme: 'red' as const },
  { id: 'pii', label: 'PII Detection', colorScheme: 'amber' as const },
  { id: 'execution', label: 'Agent Execution', colorScheme: 'emerald' as const },
  { id: 'outputScan', label: 'Output PII Scan', colorScheme: 'amber' as const },
  { id: 'audit', label: 'Audit Trail', colorScheme: 'violet' as const },
] as const

const ANIMATION_STEPS = [
  'input', 'arrow1',
  'injection', 'arrow2',
  'pii', 'arrow3',
  'execution', 'arrow4',
  'outputScan', 'arrow5',
  'audit',
] as const

const NODE_WIDTH = 440
const ROW_GAP = 180

export const SecurityPipelineDiagram = memo(function SecurityPipelineDiagram() {
  const { phase, isPlaying, toggle } = useAnimationLoop({
    totalPhases: ANIMATION_STEPS.length,
    interval: 2000,
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

  const nodes = useMemo<Node[]>(() => [
    {
      id: 'input',
      type: 'step',
      position: { x: 0, y: 0 },
      style: { width: NODE_WIDTH },
      data: {
        label: 'User Input',
        subtitle: 'Natural language prompt',
        icon: <UserCircle size={28} weight="duotone" />,
        status: isStepActive('input') ? 'active' : 'idle',
        colorScheme: STEPS[0].colorScheme,
      } satisfies StepNodeData,
    },
    {
      id: 'injection',
      type: 'step',
      position: { x: 0, y: ROW_GAP },
      style: { width: NODE_WIDTH },
      data: {
        label: 'Prompt Injection Detection',
        subtitle: 'Block jailbreaks and overrides',
        icon: <ShieldWarning size={28} weight="duotone" />,
        status: isStepActive('injection') ? 'active' : 'idle',
        colorScheme: STEPS[1].colorScheme,
      } satisfies StepNodeData,
    },
    {
      id: 'pii',
      type: 'step',
      position: { x: 0, y: ROW_GAP * 2 },
      style: { width: NODE_WIDTH },
      data: {
        label: 'PII Detection',
        subtitle: 'Redact personal information',
        icon: <Fingerprint size={28} weight="duotone" />,
        status: isStepActive('pii') ? 'active' : 'idle',
        colorScheme: STEPS[2].colorScheme,
      } satisfies StepNodeData,
    },
    {
      id: 'execution',
      type: 'step',
      position: { x: 0, y: ROW_GAP * 3 },
      style: { width: NODE_WIDTH },
      data: {
        label: 'Agent Execution',
        subtitle: 'LLM call with guardrails',
        icon: <Robot size={28} weight="duotone" />,
        status: isStepActive('execution') ? 'active' : 'idle',
        colorScheme: STEPS[3].colorScheme,
      } satisfies StepNodeData,
    },
    {
      id: 'outputScan',
      type: 'step',
      position: { x: 0, y: ROW_GAP * 4 },
      style: { width: NODE_WIDTH },
      data: {
        label: 'Output PII Scan',
        subtitle: 'Scan response for leaks',
        icon: <MagnifyingGlass size={28} weight="duotone" />,
        status: isStepActive('outputScan') ? 'active' : 'idle',
        colorScheme: STEPS[4].colorScheme,
      } satisfies StepNodeData,
    },
    {
      id: 'audit',
      type: 'step',
      position: { x: 0, y: ROW_GAP * 5 },
      style: { width: NODE_WIDTH },
      data: {
        label: 'Audit Trail',
        subtitle: 'Tamper-evident logging',
        icon: <ClipboardText size={28} weight="duotone" />,
        status: isStepActive('audit') ? 'active' : 'idle',
        colorScheme: STEPS[5].colorScheme,
      } satisfies StepNodeData,
    },
  ], [isStepActive])

  const edges = useMemo<Edge[]>(() => [
    {
      id: 'input->injection',
      source: 'input',
      sourceHandle: 'bottom',
      target: 'injection',
      targetHandle: 'top',
      type: 'labeled',
      data: { active: isArrowActive('arrow1'), colorScheme: 'primary' },
    },
    {
      id: 'injection->pii',
      source: 'injection',
      sourceHandle: 'bottom',
      target: 'pii',
      targetHandle: 'top',
      type: 'labeled',
      data: { active: isArrowActive('arrow2'), colorScheme: 'red' },
    },
    {
      id: 'pii->execution',
      source: 'pii',
      sourceHandle: 'bottom',
      target: 'execution',
      targetHandle: 'top',
      type: 'labeled',
      data: { active: isArrowActive('arrow3'), colorScheme: 'amber' },
    },
    {
      id: 'execution->outputScan',
      source: 'execution',
      sourceHandle: 'bottom',
      target: 'outputScan',
      targetHandle: 'top',
      type: 'labeled',
      data: { active: isArrowActive('arrow4'), colorScheme: 'emerald' },
    },
    {
      id: 'outputScan->audit',
      source: 'outputScan',
      sourceHandle: 'bottom',
      target: 'audit',
      targetHandle: 'top',
      type: 'labeled',
      data: { active: isArrowActive('arrow5'), colorScheme: 'amber' },
    },
  ], [isArrowActive])

  return (
    <div className="security-pipeline-diagram">
      <DiagramWrapper
        height={740}
        className="diagram-semi-compact"
        nodes={nodes}
        edges={edges}
        nodeTypes={diagramNodeTypes}
        edgeTypes={diagramEdgeTypes}
        fitViewOptions={{ padding: 0.15 }}
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
