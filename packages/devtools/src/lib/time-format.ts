export type TimeFormat = "ms" | "elapsed" | "clock";

export function formatTimestamp(
  ts: number,
  format: TimeFormat,
  baseTimestamp?: number,
): string {
  switch (format) {
    case "ms":
      return `${Math.round(ts)}ms`;

    case "elapsed": {
      const base = baseTimestamp ?? 0;
      const elapsed = (ts - base) / 1000;

      return `+${elapsed.toFixed(2)}s`;
    }

    case "clock":
      return new Date(ts).toLocaleTimeString(undefined, {
        hour12: false,
        fractionalSecondDigits: 3,
      } as Intl.DateTimeFormatOptions);
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }

  const minutes = Math.floor(ms / 60000);
  const seconds = (ms % 60000) / 1000;

  return `${minutes}m ${seconds.toFixed(1)}s`;
}

/** Format a timestamp as a human-readable relative age string */
export function formatAge(updatedAt: number | null, now?: number): string {
  if (!updatedAt) {
    return "–";
  }
  const ms = (now ?? Date.now()) - updatedAt;
  if (ms < 1000) {
    return "just now";
  }
  if (ms < 60_000) {
    return `${Math.round(ms / 1000)}s ago`;
  }
  if (ms < 3_600_000) {
    return `${Math.round(ms / 60_000)}m ago`;
  }

  return `${Math.round(ms / 3_600_000)}h ago`;
}
