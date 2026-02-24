import type { Node } from '@xyflow/react'

/** Create a node positioned at an explicit (x, y). */
export function positionNode<T extends Record<string, unknown>>(
  id: string,
  type: string,
  x: number,
  y: number,
  data: T,
): Node<T> {
  return { id, type, position: { x, y }, data }
}

/** Arrange nodes in a horizontal row, evenly spaced. */
export function horizontalRow<T extends Record<string, unknown>>(
  nodes: { id: string; type: string; data: T }[],
  startX: number,
  y: number,
  spacing: number,
): Node<T>[] {
  return nodes.map((n, i) => ({
    ...n,
    position: { x: startX + i * spacing, y },
  }))
}

/** Arrange nodes in a vertical column. */
export function verticalColumn<T extends Record<string, unknown>>(
  nodes: { id: string; type: string; data: T }[],
  x: number,
  startY: number,
  spacing: number,
): Node<T>[] {
  return nodes.map((n, i) => ({
    ...n,
    position: { x, y: startY + i * spacing },
  }))
}

/** Create a simple edge. */
export function edge(
  source: string,
  target: string,
  options?: {
    label?: string
    animated?: boolean
    style?: React.CSSProperties
    type?: string
    data?: Record<string, unknown>
    sourceHandle?: string
    targetHandle?: string
  },
) {
  return {
    id: `${source}->${target}`,
    source,
    target,
    ...options,
  }
}
