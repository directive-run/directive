"use client";

import { Database, Funnel, GearSix, ListChecks } from "@phosphor-icons/react";
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
    id: "facts",
    label: "Facts",
    subtitle: "state",
    colorScheme: "primary" as const,
  },
  {
    id: "constraints",
    label: "Constraints",
    subtitle: "when condition",
    colorScheme: "amber" as const,
  },
  {
    id: "requirements",
    label: "Requirements",
    subtitle: "what to do",
    colorScheme: "violet" as const,
  },
  {
    id: "resolvers",
    label: "Resolvers",
    subtitle: "how to do it",
    colorScheme: "emerald" as const,
  },
] as const;

const ANIMATION_STEPS = [
  "facts",
  "arrow1",
  "constraints",
  "arrow2",
  "requirements",
  "arrow3",
  "resolvers",
  "return",
] as const;

export const ConstraintFlowDiagram = memo(function ConstraintFlowDiagram() {
  const { phase, isPlaying, toggle } = useAnimationLoop({
    totalPhases: ANIMATION_STEPS.length,
    interval: 3000,
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

  // 2x2 grid layout:
  //   Facts ---------> Constraints
  //     ^                   |
  //     |                   v
  //   Resolvers <------ Requirements
  const nodes = useMemo<Node[]>(
    () => [
      {
        id: "facts",
        type: "step",
        position: { x: 0, y: 0 },
        style: { width: 280 },
        data: {
          label: STEPS[0].label,
          subtitle: STEPS[0].subtitle,
          icon: <Database size={28} weight="duotone" />,

          status: isStepActive("facts") ? "active" : "idle",
          colorScheme: STEPS[0].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "constraints",
        type: "step",
        position: { x: 440, y: 0 },
        style: { width: 280 },
        data: {
          label: STEPS[1].label,
          subtitle: STEPS[1].subtitle,
          icon: <Funnel size={28} weight="duotone" />,

          status: isStepActive("constraints") ? "active" : "idle",
          colorScheme: STEPS[1].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "requirements",
        type: "step",
        position: { x: 440, y: 280 },
        style: { width: 280 },
        data: {
          label: STEPS[2].label,
          subtitle: STEPS[2].subtitle,
          icon: <ListChecks size={28} weight="duotone" />,

          status: isStepActive("requirements") ? "active" : "idle",
          colorScheme: STEPS[2].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "resolvers",
        type: "step",
        position: { x: 0, y: 280 },
        style: { width: 280 },
        data: {
          label: STEPS[3].label,
          subtitle: STEPS[3].subtitle,
          icon: <GearSix size={28} weight="duotone" />,

          status: isStepActive("resolvers") ? "active" : "idle",
          colorScheme: STEPS[3].colorScheme,
        } satisfies StepNodeData,
      },
    ],
    [isStepActive],
  );

  // Clockwise: Facts→Constraints→Requirements→Resolvers→Facts
  const edges = useMemo<Edge[]>(
    () => [
      {
        // Top row: Facts (right) → Constraints (left) — default handles
        id: "facts->constraints",
        source: "facts",
        target: "constraints",
        type: "labeled",
        data: {
          label: "change",
          active: isArrowActive("arrow1"),
          colorScheme: "primary",
        },
      },
      {
        // Right side: Constraints (bottom) → Requirements (top) — default vertical handles
        id: "constraints->requirements",
        source: "constraints",
        sourceHandle: "bottom",
        target: "requirements",
        targetHandle: "top",
        type: "labeled",
        data: {
          label: "require",
          active: isArrowActive("arrow2"),
          colorScheme: "amber",
        },
      },
      {
        // Bottom row: Requirements (left) → Resolvers (right) — reverse handles
        id: "requirements->resolvers",
        source: "requirements",
        sourceHandle: "left-source",
        target: "resolvers",
        targetHandle: "right-target",
        type: "labeled",
        data: {
          label: "resolve",
          active: isArrowActive("arrow3"),
          colorScheme: "violet",
        },
      },
      {
        // Left side: Resolvers (top) → Facts (bottom) — reverse handles
        id: "resolvers->facts",
        source: "resolvers",
        sourceHandle: "top-source",
        target: "facts",
        targetHandle: "bottom-target",
        type: "labeled",
        data: {
          label: "update facts",
          active: isArrowActive("return"),
          colorScheme: "emerald",
        },
      },
    ],
    [isArrowActive],
  );

  const activeStepId = phase >= 0 ? ANIMATION_STEPS[phase] : null;

  return (
    <div className="constraint-diagram">
      <DiagramWrapper
        height={420}
        nodes={nodes}
        edges={edges}
        nodeTypes={diagramNodeTypes}
        edgeTypes={diagramEdgeTypes}
      />

      <DiagramToolbar
        steps={STEPS}
        activeStepId={
          typeof activeStepId === "string" &&
          STEPS.some((s) => s.id === activeStepId)
            ? activeStepId
            : null
        }
        isPlaying={isPlaying}
        onToggle={toggle}
      />
    </div>
  );
});
