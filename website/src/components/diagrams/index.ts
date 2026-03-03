// Types
export type {
  StepNodeData,
  ColorScheme,
  NodeStatus,
  AnimationConfig,
  DiagramNode,
  DiagramEdge,
} from "./types";

// Theme
export {
  getNodeColors,
  getEdgeColor,
  getEdgeColorDark,
} from "./theme";

// Wrapper & Controls
export { DiagramWrapper } from "./DiagramWrapper";
export { AnimationController } from "./AnimationController";
export { DiagramToolbar } from "./DiagramToolbar";

// Layout
export {
  positionNode,
  horizontalRow,
  verticalColumn,
  edge,
} from "./layout-utils";

// Hooks
export { useAnimationLoop } from "./hooks/useAnimationLoop";
export { useDiagramTheme } from "./hooks/useDiagramTheme";

// Node types
export { StepNode } from "./nodes/StepNode";

// Edge types
export { LabeledEdge } from "./edges/LabeledEdge";

import { LabeledEdge } from "./edges/LabeledEdge";
// Convenience: pre-built nodeTypes/edgeTypes maps for ReactFlow
import { StepNode } from "./nodes/StepNode";

export const diagramNodeTypes = {
  step: StepNode,
} as const;

export const diagramEdgeTypes = {
  labeled: LabeledEdge,
} as const;
