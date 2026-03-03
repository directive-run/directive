import type { Edge, Node } from "@xyflow/react";

export type NodeStatus = "idle" | "active" | "past" | "success" | "error";

export interface StepNodeData {
  label: string;
  subtitle?: string;
  icon?: React.ReactNode;
  tooltip?: { description: string; example?: string };
  status: NodeStatus;
  colorScheme: ColorScheme;
  [key: string]: unknown;
}

export type ColorScheme =
  | "primary"
  | "amber"
  | "violet"
  | "emerald"
  | "red"
  | "slate";

export type DiagramNode = Node<StepNodeData>;
export type DiagramEdge = Edge;

export interface AnimationConfig {
  totalPhases: number;
  interval: number;
  autoStart?: boolean;
  startDelay?: number;
}

export interface DiagramWrapperProps {
  height?: number | string;
  className?: string;
  interactive?: boolean;
  children: React.ReactNode;
}
