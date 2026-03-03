interface CountBadgeProps {
  count: number;
  variant?: "active" | "default";
  className?: string;
}

export function CountBadge({
  count,
  variant = "default",
  className,
}: CountBadgeProps) {
  return (
    <span
      className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-1 text-[9px] font-semibold leading-none ${
        variant === "active"
          ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
      }${className ? ` ${className}` : ""}`}
    >
      {count}
    </span>
  );
}
