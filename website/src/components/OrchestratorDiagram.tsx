"use client";

import {
  CurrencyCircleDollar,
  Database,
  Funnel,
  PaperPlaneTilt,
  Robot,
  ShieldCheck,
  Stamp,
  UserCircle,
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
  { id: "input", label: "User Input" },
  { id: "guardrails", label: "Guardrails / Approval / Budget" },
  { id: "agent", label: "Agent Runner" },
  { id: "output", label: "Output Guardrails / Memory" },
  { id: "response", label: "Response" },
] as const;

const ANIMATION_STEPS = [
  "input",
  "arrow-fan-out",
  "guardrails",
  "approval",
  "budget",
  "arrow-converge",
  "agent",
  "arrow-fan-out-2",
  "outputGuardrails",
  "memory",
  "arrow-converge-2",
  "response",
] as const;

const NODE_W = 260;
const NODE_W_SM = 220;
const ROW_GAP = 300;
const COL_GAP = 280;

export const OrchestratorDiagram = memo(function OrchestratorDiagram() {
  const { phase, isPlaying, toggle } = useAnimationLoop({
    totalPhases: ANIMATION_STEPS.length,
    interval: 1800,
  });

  const currentStep = phase >= 0 ? ANIMATION_STEPS[phase] : null;

  const isActive = useCallback(
    (id: string) => currentStep === id,
    [currentStep],
  );

  const isGroupActive = useCallback(
    (ids: string[]) => ids.some((id) => currentStep === id),
    [currentStep],
  );

  // Center X for the single-column nodes
  const centerX = COL_GAP;

  // Row 2: three parallel nodes
  const row2Left = 0;
  const row2Center = COL_GAP;
  const row2Right = COL_GAP * 2;

  // Row 4: two parallel nodes
  const row4Left = COL_GAP * 0.5;
  const row4Right = COL_GAP * 1.5;

  const nodes = useMemo<Node[]>(
    () => [
      // Row 1: User Input
      {
        id: "input",
        type: "step",
        position: { x: centerX, y: 0 },
        style: { width: NODE_W },
        data: {
          label: "User Input",
          subtitle: "Natural language prompt",
          icon: <UserCircle size={28} weight="duotone" />,
          status: isActive("input") ? "active" : "idle",
          colorScheme: "primary",
        } satisfies StepNodeData,
      },
      // Row 2: Three parallel gate nodes
      {
        id: "guardrails",
        type: "step",
        position: { x: row2Left, y: ROW_GAP },
        style: { width: NODE_W_SM },
        data: {
          label: "Input Guardrails",
          subtitle: "PII & injection scan",
          icon: <ShieldCheck size={28} weight="duotone" />,
          status: isGroupActive(["guardrails", "approval", "budget"])
            ? "active"
            : "idle",
          colorScheme: "red",
        } satisfies StepNodeData,
      },
      {
        id: "approval",
        type: "step",
        position: { x: row2Center, y: ROW_GAP },
        style: { width: NODE_W_SM },
        data: {
          label: "Approval Gate",
          subtitle: "Human-in-the-loop",
          icon: <Stamp size={28} weight="duotone" />,
          status: isGroupActive(["guardrails", "approval", "budget"])
            ? "active"
            : "idle",
          colorScheme: "amber",
        } satisfies StepNodeData,
      },
      {
        id: "budget",
        type: "step",
        position: { x: row2Right, y: ROW_GAP },
        style: { width: NODE_W_SM },
        data: {
          label: "Budget Check",
          subtitle: "Token & cost limits",
          icon: <CurrencyCircleDollar size={28} weight="duotone" />,
          status: isGroupActive(["guardrails", "approval", "budget"])
            ? "active"
            : "idle",
          colorScheme: "amber",
        } satisfies StepNodeData,
      },
      // Row 3: Agent Runner
      {
        id: "agent",
        type: "step",
        position: { x: centerX, y: ROW_GAP * 2 },
        style: { width: NODE_W },
        data: {
          label: "Agent Runner",
          subtitle: "LLM execution with retry",
          icon: <Robot size={28} weight="duotone" />,
          status: isActive("agent") ? "active" : "idle",
          colorScheme: "emerald",
        } satisfies StepNodeData,
      },
      // Row 4: Two parallel output nodes
      {
        id: "outputGuardrails",
        type: "step",
        position: { x: row4Left, y: ROW_GAP * 3 },
        style: { width: NODE_W_SM },
        data: {
          label: "Output Guardrails",
          subtitle: "Response safety scan",
          icon: <Funnel size={28} weight="duotone" />,
          status: isGroupActive(["outputGuardrails", "memory"])
            ? "active"
            : "idle",
          colorScheme: "red",
        } satisfies StepNodeData,
      },
      {
        id: "memory",
        type: "step",
        position: { x: row4Right, y: ROW_GAP * 3 },
        style: { width: NODE_W_SM },
        data: {
          label: "Memory Store",
          subtitle: "Conversation history",
          icon: <Database size={28} weight="duotone" />,
          status: isGroupActive(["outputGuardrails", "memory"])
            ? "active"
            : "idle",
          colorScheme: "violet",
        } satisfies StepNodeData,
      },
      // Row 5: Response
      {
        id: "response",
        type: "step",
        position: { x: centerX, y: ROW_GAP * 4 },
        style: { width: NODE_W },
        data: {
          label: "Response",
          subtitle: "Validated agent output",
          icon: <PaperPlaneTilt size={28} weight="duotone" />,
          status: isActive("response") ? "active" : "idle",
          colorScheme: "primary",
        } satisfies StepNodeData,
      },
    ],
    [
      isActive,
      isGroupActive,
      centerX,
      row2Left,
      row2Center,
      row2Right,
      row4Left,
      row4Right,
    ],
  );

  const edges = useMemo<Edge[]>(
    () => [
      // Fan-out: Input → 3 gates
      {
        id: "input->guardrails",
        source: "input",
        sourceHandle: "bottom",
        target: "guardrails",
        targetHandle: "top",
        type: "labeled",
        data: {
          active: isActive("arrow-fan-out"),
          colorScheme: "primary",
          smooth: true,
        },
      },
      {
        id: "input->approval",
        source: "input",
        sourceHandle: "bottom",
        target: "approval",
        targetHandle: "top",
        type: "labeled",
        data: {
          active: isActive("arrow-fan-out"),
          colorScheme: "primary",
          smooth: true,
        },
      },
      {
        id: "input->budget",
        source: "input",
        sourceHandle: "bottom",
        target: "budget",
        targetHandle: "top",
        type: "labeled",
        data: {
          active: isActive("arrow-fan-out"),
          colorScheme: "primary",
          smooth: true,
        },
      },
      // Converge: 3 gates → Agent
      {
        id: "guardrails->agent",
        source: "guardrails",
        sourceHandle: "bottom",
        target: "agent",
        targetHandle: "top",
        type: "labeled",
        data: {
          active: isActive("arrow-converge"),
          colorScheme: "red",
          smooth: true,
        },
      },
      {
        id: "approval->agent",
        source: "approval",
        sourceHandle: "bottom",
        target: "agent",
        targetHandle: "top",
        type: "labeled",
        data: {
          active: isActive("arrow-converge"),
          colorScheme: "amber",
          smooth: true,
        },
      },
      {
        id: "budget->agent",
        source: "budget",
        sourceHandle: "bottom",
        target: "agent",
        targetHandle: "top",
        type: "labeled",
        data: {
          active: isActive("arrow-converge"),
          colorScheme: "amber",
          smooth: true,
        },
      },
      // Fan-out 2: Agent → Output + Memory
      {
        id: "agent->outputGuardrails",
        source: "agent",
        sourceHandle: "bottom",
        target: "outputGuardrails",
        targetHandle: "top",
        type: "labeled",
        data: {
          active: isActive("arrow-fan-out-2"),
          colorScheme: "emerald",
          smooth: true,
        },
      },
      {
        id: "agent->memory",
        source: "agent",
        sourceHandle: "bottom",
        target: "memory",
        targetHandle: "top",
        type: "labeled",
        data: {
          active: isActive("arrow-fan-out-2"),
          colorScheme: "emerald",
          smooth: true,
        },
      },
      // Converge 2: Output + Memory → Response
      {
        id: "outputGuardrails->response",
        source: "outputGuardrails",
        sourceHandle: "bottom",
        target: "response",
        targetHandle: "top",
        type: "labeled",
        data: {
          active: isActive("arrow-converge-2"),
          colorScheme: "red",
          smooth: true,
        },
      },
      {
        id: "memory->response",
        source: "memory",
        sourceHandle: "bottom",
        target: "response",
        targetHandle: "top",
        type: "labeled",
        data: {
          active: isActive("arrow-converge-2"),
          colorScheme: "violet",
          smooth: true,
        },
      },
    ],
    [isActive],
  );

  const activeStepId = useMemo(() => {
    if (phase < 0) {
      return null;
    }

    const step = ANIMATION_STEPS[phase];
    if (step === "arrow-fan-out" || step === "arrow-converge") {
      return "guardrails";
    }
    if (step === "guardrails" || step === "approval" || step === "budget") {
      return "guardrails";
    }
    if (step === "arrow-fan-out-2" || step === "arrow-converge-2") {
      return "output";
    }
    if (step === "outputGuardrails" || step === "memory") {
      return "output";
    }

    return step ?? null;
  }, [phase]);

  return (
    <div className="orchestrator-diagram">
      <DiagramWrapper
        height={920}
        className="diagram-semi-compact"
        nodes={nodes}
        edges={edges}
        nodeTypes={diagramNodeTypes}
        edgeTypes={diagramEdgeTypes}
        fitViewOptions={{ padding: 0.12 }}
      />

      <DiagramToolbar
        steps={STEPS}
        activeStepId={activeStepId}
        isPlaying={isPlaying}
        onToggle={toggle}
      />
    </div>
  );
});
