"use client";

import {
  AppWindow,
  Browser,
  CirclesThreePlus,
  ListBullets,
  Plugs,
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
    id: "app",
    label: "Your App",
    subtitle: "orchestrator calls",
    colorScheme: "primary" as const,
  },
  {
    id: "orchestrator",
    label: "Orchestrator",
    subtitle: "debug: true",
    colorScheme: "amber" as const,
  },
  {
    id: "timeline",
    label: "Timeline",
    subtitle: "event log",
    colorScheme: "emerald" as const,
  },
  {
    id: "server",
    label: "DevTools Server",
    subtitle: "WebSocket",
    colorScheme: "violet" as const,
  },
  {
    id: "ui",
    label: "DevTools UI",
    subtitle: "browser",
    colorScheme: "red" as const,
  },
] as const;

const ANIMATION_STEPS = [
  "app",
  "arrow1",
  "orchestrator",
  "arrow2",
  "timeline",
  "arrow3",
  "server",
  "arrow4",
  "ui",
] as const;

const NODE_WIDTH = 440;
const ROW_GAP = 280;

export const DevtoolsFlowDiagram = memo(function DevtoolsFlowDiagram() {
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
  //   Your App
  //       ↓
  //   Orchestrator (debug: true)
  //       ↓
  //   Timeline (event log)
  //       ↓
  //   DevTools Server (WebSocket)
  //       ↓
  //   DevTools UI (browser)
  const nodes = useMemo<Node[]>(
    () => [
      {
        id: "app",
        type: "step",
        position: { x: 0, y: 0 },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[0].label,
          subtitle: STEPS[0].subtitle,
          icon: <AppWindow size={28} weight="duotone" />,
          status: isStepActive("app") ? "active" : "idle",
          colorScheme: STEPS[0].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "orchestrator",
        type: "step",
        position: { x: 0, y: ROW_GAP },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[1].label,
          subtitle: STEPS[1].subtitle,
          icon: <CirclesThreePlus size={28} weight="duotone" />,
          status: isStepActive("orchestrator") ? "active" : "idle",
          colorScheme: STEPS[1].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "timeline",
        type: "step",
        position: { x: 0, y: ROW_GAP * 2 },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[2].label,
          subtitle: STEPS[2].subtitle,
          icon: <ListBullets size={28} weight="duotone" />,
          status: isStepActive("timeline") ? "active" : "idle",
          colorScheme: STEPS[2].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "server",
        type: "step",
        position: { x: 0, y: ROW_GAP * 3 },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[3].label,
          subtitle: STEPS[3].subtitle,
          icon: <Plugs size={28} weight="duotone" />,
          status: isStepActive("server") ? "active" : "idle",
          colorScheme: STEPS[3].colorScheme,
        } satisfies StepNodeData,
      },
      {
        id: "ui",
        type: "step",
        position: { x: 0, y: ROW_GAP * 4 },
        style: { width: NODE_WIDTH },
        data: {
          label: STEPS[4].label,
          subtitle: STEPS[4].subtitle,
          icon: <Browser size={28} weight="duotone" />,
          status: isStepActive("ui") ? "active" : "idle",
          colorScheme: STEPS[4].colorScheme,
        } satisfies StepNodeData,
      },
    ],
    [isStepActive],
  );

  const edges = useMemo<Edge[]>(
    () => [
      {
        id: "app->orchestrator",
        source: "app",
        sourceHandle: "bottom",
        target: "orchestrator",
        targetHandle: "top",
        type: "labeled",
        data: {
          label: "run",
          active: isArrowActive("arrow1"),
          colorScheme: "primary",
        },
      },
      {
        id: "orchestrator->timeline",
        source: "orchestrator",
        sourceHandle: "bottom",
        target: "timeline",
        targetHandle: "top",
        type: "labeled",
        data: {
          label: "record",
          active: isArrowActive("arrow2"),
          colorScheme: "amber",
        },
      },
      {
        id: "timeline->server",
        source: "timeline",
        sourceHandle: "bottom",
        target: "server",
        targetHandle: "top",
        type: "labeled",
        data: {
          label: "stream",
          active: isArrowActive("arrow3"),
          colorScheme: "emerald",
        },
      },
      {
        id: "server->ui",
        source: "server",
        sourceHandle: "bottom",
        target: "ui",
        targetHandle: "top",
        type: "labeled",
        data: {
          label: "visualize",
          active: isArrowActive("arrow4"),
          colorScheme: "violet",
        },
      },
    ],
    [isArrowActive],
  );

  return (
    <div className="devtools-flow-diagram">
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
