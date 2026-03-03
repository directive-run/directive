interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = "currentColor",
  className,
}: SparklineProps) {
  if (data.length === 0) {
    return null;
  }

  if (data.length === 1) {
    // Single point — horizontal line at midpoint
    return (
      <svg
        width={width}
        height={height}
        className={className}
        aria-hidden="true"
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={color}
          strokeWidth={1.5}
        />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;
  const drawHeight = height - padding * 2;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = padding + drawHeight - ((v - min) / range) * drawHeight;

      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className={className} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
