import type { Node } from "@xyflow/react";

const SCALE = 1.5;

/** Create a node positioned at an explicit (x, y). */
export function positionNode<T extends Record<string, unknown>>(
  id: string,
  type: string,
  x: number,
  y: number,
  data: T,
): Node<T> {
  return { id, type, position: { x: x * SCALE, y: y * SCALE }, data };
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
    position: { x: (startX + i * spacing) * SCALE, y: y * SCALE },
  }));
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
    position: { x: x * SCALE, y: (startY + i * spacing) * SCALE },
  }));
}

/** Create a simple edge. */
export function edge(
  source: string,
  target: string,
  options?: {
    label?: string;
    animated?: boolean;
    style?: React.CSSProperties;
    type?: string;
    data?: Record<string, unknown>;
    sourceHandle?: string;
    targetHandle?: string;
  },
) {
  return {
    id: `${source}->${target}`,
    source,
    target,
    ...options,
  };
}
