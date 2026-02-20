import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface CostChartProps {
  data: { agentId: string; tokens: number; timestamp: number }[];
}

export function CostChart({ data }: CostChartProps) {
  // Aggregate tokens by agent
  const chartData = useMemo(() => {
    const byAgent = new Map<string, number>();
    for (const d of data) {
      byAgent.set(d.agentId, (byAgent.get(d.agentId) ?? 0) + d.tokens);
    }

    return Array.from(byAgent)
      .map(([agentId, tokens]) => ({ agentId, tokens }))
      .sort((a, b) => b.tokens - a.tokens);
  }, [data]);

  if (chartData.length === 0) {
    return null;
  }

  return (
    <div className="h-48 w-full rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
          <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} />
          <YAxis
            type="category"
            dataKey="agentId"
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            axisLine={false}
            width={100}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: "8px",
              fontSize: "12px",
              color: "#e4e4e7",
            }}
            formatter={(value: number) => [value.toLocaleString(), "Tokens"]}
          />
          <Bar
            dataKey="tokens"
            fill="#6366f1"
            radius={[0, 4, 4, 0]}
            maxBarSize={24}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
