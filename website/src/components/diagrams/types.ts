import type { Node, Edge } from '@xyflow/react'

export type NodeStatus = 'idle' | 'active' | 'past' | 'success' | 'error'

export interface StepNodeData {
  label: string
  subtitle?: string
  tooltip?: { description: string; example?: string }
  status: NodeStatus
  colorScheme: ColorScheme
  [key: string]: unknown
}

export interface StatusNodeData {
  label: string
  status: NodeStatus
  icon?: string
  colorScheme: ColorScheme
  [key: string]: unknown
}

export interface LayerNodeData {
  label: string
  active: boolean
  colorScheme: ColorScheme
  width: number
  height: number
  [key: string]: unknown
}

export interface CircleNodeData {
  label: string
  sublabel?: string
  status: NodeStatus
  colorScheme: ColorScheme
  [key: string]: unknown
}

export interface BadgeNodeData {
  text: string
  active: boolean
  [key: string]: unknown
}

export type ColorScheme = 'primary' | 'amber' | 'violet' | 'emerald' | 'red' | 'slate'

export type DiagramNode = Node<StepNodeData | StatusNodeData | LayerNodeData | CircleNodeData | BadgeNodeData>
export type DiagramEdge = Edge

export interface AnimationConfig {
  totalPhases: number
  interval: number
  autoStart?: boolean
  startDelay?: number
}

export interface DiagramWrapperProps {
  height?: number | string
  className?: string
  interactive?: boolean
  children: React.ReactNode
}
