import {
  Background,
  Controls,
  type Edge,
  type Node,
  type NodeTypes,
  type OnEdgesChange,
  type OnNodesChange,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";
import { DagNode } from "../components/DagNode";
import { DAG_NODE_COLORS } from "../lib/colors";
import {
  type DagNodeStatus,
  type DebugEvent,
  type DevToolsSnapshot,
  isDagNodeUpdate,
} from "../lib/types";

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
function buildDagFromEvents(
  events: DebugEvent[],
): Map<string, DagNodeState> | null {
  const dagEvents = events.filter(
    (e) =>
      e.type === "dag_node_update" ||
      e.type === "pattern_start" ||
      e.type === "pattern_complete",
  );

  if (dagEvents.length === 0) {
    return null;
  }

  const nodes = new Map<string, DagNodeState>();

  for (const event of dagEvents) {
    if (isDagNodeUpdate(event)) {
      const existing = nodes.get(event.nodeId);
      if (existing) {
        existing.status = event.status;
        if (event.deps) {
          existing.deps = event.deps;
        }
      } else {
        nodes.set(event.nodeId, {
          agentId: event.nodeId,
          status: event.status,
          deps: event.deps ?? [],
        });
      }
    }
  }

  return nodes.size > 0 ? nodes : null;
}

/** Build DAG from snapshot agent data when no DAG events exist */
function buildDagFromSnapshot(
  snapshot: DevToolsSnapshot,
): Map<string, DagNodeState> {
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

    const rawDeps = (state as Record<string, unknown>).deps;
    const deps = Array.isArray(rawDeps)
      ? rawDeps.filter((d): d is string => typeof d === "string")
      : [];
    nodes.set(agentId, { agentId, status, deps });
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

    // Topological layout: assign layers by dependency depth
    const layers = new Map<string, number>();
    function getLayer(id: string, visited = new Set<string>()): number {
      if (layers.has(id)) {
        return layers.get(id)!;
      }
      if (visited.has(id)) {
        return 0; // cycle guard
      }
      visited.add(id);
      const node = dagData!.get(id);
      if (!node || node.deps.length === 0) {
        layers.set(id, 0);

        return 0;
      }
      const maxParent = Math.max(...node.deps.map((d) => getLayer(d, visited)));
      const layer = maxParent + 1;
      layers.set(id, layer);

      return layer;
    }
    for (const n of nodeArray) {
      getLayer(n.agentId);
    }

    // Group by layer for horizontal positioning
    const layerGroups = new Map<number, string[]>();
    for (const n of nodeArray) {
      const layer = layers.get(n.agentId) ?? 0;
      if (!layerGroups.has(layer)) {
        layerGroups.set(layer, []);
      }
      layerGroups.get(layer)!.push(n.agentId);
    }

    const nodes: Node[] = nodeArray.map((n) => {
      const layer = layers.get(n.agentId) ?? 0;
      const group = layerGroups.get(layer)!;
      const indexInLayer = group.indexOf(n.agentId);
      const totalInLayer = group.length;
      const xOffset = (indexInLayer - (totalInLayer - 1) / 2) * 250;

      return {
        id: n.agentId,
        type: "agent",
        position: { x: 400 + xOffset, y: 80 + layer * 150 },
        data: {
          label: n.agentId,
          status: n.status,
          color: DAG_NODE_COLORS[n.status],
          agentState: snapshot?.agents[n.agentId],
        },
      };
    });

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
  }, [dagData, snapshot]);

  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);

  // Update nodes/edges when data changes
  useEffect(() => {
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
          <p className="mt-1 text-xs">
            Run a DAG pattern to see the visualization
          </p>
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
          onNodeClick={(_e, node) =>
            setSelectedNode(selectedNode === node.id ? null : node.id)
          }
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
              aria-label="Close detail panel"
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-500">Status</span>
              <span className="text-zinc-300">
                {snapshot.agents[selectedNode]!.status}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Tokens</span>
              <span className="text-zinc-300">
                {snapshot.agents[selectedNode]!.totalTokens.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Runs</span>
              <span className="text-zinc-300">
                {snapshot.agents[selectedNode]!.runCount}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
