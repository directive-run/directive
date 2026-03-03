"use client";

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
    id: "loadUser",
    label: "loadUser",
    subtitle: "priority: 100",
    colorScheme: "primary" as const,
  },
  {
    id: "checkAuth",
    label: "checkAuth",
    subtitle: "priority: 90",
    colorScheme: "primary" as const,
  },
  {
    id: "validateCart",
    label: "validateCart",
    subtitle: "priority: 50",
    colorScheme: "amber" as const,
  },
  {
    id: "applyPromo",
    label: "applyPromo",
    subtitle: "priority: 40",
    colorScheme: "violet" as const,
  },
  {
    id: "checkout",
    label: "checkout",
    subtitle: "priority: 10",
    colorScheme: "emerald" as const,
  },
] as const;

const ANIMATION_STEPS = [
  "loadUser",
  "checkAuth",
  "arrow1",
  "validateCart",
  "arrow2",
  "applyPromo",
  "arrow3",
  "checkout",
] as const;

const NODE_WIDTH = 280;
const COL_GAP = 440;
const ROW_GAP = 280;

export const ConstraintPriorityDiagram = memo(
  function ConstraintPriorityDiagram() {
    const { phase, isPlaying, toggle } = useAnimationLoop({
      totalPhases: ANIMATION_STEPS.length,
      interval: 2000,
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

    // Layout: 2 parallel top nodes, then 3 stacked center nodes
    //   loadUser (left)    checkAuth (right)     ← p:100, p:90
    //          \              /
    //           validateCart                      ← p:50
    //               |
    //           applyPromo                        ← p:40
    //               |
    //            checkout                         ← p:10
    // Center the middle column between the two top nodes
    const centerX = (COL_GAP + NODE_WIDTH) / 2 - NODE_WIDTH / 2;

    const nodes = useMemo<Node[]>(
      () => [
        {
          id: "loadUser",
          type: "step",
          position: { x: 0, y: 0 },
          style: { width: NODE_WIDTH },
          data: {
            label: STEPS[0].label,
            subtitle: STEPS[0].subtitle,
            status: isStepActive("loadUser") ? "active" : "idle",
            colorScheme: STEPS[0].colorScheme,
          } satisfies StepNodeData,
        },
        {
          id: "checkAuth",
          type: "step",
          position: { x: COL_GAP, y: 0 },
          style: { width: NODE_WIDTH },
          data: {
            label: STEPS[1].label,
            subtitle: STEPS[1].subtitle,
            status: isStepActive("checkAuth") ? "active" : "idle",
            colorScheme: STEPS[1].colorScheme,
          } satisfies StepNodeData,
        },
        {
          id: "validateCart",
          type: "step",
          position: { x: centerX, y: ROW_GAP + 60 },
          style: { width: NODE_WIDTH },
          data: {
            label: STEPS[2].label,
            subtitle: STEPS[2].subtitle,
            status: isStepActive("validateCart") ? "active" : "idle",
            colorScheme: STEPS[2].colorScheme,
          } satisfies StepNodeData,
        },
        {
          id: "applyPromo",
          type: "step",
          position: { x: centerX, y: ROW_GAP + 60 + ROW_GAP },
          style: { width: NODE_WIDTH },
          data: {
            label: STEPS[3].label,
            subtitle: STEPS[3].subtitle,
            status: isStepActive("applyPromo") ? "active" : "idle",
            colorScheme: STEPS[3].colorScheme,
          } satisfies StepNodeData,
        },
        {
          id: "checkout",
          type: "step",
          position: { x: centerX, y: ROW_GAP + 60 + ROW_GAP * 2 },
          style: { width: NODE_WIDTH },
          data: {
            label: STEPS[4].label,
            subtitle: STEPS[4].subtitle,
            status: isStepActive("checkout") ? "active" : "idle",
            colorScheme: STEPS[4].colorScheme,
          } satisfies StepNodeData,
        },
      ],
      [isStepActive, centerX],
    );

    const edges = useMemo<Edge[]>(
      () => [
        {
          id: "loadUser->validateCart",
          source: "loadUser",
          sourceHandle: "bottom",
          target: "validateCart",
          targetHandle: "top",
          type: "labeled",
          data: { active: isArrowActive("arrow1"), colorScheme: "primary" },
        },
        {
          id: "checkAuth->validateCart",
          source: "checkAuth",
          sourceHandle: "bottom",
          target: "validateCart",
          targetHandle: "top",
          type: "labeled",
          data: { active: isArrowActive("arrow1"), colorScheme: "primary" },
        },
        {
          id: "validateCart->applyPromo",
          source: "validateCart",
          sourceHandle: "bottom",
          target: "applyPromo",
          targetHandle: "top",
          type: "labeled",
          data: { active: isArrowActive("arrow2"), colorScheme: "amber" },
        },
        {
          id: "applyPromo->checkout",
          source: "applyPromo",
          sourceHandle: "bottom",
          target: "checkout",
          targetHandle: "top",
          type: "labeled",
          data: { active: isArrowActive("arrow3"), colorScheme: "violet" },
        },
      ],
      [isArrowActive],
    );

    return (
      <div className="constraint-priority-diagram">
        <DiagramWrapper
          height={840}
          nodes={nodes}
          edges={edges}
          nodeTypes={diagramNodeTypes}
          edgeTypes={diagramEdgeTypes}
          fitViewOptions={{ padding: 0.2 }}
        />

        <DiagramToolbar
          steps={STEPS}
          activeStepId={phase >= 0 ? (ANIMATION_STEPS[phase] ?? null) : null}
          isPlaying={isPlaying}
          onToggle={toggle}
        />
      </div>
    );
  },
);
