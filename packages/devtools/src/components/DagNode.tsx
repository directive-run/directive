import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { DagNodeStatus } from "../lib/types";
import { DAG_NODE_COLORS } from "../lib/colors";

interface DagNodeData {
  label: string;
  status: DagNodeStatus;
  color: string;
  selected: boolean;
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

export function DagNode({ data }: NodeProps) {
  const nodeData = data as unknown as DagNodeData;
  const { label, status, selected, agentState } = nodeData;
  const color = DAG_NODE_COLORS[status];

  return (
    <div
      className={`rounded-lg border-2 bg-zinc-900 px-4 py-3 shadow-lg transition-all ${
        selected ? "ring-2 ring-white/30" : ""
      } ${status === "running" ? "animate-pulse" : ""}`}
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Top} className="!bg-zinc-600 !w-2 !h-2" />

      <div className="flex items-center gap-2">
        <span style={{ color }} className="text-lg">{STATUS_ICONS[status]}</span>
        <div>
          <div className="text-sm font-medium text-zinc-100">{label}</div>
          {agentState && (
            <div className="text-[10px] text-zinc-500">
              {agentState.totalTokens.toLocaleString()} tokens &middot; {agentState.runCount} runs
            </div>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-zinc-600 !w-2 !h-2" />
    </div>
  );
}
