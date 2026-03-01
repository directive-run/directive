// Shared empty state component (replaces 8 duplicate patterns)

interface EmptyStateProps {
  message: string
  icon?: React.ReactNode
  action?: { label: string; onClick: () => void }
}

export function EmptyState({ message, icon, action }: EmptyStateProps) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center">
      {icon && (
        <div className="text-zinc-300 dark:text-zinc-600">{icon}</div>
      )}
      <p className="text-sm text-zinc-400 dark:text-zinc-500">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="cursor-pointer rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
