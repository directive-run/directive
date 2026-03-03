"use client";

import { AppWindow, Plug, Robot } from "@phosphor-icons/react";
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
    id: "framework",
    label: "Agent Framework",
    colorScheme: "primary" as const,
  },
  { id: "adapter", label: "Directive AI", colorScheme: "amber" as const },
  { id: "app", label: "Application", colorScheme: "emerald" as const },
] as const;

const ANIMATION_STEPS = [
  "framework",
  "arrow1",
  "adapter",
  "arrow2",
  "app",
] as const;

const NODE_WIDTH = 440;
const ROW_GAP = 200;

export const AiArchitectureDiagram = memo(function AiArchitectureDiagram() {
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

  const nodes = useMemo<Node[]>(
    () => [
      {
        id: "framework",
        type: "step",
        position: { x: 0, y: 0 },
        style: { width: NODE_WIDTH },
        data: {
          label: "Your Agent Framework",
          subtitle: "OpenAI, Anthropic, etc.",
          icon: <Robot size={28} weight="duotone" />,
          status: isStepActive("framework") ? "active" : "idle",
          colorScheme: STEPS[0].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "adapter",
        type: "step",
        position: { x: 0, y: ROW_GAP },
        style: { width: NODE_WIDTH },
        data: {
          label: "Directive AI Adapter",
          subtitle: "Guardrails, orchestration, streaming",
          icon: <Plug size={28} weight="duotone" />,
          status: isStepActive("adapter") ? "active" : "idle",
          colorScheme: STEPS[1].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "app",
        type: "step",
        position: { x: 0, y: ROW_GAP * 2 },
        style: { width: NODE_WIDTH },
        data: {
          label: "Your Application",
          subtitle: "React, Next.js, Node, etc.",
          icon: <AppWindow size={28} weight="duotone" />,
          status: isStepActive("app") ? "active" : "idle",
          colorScheme: STEPS[2].colorScheme,
        } satisfies StepNodeData,
      },
    ],
    [isStepActive],
  );

  const edges = useMemo<Edge[]>(
    () => [
      {
        id: "framework->adapter",
        source: "framework",
        sourceHandle: "bottom",
        target: "adapter",
        targetHandle: "top",
        type: "labeled",
        data: { active: isArrowActive("arrow1"), colorScheme: "primary" },
      },
      {
        id: "adapter->app",
        source: "adapter",
        sourceHandle: "bottom",
        target: "app",
        targetHandle: "top",
        type: "labeled",
        data: { active: isArrowActive("arrow2"), colorScheme: "amber" },
      },
    ],
    [isArrowActive],
  );

  return (
    <div className="ai-architecture-diagram">
      <DiagramWrapper
        height={480}
        className="diagram-compact"
        nodes={nodes}
        edges={edges}
        nodeTypes={diagramNodeTypes}
        edgeTypes={diagramEdgeTypes}
        fitViewOptions={{ padding: 0.3 }}
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
