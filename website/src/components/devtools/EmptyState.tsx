// M3: Shared empty state component (replaces 8 duplicate patterns)

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-48 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
      {message}
    </div>
  )
}
