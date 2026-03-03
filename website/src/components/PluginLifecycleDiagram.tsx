"use client";

import {
  ArrowsClockwise,
  Database,
  Function as FunctionIcon,
  Play,
  Stop,
  Wrench,
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
    id: "onInit",
    label: "onInit",
    subtitle: "system created",
    colorScheme: "slate" as const,
  },
  {
    id: "onStart",
    label: "onStart",
    subtitle: "system.start()",
    colorScheme: "primary" as const,
  },
  {
    id: "onFactChange",
    label: "onFactChange",
    subtitle: "facts mutated",
    colorScheme: "amber" as const,
  },
  {
    id: "onDerivation",
    label: "onDerivation",
    subtitle: "values recomputed",
    colorScheme: "violet" as const,
  },
  {
    id: "onResolve",
    label: "onResolve",
    subtitle: "requirements fulfilled",
    colorScheme: "emerald" as const,
  },
  {
    id: "onStop",
    label: "onStop",
    subtitle: "system.stop()",
    colorScheme: "red" as const,
  },
] as const;

const ANIMATION_STEPS = [
  "onInit",
  "arrow1",
  "onStart",
  "arrow2",
  "onFactChange",
  "arrow3",
  "onDerivation",
  "arrow4",
  "onResolve",
  "arrow5",
  "onStop",
] as const;

const NODE_WIDTH = 280;
const COL_GAP = 440;
const ROW_GAP = 280;

export const PluginLifecycleDiagram = memo(function PluginLifecycleDiagram() {
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

  // 2-column, 3-row zigzag:
  //   Row 0:  onInit (left)       →  onStart (right)
  //                                       │
  //   Row 1:  onFactChange (left) ←       │
  //                →  onDerivation (right)
  //                                       │
  //   Row 2:  onStop (left)       ←  onResolve (right)
  const nodes = useMemo<Node[]>(
    () => [
      {
        id: "onInit",
        type: "step",
        position: { x: 0, y: 0 },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[0].label,
          subtitle: STEPS[0].subtitle,
          icon: <Wrench size={28} weight="duotone" />,
          status: isStepActive("onInit") ? "active" : "idle",
          colorScheme: STEPS[0].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "onStart",
        type: "step",
        position: { x: COL_GAP, y: 0 },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[1].label,
          subtitle: STEPS[1].subtitle,
          icon: <Play size={28} weight="duotone" />,
          status: isStepActive("onStart") ? "active" : "idle",
          colorScheme: STEPS[1].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "onFactChange",
        type: "step",
        position: { x: 0, y: ROW_GAP },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[2].label,
          subtitle: STEPS[2].subtitle,
          icon: <Database size={28} weight="duotone" />,
          status: isStepActive("onFactChange") ? "active" : "idle",
          colorScheme: STEPS[2].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "onDerivation",
        type: "step",
        position: { x: COL_GAP, y: ROW_GAP },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[3].label,
          subtitle: STEPS[3].subtitle,
          icon: <FunctionIcon size={28} weight="duotone" />,
          status: isStepActive("onDerivation") ? "active" : "idle",
          colorScheme: STEPS[3].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "onResolve",
        type: "step",
        position: { x: 0, y: ROW_GAP * 2 },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[4].label,
          subtitle: STEPS[4].subtitle,
          icon: <ArrowsClockwise size={28} weight="duotone" />,
          status: isStepActive("onResolve") ? "active" : "idle",
          colorScheme: STEPS[4].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "onStop",
        type: "step",
        position: { x: COL_GAP, y: ROW_GAP * 2 },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[5].label,
          subtitle: STEPS[5].subtitle,
          icon: <Stop size={28} weight="duotone" />,
          status: isStepActive("onStop") ? "active" : "idle",
          colorScheme: STEPS[5].colorScheme,
        } satisfies StepNodeData,
      },
    ],
    [isStepActive],
  );

  const edges = useMemo<Edge[]>(
    () => [
      {
        // onInit → onStart (right)
        id: "onInit->onStart",
        source: "onInit",
        target: "onStart",
        type: "labeled",
        data: {
          label: "setup",
          active: isArrowActive("arrow1"),
          colorScheme: "slate",
        },
      },
      {
        // onStart → onFactChange (down-left)
        id: "onStart->onFactChange",
        source: "onStart",
        sourceHandle: "bottom",
        target: "onFactChange",
        targetHandle: "top",
        type: "labeled",
        data: {
          label: "running",
          active: isArrowActive("arrow2"),
          colorScheme: "primary",
        },
      },
      {
        // onFactChange → onDerivation (right)
        id: "onFactChange->onDerivation",
        source: "onFactChange",
        target: "onDerivation",
        type: "labeled",
        data: {
          label: "recompute",
          active: isArrowActive("arrow3"),
          colorScheme: "amber",
        },
      },
      {
        // onDerivation → onResolve (down-left)
        id: "onDerivation->onResolve",
        source: "onDerivation",
        sourceHandle: "bottom",
        target: "onResolve",
        targetHandle: "top",
        type: "labeled",
        data: {
          label: "reconcile",
          active: isArrowActive("arrow4"),
          colorScheme: "violet",
        },
      },
      {
        // onResolve → onStop (right)
        id: "onResolve->onStop",
        source: "onResolve",
        target: "onStop",
        type: "labeled",
        data: {
          label: "teardown",
          active: isArrowActive("arrow5"),
          colorScheme: "emerald",
        },
      },
    ],
    [isArrowActive],
  );

  return (
    <div className="plugin-lifecycle-diagram">
      <DiagramWrapper
        height={640}
        nodes={nodes}
        edges={edges}
        nodeTypes={diagramNodeTypes}
        edgeTypes={diagramEdgeTypes}
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
