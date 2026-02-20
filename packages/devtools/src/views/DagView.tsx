import { useMemo, useCallback, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  type OnNodesChange,
  type OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { DebugEvent, DevToolsSnapshot, DagNodeStatus } from "../lib/types";
import { DAG_NODE_COLORS } from "../lib/colors";
import { DagNode } from "../components/DagNode";

interface DagViewProps {
  events: DebugEvent[];
  snapshot: DevToolsSnapshot | null;
}

const nodeTypes: NodeTypes = {
  agent: DagNode,
};

interface DagNodeState {
  agentId: string;
  status: DagNodeStatus;
  deps: string[];
}

/** Extract DAG structure from events */
function buildDagFromEvents(events: DebugEvent[]): Map<string, DagNodeState> | null {
  const dagEvents = events.filter(
    (e) => e.type === "dag_node_update" || e.type === "pattern_start" || e.type === "pattern_complete",
  );

  if (dagEvents.length === 0) {
    return null;
  }

  const nodes = new Map<string, DagNodeState>();

  for (const event of dagEvents) {
    if (event.type === "dag_node_update") {
      const nodeId = (event as Record<string, unknown>).nodeId as string;
      const status = (event as Record<string, unknown>).status as DagNodeStatus;
      const existing = nodes.get(nodeId);
      if (existing) {
        existing.status = status;
      } else {
        nodes.set(nodeId, { agentId: nodeId, status, deps: [] });
      }
    }
  }

  return nodes.size > 0 ? nodes : null;
}

/** Build DAG from snapshot agent data when no DAG events exist */
function buildDagFromSnapshot(snapshot: DevToolsSnapshot): Map<string, DagNodeState> {
  const nodes = new Map<string, DagNodeState>();

  for (const [agentId, state] of Object.entries(snapshot.agents)) {
    let status: DagNodeStatus = "pending";
    if (state.status === "completed") {
      status = "completed";
    } else if (state.status === "running") {
      status = "running";
    } else if (state.status === "error") {
      status = "error";
    }

    nodes.set(agentId, { agentId, status, deps: [] });
  }

  return nodes;
}

export function DagView({ events, snapshot }: DagViewProps) {
  const dagData = useMemo(() => {
    const fromEvents = buildDagFromEvents(events);
    if (fromEvents) {
      return fromEvents;
    }
    if (snapshot) {
      return buildDagFromSnapshot(snapshot);
    }

    return null;
  }, [events, snapshot]);

  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Build React Flow nodes/edges
  const { initialNodes, initialEdges } = useMemo(() => {
    if (!dagData) {
      return { initialNodes: [], initialEdges: [] };
    }

    const nodeArray = Array.from(dagData.values());
    const nodes: Node[] = nodeArray.map((n, i) => ({
      id: n.agentId,
      type: "agent",
      position: { x: 200 + (i % 3) * 250, y: 80 + Math.floor(i / 3) * 150 },
      data: {
        label: n.agentId,
        status: n.status,
        color: DAG_NODE_COLORS[n.status],
        selected: selectedNode === n.agentId,
        agentState: snapshot?.agents[n.agentId],
      },
    }));

    const edges: Edge[] = [];
    for (const node of nodeArray) {
      for (const dep of node.deps) {
        edges.push({
          id: `${dep}->${node.agentId}`,
          source: dep,
          target: node.agentId,
          animated: node.status === "running",
          style: {
            stroke: DAG_NODE_COLORS[node.status],
            strokeWidth: 2,
          },
        });
      }
    }

    return { initialNodes: nodes, initialEdges: edges };
  }, [dagData, snapshot, selectedNode]);

  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);

  // Update nodes/edges when data changes
  useMemo(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  if (!dagData || dagData.size === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <div className="text-center">
          <div className="mb-2 text-4xl">⬡</div>
          <p>No DAG execution detected</p>
          <p className="mt-1 text-xs">Run a DAG pattern to see the visualization</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_e, node) => setSelectedNode(
            selectedNode === node.id ? null : node.id,
          )}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
          className="bg-zinc-950"
        >
          <Background color="#27272a" gap={20} />
          <Controls className="[&>button]:!bg-zinc-800 [&>button]:!border-zinc-700 [&>button]:!text-zinc-300" />
        </ReactFlow>
      </div>

      {/* Detail panel */}
      {selectedNode && snapshot?.agents[selectedNode] && (
        <div className="w-72 shrink-0 overflow-auto border-l border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{selectedNode}</h3>
            <button
              onClick={() => setSelectedNode(null)}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-500">Status</span>
              <span className="text-zinc-300">{snapshot.agents[selectedNode]!.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Tokens</span>
              <span className="text-zinc-300">{snapshot.agents[selectedNode]!.totalTokens.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Runs</span>
              <span className="text-zinc-300">{snapshot.agents[selectedNode]!.runCount}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
