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
  { id: "loadConfig", label: "loadConfig", colorScheme: "primary" as const },
  {
    id: "authenticate",
    label: "authenticate",
    colorScheme: "primary" as const,
  },
  {
    id: "validateInput",
    label: "validateInput",
    colorScheme: "amber" as const,
  },
  {
    id: "processRequest",
    label: "processRequest",
    colorScheme: "emerald" as const,
  },
] as const;

const ANIMATION_STEPS = [
  "loadConfig",
  "authenticate",
  "arrow1",
  "validateInput",
  "arrow2",
  "processRequest",
] as const;

const NODE_WIDTH = 280;
const COL_GAP = 440;
const ROW_GAP = 280;

export const ConstraintDependencyDiagram = memo(
  function ConstraintDependencyDiagram() {
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

    // Layout: 2 parallel top nodes converging to 2 stacked center nodes
    //   loadConfig (left)    authenticate (right)
    //          \    after      / after
    //           validateInput
    //               | after
    //           processRequest
    // Center the middle column between the two top nodes
    const centerX = (COL_GAP + NODE_WIDTH) / 2 - NODE_WIDTH / 2;

    const nodes = useMemo<Node[]>(
      () => [
        {
          id: "loadConfig",
          type: "step",
          position: { x: 0, y: 0 },
          style: { width: NODE_WIDTH },
          data: {
            label: STEPS[0].label,
            status: isStepActive("loadConfig") ? "active" : "idle",
            colorScheme: STEPS[0].colorScheme,
          } satisfies StepNodeData,
        },
        {
          id: "authenticate",
          type: "step",
          position: { x: COL_GAP, y: 0 },
          style: { width: NODE_WIDTH },
          data: {
            label: STEPS[1].label,
            status: isStepActive("authenticate") ? "active" : "idle",
            colorScheme: STEPS[1].colorScheme,
          } satisfies StepNodeData,
        },
        {
          id: "validateInput",
          type: "step",
          position: { x: centerX, y: ROW_GAP + 60 },
          style: { width: NODE_WIDTH },
          data: {
            label: STEPS[2].label,
            status: isStepActive("validateInput") ? "active" : "idle",
            colorScheme: STEPS[2].colorScheme,
          } satisfies StepNodeData,
        },
        {
          id: "processRequest",
          type: "step",
          position: { x: centerX, y: ROW_GAP + 60 + ROW_GAP },
          style: { width: NODE_WIDTH },
          data: {
            label: STEPS[3].label,
            status: isStepActive("processRequest") ? "active" : "idle",
            colorScheme: STEPS[3].colorScheme,
          } satisfies StepNodeData,
        },
      ],
      [isStepActive, centerX],
    );

    const edges = useMemo<Edge[]>(
      () => [
        {
          id: "loadConfig->validateInput",
          source: "loadConfig",
          sourceHandle: "bottom",
          target: "validateInput",
          targetHandle: "top",
          type: "labeled",
          data: {
            label: "after",
            active: isArrowActive("arrow1"),
            colorScheme: "primary",
          },
        },
        {
          id: "authenticate->validateInput",
          source: "authenticate",
          sourceHandle: "bottom",
          target: "validateInput",
          targetHandle: "top",
          type: "labeled",
          data: {
            label: "after",
            active: isArrowActive("arrow1"),
            colorScheme: "primary",
          },
        },
        {
          id: "validateInput->processRequest",
          source: "validateInput",
          sourceHandle: "bottom",
          target: "processRequest",
          targetHandle: "top",
          type: "labeled",
          data: {
            label: "after",
            active: isArrowActive("arrow2"),
            colorScheme: "amber",
          },
        },
      ],
      [isArrowActive],
    );

    return (
      <div className="constraint-dependency-diagram">
        <DiagramWrapper
          height={600}
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
  },
);
