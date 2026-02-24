// M6: Loading skeleton placeholder (replaces "Loading..." text)

export function Skeleton({ rows = 4, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <div className="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          <div
            className="h-4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700"
            style={{ width: `${60 + (i * 7) % 30}%` }}
          />
        </div>
      ))}
    </div>
  )
}
