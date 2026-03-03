import { Handle, type NodeProps, Position } from "@xyflow/react";
import { DAG_NODE_COLORS } from "../lib/colors";
import type { DagNodeStatus } from "../lib/types";

export interface DagNodeData {
  label: string;
  status: DagNodeStatus;
  color: string;
  agentState?: {
    status: string;
    totalTokens: number;
    runCount: number;
  };
  [key: string]: unknown;
}

const STATUS_ICONS: Record<DagNodeStatus, string> = {
  pending: "○",
  ready: "◎",
  running: "◉",
  completed: "●",
  error: "✕",
  skipped: "⊘",
};

export function DagNode({ data, selected }: NodeProps) {
  const { label, status, agentState } = data as DagNodeData;
  const color = DAG_NODE_COLORS[status];

  return (
    <div
      className={`rounded-lg border-2 bg-zinc-900 px-4 py-3 shadow-lg transition-all ${
        selected ? "ring-2 ring-white/30" : ""
      } ${status === "running" ? "motion-safe:animate-pulse" : ""}`}
      style={{ borderColor: color }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-zinc-600 !w-2 !h-2"
      />

      <div className="flex items-center gap-2">
        <span style={{ color }} className="text-lg">
          {STATUS_ICONS[status]}
        </span>
        <div>
          <div className="text-sm font-medium text-zinc-100">{label}</div>
          {agentState && (
            <div className="text-[10px] text-zinc-500">
              {agentState.totalTokens.toLocaleString()} tokens &middot;{" "}
              {agentState.runCount} runs
            </div>
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-zinc-600 !w-2 !h-2"
      />
    </div>
  );
}
