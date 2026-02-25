// Types
export type {
  StepNodeData,
  StatusNodeData,
  LayerNodeData,
  CircleNodeData,
  BadgeNodeData,
  ColorScheme,
  NodeStatus,
  AnimationConfig,
  DiagramNode,
  DiagramEdge,
} from './types'

// Theme
export {
  getNodeColors,
  getEdgeColor,
  getEdgeColorDark,
  LAYER_COLORS,
} from './theme'

// Wrapper & Controls
export { DiagramWrapper } from './DiagramWrapper'
export { AnimationController } from './AnimationController'

// Layout
export { positionNode, horizontalRow, verticalColumn, edge } from './layout-utils'

// Hooks
export { useAnimationLoop } from './hooks/useAnimationLoop'
export { useDiagramTheme } from './hooks/useDiagramTheme'

// Node types
export { StepNode } from './nodes/StepNode'
export { StatusNode } from './nodes/StatusNode'
export { LayerNode } from './nodes/LayerNode'
export { CircleNode } from './nodes/CircleNode'
export { BadgeNode } from './nodes/BadgeNode'

// Edge types
export { AnimatedFlowEdge } from './edges/AnimatedFlowEdge'
export { LabeledEdge } from './edges/LabeledEdge'
export { FeedbackEdge } from './edges/FeedbackEdge'

// Convenience: pre-built nodeTypes/edgeTypes maps for ReactFlow
import { StepNode } from './nodes/StepNode'
import { StatusNode } from './nodes/StatusNode'
import { LayerNode } from './nodes/LayerNode'
import { CircleNode } from './nodes/CircleNode'
import { BadgeNode } from './nodes/BadgeNode'
import { AnimatedFlowEdge } from './edges/AnimatedFlowEdge'
import { LabeledEdge } from './edges/LabeledEdge'
import { FeedbackEdge } from './edges/FeedbackEdge'

export const diagramNodeTypes = {
  step: StepNode,
  status: StatusNode,
  layer: LayerNode,
  circle: CircleNode,
  badge: BadgeNode,
} as const

export const diagramEdgeTypes = {
  animated: AnimatedFlowEdge,
  labeled: LabeledEdge,
  feedback: FeedbackEdge,
} as const
