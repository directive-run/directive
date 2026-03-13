"use client";

import {
  Fingerprint,
  Robot,
  ShieldCheck,
  ShieldWarning,
  TextAa,
} from "@phosphor-icons/react";
import type { Edge, Node } from "@xyflow/react";
import { memo, useCallback, useMemo } from "react";
import {
  DiagramToolbar,
  DiagramWrapper,
  type StepNodeData,
  diagramEdgeTypes,
  diagramNodeTypes,
  useAnimationLoop,
} from "./diagrams";

const STEPS = [
  {
    id: "input",
    label: "Raw Input",
    subtitle: "user prompt",
    colorScheme: "primary" as const,
  },
  {
    id: "injection",
    label: "Injection Check",
    subtitle: "validate",
    colorScheme: "red" as const,
  },
  {
    id: "pii",
    label: "PII Redaction",
    subtitle: "redact",
    colorScheme: "amber" as const,
  },
  {
    id: "execution",
    label: "Agent Execution",
    subtitle: "execute",
    colorScheme: "emerald" as const,
  },
  {
    id: "output",
    label: "Output Validation",
    subtitle: "verify",
    colorScheme: "violet" as const,
  },
] as const;

const ANIMATION_STEPS = [
  "input",
  "arrow1",
  "injection",
  "arrow2",
  "pii",
  "arrow3",
  "execution",
  "arrow4",
  "output",
] as const;

const NODE_WIDTH = 440;
const ROW_GAP = 280;

export const GuardrailFlowDiagram = memo(function GuardrailFlowDiagram() {
  const { phase, isPlaying, toggle } = useAnimationLoop({
    totalPhases: ANIMATION_STEPS.length,
    interval: 2400,
  });

  const currentStepName = phase >= 0 ? ANIMATION_STEPS[phase] : null;

  const isStepActive = useCallback(
    (stepId: string) => currentStepName === stepId,
    [currentStepName],
  );

  const isArrowActive = useCallback(
    (arrowId: string) => currentStepName === arrowId,
    [currentStepName],
  );

  // Vertical layout (top-down):
  //   Raw Input
  //       ↓ validate
  //   Injection Check
  //       ↓ redact
  //   PII Redaction
  //       ↓ execute
  //   Agent Execution
  //       ↓ verify
  //   Output Validation
  const nodes = useMemo<Node[]>(
    () => [
      {
        id: "input",
        type: "step",
        position: { x: 0, y: 0 },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[0].label,
          subtitle: STEPS[0].subtitle,
          icon: <TextAa size={28} weight="duotone" />,
          status: isStepActive("input") ? "active" : "idle",
          colorScheme: STEPS[0].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "injection",
        type: "step",
        position: { x: 0, y: ROW_GAP },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[1].label,
          subtitle: STEPS[1].subtitle,
          icon: <ShieldWarning size={28} weight="duotone" />,
          status: isStepActive("injection") ? "active" : "idle",
          colorScheme: STEPS[1].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "pii",
        type: "step",
        position: { x: 0, y: ROW_GAP * 2 },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[2].label,
          subtitle: STEPS[2].subtitle,
          icon: <Fingerprint size={28} weight="duotone" />,
          status: isStepActive("pii") ? "active" : "idle",
          colorScheme: STEPS[2].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "execution",
        type: "step",
        position: { x: 0, y: ROW_GAP * 3 },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[3].label,
          subtitle: STEPS[3].subtitle,
          icon: <Robot size={28} weight="duotone" />,
          status: isStepActive("execution") ? "active" : "idle",
          colorScheme: STEPS[3].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "output",
        type: "step",
        position: { x: 0, y: ROW_GAP * 4 },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[4].label,
          subtitle: STEPS[4].subtitle,
          icon: <ShieldCheck size={28} weight="duotone" />,
          status: isStepActive("output") ? "active" : "idle",
          colorScheme: STEPS[4].colorScheme,
        } satisfies StepNodeData,
      },
    ],
    [isStepActive],
  );

  const edges = useMemo<Edge[]>(
    () => [
      {
        id: "input->injection",
        source: "input",
        sourceHandle: "bottom",
        target: "injection",
        targetHandle: "top",
        type: "labeled",
        data: {
          label: "validate",
          active: isArrowActive("arrow1"),
          colorScheme: "primary",
        },
      },
      {
        id: "injection->pii",
        source: "injection",
        sourceHandle: "bottom",
        target: "pii",
        targetHandle: "top",
        type: "labeled",
        data: {
          label: "redact",
          active: isArrowActive("arrow2"),
          colorScheme: "red",
        },
      },
      {
        id: "pii->execution",
        source: "pii",
        sourceHandle: "bottom",
        target: "execution",
        targetHandle: "top",
        type: "labeled",
        data: {
          label: "execute",
          active: isArrowActive("arrow3"),
          colorScheme: "amber",
        },
      },
      {
        id: "execution->output",
        source: "execution",
        sourceHandle: "bottom",
        target: "output",
        targetHandle: "top",
        type: "labeled",
        data: {
          label: "verify",
          active: isArrowActive("arrow4"),
          colorScheme: "emerald",
        },
      },
    ],
    [isArrowActive],
  );

  return (
    <div className="guardrail-flow-diagram">
      <DiagramWrapper
        height={900}
        className="diagram-semi-compact"
        nodes={nodes}
        edges={edges}
        nodeTypes={diagramNodeTypes}
        edgeTypes={diagramEdgeTypes}
        fitViewOptions={{ padding: 0.15 }}
      />

      <DiagramToolbar
        steps={STEPS}
        activeStepId={phase >= 0 ? (ANIMATION_STEPS[phase] ?? null) : null}
        isPlaying={isPlaying}
        onToggle={toggle}
      />
    </div>
  );
});
